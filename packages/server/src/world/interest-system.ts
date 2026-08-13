import { maxHpForLevel } from "@lindocara/engine/game.js";
import { groundDistance } from "@lindocara/engine/ground.js";
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
import { type SeaGuardianRuntime, seaGuardianSnapshots } from "./sea-guardian-system.js";
import { queryWithHysteresis, type SpatialGrid } from "./spatial-grid.js";
import type {
  GroundLoot,
  GuardRuntime,
  MonsterRuntime,
  PlayerRuntime,
  ProjectileRuntime,
} from "./world-runtime.js";

/**
 * Wire precision for a position, in TILE units.
 *
 * The pixel wire rounded to 1/100 of a pixel; carrying that literal `* 100` into tile units would
 * quantise every position to 1/100 of a TILE, i.e. 0.64 px — coarser than the pixel wire was, and
 * coarse enough to make a hero's own predicted position visibly disagree with the authority it is
 * reconciling against. A tile is 64 px, so 1/6400 of a tile is the same 1/100 px the wire always
 * carried.
 */
function round(value: number): number {
  return Math.round(value * 6400) / 6400;
}

function combatActionSnapshot(
  action: PlayerRuntime["action"] | MonsterRuntime["action"],
): CombatActionSnapshot | null {
  if (!action) return null;
  return {
    id: action.id,
    kind: action.kind,
    ...(action.skillId === undefined ? {} : { skillId: action.skillId }),
    ...(action.peasantTool === undefined ? {} : { peasantTool: action.peasantTool }),
    direction: { x: action.direction.x, z: action.direction.z },
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
  seaGuardian?: SeaGuardianRuntime;
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
    seaGuardians: context.seaGuardian ? seaGuardianSnapshots(context.seaGuardian) : [],
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
    x: round(player.x),
    y: round(player.y),
    z: round(player.z),
    vy: round(player.vy),
    // Relayed, never derived: a position stream cannot tell a jump from a swim from an open canopy,
    // and those three are exactly what a remote renderer needs to draw one hero differently.
    airborne: player.airborne,
    swimming: player.swimming,
    gliding: player.gliding,
    hp: player.hp,
    maxHp: maxHpForLevel(player.level),
    level: player.level,
    appearance: player.appearance,
    class: player.class,
    equipment: { ...player.equipment },
    life: player.life,
    facing: { x: player.facing.x, z: player.facing.z },
    guarding: player.guarding,
    invisible: player.invisibleUntil > now || isRogueStealthed(player, now),
    ...(player.rangerAfterimage && player.rangerAfterimage.expiresAt > now
      ? { afterimage: { ...player.rangerAfterimage } }
      : {}),
    ...(player.peasantCarry && player.peasantCarry.until > now
      ? { peasantCarry: { ...player.peasantCarry } }
      : {}),
    ...(player.damageBoostUntil > now ? { powerBuffUntil: player.damageBoostUntil } : {}),
    ...(player.campHealingUntil > now ? { healingAuraUntil: player.campHealingUntil } : {}),
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
  // A vanished Rogue may travel far from the decoy. AOI must follow the decoy's public position,
  // never the hidden player's grid position, or observers would see it disappear early (and could
  // infer where the real Rogue moved from that disappearance).
  const entitiesById = new Map(selection.entities.map((player) => [player.id, player]));
  for (const player of context.players.values()) {
    const silhouette = player.rogueSilhouette;
    if (
      player.id !== viewer.id &&
      isRogueStealthed(player, now) &&
      silhouette &&
      silhouette.expiresAt > now &&
      groundDistance(viewer, silhouette) <= PLAYER_VISIBILITY_RADIUS + INTEREST_HYSTERESIS
    ) {
      entitiesById.set(player.id, player);
      viewer.interest.players.add(player.id);
    }
  }
  return [...entitiesById.values()]
    .filter(
      (player) =>
        player.authorized &&
        (player.id === viewer.id ||
          !isRogueStealthed(player, now) ||
          ((player.rogueSilhouette?.expiresAt ?? 0) > now &&
            groundDistance(viewer, player.rogueSilhouette ?? player) <=
              PLAYER_VISIBILITY_RADIUS + INTEREST_HYSTERESIS)),
    )
    .map((player) => {
      const snapshot = playerSnapshot(player, now);
      const silhouette =
        player.id !== viewer.id && isRogueStealthed(player, now) ? player.rogueSilhouette : null;
      return silhouette && silhouette.expiresAt > now
        ? {
            ...snapshot,
            x: silhouette.x,
            y: silhouette.y,
            z: silhouette.z,
            invisible: false,
            silhouette: true,
            action: null,
          }
        : snapshot;
    });
}

function corpseSnapshots<TSocket>(
  context: InterestSystemContext<TSocket>,
  viewer: PlayerRuntime,
): CorpseSnapshot[] {
  const corpses: CorpseSnapshot[] = [];
  const radiusSquared = CORPSE_VISIBILITY_RADIUS * CORPSE_VISIBILITY_RADIUS;
  for (const player of context.players.values()) {
    if (player.corpse === null) continue;
    // Across the GROUND: `x` and `z`. Reading `y` here would compare a corpse's elevation with
    // the viewer's, which is 0 against 0 on flat ground and therefore looks correct until the
    // first plateau.
    const dx = player.corpse.x - viewer.x;
    const dz = player.corpse.z - viewer.z;
    if (player.id !== viewer.id && dx * dx + dz * dz > radiusSquared) continue;
    corpses.push({
      id: player.id,
      nick: player.nick,
      class: player.class,
      appearance: player.appearance,
      x: player.corpse.x,
      y: player.corpse.y,
      z: player.corpse.z,
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
  const now = context.now();
  const entities = includeThreateningMonsters(selection.entities, context.monsters, viewer.id, now);
  viewer.interest.monsters = new Set(entities.map((monster) => monster.id));
  return entities.map((monster) => ({
    id: monster.id,
    name: monster.name,
    kind: monster.kind,
    species: monster.species,
    rank: monster.rank,
    specialTechnique: monster.specialTechnique,
    x: round(monster.x),
    y: round(monster.y),
    z: round(monster.z),
    hp: monster.hp,
    maxHp: monster.maxHp,
    dead: monster.deadUntil > now,
    graphicAssetId: monster.graphicAssetId,
    threatening: monsterThreatensViewer(monster, viewer.id, now),
    ...(monster.revealedUntil > now ? { revealed: true as const } : {}),
    facing: { x: monster.facing.x, z: monster.facing.z },
    action: combatActionSnapshot(monster.action),
    ...(context.navigationDebugAvailable && viewer.navigationDebug
      ? { navigationDebug: navigationDebugSnapshot(monster) }
      : {}),
  }));
}

/** Viewer-scoped combat pressure for UI/audio; target identity and the threat table stay private. */
export function monsterThreatensViewer(
  monster: MonsterRuntime,
  viewerId: string,
  now: number,
): boolean {
  return monster.deadUntil <= now && monster.threat.has(viewerId);
}

/** Threat follows its real leash, not the shorter visual AOI, so combat UI/audio cannot drop while
 * an off-edge monster is still authoritatively pursuing this viewer. */
export function includeThreateningMonsters(
  visible: readonly MonsterRuntime[],
  all: readonly MonsterRuntime[],
  viewerId: string,
  now: number,
): MonsterRuntime[] {
  const result = [...visible];
  const ids = new Set(result.map((monster) => monster.id));
  for (const monster of all) {
    if (ids.has(monster.id) || !monsterThreatensViewer(monster, viewerId, now)) continue;
    ids.add(monster.id);
    result.push(monster);
  }
  return result;
}

export function guardSnapshots<TSocket>(
  context: InterestSystemContext<TSocket>,
  viewer?: PlayerRuntime,
): GuardSnapshot[] {
  const now = context.now();
  const guards = viewer
    ? context.guards.filter((guard) => groundDistance(viewer, guard) <= GUARD_VISIBILITY_RADIUS)
    : context.guards;
  return guards.map((guard) => ({
    id: guard.id,
    x: round(guard.x),
    y: round(guard.y),
    z: round(guard.z),
    hp: guard.hp,
    maxHp: guard.maxHp,
    homeX: guard.homeX,
    homeZ: guard.homeZ,
    fighting: guard.fightingUntil > now,
    graphicAssetId: guard.graphicAssetId,
    graphicTint: guard.graphicTint,
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
  return visible.map(({ id, kind, amount, x, y, z }) => ({ id, kind, amount, x, y, z }));
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
    x: round(projectile.x),
    y: round(projectile.y),
    z: round(projectile.z),
    direction: { x: projectile.direction.x, z: projectile.direction.z },
    radius: projectile.radius,
    spawnedAt: projectile.spawnedAt,
    expiresAt: projectile.expiresAt,
  }));
}
