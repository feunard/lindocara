import { MONSTER_ACTIONS, MONSTER_SPECIAL_ACTIONS } from "@lindocara/engine/combat-actions.js";
import {
  addThreat,
  CONTRIBUTION_EXPIRES_MS,
  highestThreat,
  initialProximityThreat,
  THREAT_EXPIRES_MS,
  THREAT_LEASH_DISTANCE,
} from "@lindocara/engine/cooperation.js";
import {
  GUARD_ATTACK_COOLDOWN_MS,
  GUARD_ATTACK_RANGE,
  GUARD_DAMAGE,
  GUARD_DETECTION_RANGE,
  GUARD_SPEED,
  MONSTER_AGGRO_RANGE,
  MONSTER_ATTACK_COOLDOWN_MS,
  MONSTER_RESPAWN_MS,
  pointDistance,
  resolveTerrain,
  safeZoneShelters,
} from "@lindocara/engine/game.js";
import { PLAYER_SIZE, TICK_DT, type Vec2 } from "@lindocara/engine/simulation.js";
import { isPathWalkable } from "@lindocara/engine/tilemap.js";
import type { ZoneDefinition } from "@lindocara/engine/zones.js";
import {
  advanceWaypoint,
  invalidateBlockedWaypoint,
  invalidateMonsterPath,
  type NavigationRuntime,
  processNavigationBudget,
  requestMonsterPath,
} from "./navigation-system.js";
import { isRogueStealthed } from "./rogue-state-system.js";
import type { SpatialGrid } from "./spatial-grid.js";
import type { GuardRuntime, MonsterRuntime, PlayerRuntime } from "./world-runtime.js";

/**
 * Generic over the socket key (`TSocket`), same contract as `MovementSystemContext`: the legacy
 * Durable Object keys players by workerd `WebSocket` (the default), the Alepha room host by
 * connection-id string. The system itself never touches the key beyond map iteration.
 */
export interface MonsterSystemContext<TSocket = WebSocket> {
  players: Map<TSocket, PlayerRuntime>;
  monsters: MonsterRuntime[];
  guards: GuardRuntime[];
  monsterGrid: SpatialGrid<MonsterRuntime>;
  zone: ZoneDefinition;
  tick: number;
  navigation: NavigationRuntime;
  startAttack(monster: MonsterRuntime, target: PlayerRuntime | GuardRuntime, now: number): void;
  defeatMonster?(monster: MonsterRuntime, now: number): void;
  /** Fired after an authoritative monster movement edge. World uses it for contact teleporters. */
  onMonsterMoved?(monster: MonsterRuntime, previousPosition: Vec2): void;
}

function monsterAttackRange(monster: MonsterRuntime, now: number): number {
  if (monster.specialTechnique !== "none" && now >= monster.nextSpecialAt) {
    return MONSTER_SPECIAL_ACTIONS[monster.specialTechnique].range;
  }
  return MONSTER_ACTIONS[monster.species].range;
}

export function abandonMonsterTarget(
  monster: MonsterRuntime,
  playerId: string,
  reason = "target_unavailable",
): void {
  monster.threat.delete(playerId);
  if (monster.navigation.targetId !== playerId) return;
  invalidateMonsterPath(monster, reason);
  monster.navigation.state = "idle";
  monster.navigation.targetId = null;
  monster.navigation.destination = null;
  monster.navigation.requestedDestination = null;
  monster.navigation.directBlockedDestination = null;
  monster.vx = 0;
  monster.vy = 0;
}

/** Clears pursuit but deliberately preserves contribution credit earned before stealth. */
export function forgetPlayerFromMonsters(
  monsters: Iterable<MonsterRuntime>,
  playerId: string,
): void {
  for (const monster of monsters) abandonMonsterTarget(monster, playerId, "target_hidden");
}

export function advanceMonsters<TSocket>(
  context: MonsterSystemContext<TSocket>,
  now: number,
): void {
  const players = Array.from(context.players.entries()).filter(
    ([, player]) =>
      player.authorized &&
      player.life === "alive" &&
      player.forgottenUntil <= now &&
      player.invisibleUntil <= now &&
      !isRogueStealthed(player, now),
  );
  for (let index = 0; index < context.monsters.length; index++) {
    const monster = context.monsters[index];
    if (!monster || monster.deadUntil > now) continue;
    if (monster.deadUntil > 0) {
      const previousPosition = { x: monster.x, y: monster.y };
      monster.deadUntil = 0;
      monster.hp = monster.maxHp;
      monster.x = monster.spawnX;
      monster.y = monster.spawnY;
      monster.vx = 0;
      monster.vy = 0;
      monster.threat.clear();
      monster.contributions.clear();
      monster.rewardsGranted = false;
      monster.action = null;
      monster.nextSpecialAt = now + 2_000;
      resetMonsterNavigation(monster);
      context.monsterGrid.update(monster, previousPosition);
    }

    for (const [playerId, entry] of monster.threat) {
      const socket = [...context.players.entries()].find(([, player]) => player.id === playerId);
      const player = socket?.[1];
      const tooFar = player ? pointDistance(monster, player) > THREAT_LEASH_DISTANCE : false;
      if (
        !player?.authorized ||
        player.life !== "alive" ||
        player.forgottenUntil > now ||
        player.invisibleUntil > now ||
        isRogueStealthed(player, now) ||
        safeZoneShelters(player, context.zone.terrain) ||
        now - entry.updatedAt > THREAT_EXPIRES_MS ||
        tooFar
      ) {
        abandonMonsterTarget(monster, playerId, tooFar ? "target_too_far" : "target_unavailable");
      }
    }
    for (const [playerId, contribution] of monster.contributions) {
      if (now - contribution.updatedAt > CONTRIBUTION_EXPIRES_MS)
        monster.contributions.delete(playerId);
    }

    for (const candidate of players) {
      const player = candidate[1];
      if (safeZoneShelters(player, context.zone.terrain)) continue;
      if (
        monster.navigation.unreachableTargetId === player.id &&
        monster.navigation.unreachableUntil > now
      )
        continue;
      const distance = pointDistance(monster, player);
      if (distance < MONSTER_AGGRO_RANGE && !monster.threat.has(player.id)) {
        addThreat(
          monster.threat,
          player.id,
          initialProximityThreat(distance, MONSTER_AGGRO_RANGE),
          now,
        );
      }
    }

    const selected = highestThreat(
      monster.threat,
      (id) =>
        players.some(([, player]) => player.id === id) &&
        (monster.navigation.unreachableTargetId !== id ||
          monster.navigation.unreachableUntil <= now),
    );
    const target = selected
      ? players.find(([, player]) => player.id === selected.playerId)
      : undefined;

    if (target) {
      const [, player] = target;
      const targetDistance = pointDistance(monster, player);
      const targetChanged = monster.navigation.targetId !== player.id;
      if (monster.action && monster.action.recoveryEndsAt > now) {
        monster.vx = 0;
        monster.vy = 0;
        continue;
      }
      if (targetDistance <= monsterAttackRange(monster, now)) {
        monster.navigation.state = "chase";
        monster.navigation.destination = { x: player.x, y: player.y };
        monster.vx = 0;
        monster.vy = 0;
        if (now - monster.lastAttackAt >= MONSTER_ATTACK_COOLDOWN_MS) {
          monster.lastAttackAt = now;
          context.startAttack(monster, player, now);
        }
        continue;
      }
      navigateMonster(context, monster, player, player.id, "chase", now, targetChanged);
    } else {
      const returning =
        (monster.navigation.state === "chase" ||
          monster.navigation.state === "waiting_path" ||
          monster.navigation.state === "unreachable" ||
          monster.navigation.state === "return") &&
        pointDistance(monster, { x: monster.spawnX, y: monster.spawnY }) > 8;
      if (returning) {
        navigateMonster(
          context,
          monster,
          { x: monster.spawnX, y: monster.spawnY },
          null,
          "return",
          now,
          monster.navigation.targetId !== null,
        );
      } else {
        const patrolStep = Math.floor(context.tick / 60);
        const angle = patrolStep * 1.13 + index * 1.7;
        const patrolDestination = monster.mayEnterSafeZone
          ? { x: monster.spawnX - 40, y: monster.spawnY + 100 }
          : {
              x: monster.spawnX + Math.cos(angle) * monster.patrolRadius,
              y: monster.spawnY + Math.sin(angle) * monster.patrolRadius,
            };
        navigateMonster(context, monster, patrolDestination, null, "patrol", now, false);
      }
    }
  }
  processNavigationBudget(context.navigation, now);
}

function navigateMonster<TSocket>(
  context: MonsterSystemContext<TSocket>,
  monster: MonsterRuntime,
  destination: Vec2,
  targetId: string | null,
  state: "patrol" | "chase" | "return",
  now: number,
  forceRepath: boolean,
): void {
  monster.navigation.destination = { ...destination };
  if (pointDistance(monster, destination) <= context.navigation.definition.waypointTolerance) {
    monster.navigation.state = state;
    monster.navigation.targetId = targetId;
    monster.vx = 0;
    monster.vy = 0;
    return;
  }
  if (
    forceRepath ||
    (monster.navigation.directBlockedDestination &&
      pointDistance(monster.navigation.directBlockedDestination, destination) >=
        context.navigation.definition.targetMoveThreshold)
  ) {
    monster.navigation.directBlockedDestination = null;
  }
  // Whether the body can walk there in a straight line — not `hasLineOfSight`, which checks the
  // two entities' centers and is right for combat contact but wrong here: a body can clip a
  // wall's corner over a stretch too short for its center's line to ever cross a solid tile, and a
  // monster that keeps re-deciding "clear" from a slightly different spot near the same corner —
  // only to be shoved back by real (box) collision each time — ping-pongs there forever.
  const lineClear =
    monster.navigation.directBlockedDestination === null &&
    isPathWalkable(
      context.zone.terrain.tiles,
      monster,
      destination,
      PLAYER_SIZE,
      context.zone.terrain.colliders,
    );
  if (lineClear) {
    if (monster.navigation.requestPending || monster.navigation.path.length > 0)
      invalidateMonsterPath(monster, "direct_path");
    monster.navigation.state = state;
    monster.navigation.targetId = targetId;
    if (!moveMonsterDirect(context, monster, destination)) {
      monster.navigation.directBlockedDestination = { ...destination };
      requestMonsterPath(context.navigation, monster, destination, targetId, state, now, true);
    }
    return;
  }

  requestMonsterPath(context.navigation, monster, destination, targetId, state, now, forceRepath);
  const waypoint = advanceWaypoint(monster, context.navigation.definition.waypointTolerance);
  if (waypoint) {
    // A waypoint move can fail exactly like a direct move can (a neighbour just outside the
    // navigation grid's own idea of "walkable", anything real collision refuses that A* didn't
    // know about). Clearing the path alone (`invalidateMonsterPath`) is not enough to recover:
    // `requestedDestination` and `lastPathRequestAt` survive it, so `requestMonsterPath`'s repath
    // gate defers the next plan for up to 650ms, and once it opens, the unchanged start/goal hands
    // back the identical cached path — which fails at the identical waypoint and gets invalidated
    // again before anything outside this function ever sees it. `invalidateBlockedWaypoint` clears
    // the gate and evicts that cache entry, so the very next tick queues a genuine re-plan — but
    // that is two ticks of pause, not one: this tick (N) is the refused move; tick N+1's
    // `requestMonsterPath` call queues the real search, but the path stays empty until
    // `processNavigationBudget` runs after the monster loop, so N+1 doesn't move either. Movement
    // resumes at N+2.
    if (!moveMonsterDirect(context, monster, waypoint)) {
      invalidateBlockedWaypoint(context.navigation, monster, destination);
    }
  } else {
    monster.vx *= 0.5;
    monster.vy *= 0.5;
  }
}

function moveMonsterDirect<TSocket>(
  context: MonsterSystemContext<TSocket>,
  monster: MonsterRuntime,
  target: Vec2,
): boolean {
  const previousPosition = { x: monster.x, y: monster.y };
  const dx = target.x - monster.x;
  const dy = target.y - monster.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) {
    monster.vx = 0;
    monster.vy = 0;
    return false;
  }
  monster.vx = (dx / length) * monster.speed;
  monster.vy = (dy / length) * monster.speed;
  monster.facing = { x: dx / length, y: dy / length };
  const travel = Math.min(monster.speed * TICK_DT, length);
  const desired = {
    x: monster.x + (dx / length) * travel,
    y: monster.y + (dy / length) * travel,
  };
  const moved = resolveTerrain(monster, desired, context.zone.terrain);
  if (moved.x === monster.x) monster.vx = 0;
  if (moved.y === monster.y) monster.vy = 0;
  monster.x = moved.x;
  monster.y = moved.y;
  context.monsterGrid.update(monster, previousPosition);
  const movedDistance = pointDistance(previousPosition, monster);
  if (movedDistance > 0.05) context.onMonsterMoved?.(monster, previousPosition);
  return movedDistance > 0.05;
}

export function resetMonsterNavigation(monster: MonsterRuntime): void {
  monster.navigation.state = "idle";
  monster.navigation.path = [];
  monster.navigation.pathIndex = 0;
  monster.navigation.destination = null;
  monster.navigation.requestedDestination = null;
  monster.navigation.targetId = null;
  monster.navigation.requestId += 1;
  monster.navigation.requestPending = false;
  monster.navigation.unreachableTargetId = null;
  monster.navigation.unreachableUntil = 0;
  monster.navigation.abandonReason = null;
  monster.navigation.directBlockedDestination = null;
}

export function advanceGuards<TSocket>(context: MonsterSystemContext<TSocket>, now: number): void {
  const terrain = context.zone.terrain;
  for (const guard of context.guards) {
    let target: MonsterRuntime | undefined;
    let targetDistance = GUARD_DETECTION_RANGE;
    for (const monster of context.monsters) {
      // Catalogue guards defend their authored safe zone exactly as before. An edited map has no
      // safe-zone rectangle; its guard events instead defend their bounded patrol ring, which is
      // what lets an authored battlefield use this same authoritative combat system.
      if (
        monster.deadUntil > now ||
        (terrain.safeZone !== null && !safeZoneShelters(monster, terrain))
      )
        continue;
      const distance = pointDistance(guard, monster);
      if (distance >= targetDistance) continue;
      target = monster;
      targetDistance = distance;
    }

    if (!target) {
      moveGuardToward(context, guard, { x: guard.homeX, y: guard.homeY });
      continue;
    }
    guard.fightingUntil = now + 420;
    if (targetDistance > GUARD_ATTACK_RANGE) {
      moveGuardToward(context, guard, target);
      continue;
    }
    if (
      targetDistance <= monsterAttackRange(target, now) &&
      now - target.lastAttackAt >= MONSTER_ATTACK_COOLDOWN_MS
    ) {
      target.lastAttackAt = now;
      context.startAttack(target, guard, now);
    }
    if (now - guard.lastAttackAt < GUARD_ATTACK_COOLDOWN_MS) continue;
    guard.lastAttackAt = now;
    target.hp = Math.max(0, target.hp - GUARD_DAMAGE);
    if (target.hp > 0) continue;

    if (context.defeatMonster) {
      context.defeatMonster(target, now);
    } else {
      target.deadUntil = now + MONSTER_RESPAWN_MS;
      target.action = null;
      target.vx = 0;
      target.vy = 0;
    }
  }
}

function moveGuardToward<TSocket>(
  context: MonsterSystemContext<TSocket>,
  guard: GuardRuntime,
  target: Vec2,
): void {
  const dx = target.x - guard.x;
  const dy = target.y - guard.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 2) return;
  const maxTravel = GUARD_SPEED * TICK_DT;
  const desired = {
    x: guard.x + (dx / distance) * Math.min(maxTravel, distance),
    y: guard.y + (dy / distance) * Math.min(maxTravel, distance),
  };
  // Guards are kept inside their city as well as inside their patrol ring. With no city there is
  // no rect to clamp to — the patrol radius below is then the only leash, which is the correct
  // remaining one.
  const safe = context.zone.terrain.safeZone;
  if (safe) {
    desired.x = Math.max(safe.x, Math.min(safe.x + safe.width - PLAYER_SIZE, desired.x));
    desired.y = Math.max(safe.y, Math.min(safe.y + safe.height - PLAYER_SIZE, desired.y));
  }
  const fromHome = Math.hypot(desired.x - guard.homeX, desired.y - guard.homeY);
  if (fromHome > guard.patrolRadius) {
    desired.x = guard.homeX + ((desired.x - guard.homeX) / fromHome) * guard.patrolRadius;
    desired.y = guard.homeY + ((desired.y - guard.homeY) / fromHome) * guard.patrolRadius;
  }
  const moved = resolveTerrain(guard, desired, context.zone.terrain);
  guard.x = moved.x;
  guard.y = moved.y;
}
