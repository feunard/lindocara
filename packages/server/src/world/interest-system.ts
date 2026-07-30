import { maxHpForLevel, pointDistance } from "@lindocara/engine/game.js";
import {
  CORPSE_VISIBILITY_RADIUS,
  GUARD_VISIBILITY_RADIUS,
  INTEREST_HYSTERESIS,
  LOOT_VISIBILITY_RADIUS,
  MONSTER_VISIBILITY_RADIUS,
  PLAYER_VISIBILITY_RADIUS,
} from "@lindocara/engine/interest.js";
import type {
  CombatActionSnapshot,
  CorpseSnapshot,
  GuardSnapshot,
  LootSnapshot,
  MonsterSnapshot,
  PlayerSnapshot,
  ProjectileSnapshot,
  WorldView,
} from "@lindocara/engine/protocol.js";
import { navigationDebug as navigationDebugSnapshot } from "./navigation-system.js";
import { isRogueStealthed } from "./rogue-state-system.js";
import { queryWithHysteresis, type SpatialGrid } from "./spatial-grid.js";
import type {
  GroundLoot,
  GuardRuntime,
  MonsterRuntime,
  PlayerRuntime,
  ProjectileRuntime,
} from "./world-runtime.js";

function combatActionSnapshot(
  action: PlayerRuntime["action"] | MonsterRuntime["action"],
): CombatActionSnapshot | null {
  if (!action) return null;
  return {
    id: action.id,
    kind: action.kind,
    ...(action.skillId === undefined ? {} : { skillId: action.skillId }),
    direction: { ...action.direction },
    startedAt: action.startedAt,
    impactAt: action.impactAt,
    recoveryEndsAt: action.recoveryEndsAt,
    ...(action.channelEndsAt === undefined ? {} : { channelEndsAt: action.channelEndsAt }),
    resolved: action.resolved,
  };
}

/**
 * Generic over the socket key (`TSocket`), same contract as `MovementSystemContext`: the legacy
 * Durable Object keys players by workerd `WebSocket` (the default), the Alepha room host by
 * connection-id string. This system only ever iterates `players.values()`.
 */
export interface InterestSystemContext<TSocket = WebSocket> {
  players: Map<TSocket, PlayerRuntime>;
  monsters: MonsterRuntime[];
  guards: GuardRuntime[];
  loot: GroundLoot[];
  projectiles: ProjectileRuntime[];
  playerGrid: SpatialGrid<PlayerRuntime>;
  monsterGrid: SpatialGrid<MonsterRuntime>;
  lootGrid: SpatialGrid<GroundLoot>;
  navigationDebugAvailable: boolean;
  now(): number;
}

export function worldView<TSocket>(
  context: InterestSystemContext<TSocket>,
  viewer: PlayerRuntime,
): WorldView {
  return {
    players: visiblePlayerSnapshots(context, viewer),
    monsters: visibleMonsterSnapshots(context, viewer),
    guards: guardSnapshots(context, viewer),
    loot: visibleLootSnapshots(context, viewer),
    corpses: corpseSnapshots(context, viewer),
    projectiles: projectileSnapshots(context.projectiles),
  };
}

export function playerSnapshot(player: PlayerRuntime, now = Date.now()): PlayerSnapshot {
  return {
    id: player.id,
    nick: player.nick,
    x: Math.round(player.x * 100) / 100,
    y: Math.round(player.y * 100) / 100,
    ack: player.ack,
    hp: player.hp,
    maxHp: maxHpForLevel(player.level),
    level: player.level,
    appearance: player.appearance,
    class: player.class,
    equipment: { ...player.equipment },
    life: player.life,
    facing: { ...player.facing },
    guarding: player.guarding,
    invisible: player.invisibleUntil > now || isRogueStealthed(player, now),
    action: combatActionSnapshot(player.action),
  };
}

function visiblePlayerSnapshots<TSocket>(
  context: InterestSystemContext<TSocket>,
  viewer: PlayerRuntime,
): PlayerSnapshot[] {
  const selection = queryWithHysteresis(
    context.playerGrid,
    viewer,
    PLAYER_VISIBILITY_RADIUS,
    INTEREST_HYSTERESIS,
    viewer.interest.players,
  );
  viewer.interest.players = selection.visibleIds;
  if (!viewer.interest.players.has(viewer.id)) {
    viewer.interest.players.add(viewer.id);
    selection.entities.push(viewer);
  }
  const now = context.now();
  return selection.entities
    .filter(
      (player) => player.authorized && (player.id === viewer.id || !isRogueStealthed(player, now)),
    )
    .map((player) => playerSnapshot(player, now));
}

function corpseSnapshots<TSocket>(
  context: InterestSystemContext<TSocket>,
  viewer: PlayerRuntime,
): CorpseSnapshot[] {
  const corpses: CorpseSnapshot[] = [];
  const radiusSquared = CORPSE_VISIBILITY_RADIUS * CORPSE_VISIBILITY_RADIUS;
  for (const player of context.players.values()) {
    if (player.corpse === null) continue;
    const dx = player.corpse.x - viewer.x;
    const dy = player.corpse.y - viewer.y;
    if (player.id !== viewer.id && dx * dx + dy * dy > radiusSquared) continue;
    corpses.push({
      id: player.id,
      nick: player.nick,
      class: player.class,
      appearance: player.appearance,
      x: player.corpse.x,
      y: player.corpse.y,
    });
  }
  return corpses;
}

function visibleMonsterSnapshots<TSocket>(
  context: InterestSystemContext<TSocket>,
  viewer: PlayerRuntime,
): MonsterSnapshot[] {
  const selection = queryWithHysteresis(
    context.monsterGrid,
    viewer,
    MONSTER_VISIBILITY_RADIUS,
    INTEREST_HYSTERESIS,
    viewer.interest.monsters,
  );
  viewer.interest.monsters = selection.visibleIds;
  const now = context.now();
  return selection.entities.map((monster) => ({
    id: monster.id,
    name: monster.name,
    kind: monster.kind,
    species: monster.species,
    rank: monster.rank,
    specialTechnique: monster.specialTechnique,
    x: Math.round(monster.x * 100) / 100,
    y: Math.round(monster.y * 100) / 100,
    hp: monster.hp,
    maxHp: monster.maxHp,
    dead: monster.deadUntil > now,
    facing: { ...monster.facing },
    action: combatActionSnapshot(monster.action),
    ...(context.navigationDebugAvailable && viewer.navigationDebug
      ? { navigationDebug: navigationDebugSnapshot(monster) }
      : {}),
  }));
}

export function guardSnapshots<TSocket>(
  context: InterestSystemContext<TSocket>,
  viewer?: PlayerRuntime,
): GuardSnapshot[] {
  const now = context.now();
  const guards = viewer
    ? context.guards.filter((guard) => pointDistance(viewer, guard) <= GUARD_VISIBILITY_RADIUS)
    : context.guards;
  return guards.map((guard) => ({
    id: guard.id,
    x: Math.round(guard.x * 100) / 100,
    y: Math.round(guard.y * 100) / 100,
    hp: guard.hp,
    maxHp: guard.maxHp,
    homeX: guard.homeX,
    homeY: guard.homeY,
    fighting: guard.fightingUntil > now,
  }));
}

function visibleLootSnapshots<TSocket>(
  context: InterestSystemContext<TSocket>,
  viewer: PlayerRuntime,
): LootSnapshot[] {
  const selection = queryWithHysteresis(
    context.lootGrid,
    viewer,
    LOOT_VISIBILITY_RADIUS,
    INTEREST_HYSTERESIS,
    viewer.interest.loot,
  );
  const visible = selection.entities.filter((loot) => canSeeLoot(loot, viewer.id));
  viewer.interest.loot = new Set(visible.map((loot) => loot.id));
  return visible.map(({ id, kind, amount, x, y }) => ({ id, kind, amount, x, y }));
}

export function canSeeLoot(loot: GroundLoot, viewerId: string): boolean {
  return loot.ownerId === undefined || loot.ownerId === viewerId;
}

function projectileSnapshots(projectiles: readonly ProjectileRuntime[]): ProjectileSnapshot[] {
  return projectiles.map((projectile) => ({
    id: projectile.id,
    actionId: projectile.actionId,
    ownerId: projectile.ownerId,
    color: projectile.color,
    kind: projectile.kind,
    x: Math.round(projectile.x * 100) / 100,
    y: Math.round(projectile.y * 100) / 100,
    direction: { ...projectile.direction },
    radius: projectile.radius,
    spawnedAt: projectile.spawnedAt,
    expiresAt: projectile.expiresAt,
  }));
}
