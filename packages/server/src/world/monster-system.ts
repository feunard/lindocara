import {
  MONSTER_SPECIAL_ACTIONS,
  monsterActionDefinition,
} from "@lindocara/engine/combat-actions.js";
import {
  addThreat,
  CONTRIBUTION_EXPIRES_MS,
  highestThreat,
  initialProximityThreat,
  refreshThreat,
  THREAT_EXPIRES_MS,
  THREAT_LEASH_DISTANCE,
} from "@lindocara/engine/cooperation.js";
import { normalizeGround } from "@lindocara/engine/directional-combat.js";
import {
  GUARD_ATTACK_COOLDOWN_MS,
  GUARD_ATTACK_RANGE,
  GUARD_DAMAGE,
  GUARD_DETECTION_RANGE,
  GUARD_SPEED,
  MONSTER_AGGRO_RANGE,
  MONSTER_ATTACK_COOLDOWN_MS,
  MONSTER_RESPAWN_MS,
} from "@lindocara/engine/game.js";
import { type GroundVector, groundDistance } from "@lindocara/engine/ground.js";
import { TICK_DT } from "@lindocara/engine/simulation.js";
import {
  BODY_RADIUS,
  canStand,
  groundLineOfSight,
  groundPathClear,
  groundUnder,
  groundUnderBody,
  resolveGroundMovement,
  standingCeiling,
  type ZoneTerrain,
} from "@lindocara/engine/terrain-access.js";
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
 * How close to its spawn a monster counts as home, and how short a move counts as no move at all —
 * tile units, the exact quotients of the former 8 px and 0.05 px.
 */
const RETURN_TOLERANCE = 8 / 64;
const NEGLIGIBLE_MOVE = 0.05 / 64;
/** Under this, a destination is already reached and the monster stops rather than jitters. */
const ARRIVAL_TOLERANCE = 1 / 64;
/** Runner-only leap envelope, in tile units. It clears the generator's widest ordinary cut. */
const RUNNER_LEAP_MAX_DISTANCE = 5;
const RUNNER_LEAP_MIN_DISTANCE = 0.5;
const RUNNER_LEAP_SEARCH_STEP = 0.25;
const RUNNER_LEAP_MIN_DURATION_MS = 420;
const RUNNER_LEAP_MAX_DURATION_MS = 760;
const RUNNER_LEAP_APEX = 1.15;
/** Runner pursuit stays forgiving for two seconds, then reaches full speed one second later. */
const RUNNER_HALF_SPEED_MS = 2_000;
const RUNNER_FULL_SPEED_MS = 3_000;
const RUNNER_INITIAL_SPEED_RATIO = 0.5;
/** Two authoritative ground bodies touching; elevation keeps a clean jump over a runner viable. */
const RUNNER_CONTACT_DISTANCE = BODY_RADIUS * 2;
const RUNNER_CONTACT_HEIGHT = BODY_RADIUS * 2;
/** The offset a safe-zone raider walks to. Tile units: the former (-40, +100) px. */
const RAIDER_PATROL_OFFSET = { x: -40 / 64, z: 100 / 64 };

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
  /** Runner contact is an immediate authoritative defeat, never an attack animation. */
  killPlayerOnContact?(
    monster: MonsterRuntime,
    socket: TSocket,
    player: PlayerRuntime,
    now: number,
  ): void;
  defeatMonster?(monster: MonsterRuntime, now: number): void;
  /** Fired after an authoritative monster movement edge. World uses it for contact teleporters. */
  onMonsterMoved?(monster: MonsterRuntime, previousPosition: GroundVector): void;
}

/** Shared bounded crowd-control seam used by class effects and monster techniques. */
export function applyMonsterSlow(
  monster: MonsterRuntime,
  slowRatio: number,
  durationMs: number,
  now: number,
): void {
  monster.slowMultiplier = Math.min(
    monster.slowMultiplier,
    1 - Math.max(0, Math.min(0.95, slowRatio)),
  );
  monster.slowUntil = Math.max(monster.slowUntil, now + Math.max(0, durationMs));
}

/** Collision-resolved displacement; the spatial index is updated exactly once. */
export function pushMonsterAwayFrom(
  monster: MonsterRuntime,
  center: GroundVector,
  distance: number,
  terrain: ZoneTerrain,
  monsterGrid: SpatialGrid<MonsterRuntime>,
): void {
  const direction = normalizeGround(
    { x: monster.x - center.x, z: monster.z - center.z },
    monster.facing,
  );
  const previous = { x: monster.x, z: monster.z };
  // A knockback is the case that made the destination-grounded version of this call dangerous: it
  // is a single displacement of a whole tile or more, far past the body's radius, so the disc test
  // never gets the chance to refuse the cliff the centre test would have waved through.
  const moved = resolveGroundMovement(
    terrain,
    previous,
    {
      x: monster.x + direction.x * Math.max(0, distance),
      z: monster.z + direction.z * Math.max(0, distance),
    },
    groundUnderBody(terrain, monster.x, monster.z, monster.y),
  );
  monster.x = moved.x;
  monster.z = moved.z;
  monster.y = groundUnderBody(terrain, moved.x, moved.z, monster.y);
  monsterGrid.update(monster, previous);
}

function monsterAttackRange(monster: MonsterRuntime, now: number): number {
  if (monster.specialTechnique !== "none" && now >= monster.nextSpecialAt) {
    return MONSTER_SPECIAL_ACTIONS[monster.specialTechnique].range;
  }
  return monsterActionDefinition(monster.species, monster.attackProfile).range;
}

function runnerPursuitSpeed(monster: MonsterRuntime, now: number): number {
  const startedAt = monster.pursuitStartedAt ?? now;
  monster.pursuitStartedAt = startedAt;
  const rampProgress = Math.max(
    0,
    Math.min(
      1,
      (now - startedAt - RUNNER_HALF_SPEED_MS) / (RUNNER_FULL_SPEED_MS - RUNNER_HALF_SPEED_MS),
    ),
  );
  return (
    monster.maxSpeed *
    (RUNNER_INITIAL_SPEED_RATIO + (1 - RUNNER_INITIAL_SPEED_RATIO) * rampProgress)
  );
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
  monster.vz = 0;
}

/**
 * The elevation half of unreachability, and an EXTENSION of the abandonment above rather than a
 * second one: `abandonMonsterTarget` clears pursuit, and these two extra fields are the same ones
 * `navigation-system.ts`'s `failRequest` sets when A* reports no path — the aggro loop and the
 * threat selector below already read them, so a target marked here is skipped for `retryMs` by
 * exactly the machinery that already skips an unreachable one.
 *
 * The case it exists for has no equivalent anywhere to copy from: a hero who jumps onto a plateau
 * is visible, in range, and permanently out of reach, because `MAX_STEP` is 0 and monsters do not
 * jump. Left alone the monster would hold threat forever and grind against the cliff face.
 */
function markTargetUnreachable(
  monster: MonsterRuntime,
  playerId: string,
  now: number,
  retryMs: number,
  reason: string,
): void {
  abandonMonsterTarget(monster, playerId, reason);
  monster.navigation.state = "unreachable";
  monster.navigation.unreachableTargetId = playerId;
  monster.navigation.unreachableUntil = now + retryMs;
}

/**
 * Is `target` standing on ground this monster could never walk onto? The question is the same one
 * `canStand` asks about the monster's own next step, applied to where the target is: ground higher
 * than the monster's own by more than `MAX_STEP` tiers, or no ground at all (water, off the grid),
 * which monsters neither swim nor leave.
 */
function targetOutOfReach(
  terrain: ZoneTerrain,
  monster: MonsterRuntime,
  target: GroundVector,
): boolean {
  const targetGround = terrain.query.heightAt(target.x, target.z);
  if (targetGround === null) return true;
  const monsterGround = groundUnderBody(terrain, monster.x, monster.z, monster.y);
  return targetGround > standingCeiling(terrain, monsterGround);
}

/** Clears pursuit but deliberately preserves contribution credit earned before stealth. */
export function forgetPlayerFromMonsters(
  monsters: Iterable<MonsterRuntime>,
  playerId: string,
): void {
  for (const monster of monsters) {
    if (monster.pursuitMode !== "relentless")
      abandonMonsterTarget(monster, playerId, "target_hidden");
  }
}

/** Restores an encounter to its authored start. Hardcore retries use the same reset as a respawn. */
export function resetMonsterAtSpawn(
  monster: MonsterRuntime,
  terrain: ZoneTerrain,
  monsterGrid: SpatialGrid<MonsterRuntime>,
  now: number,
): void {
  const previousPosition = { x: monster.x, z: monster.z };
  monster.deadUntil = 0;
  monster.hp = monster.maxHp;
  monster.x = monster.spawnX;
  monster.z = monster.spawnZ;
  // POSITIONAL on purpose, where every mover above is body-aware: a spawn point is authored as a
  // cell, with no elevation of its own, so "the surface at this point" is the only reading it has.
  // A monster authored under a bridge would spawn on its deck; that is the ambiguity of a 2D spawn,
  // not the levitation `groundUnderBody` removes from the movers.
  monster.y = groundUnder(terrain, monster.spawnX, monster.spawnZ, 0);
  monster.vx = 0;
  monster.vz = 0;
  monster.runnerLeap = null;
  monster.speed = monster.baseSpeed;
  monster.pursuitStartedAt = null;
  monster.slowUntil = 0;
  monster.slowMultiplier = 1;
  monster.revealedUntil = 0;
  monster.threat.clear();
  monster.contributions.clear();
  monster.rewardsGranted = false;
  monster.action = null;
  monster.nextSpecialAt = now + 2_000;
  resetMonsterNavigation(monster);
  monsterGrid.update(monster, previousPosition);
}

export function advanceMonsters<TSocket>(
  context: MonsterSystemContext<TSocket>,
  now: number,
): void {
  const terrain = context.zone.terrain;
  const allLivingPlayers = Array.from(context.players.entries()).filter(
    ([, player]) => player.authorized && player.life === "alive" && !player.transitioning,
  );
  const visiblePlayers = allLivingPlayers.filter(([, player]) => {
    if (player.rogueSilhouette && player.rogueSilhouette.expiresAt <= now)
      player.rogueSilhouette = null;
    const activeSilhouette = player.rogueSilhouette && player.rogueSilhouette.expiresAt > now;
    return Boolean(
      player.forgottenUntil <= now &&
      ((player.invisibleUntil <= now && !isRogueStealthed(player, now)) || activeSilhouette),
    );
  });
  for (let index = 0; index < context.monsters.length; index++) {
    const monster = context.monsters[index];
    if (!monster || monster.deadUntil > now) continue;
    if (monster.deadUntil > 0) {
      resetMonsterAtSpawn(monster, terrain, context.monsterGrid, now);
    }
    if (monster.slowUntil <= now) monster.slowMultiplier = 1;
    const relentless = monster.pursuitMode === "relentless";
    const runnerPursuer = relentless && monster.oneHitKill;
    const players = relentless ? allLivingPlayers : visiblePlayers;

    if (monster.runnerLeap) {
      advanceRunnerLeap(context, monster, now);
      if (runnerPursuer) killPlayersOnRunnerContact(context, monster, allLivingPlayers, now);
      continue;
    }

    for (const [playerId, entry] of relentless ? [] : monster.threat) {
      const socket = [...context.players.entries()].find(([, player]) => player.id === playerId);
      const player = socket?.[1];
      const activeSilhouette =
        player?.rogueSilhouette && player.rogueSilhouette.expiresAt > now
          ? player.rogueSilhouette
          : null;
      const tooFar = player
        ? groundDistance(monster, activeSilhouette || player) > THREAT_LEASH_DISTANCE
        : false;
      if (
        !player?.authorized ||
        player.life !== "alive" ||
        player.forgottenUntil > now ||
        ((player.invisibleUntil > now || isRogueStealthed(player, now)) && !activeSilhouette) ||
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
      if (!relentless && (player.invisibleUntil > now || isRogueStealthed(player, now))) continue;
      if (
        monster.navigation.unreachableTargetId === player.id &&
        monster.navigation.unreachableUntil > now
      )
        continue;
      const distance = groundDistance(monster, player);
      if ((relentless || distance < MONSTER_AGGRO_RANGE) && !monster.threat.has(player.id)) {
        addThreat(
          monster.threat,
          player.id,
          relentless ? 1 : initialProximityThreat(distance, MONSTER_AGGRO_RANGE),
          now,
        );
      }
    }

    const selected = relentless
      ? players
          .map((candidate) => ({ candidate, distance: groundDistance(monster, candidate[1]) }))
          .sort(
            (left, right) =>
              left.distance - right.distance ||
              left.candidate[1].id.localeCompare(right.candidate[1].id),
          )[0]?.candidate
      : (() => {
          const threat = highestThreat(
            monster.threat,
            (id) =>
              players.some(([, player]) => player.id === id) &&
              (monster.navigation.unreachableTargetId !== id ||
                monster.navigation.unreachableUntil <= now),
          );
          return threat ? players.find(([, player]) => player.id === threat.playerId) : undefined;
        })();
    const target = selected;

    if (target) {
      const [, player] = target;
      if (runnerPursuer) {
        monster.speed = runnerPursuitSpeed(monster, now);
      } else if (relentless) {
        monster.speed = Math.min(monster.maxSpeed, monster.speed + monster.acceleration * TICK_DT);
      }
      refreshThreat(monster.threat, player.id, now);
      const afterimage =
        player.rangerAfterimage && player.rangerAfterimage.expiresAt > now
          ? player.rangerAfterimage
          : null;
      if (player.rangerAfterimage && !afterimage) player.rangerAfterimage = null;
      const silhouette =
        player.rogueSilhouette && player.rogueSilhouette.expiresAt > now
          ? player.rogueSilhouette
          : null;
      if (player.rogueSilhouette && !silhouette) player.rogueSilhouette = null;
      const targetPosition = silhouette ?? afterimage ?? player;
      const targetDistance = groundDistance(monster, targetPosition);
      const targetChanged = monster.navigation.targetId !== player.id;
      if (runnerPursuer) {
        // A runner is a moving fail state: it never waits for, telegraphs or resolves a combat
        // swing. The actual hero body (not a decoy) dies only when the two bodies touch.
        monster.action = null;
        if (killPlayersOnRunnerContact(context, monster, allLivingPlayers, now)) {
          monster.vx = 0;
          monster.vz = 0;
          continue;
        }
        monster.navigation.state = "chase";
        monster.navigation.targetId = player.id;
        monster.navigation.destination = { x: targetPosition.x, z: targetPosition.z };
        const leaping =
          runnerPathBlocked(terrain, monster, targetPosition) &&
          beginRunnerLeap(context, monster, targetPosition, now);
        if (!leaping && !moveMonsterDirect(context, monster, targetPosition)) {
          beginRunnerLeap(context, monster, targetPosition, now);
        }
        if (!monster.runnerLeap) {
          killPlayersOnRunnerContact(context, monster, allLivingPlayers, now);
        }
        continue;
      }
      if (monster.action && monster.action.recoveryEndsAt > now) {
        monster.vx = 0;
        monster.vz = 0;
        continue;
      }
      const attackRange = monsterAttackRange(monster, now);
      if (targetDistance <= attackRange && groundLineOfSight(terrain, monster, targetPosition)) {
        monster.navigation.state = "chase";
        monster.navigation.destination = { x: targetPosition.x, z: targetPosition.z };
        monster.vx = 0;
        monster.vz = 0;
        if (now - monster.lastAttackAt >= MONSTER_ATTACK_COOLDOWN_MS) {
          monster.lastAttackAt = now;
          context.startAttack(
            monster,
            targetPosition === player
              ? player
              : { ...player, x: targetPosition.x, y: targetPosition.y, z: targetPosition.z },
            now,
          );
        }
        continue;
      }
      if (relentless) {
        monster.navigation.state = "chase";
        monster.navigation.targetId = player.id;
        monster.navigation.destination = { x: targetPosition.x, z: targetPosition.z };
        if (!moveMonsterDirect(context, monster, targetPosition)) {
          beginRunnerLeap(context, monster, targetPosition, now);
        }
        continue;
      }
      // Elevation, and the one place it meets a target that can jump. For an ordinary monster a
      // hero on a plateau is visible and in range but unreachable: `MAX_STEP` is 0. The
      // monster walks as close as the terrain lets it — that is what `moveMonsterDirect` does
      // when it is refused a step — and abandons the moment it cannot get closer, instead of
      // pressing into the cliff face forever. Deliberately AFTER the attack branch above, so a
      // ranged monster already in range still shoots up at the hero rather than giving up.
      if (targetOutOfReach(terrain, monster, targetPosition)) {
        monster.navigation.state = "chase";
        monster.navigation.targetId = player.id;
        monster.navigation.destination = { x: targetPosition.x, z: targetPosition.z };
        if (!moveMonsterDirect(context, monster, targetPosition)) {
          markTargetUnreachable(
            monster,
            player.id,
            now,
            context.navigation.definition.unreachableRetryMs,
            "target_out_of_reach",
          );
        }
        continue;
      }
      navigateMonster(context, monster, targetPosition, player.id, "chase", now, targetChanged);
    } else {
      if (runnerPursuer) {
        monster.pursuitStartedAt = null;
        monster.speed = monster.baseSpeed;
      }
      const returning =
        (monster.navigation.state === "chase" ||
          monster.navigation.state === "waiting_path" ||
          monster.navigation.state === "unreachable" ||
          monster.navigation.state === "return") &&
        groundDistance(monster, { x: monster.spawnX, z: monster.spawnZ }) > RETURN_TOLERANCE;
      if (returning) {
        navigateMonster(
          context,
          monster,
          { x: monster.spawnX, z: monster.spawnZ },
          null,
          "return",
          now,
          monster.navigation.targetId !== null,
        );
      } else {
        const patrolStep = Math.floor(context.tick / 60);
        const angle = patrolStep * 1.13 + index * 1.7;
        // `patrolRadius` arrives in TILE units from every AUTHORED producer:
        // `authored-monster-system`, `authored-guard-system` and `worldEvents.ts` all cross through
        // `authoredPatrolRadius` (`engine/map-events.ts`), which is deliberately the single
        // producer-side conversion — dividing here instead would be the "half a conversion hiding
        // at a call site" the plan warns about. The compiled catalogue's `MONSTER_SPAWNS` and
        // `GUARD_DEFINITIONS` (`engine/game.ts`) still hold PIXEL radii, and stay that way: they
        // are test content that `zoneFromMapPayload` never produces (`monsters: []`, `guards: []`),
        // and they die with `game.ts`'s pixel half rather than with this file.
        const patrolDestination = monster.mayEnterSafeZone
          ? {
              x: monster.spawnX + RAIDER_PATROL_OFFSET.x,
              z: monster.spawnZ + RAIDER_PATROL_OFFSET.z,
            }
          : {
              x: monster.spawnX + Math.cos(angle) * monster.patrolRadius,
              z: monster.spawnZ + Math.sin(angle) * monster.patrolRadius,
            };
        navigateMonster(context, monster, patrolDestination, null, "patrol", now, false);
      }
    }
  }
  processNavigationBudget(context.navigation, now);
}

function killPlayersOnRunnerContact<TSocket>(
  context: MonsterSystemContext<TSocket>,
  monster: MonsterRuntime,
  players: readonly (readonly [TSocket, PlayerRuntime])[],
  now: number,
): boolean {
  let touched = false;
  for (const [socket, player] of players) {
    if (player.life !== "alive") continue;
    if (groundDistance(monster, player) > RUNNER_CONTACT_DISTANCE) continue;
    if (Math.abs(monster.y - player.y) > RUNNER_CONTACT_HEIGHT) continue;
    touched = true;
    context.killPlayerOnContact?.(monster, socket, player, now);
  }
  return touched;
}

/** Look far enough ahead to jump before collider sliding turns an obstacle into a wall-follow. */
function runnerPathBlocked(
  terrain: ZoneTerrain,
  monster: MonsterRuntime,
  target: GroundVector,
): boolean {
  const dx = target.x - monster.x;
  const dz = target.z - monster.z;
  const length = Math.hypot(dx, dz);
  if (length < RUNNER_LEAP_MIN_DISTANCE) return false;
  const lookahead = Math.min(length, RUNNER_LEAP_MAX_DISTANCE);
  return !groundPathClear(
    terrain,
    monster,
    {
      x: monster.x + (dx / length) * lookahead,
      z: monster.z + (dz / length) * lookahead,
    },
    BODY_RADIUS,
    groundUnderBody(terrain, monster.x, monster.z, monster.y),
  );
}

/**
 * Finds a standable landing beyond the obstacle that just refused a direct runner step. The
 * destination's own surface is supplied to `canStand`: a leap is allowed to gain or lose several
 * terrain levels, while the landing disc must still be completely supported and collider-free.
 */
function beginRunnerLeap<TSocket>(
  context: MonsterSystemContext<TSocket>,
  monster: MonsterRuntime,
  target: GroundVector,
  now: number,
): boolean {
  const dx = target.x - monster.x;
  const dz = target.z - monster.z;
  const length = Math.hypot(dx, dz);
  if (length < RUNNER_LEAP_MIN_DISTANCE) return false;
  const direction = { x: dx / length, z: dz / length };
  const maximum = Math.min(RUNNER_LEAP_MAX_DISTANCE, length);
  let landing: { x: number; y: number; z: number } | null = null;
  for (
    let distance = maximum;
    distance >= RUNNER_LEAP_MIN_DISTANCE;
    distance -= RUNNER_LEAP_SEARCH_STEP
  ) {
    const x = monster.x + direction.x * distance;
    const z = monster.z + direction.z * distance;
    const surface = context.zone.terrain.query.heightAt(x, z);
    if (surface === null || !canStand(context.zone.terrain, x, z, BODY_RADIUS, surface)) continue;
    landing = { x, y: surface, z };
    break;
  }
  if (!landing) {
    monster.vx = 0;
    monster.vz = 0;
    return false;
  }

  invalidateMonsterPath(monster, "runner_leap");
  monster.navigation.state = "chase";
  const duration = Math.max(
    RUNNER_LEAP_MIN_DURATION_MS,
    Math.min(RUNNER_LEAP_MAX_DURATION_MS, (maximum / Math.max(monster.speed, 0.1)) * 1_000),
  );
  monster.runnerLeap = {
    fromX: monster.x,
    fromY: monster.y,
    fromZ: monster.z,
    toX: landing.x,
    toY: landing.y,
    toZ: landing.z,
    startedAt: now,
    endsAt: now + duration,
  };
  monster.vx = direction.x * monster.speed;
  monster.vz = direction.z * monster.speed;
  monster.facing = direction;
  return true;
}

/** Advances the room-owned leap. Airborne runners neither attack nor abandon their quarry. */
function advanceRunnerLeap<TSocket>(
  context: MonsterSystemContext<TSocket>,
  monster: MonsterRuntime,
  now: number,
): void {
  const leap = monster.runnerLeap;
  if (!leap) return;
  const previousPosition = { x: monster.x, z: monster.z };
  const progress = Math.max(
    0,
    Math.min(1, (now - leap.startedAt) / Math.max(1, leap.endsAt - leap.startedAt)),
  );
  monster.x = leap.fromX + (leap.toX - leap.fromX) * progress;
  monster.z = leap.fromZ + (leap.toZ - leap.fromZ) * progress;
  const baseline = leap.fromY + (leap.toY - leap.fromY) * progress;
  const heightGain = Math.abs(leap.toY - leap.fromY);
  monster.y = baseline + Math.sin(Math.PI * progress) * (RUNNER_LEAP_APEX + heightGain * 0.2);
  context.monsterGrid.update(monster, previousPosition);
  if (progress < 1) return;

  monster.x = leap.toX;
  monster.y = leap.toY;
  monster.z = leap.toZ;
  monster.runnerLeap = null;
  context.onMonsterMoved?.(monster, previousPosition);
}

function navigateMonster<TSocket>(
  context: MonsterSystemContext<TSocket>,
  monster: MonsterRuntime,
  destination: GroundVector,
  targetId: string | null,
  state: "patrol" | "chase" | "return",
  now: number,
  forceRepath: boolean,
): void {
  monster.navigation.destination = { ...destination };
  if (groundDistance(monster, destination) <= context.navigation.definition.waypointTolerance) {
    monster.navigation.state = state;
    monster.navigation.targetId = targetId;
    monster.vx = 0;
    monster.vz = 0;
    return;
  }
  if (
    forceRepath ||
    (monster.navigation.directBlockedDestination &&
      groundDistance(monster.navigation.directBlockedDestination, destination) >=
        context.navigation.definition.targetMoveThreshold)
  ) {
    monster.navigation.directBlockedDestination = null;
  }
  // Whether the body can walk there in a straight line — not `groundLineOfSight`, which checks the
  // two entities' centers and is right for combat contact but wrong here: a body can clip a
  // wall's corner over a stretch too short for its center's line to ever cross a solid cell, and a
  // monster that keeps re-deciding "clear" from a slightly different spot near the same corner —
  // only to be shoved back by real collision each time — ping-pongs there forever.
  const lineClear =
    monster.navigation.directBlockedDestination === null &&
    groundPathClear(
      context.zone.terrain,
      monster,
      destination,
      BODY_RADIUS,
      groundUnderBody(context.zone.terrain, monster.x, monster.z, monster.y),
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
    monster.vz *= 0.5;
  }
}

/**
 * One step toward `target`, collision-resolved. Returns whether the monster actually got anywhere:
 * `false` means the terrain refused it, which is what both the pathfinding fallback above and the
 * out-of-reach abandonment read as "this is as close as it gets".
 */
function moveMonsterDirect<TSocket>(
  context: MonsterSystemContext<TSocket>,
  monster: MonsterRuntime,
  target: GroundVector,
): boolean {
  const terrain = context.zone.terrain;
  const previousPosition = { x: monster.x, z: monster.z };
  const dx = target.x - monster.x;
  const dz = target.z - monster.z;
  const length = Math.hypot(dx, dz);
  if (length < ARRIVAL_TOLERANCE) {
    monster.vx = 0;
    monster.vz = 0;
    return false;
  }
  const speed = monster.speed * Math.max(0.05, Math.min(1, monster.slowMultiplier));
  monster.vx = (dx / length) * speed;
  monster.vz = (dz / length) * speed;
  monster.facing = { x: dx / length, z: dz / length };
  const travel = Math.min(speed * TICK_DT, length);
  const moved = resolveGroundMovement(
    terrain,
    previousPosition,
    {
      x: monster.x + (dx / length) * travel,
      z: monster.z + (dz / length) * travel,
    },
    groundUnderBody(terrain, monster.x, monster.z, monster.y),
  );
  if (moved.x === monster.x) monster.vx = 0;
  if (moved.z === monster.z) monster.vz = 0;
  monster.x = moved.x;
  monster.z = moved.z;
  // Ordinary movement follows terrain height. A runner leap bypasses this function until landing.
  monster.y = groundUnderBody(terrain, moved.x, moved.z, monster.y);
  context.monsterGrid.update(monster, previousPosition);
  const movedDistance = groundDistance(previousPosition, monster);
  if (movedDistance > NEGLIGIBLE_MOVE) context.onMonsterMoved?.(monster, previousPosition);
  return movedDistance > NEGLIGIBLE_MOVE;
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
      // The authored safe-zone rectangle did not survive the move to a heightfield: a map author
      // never had a way to declare one, and `ZoneTerrain` carries collision, not authored regions.
      // Every guard therefore defends its bounded patrol ring, which is exactly the branch every
      // edited map already took (`safeZone` was baked `null` for all of them) — so nothing an
      // authored map does changes here. The catalogue's Heartroot guards are the only losers, and
      // no catalogue zone can be a room any more.
      if (monster.deadUntil > now) continue;
      const distance = groundDistance(guard, monster);
      if (distance >= targetDistance) continue;
      target = monster;
      targetDistance = distance;
    }

    if (!target) {
      moveGuardToward(context, guard, { x: guard.homeX, z: guard.homeZ });
      continue;
    }
    const canAttack =
      targetDistance <= GUARD_ATTACK_RANGE && groundLineOfSight(terrain, guard, target);
    if (!canAttack) {
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
    guard.fightingUntil = now + 420;
    target.hp = Math.max(0, target.hp - GUARD_DAMAGE);
    if (target.hp > 0) continue;

    if (context.defeatMonster) {
      context.defeatMonster(target, now);
    } else {
      target.deadUntil = now + MONSTER_RESPAWN_MS;
      target.action = null;
      target.vx = 0;
      target.vz = 0;
    }
  }
}

/**
 * `MOVE_TOLERANCE` in tile units: the exact quotient of the former 2 px. Below it the guard is
 * already where it wants to be and holding still reads better than a per-tick twitch.
 */
const GUARD_MOVE_TOLERANCE = 2 / 64;

function moveGuardToward<TSocket>(
  context: MonsterSystemContext<TSocket>,
  guard: GuardRuntime,
  target: GroundVector,
): void {
  const terrain = context.zone.terrain;
  const dx = target.x - guard.x;
  const dz = target.z - guard.z;
  const distance = Math.hypot(dx, dz);
  if (distance < GUARD_MOVE_TOLERANCE) return;
  const maxTravel = GUARD_SPEED * TICK_DT;
  const desired = {
    x: guard.x + (dx / distance) * Math.min(maxTravel, distance),
    z: guard.z + (dz / distance) * Math.min(maxTravel, distance),
  };
  // The city rectangle is gone with the safe zone (see `advanceGuards`), so the patrol radius is
  // now the only leash — which is the one that was always correct for an authored map.
  const fromHome = Math.hypot(desired.x - guard.homeX, desired.z - guard.homeZ);
  if (fromHome > guard.patrolRadius) {
    desired.x = guard.homeX + ((desired.x - guard.homeX) / fromHome) * guard.patrolRadius;
    desired.z = guard.homeZ + ((desired.z - guard.homeZ) / fromHome) * guard.patrolRadius;
  }
  const moved = resolveGroundMovement(
    terrain,
    { x: guard.x, z: guard.z },
    desired,
    groundUnderBody(terrain, guard.x, guard.z, guard.y),
  );
  guard.x = moved.x;
  guard.z = moved.z;
  guard.y = groundUnderBody(terrain, moved.x, moved.z, guard.y);
}
