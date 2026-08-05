/**
 * The A* grid, once "walkable" stopped meaning "not a solid tile" and started meaning `canStand`.
 *
 * Three behaviours and one non-behaviour:
 *
 * 1. **a monster does not walk up a cliff.** `MAX_STEP` is 0, so relief is a one-way door: down is
 *    a step, up is not. A grid that only knew which cells were standable would happily hand back a
 *    one-cell path straight onto a plateau, and nothing downstream would refuse it — real
 *    collision would silently eat the move every tick while the pathfinder kept re-issuing it.
 * 2. **it goes round.** Relief is a wall to plan against, not a wall to notice on arrival.
 * 3. **a target on unreachable high ground is abandoned.** Visible, in range, and no path — the
 *    exact state the pixel grid never had to represent, because pixels had no elevation at all.
 * 4. **and none of it costs a single extra node.** "Make it elevation-aware" turning into "make it
 *    search more" is how a per-tick budget becomes a frame hitch; the fourth test pins the cap and
 *    then pins the search itself against the flat obstacle it replaced.
 */

import type { GroundVector } from "@lindocara/engine/ground.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { DEFAULT_ZONE_NAVIGATION } from "@lindocara/engine/navigation.js";
import { describe, expect, it } from "vitest";
import {
  createNavigationRuntime,
  type NavigationRuntime,
  processNavigationBudget,
  requestMonsterPath,
} from "../src/world/navigation-system.js";
import {
  groundUnder,
  type ZoneTerrain,
  zoneTerrainFromHeightfield,
} from "../src/world/terrain-access.js";
import { createMonsters, type MonsterRuntime } from "../src/world/world-runtime.js";

const SIZE = 16;
const HALF = SIZE / 2;
const LEVEL_HEIGHT = 0.5;

/** A cell's level: `1` is a plateau top, `0` is ground, `null` is water. */
type Level = 0 | 1 | null;

/** Flat ground everywhere — the control every elevation claim is measured against. */
const FLAT = (): Level => 0;

/**
 * Cols 6-7, rows 0-11: a plateau wall dropped from the north edge, leaving rows 12-15 open. A body
 * on level 0 must walk round its southern end; it may never walk over it.
 */
const WALL = (col: number, row: number): Level => (col >= 6 && col <= 7 && row <= 11 ? 1 : 0);

/** Cols 6-9, rows 6-9: an island of high ground in the middle of walkable ground. */
const MESA = (col: number, row: number): Level =>
  col >= 6 && col <= 9 && row >= 6 && row <= 9 ? 1 : 0;

/** The same island as `MESA`, as WATER: the pre-elevation notion of "blocked", for comparison. */
const LAKE = (col: number, row: number): Level => (MESA(col, row) === 1 ? null : 0);

function terrain(levelAt: (col: number, row: number) => Level): ZoneTerrain {
  const levels: (number | null)[] = [];
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) levels.push(levelAt(col, row));
  }
  const map: MapData = {
    version: 1,
    size: SIZE,
    levelHeight: LEVEL_HEIGHT,
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

/** The world-space centre of cell `(col, row)` — `TerrainQuery.cellCenter`, written out. */
function at(col: number, row: number): GroundVector {
  return { x: col + 0.5 - HALF, z: row + 0.5 - HALF };
}

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

function runtimeFor(built: ZoneTerrain, budget = 180): NavigationRuntime {
  return createNavigationRuntime(built, {
    ...DEFAULT_ZONE_NAVIGATION,
    nodeBudgetPerTick: budget,
    maximumSearchNodes: 2_000,
  });
}

function complete(runtime: NavigationRuntime, maximumTicks = 2_000): void {
  for (let tick = 0; tick < maximumTicks; tick++) {
    processNavigationBudget(runtime, tick * 50);
    if (!runtime.active && runtime.queue.length === 0) return;
  }
  throw new Error("navigation did not finish within the test budget");
}

describe("navigation with elevation", () => {
  it("refuses to path up a cliff face", () => {
    const built = terrain(MESA);
    const runtime = runtimeFor(built);
    const actor = monster("climber", 5, 7);
    actor.threat.set("target", { playerId: "target", amount: 100, updatedAt: 0 });

    // One cell east: straight onto the mesa's west face, from ground pressed right against it.
    requestMonsterPath(runtime, actor, at(6, 7), "target", "chase", 0);
    complete(runtime);

    expect(actor.navigation.state).toBe("unreachable");
    expect(actor.navigation.path).toEqual([]);

    // The control: the identical request across identical geometry, with the relief flattened. It
    // resolves in one step — so what refused the climb was the elevation, not the distance, not
    // the grid bounds and not a mis-sized cell.
    const flat = runtimeFor(terrain(FLAT));
    const twin = monster("flat", 5, 7);
    requestMonsterPath(flat, twin, at(6, 7), "target", "chase", 0);
    complete(flat);
    expect(twin.navigation.state).toBe("chase");
    expect(twin.navigation.path.length).toBeGreaterThan(0);
  });

  it("paths around a plateau to a target on the same level", () => {
    const built = terrain(WALL);
    const runtime = runtimeFor(built);
    const actor = monster("around", 2, 6);

    requestMonsterPath(runtime, actor, at(12, 6), null, "patrol", 0);
    complete(runtime);

    expect(actor.navigation.state).toBe("patrol");
    expect(actor.navigation.path.length).toBeGreaterThan(0);
    // Every waypoint stays on level 0: the plan never crosses the wall it is routing around.
    expect(actor.navigation.path.every((point) => groundUnder(built, point.x, point.z) === 0)).toBe(
      true,
    );
    // And it really went round the wall's open southern end (rows 12+ are at z >= 4) rather than
    // taking the straight line the two endpoints share.
    expect(actor.navigation.path.some((point) => point.z >= 4)).toBe(true);
  });

  it("reports no path to a target standing on unreachable high ground", () => {
    const runtime = runtimeFor(terrain(MESA));
    const actor = monster("hunter", 2, 2);
    actor.threat.set("hero", { playerId: "hero", amount: 100, updatedAt: 0 });

    // The mesa's interior: a hero up there is visible and in range, and there is no way up.
    requestMonsterPath(runtime, actor, at(7, 7), "hero", "chase", 0);
    complete(runtime);

    expect(actor.navigation.state).toBe("unreachable");
    expect(actor.navigation.abandonReason).toBe("unreachable");
    expect(actor.threat.has("hero")).toBe(false);
    expect(actor.navigation.unreachableTargetId).toBe("hero");
  });

  it("still respects the per-tick node budget", () => {
    // Eight monsters all asking for a path across an elevated map on the same tick. The budget is
    // the speed limit whatever the relief does.
    const runtime = runtimeFor(terrain(MESA), 3);
    for (let index = 0; index < 8; index++) {
      const actor = monster(`budget-${index}`, 1, 1 + index);
      requestMonsterPath(runtime, actor, at(14, 14), `target-${index}`, "chase", 0);
    }
    expect(processNavigationBudget(runtime, 0)).toBeLessThanOrEqual(3);
    expect(runtime.metrics.expandedThisTick).toBeLessThanOrEqual(3);

    // And the search itself did not get hungrier. A plateau nothing can climb onto and a lake
    // nothing can walk into block exactly the same cells; the elevation-aware grid must expand
    // exactly the nodes the flat-obstacle grid does, not a single one more. An implementation
    // that re-tested relief per candidate, or widened the frontier to "look for a way up", shows
    // up here as a number that is merely close.
    const elevated = runtimeFor(terrain(MESA));
    const blocked = runtimeFor(terrain(LAKE));
    for (const [index, subject] of [elevated, blocked].entries()) {
      const actor = monster(`compare-${index}`, 1, 1);
      requestMonsterPath(subject, actor, at(14, 14), null, "patrol", 0);
      complete(subject);
      expect(actor.navigation.path.length).toBeGreaterThan(0);
    }
    expect(elevated.metrics.totalExpanded).toBe(blocked.metrics.totalExpanded);
  });
});
