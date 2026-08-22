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
  normalizeGround,
  type SegmentImpact,
  sweptProjectileEntityImpact,
} from "@lindocara/engine/directional-combat.js";
import {
  MAX_MONSTER_BODY_REACH,
  maxHpForLevel,
  monsterBodyHitbox,
} from "@lindocara/engine/game.js";
import { type GroundVector, groundDistance } from "@lindocara/engine/ground.js";
import { TICK_DT } from "@lindocara/engine/simulation.js";
import {
  BODY_RADIUS,
  sweptGroundTerrainImpact,
  type ZoneTerrain,
} from "@lindocara/engine/terrain-access.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";

import { isRogueStealthed } from "./rogue-state-system.js";
import type {
  GroundIndexQuery,
  GuardRuntime,
  MonsterRuntime,
  PlayerRuntime,
  ProjectileRuntime,
  ProjectileTargetFilter,
  WorldPosition,
} from "./world-runtime.js";

export interface SpawnProjectileOptions {
  actionId: string;
  owner: Pick<PlayerRuntime, "id" | "partyId" | "appearance"> | MonsterRuntime;
  roomKey: string;
  origin: WorldPosition;
  direction: GroundVector;
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
  terrain: ZoneTerrain;
  monsters: MonsterRuntime[];
  players: Map<TSocket, PlayerRuntime>;
  guards: GuardRuntime[];
  monsterGrid: GroundIndexQuery<MonsterRuntime>;
  playerGrid: GroundIndexQuery<PlayerRuntime>;
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
  blocked(projectile: ProjectileRuntime, point: GroundVector): void;
  removed?(
    projectile: ProjectileRuntime,
    point: GroundVector,
    reason: "expired" | "terrain" | "entity" | "range",
    now: number,
  ): void;
}

/**
 * Where a shot leaves its owner: one body radius plus the projectile's own, plus the historical
 * 2 px of daylight, along the facing.
 *
 * The `PLAYER_SIZE / 2` that used to recentre the owner is GONE, and its absence is the conversion,
 * not an omission: a pixel position was a 32 px box's top-left corner, a tile-unit position is the
 * body's centre. Adding half a body here now would spawn every projectile half a body off-axis.
 *
 * All three axes travel — the returned `y` is the owner's elevation, and it becomes the shot's
 * flight height, which is what `advanceProjectiles` asks the terrain about.
 */
export function projectileOrigin(
  owner: WorldPosition,
  direction: GroundVector,
  radius: number,
): WorldPosition {
  const facing = normalizeGround(direction);
  const offset = BODY_RADIUS + radius + PROJECTILE_MUZZLE_GAP;
  return { x: owner.x + facing.x * offset, y: owner.y, z: owner.z + facing.z * offset };
}

/** The 2 px of daylight the pixel muzzle offset always carried, in tile units. */
const PROJECTILE_MUZZLE_GAP = 2 / TILE_SIZE;

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
    // The elevation the shot flies at. Nothing on the server leaves the ground yet, so this is the
    // shooter's own ground — and it is what decides which relief the sweep below is stopped by.
    y: options.origin.y,
    z: options.origin.z,
    direction: normalizeGround(options.direction),
    speed: Math.max(0, options.definition.speed),
    // The floor was 1 PIXEL: a projectile must have a body, however small. One pixel of a tile is
    // the same promise in the new units, not a whole tile.
    radius: Math.max(1 / TILE_SIZE, options.definition.radius),
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

const PROJECTILE_ELEVATION_EPSILON = 1e-3;

/**
 * Projectiles are horizontal shots. Small differences on the same ramp are tolerated, but a full
 * authored terrain level is never treated as the same combat plane.
 */
export function sameProjectileElevation(
  sourceY: number,
  targetY: number,
  levelHeight: number,
): boolean {
  const difference = Math.abs(sourceY - targetY);
  const level = Math.abs(levelHeight);
  if (level <= PROJECTILE_ELEVATION_EPSILON) return difference <= PROJECTILE_ELEVATION_EPSILON;
  return difference < level / 2;
}

/**
 * Selects the server-authoritative target for an offensive player projectile. Obstacles are not
 * filtered here on purpose: the projectile sweep remains authoritative and stops the shot at the
 * first wall or raised terrain between the actor and this target.
 */
export function nearestProjectileMonster(
  origin: WorldPosition,
  monsters: Iterable<MonsterRuntime>,
  range: number,
  now: number,
  levelHeight: number,
): MonsterRuntime | null {
  const maximumRange = Math.max(0, Math.min(range, MAX_PROJECTILE_RANGE));
  return (
    [...monsters]
      .filter((monster) => {
        if (monster.deadUntil > now || !sameProjectileElevation(origin.y, monster.y, levelHeight))
          return false;
        const distance = groundDistance(origin, monster);
        return distance > 0 && distance <= maximumRange;
      })
      .sort((left, right) => {
        const distance = groundDistance(origin, left) - groundDistance(origin, right);
        return distance || left.id.localeCompare(right.id);
      })[0] ?? null
  );
}

function playerById<TSocket>(
  players: Map<TSocket, PlayerRuntime>,
  playerId: string,
): PlayerRuntime | undefined {
  return [...players.values()].find((player) => player.id === playerId);
}

function turnToward(
  current: GroundVector,
  target: GroundVector,
  maximumRadians: number,
): GroundVector {
  const currentAngle = Math.atan2(current.z, current.x);
  const targetAngle = Math.atan2(target.z, target.x);
  const delta = Math.atan2(
    Math.sin(targetAngle - currentAngle),
    Math.cos(targetAngle - currentAngle),
  );
  const angle = currentAngle + Math.max(-maximumRadians, Math.min(maximumRadians, delta));
  return { x: Math.cos(angle), z: Math.sin(angle) };
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
  projectile.direction = normalizeGround({
    x: owner.x - projectile.x,
    z: owner.z - projectile.z,
  });
  projectile.expiresAt = now + MAX_PROJECTILE_LIFETIME_MS;
  return true;
}

function entityImpacts<TSocket>(
  projectile: ProjectileRuntime,
  from: GroundVector,
  to: GroundVector,
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
  const midpoint = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };
  // Widened by the largest body any monster presents: a troll's edge can lie inside the sweep while
  // its centre sits outside a search circle sized for one ordinary body.
  const searchRadius = groundDistance(from, to) / 2 + 2 * BODY_RADIUS + MAX_MONSTER_BODY_REACH;
  if (projectile.targetFilter === "monsters") {
    return context.monsterGrid
      .queryRadius(midpoint, searchRadius)
      .filter(
        (monster) =>
          monster.deadUntil <= now &&
          sameProjectileElevation(projectile.y, monster.y, context.terrain.levelHeight) &&
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
          sameProjectileElevation(projectile.y, player.y, context.terrain.levelHeight) &&
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
            { center: { x: player.x, z: player.z }, radius: BODY_RADIUS },
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
          sameProjectileElevation(
            projectile.y,
            player.rogueSilhouette.y,
            context.terrain.levelHeight,
          ) &&
          !projectile.hitEntityIds.has(`rogue-silhouette-${player.id}`),
      )
      .map((player) => ({
        impact: sweptProjectileEntityImpact(
          from,
          to,
          projectile.radius,
          {
            center: {
              x: player.rogueSilhouette?.x ?? player.x,
              z: player.rogueSilhouette?.z ?? player.z,
            },
            radius: BODY_RADIUS,
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
      .filter(
        (guard) =>
          sameProjectileElevation(projectile.y, guard.y, context.terrain.levelHeight) &&
          !projectile.hitEntityIds.has(guard.id),
      )
      .map((guard) => ({
        impact: sweptProjectileEntityImpact(
          from,
          to,
          projectile.radius,
          { center: { x: guard.x, z: guard.z }, radius: BODY_RADIUS },
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
          { center: { x: player.x, z: player.z }, radius: BODY_RADIUS },
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
      if (groundDistance(owner, projectile) <= projectile.speed * TICK_DT) continue;
      projectile.direction = normalizeGround({
        x: owner.x - projectile.x,
        z: owner.z - projectile.z,
      });
    } else if (projectile.homingTargetId) {
      const target = context.monsters.find(
        (monster) =>
          monster.id === projectile.homingTargetId &&
          monster.deadUntil <= now &&
          sameProjectileElevation(projectile.y, monster.y, context.terrain.levelHeight),
      );
      if (target) {
        projectile.direction = turnToward(
          projectile.direction,
          { x: target.x - projectile.x, z: target.z - projectile.z },
          projectile.homingTurnRateRadians ?? 0,
        );
      }
    }
    const desired = advanceProjectile(projectile, projectile.direction, projectile.speed, TICK_DT);
    const fullDistance = Math.min(desired.distance, projectile.rangeRemaining);
    const to = {
      x: projectile.x + projectile.direction.x * fullDistance,
      z: projectile.z + projectile.direction.z * fullDistance,
    };
    // Still one exact sweep per tick, never a walk of samples: `fullDistance` can be most of a
    // tile at a Heartseeker's speed and several tiles for anything talented, and an obstacle
    // narrower than that stride is exactly what must not be tunnelled through. `projectile.y` is
    // the flight height, so only relief ABOVE the shot stops it.
    const terrain = sweptGroundTerrainImpact(
      context.terrain,
      projectile,
      to,
      projectile.radius,
      projectile.y,
    );
    const contacts = entityImpacts(projectile, projectile, to, context, now).sort((a, b) => {
      if (a.impact.fraction !== b.impact.fraction) return a.impact.fraction - b.impact.fraction;
      return a.impact.id.localeCompare(b.impact.id);
    });
    const firstEntity = contacts[0]?.impact ?? null;
    const first = firstSegmentImpact([terrain, firstEntity]);
    if (first?.kind === "terrain") {
      projectile.x = first.point.x;
      projectile.z = first.point.z;
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
      projectile.z = blockingContact.point.z;
      if (beginReturn(projectile, context, now)) survivors.push(projectile);
      else context.removed?.(projectile, blockingContact.point, "entity", now);
      continue;
    }
    if (terrain) {
      projectile.x = terrain.point.x;
      projectile.z = terrain.point.z;
      if (beginReturn(projectile, context, now)) {
        survivors.push(projectile);
        continue;
      }
      context.blocked(projectile, terrain.point);
      context.removed?.(projectile, terrain.point, "terrain", now);
      continue;
    }
    projectile.x = to.x;
    projectile.z = to.z;
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
