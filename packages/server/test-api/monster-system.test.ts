/**
 * Monster and guard behaviour, in tile units against a heightfield.
 *
 * Geometry is expressed through `tile()`, which is the old pixel coordinate divided by `TILE_SIZE`
 * and shifted onto a grid-centred origin. That is not nostalgia: every range these tests measure
 * against (`MONSTER_ATTACK_RANGE`, `GUARD_ATTACK_RANGE`, the patrol radii) was converted by the
 * exact same quotient, so keeping the positions in step preserves each test's margin instead of
 * silently re-tuning it. `tile(px)` and the cell index `px / TILE_SIZE` line up by construction,
 * which is what lets a legacy pixel obstacle rectangle become a block of cells with no arithmetic.
 *
 * **Five tests died with the pixel model rather than being converted**, and each of them pinned a
 * rule that no longer exists:
 *
 * - "paths around a coarsened tile wall instead of grinding into it" pinned the disagreement
 *   between a rectangle-based line of sight and a tile grid that rasterised an 8 px rectangle into
 *   a solid 64 px cell. A heightfield has no rasterisation step: relief is per cell and props are
 *   sub-cell rectangles a disc is tested against directly, so there is no fattened wall to
 *   disagree about. What that test really guarded — a monster routes round an obstruction and
 *   actually arrives, rather than grinding along its face — is kept below as "paths around a
 *   blocked cell", built on a cell that is genuinely impassable.
 * - "leaves no rect an authored map's entities can hide in", "still lets the catalogue's safe city
 *   disarm a monster standing right on top of a player" and "lets a monster acquire threat and
 *   attack a player standing on a bare authored map" were three faces of the SAFE ZONE.
 *   `ZoneTerrain` carries no `safeZone` and a stored heightfield has no way to declare one, so the
 *   "monsters may not touch a player inside the walls" rule is gone and the guard patrol ring
 *   replaces it (see the root `AGENTS.md`). `safeZoneShelters` survives only for the pixel
 *   catalogue's own tests, and no converted system calls it.
 * - the same rule is why "telegraphs a monster attack before the guard defeats it" no longer wraps
 *   its terrain in an all-covering safe zone: it was never what the test asserted.
 * "Does not attack through an obstacle even when centre distance is within melee range" was very
 * nearly a fifth casualty, on the theory that a `BODY_RADIUS` disc kept off relief puts any two
 * standable points further apart than `GUARD_ATTACK_RANGE`. **That is true across a cell FACE
 * (1 + 2 * 0.25 = 1.5 tiles) and false across a CORNER.** `maxHeightAround`
 * (`hd2d/terrain-query.ts:63-82`) is a disc test against each cell's CLOSEST POINT, so around a
 * plateau's corner the standable region pinches to "further than `BODY_RADIUS` from that one
 * point" rather than "outside the whole cell", and two bodies can sit diagonally opposite at
 * `2 * 0.25 * sqrt(2) ≈ 0.707` — comfortably inside the 0.84 melee reach. The test lives on below,
 * on exactly that corner. It is the ONLY melee-range coverage of `groundLineOfSight`, which
 * `monster-system.ts` consults at `:318` (monsters) and `:558` (guards).
 */

import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { THREAT_EXPIRES_MS } from "@lindocara/engine/cooperation.js";
import {
  GUARD_ATTACK_COOLDOWN_MS,
  GUARD_ATTACK_RANGE,
  GUARD_DAMAGE,
  MONSTER_ATTACK_COOLDOWN_MS,
  MONSTER_ATTACK_RANGE,
} from "@lindocara/engine/game.js";
import { type GroundVector, groundDistance } from "@lindocara/engine/ground.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { DEFAULT_ZONE_NAVIGATION } from "@lindocara/engine/navigation.js";
import { TICK_DT } from "@lindocara/engine/simulation.js";
import {
  BODY_RADIUS,
  canStand,
  groundLineOfSight,
  type ZoneTerrain,
  zoneTerrainFromHeightfield,
} from "@lindocara/engine/terrain-access.js";
import type { ZoneDefinition } from "@lindocara/engine/zones.js";
import {
  advanceGuards,
  advanceMonsters,
  forgetPlayerFromMonsters,
  type MonsterSystemContext,
  resetMonsterAtSpawn,
} from "@lindocara/server/world/monster-system.js";
import { createNavigationRuntime } from "@lindocara/server/world/navigation-system.js";
import { SpatialGrid } from "@lindocara/server/world/spatial-grid.js";
import {
  createGuards,
  createMonsters,
  type MonsterRuntime,
  newPlayer,
  type PlayerRuntime,
} from "@lindocara/server/world/world-runtime.js";
import { describe, expect, it, vi } from "vitest";

const SIZE = 16;
const HALF = SIZE / 2;

/** A legacy pixel coordinate, in tile units with the grid centre as origin. */
function tile(pixels: number): number {
  return pixels / 64 - HALF;
}

/** A block of cells, in grid indices — the successor of a pixel obstacle rectangle. */
interface CellRect {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

/** Blocked cells are WATER: `canStand` refuses them at any elevation, like a solid tile did. */
function terrainOf(blocks: readonly CellRect[] = []): ZoneTerrain {
  const blocked = (col: number, row: number) =>
    blocks.some(
      (rect) =>
        col >= rect.col &&
        col < rect.col + rect.cols &&
        row >= rect.row &&
        row < rect.row + rect.rows,
    );
  const levels: (number | null)[] = [];
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) levels.push(blocked(col, row) ? null : 0);
  }
  const map: MapData = {
    version: 1,
    size: SIZE,
    levelHeight: 0.5,
    waterLevel: -0.25,
    levels,
    materials: new Array(SIZE * SIZE).fill("herbe"),
    colliders: [],
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

const terrain = terrainOf();
/** The old 64x128 px wall at (64, 0): cells col 1, rows 0-1. */
const WALL_BLOCK: CellRect = { col: 1, row: 0, cols: 1, rows: 2 };
/**
 * The closest a body may stand west of `WALL_BLOCK` — its west face at `tile(64)`, less the disc
 * `canStand` keeps off relief. A monster placed a hair further out is standing still, and the very
 * next eastward step is refused: the pixel suite got the same "one pixel shy of the boundary" start
 * from a body box against a tile edge.
 */
const WALL_WEST_LIMIT = tile(64) - 0.25;

const zone: ZoneDefinition = {
  id: "verdant-reach",
  nameKey: "zone.verdant_reach.name",
  type: "open_world",
  defaultInstanceId: "main",
  maxPlayers: 48,
  terrain,
  quests: [],
  questSites: [],
  monsters: [],
  guards: [],
  portals: [],
  navigation: { ...DEFAULT_ZONE_NAVIGATION, nodeBudgetPerTick: 200 },
};

function zoneWith(built: ZoneTerrain): ZoneDefinition {
  return { ...zone, terrain: built };
}

function targetPlayer(x: number, z: number): PlayerRuntime {
  return newPlayer(
    {
      id: "chase-target",
      nick: "Target",
      x,
      y: 0,
      z,
      level: 1,
      xp: 0,
      hp: 100,
      appearance: { body: "wayfarer", primaryColor: "azure" },
      class: "warrior",
      equipment: starterEquipmentFor("warrior"),
      inventory: { potions: 2, gold: 0, crystals: 0 },
      quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
      zoneId: "verdant-reach",
      instanceId: "main",
      sessionEpoch: 1,
      wardRunExpiresAt: null,
      life: "alive",
      corpse: null,
    },
    "connection-1",
    "verdant-reach:main",
  );
}

function chasingMonster(): MonsterRuntime {
  const monster = createMonsters([
    {
      id: "test-goblin",
      kind: "goblin",
      species: "spear_goblin",
      zone: "route",
      x: tile(250),
      y: 0,
      z: tile(220),
      patrolRadius: 40 / 64,
    },
  ])[0];
  if (!monster) throw new Error("missing monster");
  return monster;
}

describe("authored monster tuning", () => {
  it("hydrates a named boss with authoritative stats and a special technique", () => {
    const boss = createMonsters([
      {
        id: "authored-boss",
        name: "Varos",
        kind: "skull",
        species: "skull_warden",
        zone: "route",
        x: tile(320),
        y: 0,
        z: tile(192),
        patrolRadius: 96 / 64,
        rank: "boss",
        maxHp: 3_600,
        damage: 52,
        speed: 74,
        xp: 3_000,
        weakness: "priest",
        weaknessPercent: 180,
        specialTechnique: "soul_drain",
      },
    ])[0];

    expect(boss).toMatchObject({
      name: "Varos",
      rank: "boss",
      hp: 3_600,
      maxHp: 3_600,
      damage: 52,
      speed: 74,
      xp: 3_000,
      weakness: "priest",
      weaknessPercent: 180,
      specialTechnique: "soul_drain",
      nextSpecialAt: 0,
    });
  });
});

describe("enemy ranged attack acceptance", () => {
  function rangedHarness(monsterX: number, playerX: number, combatZone = zone) {
    const monster = chasingMonster();
    monster.x = tile(monsterX);
    monster.z = tile(32);
    monster.attackProfile = "arrow";
    const player = targetPlayer(tile(playerX), tile(32));
    monster.threat.set(player.id, { playerId: player.id, amount: 999, updatedAt: 1_000 });
    const monsterGrid = new SpatialGrid<MonsterRuntime>(1);
    monsterGrid.insert(monster);
    const startAttack = vi.fn();
    const context: MonsterSystemContext = {
      players: new Map([[{ id: "ranged-socket" } as unknown as WebSocket, player]]),
      monsters: [monster],
      guards: [],
      monsterGrid,
      zone: combatZone,
      tick: 0,
      navigation: createNavigationRuntime(combatZone.terrain, combatZone.navigation),
      startAttack,
    };
    return { context, monster, player, startAttack };
  }

  it("accepts a visible target in range immediately and keeps the normal cooldown", () => {
    const { context, monster, startAttack } = rangedHarness(100, 280);
    const firstAttackAt = 1_000;

    advanceMonsters(context, firstAttackAt);
    expect(startAttack).toHaveBeenCalledTimes(1);
    expect(monster.lastAttackAt).toBe(firstAttackAt);

    advanceMonsters(context, firstAttackAt + MONSTER_ATTACK_COOLDOWN_MS - 1);
    expect(startAttack).toHaveBeenCalledTimes(1);
    advanceMonsters(context, firstAttackAt + MONSTER_ATTACK_COOLDOWN_MS);
    expect(startAttack).toHaveBeenCalledTimes(2);
  });

  it("does not accept a target outside the authored projectile range", () => {
    const { context, monster, startAttack } = rangedHarness(100, 401);

    advanceMonsters(context, 1_000);

    expect(startAttack).not.toHaveBeenCalled();
    expect(monster.lastAttackAt).toBe(0);
  });

  it("repositions instead of firing through an obstacle or consuming its cooldown", () => {
    // The wall is water, and water does NOT block a shot — it is a surface below the arrow, not a
    // wall (see `groundLineOfSight`). Relief does, so the obstruction is a plateau: cells col 1,
    // rows 0-1, standing between a shooter and a target both on level 0.
    const wallZone = zoneWith(plateauTerrain([WALL_BLOCK]));
    const { context, monster, startAttack } = rangedHarness(0, 160, wallZone);

    advanceMonsters(context, 1_000);

    expect(startAttack).not.toHaveBeenCalled();
    expect(monster.lastAttackAt).toBe(0);
    expect(monster.navigation.state).not.toBe("idle");
  });
});

/** The same block shape as `terrainOf`, raised one level instead of flooded. Relief blocks sight. */
function plateauTerrain(blocks: readonly CellRect[], level = 1): ZoneTerrain {
  const raised = (col: number, row: number) =>
    blocks.some(
      (rect) =>
        col >= rect.col &&
        col < rect.col + rect.cols &&
        row >= rect.row &&
        row < rect.row + rect.rows,
    );
  const levels: (number | null)[] = [];
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) levels.push(raised(col, row) ? level : 0);
  }
  const map: MapData = {
    version: 1,
    size: SIZE,
    levelHeight: 0.5,
    waterLevel: -0.25,
    levels,
    materials: new Array(SIZE * SIZE).fill("herbe"),
    colliders: [],
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

describe("guard effective attack acceptance", () => {
  function guardHarness(
    monsterPosition: GroundVector,
    guardPosition: GroundVector,
    combatTerrain: ZoneTerrain = terrain,
  ) {
    const combatZone = zoneWith(combatTerrain);
    const monster = chasingMonster();
    monster.x = monsterPosition.x;
    monster.z = monsterPosition.z;
    monster.maxHp = GUARD_DAMAGE * 4;
    monster.hp = monster.maxHp;
    const guards = createGuards([
      {
        id: "effective-range-guard",
        x: guardPosition.x,
        y: 0,
        z: guardPosition.z,
        patrolRadius: 240 / 64,
      },
    ]);
    const guard = guards[0];
    if (!guard) throw new Error("missing guard");
    const monsterGrid = new SpatialGrid<MonsterRuntime>(1);
    monsterGrid.insert(monster);
    const startAttack = vi.fn();
    const context: MonsterSystemContext = {
      players: new Map(),
      monsters: [monster],
      guards,
      monsterGrid,
      zone: combatZone,
      tick: 0,
      navigation: createNavigationRuntime(combatTerrain, combatZone.navigation),
      startAttack,
    };
    return { context, guard, monster, startAttack };
  }

  it("pursues a detected target outside effective range without attacking or spending cooldown", () => {
    const { context, guard, monster, startAttack } = guardHarness(
      { x: tile(220), z: tile(100) },
      { x: tile(100), z: tile(100) },
    );
    const hpBefore = monster.hp;

    advanceGuards(context, 1_000);

    expect(guard.x).toBeGreaterThan(tile(100));
    expect(monster.hp).toBe(hpBefore);
    expect(guard.lastAttackAt).toBe(0);
    expect(guard.fightingUntil).toBe(0);
    expect(startAttack).not.toHaveBeenCalled();
  });

  it("starts attacking as soon as the pursued target reaches the exact range boundary", () => {
    const { context, guard, monster } = guardHarness(
      { x: tile(220), z: tile(100) },
      { x: tile(100), z: tile(100) },
    );
    advanceGuards(context, 1_000);
    monster.x = guard.x + GUARD_ATTACK_RANGE;
    monster.z = guard.z;
    const acceptedAt = 1_100;
    const hpBefore = monster.hp;

    advanceGuards(context, acceptedAt);

    expect(monster.hp).toBe(hpBefore - GUARD_DAMAGE);
    expect(guard.lastAttackAt).toBe(acceptedAt);
    expect(guard.fightingUntil).toBe(acceptedAt + 420);
  });

  it("does not accept or spend cooldown when a target leaves range before the guard is ready", () => {
    const { context, guard, monster } = guardHarness(
      { x: tile(100) + GUARD_ATTACK_RANGE, z: tile(100) },
      { x: tile(100), z: tile(100) },
    );
    const hpBefore = monster.hp;

    advanceGuards(context, GUARD_ATTACK_COOLDOWN_MS - 1);
    expect(monster.hp).toBe(hpBefore);
    monster.x = guard.x + GUARD_ATTACK_RANGE + 1 / 64;
    advanceGuards(context, GUARD_ATTACK_COOLDOWN_MS + 1);

    expect(monster.hp).toBe(hpBefore);
    expect(guard.lastAttackAt).toBe(0);
    expect(guard.fightingUntil).toBe(0);
  });

  it("does not attack through an obstacle even when centre distance is within melee range", () => {
    // A single plateau cell covering world [0, 1]^2 (grid cell 8, 8 on a 16-tile grid), and two
    // bodies tucked diagonally against its north-west corner at (0, 0). Both are standable —
    // `maxHeightAround` measures to the cell's CLOSEST POINT, which for each of them is that
    // corner, 0.2517 away and therefore outside the 0.25 disc — and their centres are 0.8251
    // apart, inside `GUARD_ATTACK_RANGE` (0.84375). The segment between them passes through the
    // cell's interior, so relief must refuse the strike. This is the only melee-range witness for
    // `groundLineOfSight`; deleting it leaves `monster-system.ts:318` and `:558` covered at
    // projectile distance only.
    const corner = plateauTerrain([{ col: 8, row: 8, cols: 1, rows: 1 }]);
    const { context, guard, monster, startAttack } = guardHarness(
      { x: 0.3317, z: -0.2517 },
      { x: -0.2517, z: 0.3317 },
      corner,
    );
    const hpBefore = monster.hp;
    expect(groundDistance(guard, monster)).toBeLessThan(GUARD_ATTACK_RANGE);
    expect(canStand(corner, guard.x, guard.z, BODY_RADIUS, 0)).toBe(true);
    expect(canStand(corner, monster.x, monster.z, BODY_RADIUS, 0)).toBe(true);
    expect(groundLineOfSight(corner, guard, monster)).toBe(false);

    advanceGuards(context, 1_000);

    expect(monster.hp).toBe(hpBefore);
    expect(guard.lastAttackAt).toBe(0);
    expect(guard.fightingUntil).toBe(0);
    expect(startAttack).not.toHaveBeenCalled();
  });

  it("applies one attack and keeps the normal cooldown at the stable range boundary", () => {
    const { context, guard, monster } = guardHarness(
      { x: tile(100) + GUARD_ATTACK_RANGE, z: tile(100) },
      { x: tile(100), z: tile(100) },
    );
    const acceptedAt = 1_000;
    advanceGuards(context, acceptedAt);
    const hpAfterFirst = monster.hp;

    advanceGuards(context, acceptedAt + GUARD_ATTACK_COOLDOWN_MS - 1);
    expect(monster.hp).toBe(hpAfterFirst);
    expect(guard.lastAttackAt).toBe(acceptedAt);

    advanceGuards(context, acceptedAt + GUARD_ATTACK_COOLDOWN_MS);
    expect(monster.hp).toBe(hpAfterFirst - GUARD_DAMAGE);
    expect(guard.lastAttackAt).toBe(acceptedAt + GUARD_ATTACK_COOLDOWN_MS);
  });
});

describe("monster navigation on the heightfield", () => {
  function monsterContext(
    monsters: MonsterRuntime[],
    players: Map<WebSocket, PlayerRuntime>,
    combatZone = zone,
  ): MonsterSystemContext {
    const monsterGrid = new SpatialGrid<MonsterRuntime>(1);
    for (const monster of monsters) monsterGrid.insert(monster);
    return {
      players,
      monsters,
      guards: [],
      monsterGrid,
      zone: combatZone,
      tick: 0,
      navigation: createNavigationRuntime(combatZone.terrain, combatZone.navigation),
      startAttack: vi.fn(),
    };
  }

  it("keeps threat alive while the monster is still pursuing its valid target", () => {
    const monster = chasingMonster();
    const player = targetPlayer(tile(500), tile(220));
    const socket = { id: "pursuit-socket" } as unknown as WebSocket;
    monster.threat.set(player.id, { playerId: player.id, amount: 50, updatedAt: 1_000 });
    const context = monsterContext([monster], new Map([[socket, player]]));

    const firstRefresh = 1_000 + THREAT_EXPIRES_MS - 1;
    advanceMonsters(context, firstRefresh);
    const secondRefresh = firstRefresh + THREAT_EXPIRES_MS - 1;
    advanceMonsters(context, secondRefresh);

    expect(monster.threat.get(player.id)?.updatedAt).toBe(secondRefresh);
  });

  it("abandons a vanished Rogue immediately without erasing earned contribution", () => {
    const monster = chasingMonster();
    const player = targetPlayer(tile(260), tile(220));
    player.class = "rogue";
    monster.threat.set(player.id, { playerId: player.id, amount: 50, updatedAt: 1_000 });
    monster.contributions.set(player.id, {
      playerId: player.id,
      damage: 12,
      usefulHealing: 0,
      relevantThreat: 0,
      updatedAt: 1_000,
    });
    monster.navigation.state = "chase";
    monster.navigation.targetId = player.id;
    monster.navigation.destination = { x: player.x, z: player.z };
    monster.navigation.requestedDestination = { x: player.x, z: player.z };
    monster.navigation.path = [{ x: player.x, z: player.z }];
    monster.vx = 20;

    forgetPlayerFromMonsters([monster], player.id);

    expect(monster.threat.has(player.id)).toBe(false);
    expect(monster.contributions.get(player.id)?.damage).toBe(12);
    expect(monster.navigation).toMatchObject({
      state: "idle",
      targetId: null,
      destination: null,
      requestedDestination: null,
      path: [],
      abandonReason: "target_hidden",
    });
    expect(monster.vx).toBe(0);
  });

  it("keeps a relentless pursuer on an invisible distant hero and accelerates to its ceiling", () => {
    const monster = chasingMonster();
    monster.pursuitMode = "relentless";
    monster.baseSpeed = 2;
    monster.speed = 2;
    monster.acceleration = 10;
    monster.maxSpeed = 2.75;
    const player = targetPlayer(tile(600), tile(220));
    player.invisibleUntil = 10_000;
    player.forgottenUntil = 10_000;
    const socket = { id: "runner-socket" } as unknown as WebSocket;
    const context = monsterContext([monster], new Map([[socket, player]]));

    advanceMonsters(context, 1_000);
    expect(monster.threat.has(player.id)).toBe(true);
    expect(monster.navigation.targetId).toBe(player.id);
    expect(monster.speed).toBeCloseTo(2 + 10 * TICK_DT);

    for (let tick = 0; tick < 10; tick += 1) advanceMonsters(context, 1_050 + tick * 50);
    expect(monster.speed).toBe(2.75);
    forgetPlayerFromMonsters([monster], player.id);
    expect(monster.threat.has(player.id)).toBe(true);
  });

  it("defeats the hero on runner contact without starting a monster attack", () => {
    const monster = chasingMonster();
    monster.pursuitMode = "relentless";
    monster.oneHitKill = true;
    monster.x = 0;
    monster.z = 0;
    monster.action = {
      id: "obsolete-runner-swing",
      kind: "monster_attack",
      direction: { x: 1, z: 0 },
      startedAt: 900,
      impactAt: 1_100,
      recoveryEndsAt: 1_500,
      resolved: false,
    };
    const player = targetPlayer(0.45, 0);
    const socket = { id: "runner-contact-socket" } as unknown as WebSocket;
    const context = monsterContext([monster], new Map([[socket, player]]));
    const killPlayerOnContact = vi.fn();
    context.killPlayerOnContact = killPlayerOnContact;

    advanceMonsters(context, 1_000);

    expect(killPlayerOnContact).toHaveBeenCalledOnce();
    expect(killPlayerOnContact).toHaveBeenCalledWith(monster, socket, player, 1_000);
    expect(context.startAttack).not.toHaveBeenCalled();
    expect(monster.action).toBeNull();
  });

  it("restores a relentless pursuer to its authored start and base speed", () => {
    const monster = chasingMonster();
    const context = monsterContext([monster], new Map());
    monster.pursuitMode = "relentless";
    monster.baseSpeed = 2;
    monster.speed = 7;
    monster.x += 2;
    monster.hp = 1;
    monster.runnerLeap = {
      fromX: monster.x,
      fromY: monster.y,
      fromZ: monster.z,
      toX: monster.x + 2,
      toY: monster.y + 1.5,
      toZ: monster.z,
      startedAt: 1_000,
      endsAt: 1_700,
    };
    monster.threat.set("runner", { playerId: "runner", amount: 1, updatedAt: 0 });

    resetMonsterAtSpawn(monster, terrain, context.monsterGrid, 5_000);

    expect(monster).toMatchObject({
      x: monster.spawnX,
      z: monster.spawnZ,
      hp: monster.maxHp,
      speed: 2,
      deadUntil: 0,
      runnerLeap: null,
    });
    expect(monster.threat.size).toBe(0);
  });

  it("leaps a relentless pursuer from level 0 onto a level 3 plateau", () => {
    const cliffTerrain = plateauTerrain([{ col: 8, row: 6, cols: 4, rows: 5 }], 3);
    const cliffZone = zoneWith(cliffTerrain);
    const monster = chasingMonster();
    monster.x = -0.251;
    monster.y = 0;
    monster.z = 0.5;
    monster.spawnX = monster.x;
    monster.spawnZ = monster.z;
    monster.pursuitMode = "relentless";
    monster.oneHitKill = true;
    monster.baseSpeed = 5.4;
    monster.speed = 5.4;
    monster.maxSpeed = 7.8;
    const player = targetPlayer(2, 0.5);
    player.y = 1.5;
    const socket = { id: "runner-cliff-socket" } as unknown as WebSocket;
    const context = monsterContext([monster], new Map([[socket, player]]), cliffZone);

    for (let tick = 0; tick < 4 && monster.runnerLeap === null; tick += 1) {
      advanceMonsters(context, 1_000 + tick * 50);
    }
    const leap = monster.runnerLeap;
    expect(leap).not.toBeNull();
    if (!leap) throw new Error("runner leap did not start");

    advanceMonsters(context, (leap.startedAt + leap.endsAt) / 2);
    expect(monster.runnerLeap).not.toBeNull();
    expect(monster.y).toBeGreaterThan(1.5);

    advanceMonsters(context, leap.endsAt);
    expect(monster.runnerLeap).toBeNull();
    expect(monster.x).toBeGreaterThanOrEqual(1.9);
    expect(monster.y).toBe(1.5);
    expect(monster.threat.has(player.id)).toBe(true);
  });

  it("starts a runner leap before collider sliding can steer it around an obstacle", () => {
    const obstacleMap: MapData = {
      version: 1,
      size: SIZE,
      levelHeight: 0.5,
      waterLevel: -0.25,
      levels: new Array(SIZE * SIZE).fill(0),
      materials: new Array(SIZE * SIZE).fill("herbe"),
      colliders: [{ x: -0.3, z: -0.7, w: 0.6, h: 1.4, top: 1 }],
      spawns: [],
      elements: [],
      events: [],
    };
    const obstacleZone = zoneWith(zoneTerrainFromHeightfield(obstacleMap));
    const monster = chasingMonster();
    monster.x = -2;
    monster.y = 0;
    monster.z = 0;
    monster.spawnX = monster.x;
    monster.spawnZ = monster.z;
    monster.pursuitMode = "relentless";
    monster.oneHitKill = true;
    monster.baseSpeed = 6.4;
    monster.speed = 6.4;
    monster.maxSpeed = 8.6;
    const player = targetPlayer(3, 0);
    const socket = { id: "runner-obstacle-socket" } as unknown as WebSocket;
    const context = monsterContext([monster], new Map([[socket, player]]), obstacleZone);

    advanceMonsters(context, 1_000);

    expect(monster.runnerLeap).not.toBeNull();
    expect(monster.runnerLeap?.toX).toBeGreaterThan(0.3);
    expect(context.startAttack).not.toHaveBeenCalled();
  });

  it("cannot acquire a stealthed Rogue but can target them after the window ends", () => {
    const monster = chasingMonster();
    const player = targetPlayer(tile(260), tile(220));
    player.class = "rogue";
    player.rogueStealthUntil = 2_000;
    const socket = { id: "rogue-socket" } as unknown as WebSocket;
    const context = monsterContext([monster], new Map([[socket, player]]));

    advanceMonsters(context, 1_000);
    expect(monster.threat.has(player.id)).toBe(false);
    expect(context.startAttack).not.toHaveBeenCalled();

    player.rogueStealthUntil = 0;
    advanceMonsters(context, 1_100);
    expect(monster.threat.has(player.id)).toBe(true);
  });

  it("pursues a live Ranger afterimage instead of the Ranger until the decoy expires", () => {
    const monster = chasingMonster();
    const player = targetPlayer(tile(260), tile(220));
    player.class = "ranger";
    player.rangerAfterimage = { x: tile(400), y: 0, z: tile(220), expiresAt: 3_000 };
    monster.threat.set(player.id, { playerId: player.id, amount: 999, updatedAt: 1_000 });
    const socket = { id: "afterimage-socket" } as unknown as WebSocket;
    const context = monsterContext([monster], new Map([[socket, player]]));

    advanceMonsters(context, 1_000);
    expect(monster.navigation.destination?.x).toBe(tile(400));
    advanceMonsters(context, 3_001);
    expect(player.rangerAfterimage).toBeNull();
    expect(monster.navigation.destination?.x).toBe(player.x);
  });

  it("keeps pursuing a vanished Rogue's silhouette until it expires", () => {
    const monster = chasingMonster();
    const player = targetPlayer(tile(260), tile(220));
    player.class = "rogue";
    player.rogueStealthUntil = 4_000;
    player.rogueSilhouette = { x: tile(400), y: 0, z: tile(220), hp: 45, expiresAt: 3_000 };
    monster.threat.set(player.id, { playerId: player.id, amount: 999, updatedAt: 1_000 });
    const socket = { id: "silhouette-socket" } as unknown as WebSocket;
    const context = monsterContext([monster], new Map([[socket, player]]));

    advanceMonsters(context, 1_000);
    expect(monster.threat.has(player.id)).toBe(true);
    expect(monster.navigation.destination?.x).toBe(tile(400));
    advanceMonsters(context, 3_001);
    expect(player.rogueSilhouette).toBeNull();
    expect(monster.threat.has(player.id)).toBe(false);
  });

  it("telegraphs a monster attack before the guard defeats it", () => {
    const monster = chasingMonster();
    monster.x = tile(100);
    monster.z = tile(100);
    const guards = createGuards([
      { id: "guard", x: tile(110), y: 0, z: tile(100), patrolRadius: 100 / 64 },
    ]);
    const guard = guards[0];
    if (!guard) throw new Error("missing guard");
    const monsterGrid = new SpatialGrid<MonsterRuntime>(1);
    monsterGrid.insert(monster);
    const startAttack = vi.fn();
    const context: MonsterSystemContext = {
      players: new Map(),
      monsters: [monster],
      guards,
      monsterGrid,
      zone,
      tick: 0,
      navigation: createNavigationRuntime(terrain, zone.navigation),
      startAttack,
    };

    advanceGuards(context, MONSTER_ATTACK_COOLDOWN_MS + 1);

    expect(startAttack).toHaveBeenCalledWith(monster, guard, MONSTER_ATTACK_COOLDOWN_MS + 1);
    expect(guard.hp).toBe(guard.maxHp);
    expect(monster.hp).toBe(0);
  });

  it("lets a guard engage a monster inside its patrol ring", () => {
    const monster = chasingMonster();
    monster.x = tile(100);
    monster.z = tile(100);
    const guards = createGuards([
      { id: "authored-guard", x: tile(110), y: 0, z: tile(100), patrolRadius: 100 / 64 },
    ]);
    const monsterGrid = new SpatialGrid<MonsterRuntime>(1);
    monsterGrid.insert(monster);
    const context: MonsterSystemContext = {
      players: new Map(),
      monsters: [monster],
      guards,
      monsterGrid,
      zone,
      tick: 0,
      navigation: createNavigationRuntime(terrain, zone.navigation),
      startAttack: vi.fn(),
    };

    advanceGuards(context, MONSTER_ATTACK_COOLDOWN_MS + 1);

    expect(monster.hp).toBe(0);
    expect(monster.deadUntil).toBeGreaterThan(MONSTER_ATTACK_COOLDOWN_MS + 1);
  });

  it("keeps a guard inside its patrol leash against a distant target", () => {
    const monster = chasingMonster();
    monster.x = tile(260);
    monster.z = tile(100);
    const guards = createGuards([
      { id: "leashed-guard", x: tile(100), y: 0, z: tile(100), patrolRadius: 32 / 64 },
    ]);
    const guard = guards[0];
    if (!guard) throw new Error("missing guard");
    const monsterGrid = new SpatialGrid<MonsterRuntime>(1);
    monsterGrid.insert(monster);
    const startAttack = vi.fn();
    const context: MonsterSystemContext = {
      players: new Map(),
      monsters: [monster],
      guards,
      monsterGrid,
      zone,
      tick: 0,
      navigation: createNavigationRuntime(terrain, zone.navigation),
      startAttack,
    };

    for (let tick = 0; tick < 80; tick += 1) {
      advanceGuards(context, (tick + 1) * TICK_DT * 1_000);
    }

    expect(guard.x).toBeGreaterThan(tile(100));
    expect(groundDistance(guard, { x: guard.homeX, z: guard.homeZ })).toBeLessThanOrEqual(
      32 / 64 + 0.001,
    );
    expect(startAttack).not.toHaveBeenCalled();
  });

  it("paths around a blocked cell instead of grinding into it", () => {
    // The straight line from the monster to its target crosses a water cell. The direct-move
    // branch is refused, the pathfinder must produce a detour, and the monster must actually
    // arrive rather than sliding along the obstruction's face forever.
    const blockedZone = zoneWith(terrainOf([{ col: 3, row: 4, cols: 1, rows: 1 }]));
    const monster = chasingMonster();
    const player = targetPlayer(tile(250), tile(400));
    const socket = { id: "socket-1" } as unknown as WebSocket;
    monster.threat.set(player.id, { playerId: player.id, amount: 999, updatedAt: 0 });
    const context = monsterContext([monster], new Map([[socket, player]]), blockedZone);

    let reachedAtTick = -1;
    let maxXDeviation = 0;
    const startX = monster.x;
    const tickMs = TICK_DT * 1000;
    for (let tick = 0; tick < 200; tick++) {
      context.tick = tick;
      advanceMonsters(context, tick * tickMs);
      maxXDeviation = Math.max(maxXDeviation, Math.abs(monster.x - startX));
      if (groundDistance(monster, player) <= MONSTER_ATTACK_RANGE) {
        reachedAtTick = tick;
        break;
      }
    }

    expect(reachedAtTick).toBeGreaterThan(-1);
    // It went sideways to get round the cell rather than merely sliding along its face.
    expect(maxXDeviation).toBeGreaterThan(20 / 64);
  });

  it("re-plans instead of freezing when a waypoint move is fully blocked", () => {
    // A single-column wall spanning rows 0-1, open only at row 2 — the monster must detour down
    // and back up to cross it. Column 0 (monster) and column 4 (player) sit on either side, all in
    // row 0, so the straight line between them runs directly through the blocked column: the
    // direct-move branch never applies here, only the path-following one.
    const wallZone = zoneWith(plateauTerrain([WALL_BLOCK]));

    const monster = createMonsters([
      {
        id: "blocked-goblin",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: WALL_WEST_LIMIT - 0.01,
        y: 0,
        z: tile(32),
        patrolRadius: 40 / 64,
      },
    ])[0];
    if (!monster) throw new Error("missing monster");
    const player = targetPlayer(tile(280), tile(32));
    const socket = { id: "socket-2" } as unknown as WebSocket;
    monster.threat.set(player.id, { playerId: player.id, amount: 999, updatedAt: 0 });

    // Sabotage: hand the monster a "path" whose one waypoint jumps straight across the wall, as
    // if a stale plan had survived past the point collision actually refuses it.
    monster.navigation.state = "chase";
    monster.navigation.targetId = player.id;
    monster.navigation.requestedDestination = { x: player.x, z: player.z };
    monster.navigation.destination = { x: player.x, z: player.z };
    monster.navigation.path = [{ x: player.x, z: player.z }];
    monster.navigation.pathIndex = 0;
    monster.navigation.requestPending = false;
    monster.navigation.lastPathRequestAt = 0;

    const context = monsterContext([monster], new Map([[socket, player]]), wallZone);

    const startX = monster.x;
    advanceMonsters(context, 0);
    // The blocked waypoint move must not have moved the monster at all...
    expect(monster.x).toBe(startX);
    // ...but it must have invalidated the stale path rather than leaving it in place forever —
    // this is the recovery the direct-move branch already had (`directBlockedDestination`) and the
    // path-following branch did not, before this fix.
    expect(monster.navigation.path.length).toBe(0);
    expect(monster.navigation.abandonReason).toBe("waypoint_blocked");

    // Recovery must be real, not just internal bookkeeping: given ticks to re-plan around the
    // wall (through the row-2 gap), the monster must actually arrive.
    let reachedAtTick = -1;
    const tickMs = TICK_DT * 1000;
    for (let tick = 1; tick < 300; tick++) {
      context.tick = tick;
      advanceMonsters(context, tick * tickMs);
      if (groundDistance(monster, player) <= MONSTER_ATTACK_RANGE) {
        reachedAtTick = tick;
        break;
      }
    }
    expect(reachedAtTick).toBeGreaterThan(-1);
  });

  it("re-plans within a tick and does not reuse the stale cached path when a waypoint move is refused", () => {
    // Same wedge shape as the test above, but this time the stale path is also sitting in the
    // navigation cache under the exact key a re-plan for this start/goal would use — the situation
    // a *legitimate* earlier `requestMonsterPath` call would actually leave behind. If the recovery
    // does not evict that entry, the very re-plan it triggers hands back the identical
    // one-waypoint path that just failed.
    const wallZone = zoneWith(plateauTerrain([WALL_BLOCK]));

    const monster = createMonsters([
      {
        id: "blocked-goblin-2",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: WALL_WEST_LIMIT - 0.01,
        y: 0,
        z: tile(32),
        patrolRadius: 40 / 64,
      },
    ])[0];
    if (!monster) throw new Error("missing monster");
    const player = targetPlayer(tile(280), tile(32));
    const socket = { id: "socket-3" } as unknown as WebSocket;
    monster.threat.set(player.id, { playerId: player.id, amount: 999, updatedAt: 0 });

    monster.navigation.state = "chase";
    monster.navigation.targetId = player.id;
    monster.navigation.requestedDestination = { x: player.x, z: player.z };
    monster.navigation.destination = { x: player.x, z: player.z };
    const staleBlockedPath = [{ x: player.x, z: player.z }];
    monster.navigation.path = staleBlockedPath.map((point) => ({ ...point }));
    monster.navigation.pathIndex = 0;
    monster.navigation.requestPending = false;
    monster.navigation.lastPathRequestAt = 0;

    const context = monsterContext([monster], new Map([[socket, player]]), wallZone);
    // Cell indices are `floor(world + SIZE / 2)`: the monster at `tile(32)` centres in column 0 /
    // row 0 -> node 0, the player at `tile(280)` in column 4 / row 0 -> node 4 -- the identical
    // math `requestMonsterPath` uses to build its cache key.
    context.navigation.cache.set(`0:${4}`, {
      points: staleBlockedPath.map((point) => ({ ...point })),
      usedAt: 0,
    });

    advanceMonsters(context, 0);
    expect(monster.navigation.path.length).toBe(0);
    expect(monster.navigation.abandonReason).toBe("waypoint_blocked");

    let replannedAtTick = -1;
    let firstPathAfterBlock: GroundVector[] | null = null;
    const tickMs = TICK_DT * 1000;
    for (let tick = 1; tick <= 5; tick++) {
      context.tick = tick;
      advanceMonsters(context, tick * tickMs);
      if (replannedAtTick === -1 && monster.navigation.path.length > 0) {
        replannedAtTick = tick;
        firstPathAfterBlock = monster.navigation.path.map((point) => ({ ...point }));
      }
    }

    // Recovery must happen almost immediately -- not 13 ticks (650ms) later, which is what
    // `minimumRepathMs` would otherwise impose since neither the monster nor the destination has
    // moved.
    expect(replannedAtTick).toBeGreaterThan(0);
    expect(replannedAtTick).toBeLessThanOrEqual(2);
    // And the recovered path must not be the identical blocked one served straight back out of
    // the cache -- it must be a genuine, different (multi-waypoint) route around the wall.
    expect(firstPathAfterBlock).not.toEqual(staleBlockedPath);
    expect(firstPathAfterBlock?.length ?? 0).toBeGreaterThan(1);

    let reachedAtTick = -1;
    for (let tick = 6; tick < 300; tick++) {
      context.tick = tick;
      advanceMonsters(context, tick * tickMs);
      if (groundDistance(monster, player) <= MONSTER_ATTACK_RANGE) {
        reachedAtTick = tick;
        break;
      }
    }
    expect(reachedAtTick).toBeGreaterThan(-1);
  });
});

describe("monster action attacker identity", () => {
  it("starts each attacking monster's own action, not a same-species neighbour's", () => {
    // Mirrors the real hazard next to a guard post: two same-species monsters close enough
    // together that a client guessing the attacker from distance-to-victim alone cannot reliably
    // tell them apart. Placed symmetrically around the player here for the same reason —
    // equidistant is the worst case for that guess. The server must not make the client guess: it
    // must name which monster it resolved as the attacker.
    const player = targetPlayer(tile(300), tile(500));
    const socket = { id: "socket-hurt" } as unknown as WebSocket;

    const monsters = createMonsters([
      {
        id: "goblin-a",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: tile(270),
        y: 0,
        z: tile(500),
        patrolRadius: 40 / 64,
      },
      {
        id: "goblin-b",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: tile(330),
        y: 0,
        z: tile(500),
        patrolRadius: 40 / 64,
      },
    ]);
    const [monsterA, monsterB] = monsters;
    if (!monsterA || !monsterB) throw new Error("missing monsters");
    monsterA.threat.set(player.id, { playerId: player.id, amount: 999, updatedAt: 0 });
    monsterB.threat.set(player.id, { playerId: player.id, amount: 999, updatedAt: 0 });

    const monsterGrid = new SpatialGrid<MonsterRuntime>(1);
    monsterGrid.insert(monsterA);
    monsterGrid.insert(monsterB);

    const startAttack = vi.fn();
    const context: MonsterSystemContext = {
      players: new Map([[socket, player]]),
      monsters: [monsterA, monsterB],
      guards: [],
      monsterGrid,
      zone,
      tick: 0,
      navigation: createNavigationRuntime(terrain, zone.navigation),
      startAttack,
    };

    advanceMonsters(context, MONSTER_ATTACK_COOLDOWN_MS + 100);

    expect(startAttack).toHaveBeenCalledTimes(2);
    const attackerIds = startAttack.mock.calls.map((call) => String(call[0]?.id ?? ""));
    expect(attackerIds.sort((a, b) => a.localeCompare(b))).toEqual(["goblin-a", "goblin-b"]);
  });
});
