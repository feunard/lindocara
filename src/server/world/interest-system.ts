import { maxHpForLevel, pointDistance } from "../../shared/game.js";
import {
  CORPSE_VISIBILITY_RADIUS,
  GUARD_VISIBILITY_RADIUS,
  INTEREST_HYSTERESIS,
  LOOT_VISIBILITY_RADIUS,
  MONSTER_VISIBILITY_RADIUS,
  PLAYER_VISIBILITY_RADIUS,
} from "../../shared/interest.js";
import type {
  CombatActionSnapshot,
  CorpseSnapshot,
  GuardSnapshot,
  LootSnapshot,
  MonsterSnapshot,
  PlayerSnapshot,
  ProjectileSnapshot,
  WorldView,
} from "../../shared/protocol.js";
import { navigationDebug as navigationDebugSnapshot } from "./navigation-system.js";
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
    resolved: action.resolved,
  };
}

export interface InterestSystemContext {
  players: Map<WebSocket, PlayerRuntime>;
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

export function worldView(context: InterestSystemContext, viewer: PlayerRuntime): WorldView {
  return {
    players: visiblePlayerSnapshots(context, viewer),
    monsters: visibleMonsterSnapshots(context, viewer),
    guards: guardSnapshots(context, viewer),
    loot: visibleLootSnapshots(context, viewer),
    corpses: corpseSnapshots(context, viewer),
    projectiles: projectileSnapshots(context.projectiles),
  };
}

export function playerSnapshot(player: PlayerRuntime): PlayerSnapshot {
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
    action: combatActionSnapshot(player.action),
  };
}

function visiblePlayerSnapshots(
  context: InterestSystemContext,
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
  return selection.entities.filter((player) => player.authorized).map(playerSnapshot);
}

function corpseSnapshots(context: InterestSystemContext, viewer: PlayerRuntime): CorpseSnapshot[] {
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

function visibleMonsterSnapshots(
  context: InterestSystemContext,
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
    kind: monster.kind,
    species: monster.species,
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

export function guardSnapshots(
  context: InterestSystemContext,
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

function visibleLootSnapshots(
  context: InterestSystemContext,
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
