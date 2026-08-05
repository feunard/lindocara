/**
 * The three systems that move things across the ground, in tile units — and the four behaviours
 * that a mechanical `y` → `z` rename would satisfy the compiler about while quietly losing:
 *
 * 1. **wall sliding.** Axis-separated resolution is what lets a body taken diagonally into a cliff
 *    keep the free axis. Nothing fails when it goes: movement just turns sticky.
 * 2. **a body that is already inside geometry can still leave it.** `canStand` has no escape hatch
 *    and cannot have one — it is positional. Without the caller's, a hero restored inside a
 *    plateau's disc is refused every direction forever, with no diagnostic at all.
 * 3. **a restored position carries three axes and is validated.** The compiler is happy either way:
 *    `WorldPosition` still satisfies a two-axis type, so an axis can be dropped on the return leg
 *    with a green suite and a hero in the wrong place after a reconnect.
 * 4. **a monster abandons a target it cannot reach.** A hero on a plateau is visible, in range and
 *    permanently unreachable — `maxStep` is 0 and monsters do not jump.
 */

import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { CLASS_STATS } from "@lindocara/engine/game.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { DEFAULT_ZONE_NAVIGATION } from "@lindocara/engine/navigation.js";
import { TICK_DT, TICK_MS } from "@lindocara/engine/simulation.js";
import type { ZoneDefinition } from "@lindocara/engine/zones.js";
import { noColliders, tileMapFromRects } from "@lindocara/testing/tiles.js";
import { describe, expect, it, vi } from "vitest";
import { collectLoot } from "../src/world/loot-system.js";
import { advanceMonsters, type MonsterSystemContext } from "../src/world/monster-system.js";
import { advancePlayers } from "../src/world/movement-system.js";
import { createNavigationRuntime } from "../src/world/navigation-system.js";
import { SpatialGrid } from "../src/world/spatial-grid.js";
import {
  BODY_RADIUS,
  canStand,
  canStandOrEscape,
  groundUnder,
  restoreStandablePosition,
  type ZoneTerrain,
  zoneTerrainFromHeightfield,
} from "../src/world/terrain-access.js";
import {
  createMonsters,
  type GroundLoot,
  type MonsterRuntime,
  newPlayer,
  type PlayerRuntime,
} from "../src/world/world-runtime.js";

const SIZE = 16;
const LEVEL_HEIGHT = 0.5;
const HALF = SIZE / 2;

/**
 * A 16x16 heightfield, grid centre as origin, flat level-0 ground except for a plateau filling
 * every cell from `z = PLATEAU_EDGE` southwards. `toCell = floor(w + 8)`, so cell row `j` covers
 * `z ∈ [j - 8, j - 7)` and the plateau's north face is a straight line at `z = 4`.
 */
const PLATEAU_ROW = 12;
const PLATEAU_EDGE = PLATEAU_ROW - HALF;

function terrain(options: { colliders?: MapData["colliders"] } = {}): ZoneTerrain {
  const levels: (number | null)[] = [];
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      void col;
      levels.push(row >= PLATEAU_ROW ? 1 : 0);
    }
  }
  const map: MapData = {
    version: 1,
    size: SIZE,
    levelHeight: LEVEL_HEIGHT,
    waterLevel: -0.25,
    levels,
    materials: new Array(SIZE * SIZE).fill("herbe"),
    colliders: options.colliders ?? [],
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

function zoneWith(built: ZoneTerrain): ZoneDefinition {
  return {
    id: "verdant-reach",
    nameKey: "zone.verdant_reach.name",
    type: "open_world",
    defaultInstanceId: "main",
    maxPlayers: 4,
    terrain: built,
    quests: [],
    questSites: [],
    monsters: [],
    guards: [],
    portals: [],
    navigation: DEFAULT_ZONE_NAVIGATION,
  };
}

function hero(x: number, z: number, id = "hero-1"): PlayerRuntime {
  return newPlayer(
    {
      id,
      nick: id,
      x,
      y: 0,
      z,
      level: 1,
      xp: 0,
      hp: 100,
      appearance: { body: "wayfarer", primaryColor: "azure" },
      class: "warrior",
      equipment: starterEquipmentFor("warrior"),
      inventory: { potions: 0, gold: 0, crystals: 0 },
      quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
      zoneId: "verdant-reach",
      instanceId: "main",
      sessionEpoch: 1,
      wardRunExpiresAt: null,
      life: "alive",
      corpse: null,
    },
    `connection-${id}`,
    "verdant-reach:main",
  );
}

/** `advancePlayers` does far more than move: the harness keeps every other duty observable. */
function movementHarness(built: ZoneTerrain, player: PlayerRuntime) {
  const playerGrid = new SpatialGrid<PlayerRuntime>(4);
  const socket = `socket-${player.id}`;
  const players = new Map([[socket, player]]);
  // Due immediately, so the very first tick shows the heartbeat firing.
  player.nextPresenceHeartbeatAt = 0;
  const reclaimCorpse = vi.fn();
  const collect = vi.fn();
  const savePlayer = vi.fn(async () => true);
  const renewPresence = vi.fn(async () => undefined);
  const context = {
    players,
    playerGrid,
    zone: zoneWith(built),
    now: 1_000,
    presenceHeartbeatMs: 10_000,
    writeAttachment: false,
    writeD1: false,
    waitUntil: () => undefined,
    renewPresence,
    reclaimCorpse,
    collectLoot: collect,
    savePlayer,
  };
  return { context, socket, player, reclaimCorpse, collect, savePlayer, renewPresence };
}

const HELD = { up: false, down: false, left: false, right: false };

/**
 * Queues one real command per tick rather than writing `lastInput` directly: the starve branch
 * zeroes a player's input after `MAX_STARVED_TICKS`, so a harness that skips the queue silently
 * stops moving after five ticks.
 */
function press(
  harness: ReturnType<typeof movementHarness>,
  input: Partial<typeof HELD>,
  ticks: number,
): void {
  for (let tick = 0; tick < ticks; tick++) {
    harness.player.queue.push({ seq: harness.player.ack + 1, input: { ...HELD, ...input } });
    harness.context.now += TICK_MS;
    advancePlayers(harness.context);
  }
}

describe("hero movement in tile units", () => {
  it("slides along a cliff taken diagonally instead of sticking to it", () => {
    const built = terrain();
    // Just north of the plateau's face, far enough that the body's disc clears it.
    const start = { x: 0, z: PLATEAU_EDGE - 1 };
    const player = hero(start.x, start.z);
    const harness = movementHarness(built, player);

    // Down-and-right into the face: the southward half must be refused and the eastward half must
    // survive. A resolver that tests both axes together refuses the whole move and the hero sticks.
    press(harness, { down: true, right: true }, 60);

    expect(player.x).toBeGreaterThan(start.x + 1);
    expect(player.z).toBeLessThan(PLATEAU_EDGE);
    expect(player.y).toBe(0);
  });

  it("walks off a plateau but never up one", () => {
    const built = terrain();
    const player = hero(0, PLATEAU_EDGE + 1);
    player.y = LEVEL_HEIGHT;
    const harness = movementHarness(built, player);

    // Northward, off the plateau and onto the flat ground below: falling is free, climbing is not.
    press(harness, { up: true }, 60);
    expect(player.z).toBeLessThan(PLATEAU_EDGE);
    expect(player.y).toBe(0);

    // And back south, into the face it just came down: refused, because `MAX_STEP` is 0.
    const beforeClimb = player.z;
    press(harness, { down: true }, 60);
    expect(player.z).toBeLessThan(PLATEAU_EDGE);
    expect(player.z).toBeGreaterThanOrEqual(beforeClimb);
    expect(player.y).toBe(0);
  });

  it("keeps every non-movement duty `advancePlayers` owns", () => {
    const built = terrain();
    const player = hero(0, 0);
    const harness = movementHarness(built, player);
    harness.context.writeD1 = true;

    press(harness, { right: true }, 1);

    expect(harness.collect).toHaveBeenCalledTimes(1);
    expect(harness.savePlayer).toHaveBeenCalledTimes(1);
    expect(harness.renewPresence).toHaveBeenCalledTimes(1);
  });

  it("lets a body already overlapping a cliff move, and never into the sea", () => {
    const built = terrain();
    // Pressed right up against the plateau's face: the body's 0.25 disc bites 0.24 into it, more
    // than one tick of travel, so the destination one step north is STILL inside the cliff.
    const stuck = { x: 0, z: PLATEAU_EDGE - 0.01 };
    const groundY = groundUnder(built, stuck.x, stuck.z);
    expect(canStand(built, stuck.x, stuck.z, BODY_RADIUS, groundY)).toBe(false);

    const north = { x: stuck.x, z: stuck.z - CLASS_STATS.warrior.movementSpeed * TICK_DT };
    expect(canStand(built, north.x, north.z, BODY_RADIUS, groundY)).toBe(false);
    // …and yet it must be allowed, because it takes the body no deeper into the cliff than it
    // already is. This is the clause `canStand` cannot carry: it is positional and cannot know
    // the body is already overlapping something.
    expect(canStandOrEscape(built, stuck, north.x, north.z, BODY_RADIUS, groundY)).toBe(true);

    // The hatch is not a licence to walk anywhere: off the grid stays refused even while stuck,
    // or a cemented body would trade being stuck for drowning.
    expect(canStandOrEscape(built, stuck, -20, stuck.z, BODY_RADIUS, groundY)).toBe(false);
  });

  it("moves a hero already overlapping a cliff back out of it", () => {
    const built = terrain();
    const stuck = { x: 0, z: PLATEAU_EDGE - 0.01 };
    const player = hero(stuck.x, stuck.z);
    const harness = movementHarness(built, player);

    // One tick. Without the escape hatch this hero never moves a single tile unit for the rest of
    // the session, and nothing — no error, no log, no failing assertion anywhere else — says so.
    press(harness, { up: true }, 1);
    expect(player.z).toBeLessThan(stuck.z);

    press(harness, { up: true }, 20);
    expect(
      canStand(built, player.x, player.z, BODY_RADIUS, groundUnder(built, player.x, player.z)),
    ).toBe(true);
  });

  it("moves a hero cemented inside a prop out of it, and never into the sea", () => {
    // A prop the hero is standing in the middle of: every point within its rectangle is refused,
    // so only the escape hatch gets the body out.
    const built = terrain({ colliders: [{ x: -1.5, z: -1.5, w: 3, h: 3 }] });
    const player = hero(0, 0);
    expect(canStand(built, 0, 0, BODY_RADIUS, groundUnder(built, 0, 0))).toBe(false);

    const harness = movementHarness(built, player);
    press(harness, { right: true }, 60);

    expect(player.x).toBeGreaterThan(1.5);
    expect(
      canStand(built, player.x, player.z, BODY_RADIUS, groundUnder(built, player.x, player.z)),
    ).toBe(true);
  });

  it("moves at the class speed, in tiles per second", () => {
    const built = terrain();
    const player = hero(0, 0);
    const harness = movementHarness(built, player);
    press(harness, { right: true }, 1);
    expect(player.x).toBeCloseTo(CLASS_STATS.warrior.movementSpeed * TICK_DT, 10);
  });
});

describe("a restored position", () => {
  it("carries all three axes when the stored ground is still standable", () => {
    const built = terrain();
    const restored = restoreStandablePosition(built, { x: 1.5, y: 99, z: -2.5 }, { x: 0, z: 0 });
    // `x` and `z` survive verbatim and `y` is re-derived from the ground, never carried from a
    // stored elevation nobody validated. A two-axis return here typechecks and strands the hero.
    expect(restored).toEqual({ x: 1.5, y: 0, z: -2.5 });
  });

  it("sends a hero whose stored ground is no longer standable to the map spawn", () => {
    const built = terrain();
    // Inside the plateau's disc — the cemented case, refused before it can become a live hero.
    const spawn = { x: -3.5, z: -3.5 };
    const restored = restoreStandablePosition(built, { x: 0, y: 0, z: PLATEAU_EDGE - 0.1 }, spawn);
    expect(restored).toEqual({ x: spawn.x, y: 0, z: spawn.z });
  });

  it("refuses a non-finite stored position and a position off the grid", () => {
    const built = terrain();
    const spawn = { x: -3.5, z: -3.5 };
    expect(restoreStandablePosition(built, { x: Number.NaN, y: 0, z: 0 }, spawn)).toEqual({
      ...spawn,
      y: 0,
    });
    // A stored PIXEL coordinate read as tiles lands thousands of tiles off a 16-tile grid. It must
    // become the spawn, not a hero standing in the void.
    expect(restoreStandablePosition(built, { x: 1_870, y: 0, z: 820 }, spawn)).toEqual({
      ...spawn,
      y: 0,
    });
  });
});

describe("loot pickup", () => {
  it("measures across the ground, not against elevation", () => {
    const player = hero(0, 0);
    player.y = 0;
    // Directly under the hero on the ground plane, but a full level below it. `pointDistance`
    // compared the hero's ground `x` (0) against the item's elevation (-0.5) and called that
    // half a tile of separation; the truth is that they are in the same spot.
    const item: GroundLoot = {
      id: "gold-1",
      kind: "gold",
      amount: 7,
      x: 0,
      y: -0.5,
      z: 0,
      expiresAt: Number.POSITIVE_INFINITY,
    };
    const lootGrid = new SpatialGrid<GroundLoot>(4);
    const loot = [item];
    const send = vi.fn();
    collectLoot({ loot, lootGrid, send, sendState: vi.fn() }, "socket", player);
    expect(player.inventory.gold).toBe(7);

    // …and a stack a whole grid away is still out of reach, so the check is a radius and not an
    // "always true".
    const player2 = hero(0, 0, "hero-2");
    const far: GroundLoot = { ...item, id: "gold-2", x: 6, y: 0, z: 6 };
    collectLoot(
      { loot: [far], lootGrid: new SpatialGrid<GroundLoot>(4), send, sendState: vi.fn() },
      "socket",
      player2,
    );
    expect(player2.inventory.gold).toBe(0);
  });
});

describe("a monster and a hero on high ground", () => {
  /**
   * The navigation runtime is still the pixel one — `navigation-system.ts` is converted with the
   * A* grid in a later task. Nothing in these tests reaches the pathfinder: the out-of-reach
   * branch resolves before `navigateMonster` is ever called, and `processNavigationBudget` returns
   * immediately on an empty queue.
   */
  function navigation() {
    const tiles = tileMapFromRects(64, 64, []);
    return createNavigationRuntime(
      {
        width: 64,
        height: 64,
        obstacles: [],
        spawnPoints: [{ x: 0, y: 0 }],
        safeZone: null,
        tiles,
        colliders: noColliders(tiles),
      },
      TILE_UNIT_NAVIGATION,
    );
  }

  /**
   * `DEFAULT_ZONE_NAVIGATION`'s two geometric fields are still PIXELS — they belong to the A*
   * conversion in a later task, which owns `navigation-system.ts`. Left as they are, a 10px
   * waypoint tolerance reads as ten TILES and every destination looks already reached, so a
   * monster stops before it starts. Overriding them here keeps this suite about elevation instead
   * of about that seam; the seam itself is carried forward, not hidden.
   */
  const TILE_UNIT_NAVIGATION = {
    ...DEFAULT_ZONE_NAVIGATION,
    waypointTolerance: 10 / 64,
    targetMoveThreshold: 72 / 64,
  };

  function goblinAt(x: number, z: number): MonsterRuntime {
    const monster = createMonsters([
      {
        id: "goblin-1",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x,
        z,
        patrolRadius: 1,
      } as unknown as Parameters<typeof createMonsters>[0][number],
    ])[0];
    if (!monster) throw new Error("missing monster");
    return monster;
  }

  function chase(
    built: ZoneTerrain,
    monster: MonsterRuntime,
    target: PlayerRuntime,
    ticks: number,
  ) {
    const monsterGrid = new SpatialGrid<MonsterRuntime>(4);
    monsterGrid.insert(monster);
    const context: MonsterSystemContext<string> = {
      players: new Map([["socket-1", target]]),
      monsters: [monster],
      guards: [],
      monsterGrid,
      zone: zoneWith(built),
      tick: 0,
      navigation: navigation(),
      startAttack: vi.fn(),
    };
    let now = 1_000;
    for (let tick = 0; tick < ticks; tick++) {
      now += TICK_MS;
      context.tick = tick;
      advanceMonsters(context, now);
    }
    return { context, now };
  }

  it("cannot chase a hero onto a plateau it has no path to", () => {
    const built = terrain();
    // Level-0 ground, 2.5 tiles north of the plateau's face and inside `MONSTER_AGGRO_RANGE`
    // (210/64 = 3.28 tiles) of a hero standing on top of it.
    const monster = goblinAt(0, PLATEAU_EDGE - 2.5);
    const startZ = monster.z;
    const target = hero(0, PLATEAU_EDGE + 0.5);
    target.y = LEVEL_HEIGHT;

    const { now } = chase(built, monster, target, 80);

    // It approached…
    expect(monster.z).toBeGreaterThan(startZ);
    // …never got onto the plateau, in either axis of the position or in its elevation…
    expect(monster.z).toBeLessThan(PLATEAU_EDGE);
    expect(monster.y).toBe(0);
    // …and gave up rather than grinding against the face for the rest of the session.
    expect(monster.threat.has(target.id)).toBe(false);
    expect(monster.navigation.abandonReason).toBe("target_out_of_reach");
    expect(monster.navigation.unreachableTargetId).toBe(target.id);
    expect(monster.navigation.unreachableUntil).toBeGreaterThan(now);
  });

  it("does not re-acquire the same unreachable hero on the next tick", () => {
    const built = terrain();
    const monster = goblinAt(0, PLATEAU_EDGE - 2.5);
    const target = hero(0, PLATEAU_EDGE + 0.5);
    target.y = LEVEL_HEIGHT;

    chase(built, monster, target, 120);

    expect(monster.threat.has(target.id)).toBe(false);
    expect(monster.navigation.unreachableTargetId).toBe(target.id);
  });

  it("still chases a hero standing on its own level", () => {
    const built = terrain();
    const monster = goblinAt(0, PLATEAU_EDGE - 2.5);
    const startZ = monster.z;
    // Same distance, same aggro radius, level ground: the control that stops the test above from
    // passing on an AI that simply abandons everyone.
    const target = hero(0, PLATEAU_EDGE - 5);

    chase(built, monster, target, 40);

    expect(monster.threat.has(target.id)).toBe(true);
    expect(monster.navigation.unreachableTargetId).toBeNull();
    expect(monster.z).toBeLessThan(startZ);
  });
});
