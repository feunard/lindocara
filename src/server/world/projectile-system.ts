import {
  MAX_PROJECTILE_LIFETIME_MS,
  MAX_PROJECTILE_RANGE,
  MAX_PROJECTILES_PER_PLAYER,
  MAX_PROJECTILES_PER_ROOM,
  type ProjectileActionDefinition,
} from "../../shared/combat-actions.js";
import {
  advanceProjectile,
  firstSegmentImpact,
  normalizeDirection,
  type SegmentImpact,
  sweptProjectileEntityImpact,
  sweptProjectileTerrainImpact,
} from "../../shared/directional-combat.js";
import { maxHpForLevel, type TerrainGeometry } from "../../shared/game.js";
import { PLAYER_SIZE, TICK_DT, type Vec2 } from "../../shared/simulation.js";
import type { SpatialGrid } from "./spatial-grid.js";
import type {
  MonsterRuntime,
  PlayerRuntime,
  ProjectileRuntime,
  ProjectileTargetFilter,
} from "./world-runtime.js";

export interface SpawnProjectileOptions {
  actionId: string;
  owner: PlayerRuntime;
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
  ricochetRemaining?: number;
}

export interface ProjectileSystemContext {
  projectiles: ProjectileRuntime[];
  terrain: TerrainGeometry;
  monsters: MonsterRuntime[];
  players: Map<WebSocket, PlayerRuntime>;
  monsterGrid: SpatialGrid<MonsterRuntime>;
  playerGrid: SpatialGrid<PlayerRuntime>;
  canHeal(owner: PlayerRuntime, target: PlayerRuntime): boolean;
  damageMonster(projectile: ProjectileRuntime, monster: MonsterRuntime, now: number): void;
  healPlayer(
    projectile: ProjectileRuntime,
    socket: WebSocket,
    player: PlayerRuntime,
    now: number,
  ): void;
  blocked(projectile: ProjectileRuntime, point: Vec2): void;
}

export function projectileOrigin(owner: PlayerRuntime, direction: Vec2, radius: number): Vec2 {
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
    ownerPartyId: options.owner.partyId,
    color: options.owner.appearance.primaryColor,
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
    ...(options.activationHitEntityIds
      ? { activationHitEntityIds: options.activationHitEntityIds }
      : {}),
  };
  projectiles.push(projectile);
  return projectile;
}

function entityCenter(entity: Vec2): Vec2 {
  return { x: entity.x + PLAYER_SIZE / 2, y: entity.y + PLAYER_SIZE / 2 };
}

function entityImpacts(
  projectile: ProjectileRuntime,
  from: Vec2,
  to: Vec2,
  context: ProjectileSystemContext,
  now: number,
): {
  impact: SegmentImpact;
  monster?: MonsterRuntime;
  player?: PlayerRuntime;
  socket?: WebSocket;
}[] {
  const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const searchRadius = Math.hypot(to.x - from.x, to.y - from.y) / 2 + PLAYER_SIZE;
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
          { center: entityCenter(monster), radius: PLAYER_SIZE / 2 },
          monster.id,
        ),
        monster,
      }))
      .filter(
        (entry): entry is { impact: SegmentImpact; monster: MonsterRuntime } =>
          entry.impact !== null,
      );
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
        socket: WebSocket;
      } => entry.impact !== null && entry.socket !== undefined,
    );
}

export function advanceProjectiles(context: ProjectileSystemContext, now: number): void {
  const survivors: ProjectileRuntime[] = [];
  for (const projectile of context.projectiles) {
    if (now >= projectile.expiresAt || projectile.rangeRemaining <= 0) continue;
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
      context.blocked(projectile, first.point);
      continue;
    }

    let blockingContact: SegmentImpact | null = null;
    for (const contact of contacts) {
      if (terrain && contact.impact.fraction >= terrain.fraction) break;
      projectile.hitEntityIds.add(contact.impact.id);
      projectile.activationHitEntityIds?.add(contact.impact.id);
      if (contact.monster) context.damageMonster(projectile, contact.monster, now);
      else if (contact.player && contact.socket)
        context.healPlayer(projectile, contact.socket, contact.player, now);
      if (projectile.pierceRemaining <= 0 || projectile.targetFilter === "wounded_allies") {
        blockingContact = contact.impact;
        break;
      }
      projectile.pierceRemaining -= 1;
    }
    if (blockingContact) {
      projectile.x = blockingContact.point.x;
      projectile.y = blockingContact.point.y;
      continue;
    }
    if (terrain) {
      projectile.x = terrain.point.x;
      projectile.y = terrain.point.y;
      context.blocked(projectile, terrain.point);
      continue;
    }
    projectile.x = to.x;
    projectile.y = to.y;
    projectile.rangeRemaining -= fullDistance;
    if (projectile.rangeRemaining > 0) survivors.push(projectile);
  }
  context.projectiles.splice(0, context.projectiles.length, ...survivors);
}

export function removeProjectilesByOwner(projectiles: ProjectileRuntime[], ownerId: string): void {
  for (let index = projectiles.length - 1; index >= 0; index--) {
    if (projectiles[index]?.ownerId === ownerId) projectiles.splice(index, 1);
  }
}
