import {
  MAX_PROJECTILE_LIFETIME_MS,
  MAX_PROJECTILE_RANGE,
  MAX_PROJECTILES_PER_PLAYER,
  MAX_PROJECTILES_PER_ROOM,
  type ProjectileActionDefinition,
} from "@lindocara/engine/combat-actions.js";
import {
  advanceProjectile,
  firstSegmentImpact,
  normalizeDirection,
  type SegmentImpact,
  sweptProjectileEntityImpact,
  sweptProjectileTerrainImpact,
} from "@lindocara/engine/directional-combat.js";
import {
  MAX_MONSTER_BODY_REACH,
  maxHpForLevel,
  monsterBodyHitbox,
  type TerrainGeometry,
} from "@lindocara/engine/game.js";
import { PLAYER_SIZE, TICK_DT, type Vec2 } from "@lindocara/engine/simulation.js";
import { isRogueStealthed } from "./rogue-state-system.js";
import type { SpatialGrid } from "./spatial-grid.js";
import type {
  GuardRuntime,
  MonsterRuntime,
  PlayerRuntime,
  ProjectileRuntime,
  ProjectileTargetFilter,
} from "./world-runtime.js";

export interface SpawnProjectileOptions {
  actionId: string;
  owner: Pick<PlayerRuntime, "id" | "partyId" | "appearance"> | MonsterRuntime;
  roomKey: string;
  origin: Vec2;
  direction: Vec2;
  definition: ProjectileActionDefinition;
  range: number;
  power: number;
  targetFilter: ProjectileTargetFilter;
  sourceSkillId: string;
  basic: boolean;
  now: number;
  activationHitEntityIds?: Set<string>;
  activationHitCounts?: Map<string, number>;
  ricochetRemaining?: number;
  returnRange?: number;
  homingTargetId?: string;
  homingTurnRateRadians?: number;
}

/**
 * Generic over the socket key (`TSocket`), same contract as `MovementSystemContext`: the legacy
 * Durable Object addresses recipients by workerd `WebSocket` (the default), the Alepha room host
 * by connection-id string.
 */
export interface ProjectileSystemContext<TSocket = WebSocket> {
  projectiles: ProjectileRuntime[];
  terrain: TerrainGeometry;
  monsters: MonsterRuntime[];
  players: Map<TSocket, PlayerRuntime>;
  guards: GuardRuntime[];
  monsterGrid: SpatialGrid<MonsterRuntime>;
  playerGrid: SpatialGrid<PlayerRuntime>;
  canHeal(owner: PlayerRuntime, target: PlayerRuntime): boolean;
  damageMonster(projectile: ProjectileRuntime, monster: MonsterRuntime, now: number): void;
  healPlayer(
    projectile: ProjectileRuntime,
    socket: TSocket,
    player: PlayerRuntime,
    now: number,
  ): void;
  damagePlayer(
    projectile: ProjectileRuntime,
    socket: TSocket,
    player: PlayerRuntime,
    now: number,
  ): void;
  damageRogueSilhouette?(projectile: ProjectileRuntime, owner: PlayerRuntime, now: number): void;
  damageGuard(projectile: ProjectileRuntime, guard: GuardRuntime, now: number): void;
  blocked(projectile: ProjectileRuntime, point: Vec2): void;
  removed?(
    projectile: ProjectileRuntime,
    point: Vec2,
    reason: "expired" | "terrain" | "entity" | "range",
    now: number,
  ): void;
}

export function projectileOrigin(owner: Vec2, direction: Vec2, radius: number): Vec2 {
  const facing = normalizeDirection(direction);
  const center = { x: owner.x + PLAYER_SIZE / 2, y: owner.y + PLAYER_SIZE / 2 };
  const offset = PLAYER_SIZE / 2 + radius + 2;
  return { x: center.x + facing.x * offset, y: center.y + facing.y * offset };
}

export function spawnProjectile(
  projectiles: ProjectileRuntime[],
  options: SpawnProjectileOptions,
): ProjectileRuntime | null {
  if (projectiles.length >= MAX_PROJECTILES_PER_ROOM) return null;
  const ownerCount = projectiles.filter(
    (projectile) => projectile.ownerId === options.owner.id,
  ).length;
  if (ownerCount >= MAX_PROJECTILES_PER_PLAYER) return null;
  const range = Math.max(0, Math.min(options.range, MAX_PROJECTILE_RANGE));
  if (range <= 0) return null;
  const projectile: ProjectileRuntime = {
    id: crypto.randomUUID(),
    actionId: options.actionId,
    ownerId: options.owner.id,
    ownerPartyId: "partyId" in options.owner ? options.owner.partyId : null,
    color: "appearance" in options.owner ? options.owner.appearance.primaryColor : "ember",
    roomKey: options.roomKey,
    kind: options.definition.kind,
    targetFilter: options.targetFilter,
    x: options.origin.x,
    y: options.origin.y,
    direction: normalizeDirection(options.direction),
    speed: Math.max(0, options.definition.speed),
    radius: Math.max(1, options.definition.radius),
    rangeRemaining: range,
    power: Math.max(0, options.power),
    pierceRemaining: Math.max(0, Math.trunc(options.definition.pierce)),
    hitEntityIds: new Set(),
    spawnedAt: options.now,
    expiresAt: options.now + MAX_PROJECTILE_LIFETIME_MS,
    sourceSkillId: options.sourceSkillId,
    basic: options.basic,
    ricochetRemaining: Math.max(0, Math.trunc(options.ricochetRemaining ?? 0)),
    ...(options.returnRange === undefined
      ? {}
      : {
          returnRange: Math.max(0, Math.min(options.returnRange, MAX_PROJECTILE_RANGE)),
          returnPierce: Math.max(0, Math.trunc(options.definition.pierce)),
        }),
    ...(options.homingTargetId ? { homingTargetId: options.homingTargetId } : {}),
    ...(options.homingTurnRateRadians === undefined
      ? {}
      : { homingTurnRateRadians: Math.max(0, options.homingTurnRateRadians) }),
    ...(options.activationHitEntityIds
      ? { activationHitEntityIds: options.activationHitEntityIds }
      : {}),
    ...(options.activationHitCounts ? { activationHitCounts: options.activationHitCounts } : {}),
  };
  projectiles.push(projectile);
  return projectile;
}

export function canSpawnProjectile(
  projectiles: readonly ProjectileRuntime[],
  ownerId: string,
): boolean {
  return (
    projectiles.length < MAX_PROJECTILES_PER_ROOM &&
    projectiles.filter((projectile) => projectile.ownerId === ownerId).length <
      MAX_PROJECTILES_PER_PLAYER
  );
}

function playerById<TSocket>(
  players: Map<TSocket, PlayerRuntime>,
  playerId: string,
): PlayerRuntime | undefined {
  return [...players.values()].find((player) => player.id === playerId);
}

function turnToward(current: Vec2, target: Vec2, maximumRadians: number): Vec2 {
  const currentAngle = Math.atan2(current.y, current.x);
  const targetAngle = Math.atan2(target.y, target.x);
  const delta = Math.atan2(
    Math.sin(targetAngle - currentAngle),
    Math.cos(targetAngle - currentAngle),
  );
  const angle = currentAngle + Math.max(-maximumRadians, Math.min(maximumRadians, delta));
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function beginReturn<TSocket>(
  projectile: ProjectileRuntime,
  context: ProjectileSystemContext<TSocket>,
  now: number,
): boolean {
  if (projectile.returningToOwner || !projectile.returnRange) return false;
  const owner = playerById(context.players, projectile.ownerId);
  if (!owner?.authorized || owner.transitioning || owner.life !== "alive") return false;
  projectile.returningToOwner = true;
  projectile.rangeRemaining = projectile.returnRange;
  projectile.pierceRemaining = projectile.returnPierce ?? 0;
  projectile.direction = normalizeDirection({
    x: owner.x - projectile.x,
    y: owner.y - projectile.y,
  });
  projectile.expiresAt = now + MAX_PROJECTILE_LIFETIME_MS;
  return true;
}

function entityCenter(entity: Vec2): Vec2 {
  return { x: entity.x + PLAYER_SIZE / 2, y: entity.y + PLAYER_SIZE / 2 };
}

function entityImpacts<TSocket>(
  projectile: ProjectileRuntime,
  from: Vec2,
  to: Vec2,
  context: ProjectileSystemContext<TSocket>,
  now: number,
): {
  impact: SegmentImpact;
  monster?: MonsterRuntime;
  player?: PlayerRuntime;
  silhouetteOwner?: PlayerRuntime;
  guard?: GuardRuntime;
  socket?: TSocket;
}[] {
  const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  // Widened by the largest body any monster presents: a troll's edge can lie inside the sweep while
  // its centre sits outside a search circle sized for a 32px body.
  const searchRadius =
    Math.hypot(to.x - from.x, to.y - from.y) / 2 + PLAYER_SIZE + MAX_MONSTER_BODY_REACH;
  if (projectile.targetFilter === "monsters") {
    return context.monsterGrid
      .queryRadius(midpoint, searchRadius)
      .filter(
        (monster) =>
          monster.deadUntil <= now &&
          !projectile.hitEntityIds.has(monster.id) &&
          !projectile.activationHitEntityIds?.has(monster.id),
      )
      .map((monster) => ({
        impact: sweptProjectileEntityImpact(
          from,
          to,
          projectile.radius,
          monsterBodyHitbox(monster.species, monster),
          monster.id,
        ),
        monster,
      }))
      .filter(
        (entry): entry is { impact: SegmentImpact; monster: MonsterRuntime } =>
          entry.impact !== null,
      );
  }

  if (projectile.targetFilter === "players_and_guards") {
    const playerContacts = context.playerGrid
      .queryRadius(midpoint, searchRadius)
      .filter(
        (player) =>
          player.authorized &&
          player.life === "alive" &&
          !player.transitioning &&
          player.invisibleUntil <= now &&
          !isRogueStealthed(player, now) &&
          !projectile.hitEntityIds.has(player.id) &&
          !projectile.activationHitEntityIds?.has(player.id),
      )
      .map((player) => {
        const socket = [...context.players].find(
          ([, candidate]) => candidate.id === player.id,
        )?.[0];
        return {
          impact: sweptProjectileEntityImpact(
            from,
            to,
            projectile.radius,
            { center: entityCenter(player), radius: PLAYER_SIZE / 2 },
            player.id,
          ),
          player,
          socket,
        };
      })
      .filter(
        (entry): entry is { impact: SegmentImpact; player: PlayerRuntime; socket: TSocket } =>
          entry.impact !== null && entry.socket !== undefined,
      );
    const silhouetteContacts = [...context.players.values()]
      .filter(
        (player) =>
          player.authorized &&
          player.life === "alive" &&
          !player.transitioning &&
          isRogueStealthed(player, now) &&
          player.rogueSilhouette !== null &&
          player.rogueSilhouette.expiresAt > now &&
          !projectile.hitEntityIds.has(`rogue-silhouette-${player.id}`),
      )
      .map((player) => ({
        impact: sweptProjectileEntityImpact(
          from,
          to,
          projectile.radius,
          {
            center: {
              x: (player.rogueSilhouette?.x ?? player.x) + PLAYER_SIZE / 2,
              y: (player.rogueSilhouette?.y ?? player.y) + PLAYER_SIZE / 2,
            },
            radius: PLAYER_SIZE / 2,
          },
          `rogue-silhouette-${player.id}`,
        ),
        silhouetteOwner: player,
      }))
      .filter(
        (entry): entry is { impact: SegmentImpact; silhouetteOwner: PlayerRuntime } =>
          entry.impact !== null,
      );
    const guardContacts = context.guards
      .filter((guard) => !projectile.hitEntityIds.has(guard.id))
      .map((guard) => ({
        impact: sweptProjectileEntityImpact(
          from,
          to,
          projectile.radius,
          { center: entityCenter(guard), radius: PLAYER_SIZE / 2 },
          guard.id,
        ),
        guard,
      }))
      .filter(
        (entry): entry is { impact: SegmentImpact; guard: GuardRuntime } => entry.impact !== null,
      );
    return [...playerContacts, ...silhouetteContacts, ...guardContacts];
  }

  const ownerSocket = [...context.players].find(([, player]) => player.id === projectile.ownerId);
  const owner = ownerSocket?.[1];
  if (!owner) return [];
  return context.playerGrid
    .queryRadius(midpoint, searchRadius)
    .filter(
      (player) =>
        player.id !== projectile.ownerId &&
        player.life === "alive" &&
        player.hp < maxHpForLevel(player.level) &&
        !projectile.hitEntityIds.has(player.id) &&
        context.canHeal(owner, player),
    )
    .map((player) => {
      const socket = [...context.players].find(([, candidate]) => candidate.id === player.id)?.[0];
      return {
        impact: sweptProjectileEntityImpact(
          from,
          to,
          projectile.radius,
          { center: entityCenter(player), radius: PLAYER_SIZE / 2 },
          player.id,
        ),
        player,
        socket,
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        impact: SegmentImpact;
        player: PlayerRuntime;
        socket: TSocket;
      } => entry.impact !== null && entry.socket !== undefined,
    );
}

export function advanceProjectiles<TSocket>(
  context: ProjectileSystemContext<TSocket>,
  now: number,
): void {
  const survivors: ProjectileRuntime[] = [];
  for (const projectile of context.projectiles) {
    if (now >= projectile.expiresAt) {
      context.removed?.(projectile, projectile, "expired", now);
      continue;
    }
    if (projectile.rangeRemaining <= 0) {
      context.removed?.(projectile, projectile, "range", now);
      continue;
    }
    const owner = playerById(context.players, projectile.ownerId);
    if (projectile.returningToOwner) {
      if (!owner?.authorized || owner.transitioning || owner.life !== "alive") continue;
      const ownerCenter = entityCenter(owner);
      if (
        Math.hypot(ownerCenter.x - projectile.x, ownerCenter.y - projectile.y) <=
        projectile.speed * TICK_DT
      )
        continue;
      projectile.direction = normalizeDirection({
        x: ownerCenter.x - projectile.x,
        y: ownerCenter.y - projectile.y,
      });
    } else if (projectile.homingTargetId) {
      const target = context.monsters.find(
        (monster) => monster.id === projectile.homingTargetId && monster.deadUntil <= now,
      );
      if (target) {
        const targetCenter = entityCenter(target);
        projectile.direction = turnToward(
          projectile.direction,
          { x: targetCenter.x - projectile.x, y: targetCenter.y - projectile.y },
          projectile.homingTurnRateRadians ?? 0,
        );
      }
    }
    const desired = advanceProjectile(projectile, projectile.direction, projectile.speed, TICK_DT);
    const fullDistance = Math.min(desired.distance, projectile.rangeRemaining);
    const to = {
      x: projectile.x + projectile.direction.x * fullDistance,
      y: projectile.y + projectile.direction.y * fullDistance,
    };
    const terrain = sweptProjectileTerrainImpact(
      projectile,
      to,
      projectile.radius,
      context.terrain.tiles,
      context.terrain.colliders,
    );
    const contacts = entityImpacts(projectile, projectile, to, context, now).sort((a, b) => {
      if (a.impact.fraction !== b.impact.fraction) return a.impact.fraction - b.impact.fraction;
      return a.impact.id.localeCompare(b.impact.id);
    });
    const firstEntity = contacts[0]?.impact ?? null;
    const first = firstSegmentImpact([terrain, firstEntity]);
    if (first?.kind === "terrain") {
      projectile.x = first.point.x;
      projectile.y = first.point.y;
      if (beginReturn(projectile, context, now)) {
        survivors.push(projectile);
        continue;
      }
      context.blocked(projectile, first.point);
      context.removed?.(projectile, first.point, "terrain", now);
      continue;
    }

    let blockingContact: SegmentImpact | null = null;
    for (const contact of contacts) {
      if (terrain && contact.impact.fraction >= terrain.fraction) break;
      projectile.hitEntityIds.add(contact.impact.id);
      projectile.activationHitEntityIds?.add(contact.impact.id);
      if (projectile.activationHitCounts) {
        projectile.activationHitCounts.set(
          contact.impact.id,
          (projectile.activationHitCounts.get(contact.impact.id) ?? 0) + 1,
        );
      }
      if (contact.monster) context.damageMonster(projectile, contact.monster, now);
      else if (contact.guard) context.damageGuard(projectile, contact.guard, now);
      else if (contact.silhouetteOwner)
        context.damageRogueSilhouette?.(projectile, contact.silhouetteOwner, now);
      else if (contact.player && contact.socket) {
        if (projectile.targetFilter === "players_and_guards")
          context.damagePlayer(projectile, contact.socket, contact.player, now);
        else context.healPlayer(projectile, contact.socket, contact.player, now);
      }
      if (projectile.pierceRemaining <= 0 || projectile.targetFilter === "wounded_allies") {
        blockingContact = contact.impact;
        break;
      }
      projectile.pierceRemaining -= 1;
    }
    if (blockingContact) {
      projectile.x = blockingContact.point.x;
      projectile.y = blockingContact.point.y;
      if (beginReturn(projectile, context, now)) survivors.push(projectile);
      else context.removed?.(projectile, blockingContact.point, "entity", now);
      continue;
    }
    if (terrain) {
      projectile.x = terrain.point.x;
      projectile.y = terrain.point.y;
      if (beginReturn(projectile, context, now)) {
        survivors.push(projectile);
        continue;
      }
      context.blocked(projectile, terrain.point);
      context.removed?.(projectile, terrain.point, "terrain", now);
      continue;
    }
    projectile.x = to.x;
    projectile.y = to.y;
    projectile.rangeRemaining -= fullDistance;
    if (projectile.rangeRemaining > 0 || beginReturn(projectile, context, now)) {
      survivors.push(projectile);
    } else {
      context.removed?.(projectile, projectile, "range", now);
    }
  }
  context.projectiles.splice(0, context.projectiles.length, ...survivors);
}

export function removeProjectilesByOwner(projectiles: ProjectileRuntime[], ownerId: string): void {
  for (let index = projectiles.length - 1; index >= 0; index--) {
    if (projectiles[index]?.ownerId === ownerId) projectiles.splice(index, 1);
  }
}
