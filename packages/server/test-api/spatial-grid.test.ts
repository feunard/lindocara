import { queryWithHysteresis, SpatialGrid } from "@lindocara/server/spatial-grid.js";
import { describe, expect, it } from "vitest";

interface Entity {
  id: string;
  x: number;
  z: number;
}

/** A three-axis runtime, the shape every real indexed entity has. `y` is ELEVATION. */
interface Body extends Entity {
  y: number;
}

describe("SpatialGrid", () => {
  it("buckets on the ground plane and ignores elevation", () => {
    // Two bodies one cell apart on the ground, one of them high on a plateau. While the grid
    // indexed `Vec2`, `y` WAS the second axis: the plateau body was filed 12 cells away from a
    // neighbour standing right beside it, and nothing failed to compile.
    const grid = new SpatialGrid<Body>(4);
    const onGround: Body = { id: "ground", x: 1, y: 0, z: 1 };
    const onPlateau: Body = { id: "plateau", x: 2, y: 50, z: 1 };
    grid.insert(onGround);
    grid.insert(onPlateau);

    expect(
      grid
        .queryRadius({ x: 0, z: 0 }, 4)
        .map((entity) => entity.id)
        .sort(),
    ).toEqual(["ground", "plateau"]);
    // And the elevation must not be mistaken for ground distance in the other direction either:
    // querying at the plateau body's own `y` as if it were a ground axis finds nobody.
    expect(grid.queryRadius({ x: 2, z: 50 }, 4)).toEqual([]);
  });

  it("inserts, moves and removes entities across cells", () => {
    const grid = new SpatialGrid<Entity>(100);
    const entity = { id: "moving", x: 20, z: 20 };
    grid.insert(entity);
    expect(grid.queryRadius({ x: 0, z: 0 }, 50)).toEqual([entity]);

    const previous = { x: entity.x, z: entity.z };
    entity.x = 320;
    grid.update(entity, previous);
    expect(grid.queryRadius({ x: 0, z: 0 }, 50)).toEqual([]);
    expect(grid.queryRadius({ x: 300, z: 20 }, 50)).toEqual([entity]);

    grid.remove(entity.id);
    expect(grid.queryRadius({ x: 300, z: 20 }, 50)).toEqual([]);
  });

  it("returns only entities inside the circular radius", () => {
    const grid = new SpatialGrid<Entity>(64);
    const near = { id: "near", x: 30, z: 40 };
    const outsideCircle = { id: "corner", x: 49, z: 49 };
    const far = { id: "far", x: 200, z: 0 };
    for (const entity of [near, outsideCircle, far]) grid.insert(entity);

    expect(grid.queryRadius({ x: 0, z: 0 }, 50).map((entity) => entity.id)).toEqual(["near"]);
  });

  it("adds entering entities and removes entities beyond the exit radius", () => {
    const grid = new SpatialGrid<Entity>(100);
    const entity = { id: "subject", x: 90, z: 0 };
    grid.insert(entity);

    const entered = queryWithHysteresis(grid, { x: 0, z: 0 }, 100, 20, new Set());
    expect(entered.visibleIds.has(entity.id)).toBe(true);

    const previous = { x: entity.x, z: entity.z };
    entity.x = 121;
    grid.update(entity, previous);
    const exited = queryWithHysteresis(grid, { x: 0, z: 0 }, 100, 20, entered.visibleIds);
    expect(exited.visibleIds.has(entity.id)).toBe(false);
  });

  it("keeps an already visible entity stable inside the hysteresis margin", () => {
    const grid = new SpatialGrid<Entity>(100);
    const entity = { id: "edge", x: 99, z: 0 };
    grid.insert(entity);
    const entered = queryWithHysteresis(grid, { x: 0, z: 0 }, 100, 20, new Set());

    const previous = { x: entity.x, z: entity.z };
    entity.x = 110;
    grid.update(entity, previous);
    const retained = queryWithHysteresis(grid, { x: 0, z: 0 }, 100, 20, entered.visibleIds);
    expect(retained.visibleIds.has(entity.id)).toBe(true);

    const unknownAtSamePosition = queryWithHysteresis(grid, { x: 0, z: 0 }, 100, 20, new Set());
    expect(unknownAtSamePosition.visibleIds.has(entity.id)).toBe(false);
  });
});
