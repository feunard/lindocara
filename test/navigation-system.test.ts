import { describe, expect, it } from "vitest";
import {
  advanceWaypoint,
  createNavigationGrid,
  createNavigationRuntime,
  invalidateBlockedWaypoint,
  type NavigationRuntime,
  processNavigationBudget,
  requestMonsterPath,
} from "../src/server/world/navigation-system.js";
import { createMonsters, type MonsterRuntime } from "../src/server/world/world-runtime.js";
import { isWalkable, type Rect, type TerrainGeometry } from "../src/shared/game.js";
import { DEFAULT_ZONE_NAVIGATION } from "../src/shared/navigation.js";
import type { TileMap } from "../src/shared/tilemap.js";
import { ZONES } from "../src/shared/zones.js";
import { tileMapFromRects } from "./support/tiles.js";

const baseTerrain: TerrainGeometry = {
  width: 480,
  height: 320,
  obstacles: [],
  spawnPoints: [{ x: 40, y: 40 }],
  safeZone: { x: 0, y: 280, width: 80, height: 40 },
  tiles: tileMapFromRects(480, 320, []),
};

/** Rebuilds `tiles` to match a test's ad hoc `obstacles`, since `isWalkable` reads only the grid. */
function terrainWith(obstacles: readonly Rect[]): TerrainGeometry {
  return { ...baseTerrain, obstacles, tiles: tileMapFromRects(480, 320, obstacles) };
}

function monster(id: string, x: number, y: number): MonsterRuntime {
  const created = createMonsters([
    { id, kind: "goblin", species: "spear_goblin", zone: "route", x, y, patrolRadius: 40 },
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

function runtimeFor(terrain: TerrainGeometry, budget = 180): NavigationRuntime {
  return createNavigationRuntime(terrain, {
    ...DEFAULT_ZONE_NAVIGATION,
    nodeBudgetPerTick: budget,
    maximumSearchNodes: 2_000,
  });
}

describe("budgeted zone navigation", () => {
  it("routes around a building", () => {
    const terrain = terrainWith([{ x: 180, y: 80, width: 80, height: 160 }]);
    const runtime = runtimeFor(terrain);
    const actor = monster("building", 80, 140);
    requestMonsterPath(runtime, actor, { x: 360, y: 140 }, "target", "chase", 0);
    complete(runtime);
    expect(actor.navigation.path.length).toBeGreaterThan(4);
    expect(actor.navigation.path.some((point) => point.y < 80 || point.y > 240)).toBe(true);
  });

  it("routes around a natural obstacle", () => {
    const terrain = terrainWith([{ x: 120, y: 120, width: 240, height: 72 }]);
    const runtime = runtimeFor(terrain);
    const actor = monster("water", 220, 40);
    requestMonsterPath(runtime, actor, { x: 220, y: 250 }, null, "patrol", 0);
    complete(runtime);
    expect(actor.navigation.path.some((point) => point.x < 120 || point.x > 360)).toBe(true);
  });

  it("never emits a waypoint inside a wall", () => {
    const terrain = terrainWith([{ x: 216, y: 0, width: 18, height: 230 }]);
    const runtime = runtimeFor(terrain);
    const actor = monster("wall", 80, 80);
    requestMonsterPath(runtime, actor, { x: 360, y: 80 }, null, "return", 0);
    complete(runtime);
    expect(actor.navigation.path.every((point) => isWalkable(point, 32, terrain))).toBe(true);
    expect(actor.navigation.path.some((point) => point.y > 230)).toBe(true);
  });

  it("abandons an inaccessible target", () => {
    const terrain = terrainWith([{ x: 220, y: 0, width: 40, height: 320 }]);
    const runtime = runtimeFor(terrain);
    const actor = monster("blocked", 80, 120);
    actor.threat.set("target", { playerId: "target", amount: 100, updatedAt: 0 });
    requestMonsterPath(runtime, actor, { x: 360, y: 120 }, "target", "chase", 0);
    complete(runtime);
    expect(actor.navigation.state).toBe("unreachable");
    expect(actor.navigation.abandonReason).toBe("unreachable");
    expect(actor.threat.has("target")).toBe(false);
  });

  it("builds a return path to the spawn point", () => {
    const terrain = terrainWith([{ x: 180, y: 80, width: 80, height: 160 }]);
    const runtime = runtimeFor(terrain);
    const actor = monster("return", 80, 140);
    actor.x = 360;
    requestMonsterPath(runtime, actor, { x: actor.spawnX, y: actor.spawnY }, null, "return", 0);
    complete(runtime);
    expect(actor.navigation.state).toBe("return");
    expect(actor.navigation.path.length).toBeGreaterThan(0);
    expect(actor.navigation.destination).toEqual({ x: actor.spawnX, y: actor.spawnY });
  });

  it("limits recalculation for small target movements", () => {
    const runtime = runtimeFor(baseTerrain);
    const actor = monster("repath", 40, 40);
    expect(requestMonsterPath(runtime, actor, { x: 320, y: 40 }, "target", "chase", 1_000)).toBe(
      "queued",
    );
    complete(runtime);
    expect(requestMonsterPath(runtime, actor, { x: 326, y: 43 }, "target", "chase", 1_100)).toBe(
      "deferred",
    );
    expect(runtime.metrics.pathsCalculated).toBe(1);
  });

  it("reuses cached paths", () => {
    const runtime = runtimeFor(baseTerrain);
    const first = monster("cache-a", 40, 40);
    requestMonsterPath(runtime, first, { x: 320, y: 40 }, null, "patrol", 0);
    complete(runtime);
    const second = monster("cache-b", 40, 40);
    expect(requestMonsterPath(runtime, second, { x: 320, y: 40 }, null, "patrol", 1)).toBe(
      "cached",
    );
    expect(runtime.metrics.cacheHits).toBe(1);
    expect(second.navigation.path).toEqual(first.navigation.path);
  });

  it("clears the repath gate and evicts the cached path when a waypoint move is refused", () => {
    const terrain = terrainWith([{ x: 180, y: 80, width: 80, height: 160 }]);
    const runtime = runtimeFor(terrain);
    const actor = monster("blocked-waypoint", 80, 140);
    const destination = { x: 360, y: 140 };
    requestMonsterPath(runtime, actor, destination, "target", "chase", 0);
    complete(runtime);
    expect(actor.navigation.path.length).toBeGreaterThan(0);

    // Confirm the path really is cached under this start/goal: a second monster starting at the
    // identical cell gets served from cache, not a fresh search.
    const twin = monster("blocked-waypoint-twin", 80, 140);
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
    const actor = monster("retarget", 40, 40);
    requestMonsterPath(runtime, actor, { x: 320, y: 40 }, "low", "chase", 0);
    const firstRequest = actor.navigation.requestId;
    expect(requestMonsterPath(runtime, actor, { x: 40, y: 240 }, "high", "chase", 1, true)).toBe(
      "queued",
    );
    expect(actor.navigation.requestId).toBeGreaterThan(firstRequest);
    expect(actor.navigation.targetId).toBe("high");
  });

  it("advances waypoints monotonically without oscillation", () => {
    const runtime = runtimeFor(baseTerrain);
    const actor = monster("stable", 40, 40);
    requestMonsterPath(runtime, actor, { x: 360, y: 40 }, null, "patrol", 0);
    complete(runtime);
    const indices: number[] = [];
    while (actor.navigation.pathIndex < actor.navigation.path.length) {
      const waypoint = advanceWaypoint(actor, 10);
      if (!waypoint) break;
      actor.x = waypoint.x;
      actor.y = waypoint.y;
      indices.push(actor.navigation.pathIndex);
    }
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("never exceeds the navigation budget for a tick", () => {
    const runtime = runtimeFor(terrainWith([{ x: 180, y: 40, width: 80, height: 200 }]), 3);
    for (let index = 0; index < 8; index++) {
      const actor = monster(`budget-${index}`, 40, 40 + index * 20);
      requestMonsterPath(runtime, actor, { x: 400, y: 240 }, `target-${index}`, "chase", 0);
    }
    expect(processNavigationBudget(runtime, 0)).toBeLessThanOrEqual(3);
    expect(runtime.metrics.expandedThisTick).toBeLessThanOrEqual(3);
  });

  it("generates navigation for both existing zones", () => {
    for (const zone of Object.values(ZONES)) {
      const runtime = createNavigationRuntime(zone.terrain, zone.navigation);
      expect(runtime.grid.columns).toBeGreaterThan(0);
      expect(runtime.grid.rows).toBeGreaterThan(0);
      expect(runtime.grid.walkable.some((value) => value === 1)).toBe(true);
    }
  });

  it("excludes a node whose waypoint would land in an unwalkable cell", () => {
    // A tilemap can be taller than the world it was generated from — it rounds up to whole
    // tiles, the world does not. Row 0 is water, row 1 is grass, but the world is only 80px
    // tall: short enough that `pointForNode`'s clamp for row 1 (naturally 64 + 16 = 80, clamped
    // to 80 - 32 = 48) lands at y = 48, *before* row 1 even starts (64) — squarely in row 0's
    // solid territory. This is the same shape as Verdant Reach's real row 42/41 disagreement,
    // shrunk down to pin exactly: a node's tile kind alone is not enough to call it walkable.
    const tiles: TileMap = { cols: 1, rows: 2, kinds: ["water", "grass"] };
    const terrain: TerrainGeometry = {
      width: 64,
      height: 80,
      obstacles: [],
      spawnPoints: [{ x: 16, y: 16 }],
      safeZone: { x: 0, y: 0, width: 1, height: 1 },
      tiles,
    };
    const grid = createNavigationGrid(terrain);
    expect(grid.walkable[0]).toBe(0); // row 0: water by kind — unwalkable either way.
    expect(grid.walkable[1]).toBe(0); // row 1: grass by kind, but its waypoint sits in row 0's water.
  });

  it("marks Verdant Reach's out-of-world-bounds last row entirely unwalkable", () => {
    // Verdant Reach's tilemap is 43 rows (2752px) but the world is only 2700px tall. Row 42 is
    // all grass by tile kind, and row 41 (the actual last in-world row) is all water. Without
    // the fix, all 75 nodes in row 42 were marked walkable purely by kind, even though every one
    // of their clamped waypoints lands in row 41's water.
    const grid = createNavigationGrid(ZONES["verdant-reach"].terrain);
    const row42Start = 42 * grid.columns;
    const row42 = grid.walkable.slice(row42Start, row42Start + grid.columns);
    expect(row42.every((value) => value === 0)).toBe(true);
  });
});
