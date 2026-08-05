/**
 * The budgeted A* itself: routing, the path cache, the repath gate and the per-tick budget — the
 * pacing that this increment must not touch, now expressed against a heightfield rather than a
 * pixel tilemap.
 *
 * A blocked cell is WATER here, which is the direct successor of the old solid tile: `canStand`
 * refuses it, so the node never becomes walkable. Relief is the other way for a cell to be
 * unreachable and has its own suite (`navigation-elevation.test.ts`) — the two are deliberately
 * separate, because "the search is paced the same" and "the search understands elevation" are
 * different claims.
 *
 * Three tests died with the pixel grid rather than being converted, and none of them can come
 * back:
 *
 * - "generates navigation for both existing zones" walked the compiled `ZONES` catalogue, whose
 *   terrain is a pixel `TerrainGeometry` a heightfield grid cannot be built from at all.
 * - "excludes a node whose waypoint would land in an unwalkable cell" and "marks Verdant Reach's
 *   out-of-world-bounds last row entirely unwalkable" both pinned the SAME defect: a tilemap
 *   rounds up to whole tiles while the world rectangle it was generated from does not, so an edge
 *   row's clamped waypoint could be dragged into a neighbouring cell. A heightfield has no world
 *   rectangle separate from its grid and `pointForNode` returns an exact cell centre, so the
 *   disagreement has no way to exist. What those two really guarded — "a node is walkable only if
 *   a body can stand at the waypoint it promises" — is now structural, and the collider test at
 *   the bottom is what keeps it honest.
 */

import type { ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { DEFAULT_ZONE_NAVIGATION } from "@lindocara/engine/navigation.js";
import {
  advanceWaypoint,
  createNavigationGrid,
  createNavigationRuntime,
  invalidateBlockedWaypoint,
  type NavigationRuntime,
  processNavigationBudget,
  requestMonsterPath,
} from "@lindocara/server/world/navigation-system.js";
import {
  BODY_RADIUS,
  canStand,
  groundUnder,
  type ZoneTerrain,
  zoneTerrainFromHeightfield,
} from "@lindocara/server/world/terrain-access.js";
import { createMonsters, type MonsterRuntime } from "@lindocara/server/world/world-runtime.js";
import { describe, expect, it } from "vitest";

const SIZE = 16;
const HALF = SIZE / 2;

/** A block of cells, in grid indices. Rendered as water: unwalkable, at any elevation. */
interface CellRect {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

/** The world-space centre of cell `(col, row)`. */
function at(col: number, row: number): { x: number; z: number } {
  return { x: col + 0.5 - HALF, z: row + 0.5 - HALF };
}

function terrainWith(
  blocks: readonly CellRect[] = [],
  colliders: readonly ColliderRect[] = [],
): ZoneTerrain {
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
    colliders: [...colliders],
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

const baseTerrain = terrainWith();

function monster(id: string, col: number, row: number): MonsterRuntime {
  const cell = at(col, row);
  const created = createMonsters([
    {
      id,
      kind: "goblin",
      species: "spear_goblin",
      zone: "route",
      x: cell.x,
      y: 0,
      z: cell.z,
      patrolRadius: 40 / 64,
    },
  ])[0];
  if (!created) throw new Error("missing monster");
  return created;
}

function complete(runtime: NavigationRuntime, maximumTicks = 2_000): void {
  for (let tick = 0; tick < maximumTicks; tick++) {
    processNavigationBudget(runtime, tick * 50);
    if (!runtime.active && runtime.queue.length === 0) return;
  }
  throw new Error("navigation did not finish within the test budget");
}

function runtimeFor(terrain: ZoneTerrain, budget = 180): NavigationRuntime {
  return createNavigationRuntime(terrain, {
    ...DEFAULT_ZONE_NAVIGATION,
    nodeBudgetPerTick: budget,
    maximumSearchNodes: 2_000,
  });
}

describe("budgeted zone navigation", () => {
  it("routes around a building", () => {
    const terrain = terrainWith([{ col: 6, row: 2, cols: 2, rows: 10 }]);
    const runtime = runtimeFor(terrain);
    const actor = monster("building", 2, 6);
    requestMonsterPath(runtime, actor, at(12, 6), "target", "chase", 0);
    complete(runtime);
    expect(actor.navigation.path.length).toBeGreaterThan(4);
    // Round one end of the block: rows 0-1 to the north or rows 12-15 to the south.
    expect(
      actor.navigation.path.some((point) => point.z < at(0, 2).z || point.z > at(0, 11).z),
    ).toBe(true);
  });

  it("routes around a natural obstacle", () => {
    const terrain = terrainWith([{ col: 2, row: 6, cols: 12, rows: 2 }]);
    const runtime = runtimeFor(terrain);
    const actor = monster("water", 7, 2);
    requestMonsterPath(runtime, actor, at(7, 12), null, "patrol", 0);
    complete(runtime);
    expect(
      actor.navigation.path.some((point) => point.x < at(2, 0).x || point.x > at(13, 0).x),
    ).toBe(true);
  });

  it("never emits a waypoint inside a wall", () => {
    const terrain = terrainWith([{ col: 7, row: 0, cols: 1, rows: 12 }]);
    const runtime = runtimeFor(terrain);
    const actor = monster("wall", 2, 2);
    requestMonsterPath(runtime, actor, at(12, 2), null, "return", 0);
    complete(runtime);
    expect(
      actor.navigation.path.every((point) =>
        canStand(terrain, point.x, point.z, BODY_RADIUS, groundUnder(terrain, point.x, point.z)),
      ),
    ).toBe(true);
    expect(actor.navigation.path.some((point) => point.z > at(0, 11).z)).toBe(true);
  });

  it("abandons an inaccessible target", () => {
    const terrain = terrainWith([{ col: 7, row: 0, cols: 1, rows: SIZE }]);
    const runtime = runtimeFor(terrain);
    const actor = monster("blocked", 2, 6);
    actor.threat.set("target", { playerId: "target", amount: 100, updatedAt: 0 });
    requestMonsterPath(runtime, actor, at(12, 6), "target", "chase", 0);
    complete(runtime);
    expect(actor.navigation.state).toBe("unreachable");
    expect(actor.navigation.abandonReason).toBe("unreachable");
    expect(actor.threat.has("target")).toBe(false);
  });

  it("builds a return path to the spawn point", () => {
    const terrain = terrainWith([{ col: 6, row: 2, cols: 2, rows: 10 }]);
    const runtime = runtimeFor(terrain);
    const actor = monster("return", 2, 6);
    actor.x = at(12, 6).x;
    requestMonsterPath(runtime, actor, { x: actor.spawnX, z: actor.spawnZ }, null, "return", 0);
    complete(runtime);
    expect(actor.navigation.state).toBe("return");
    expect(actor.navigation.path.length).toBeGreaterThan(0);
    expect(actor.navigation.destination).toEqual({ x: actor.spawnX, z: actor.spawnZ });
  });

  it("limits recalculation for small target movements", () => {
    const runtime = runtimeFor(baseTerrain);
    const actor = monster("repath", 1, 1);
    expect(requestMonsterPath(runtime, actor, at(12, 1), "target", "chase", 1_000)).toBe("queued");
    complete(runtime);
    // Under `targetMoveThreshold` (72 px, i.e. 1.125 tiles) in both axes, and inside the 650 ms
    // repath gate: the plan stands.
    const nudged = at(12, 1);
    expect(
      requestMonsterPath(
        runtime,
        actor,
        { x: nudged.x + 0.1, z: nudged.z + 0.05 },
        "target",
        "chase",
        1_100,
      ),
    ).toBe("deferred");
    expect(runtime.metrics.pathsCalculated).toBe(1);
  });

  it("reuses cached paths", () => {
    const runtime = runtimeFor(baseTerrain);
    const first = monster("cache-a", 1, 1);
    requestMonsterPath(runtime, first, at(12, 1), null, "patrol", 0);
    complete(runtime);
    const second = monster("cache-b", 1, 1);
    expect(requestMonsterPath(runtime, second, at(12, 1), null, "patrol", 1)).toBe("cached");
    expect(runtime.metrics.cacheHits).toBe(1);
    expect(second.navigation.path).toEqual(first.navigation.path);
  });

  it("clears the repath gate and evicts the cached path when a waypoint move is refused", () => {
    const terrain = terrainWith([{ col: 6, row: 2, cols: 2, rows: 10 }]);
    const runtime = runtimeFor(terrain);
    const actor = monster("blocked-waypoint", 2, 6);
    const destination = at(12, 6);
    requestMonsterPath(runtime, actor, destination, "target", "chase", 0);
    complete(runtime);
    expect(actor.navigation.path.length).toBeGreaterThan(0);

    // Confirm the path really is cached under this start/goal: a second monster starting at the
    // identical cell gets served from cache, not a fresh search.
    const twin = monster("blocked-waypoint-twin", 2, 6);
    expect(requestMonsterPath(runtime, twin, destination, "target", "chase", 1)).toBe("cached");

    // Simulate real collision refusing the first waypoint move.
    invalidateBlockedWaypoint(runtime, actor, destination);
    expect(actor.navigation.path.length).toBe(0);
    expect(actor.navigation.abandonReason).toBe("waypoint_blocked");
    expect(actor.navigation.requestedDestination).toBeNull();

    // A fresh request for the identical start/goal, made a single millisecond later (nowhere near
    // `minimumRepathMs`), must not be deferred by the repath gate (proven by "queued" rather than
    // "deferred") and must not be silently handed the same cached path back (proven by "queued"
    // rather than "cached") -- the two failures the un-fixed recovery had.
    expect(requestMonsterPath(runtime, actor, destination, "target", "chase", 2)).toBe("queued");
  });

  it("invalidates the route when threat selects a new target", () => {
    const runtime = runtimeFor(baseTerrain);
    const actor = monster("retarget", 1, 1);
    requestMonsterPath(runtime, actor, at(12, 1), "low", "chase", 0);
    const firstRequest = actor.navigation.requestId;
    expect(requestMonsterPath(runtime, actor, at(1, 12), "high", "chase", 1, true)).toBe("queued");
    expect(actor.navigation.requestId).toBeGreaterThan(firstRequest);
    expect(actor.navigation.targetId).toBe("high");
  });

  it("advances waypoints monotonically without oscillation", () => {
    const runtime = runtimeFor(baseTerrain);
    const actor = monster("stable", 1, 1);
    requestMonsterPath(runtime, actor, at(14, 1), null, "patrol", 0);
    complete(runtime);
    const indices: number[] = [];
    while (actor.navigation.pathIndex < actor.navigation.path.length) {
      const waypoint = advanceWaypoint(actor, 10 / 64);
      if (!waypoint) break;
      actor.x = waypoint.x;
      actor.z = waypoint.z;
      indices.push(actor.navigation.pathIndex);
    }
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("never exceeds the navigation budget for a tick", () => {
    const runtime = runtimeFor(terrainWith([{ col: 6, row: 1, cols: 2, rows: 13 }]), 3);
    for (let index = 0; index < 8; index++) {
      const actor = monster(`budget-${index}`, 1, 1 + index);
      requestMonsterPath(runtime, actor, at(14, 12), `target-${index}`, "chase", 0);
    }
    expect(processNavigationBudget(runtime, 0)).toBeLessThanOrEqual(3);
    expect(runtime.metrics.expandedThisTick).toBeLessThanOrEqual(3);
  });

  it("excludes a node whose cell centre a sub-cell collider covers", () => {
    // The heightfield's answer to the two deleted tilemap-extent tests: a node is walkable only if
    // a `BODY_RADIUS` disc fits at the exact waypoint it promises. Cell (4, 4) is open ground and
    // its relief refuses nothing; a 1x1 tile rectangle sitting on its centre is the only thing
    // between the pathfinder and a waypoint no monster could ever occupy.
    const covered = at(4, 4);
    const grid = createNavigationGrid(
      terrainWith([], [{ x: covered.x - 0.5, z: covered.z - 0.5, w: 1, h: 1 }]),
    );
    expect(grid.walkable[4 * grid.columns + 4]).toBe(0);
    expect(grid.walkable[4 * grid.columns + 5]).toBe(1);
  });
});
