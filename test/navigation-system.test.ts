import { describe, expect, it } from "vitest";
import {
  advanceWaypoint,
  createNavigationRuntime,
  type NavigationRuntime,
  processNavigationBudget,
  requestMonsterPath,
} from "../src/server/world/navigation-system.js";
import { createMonsters, type MonsterRuntime } from "../src/server/world/world-runtime.js";
import { isWalkable, type TerrainGeometry } from "../src/shared/game.js";
import { DEFAULT_ZONE_NAVIGATION } from "../src/shared/navigation.js";
import { ZONES } from "../src/shared/zones.js";

const baseTerrain: TerrainGeometry = {
  width: 480,
  height: 320,
  obstacles: [],
  spawnPoints: [{ x: 40, y: 40 }],
  safeZone: { x: 0, y: 280, width: 80, height: 40 },
};

function monster(id: string, x: number, y: number): MonsterRuntime {
  const created = createMonsters([
    { id, kind: "goblin", species: "goblin_scout", zone: "route", x, y, patrolRadius: 40 },
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
    cellSize: 40,
    nodeBudgetPerTick: budget,
    maximumSearchNodes: 2_000,
  });
}

describe("budgeted zone navigation", () => {
  it("routes around a building", () => {
    const terrain = { ...baseTerrain, obstacles: [{ x: 180, y: 80, width: 80, height: 160 }] };
    const runtime = runtimeFor(terrain);
    const actor = monster("building", 80, 140);
    requestMonsterPath(runtime, actor, { x: 360, y: 140 }, "target", "chase", 0);
    complete(runtime);
    expect(actor.navigation.path.length).toBeGreaterThan(4);
    expect(actor.navigation.path.some((point) => point.y < 80 || point.y > 240)).toBe(true);
  });

  it("routes around a natural obstacle", () => {
    const terrain = { ...baseTerrain, obstacles: [{ x: 120, y: 120, width: 240, height: 72 }] };
    const runtime = runtimeFor(terrain);
    const actor = monster("water", 220, 40);
    requestMonsterPath(runtime, actor, { x: 220, y: 250 }, null, "patrol", 0);
    complete(runtime);
    expect(actor.navigation.path.some((point) => point.x < 120 || point.x > 360)).toBe(true);
  });

  it("never emits a waypoint inside a wall", () => {
    const terrain = { ...baseTerrain, obstacles: [{ x: 216, y: 0, width: 18, height: 230 }] };
    const runtime = runtimeFor(terrain);
    const actor = monster("wall", 80, 80);
    requestMonsterPath(runtime, actor, { x: 360, y: 80 }, null, "return", 0);
    complete(runtime);
    expect(actor.navigation.path.every((point) => isWalkable(point, 32, terrain))).toBe(true);
    expect(actor.navigation.path.some((point) => point.y > 230)).toBe(true);
  });

  it("abandons an inaccessible target", () => {
    const terrain = { ...baseTerrain, obstacles: [{ x: 220, y: 0, width: 40, height: 320 }] };
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
    const terrain = { ...baseTerrain, obstacles: [{ x: 180, y: 80, width: 80, height: 160 }] };
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
    const runtime = runtimeFor(
      { ...baseTerrain, obstacles: [{ x: 180, y: 40, width: 80, height: 200 }] },
      3,
    );
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
});
