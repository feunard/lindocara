import { queryWithHysteresis, SpatialGrid } from "@lindocara/server/spatial-grid.js";
import { describe, expect, it } from "vitest";

interface Entity {
  id: string;
  x: number;
  y: number;
}

describe("SpatialGrid", () => {
  it("inserts, moves and removes entities across cells", () => {
    const grid = new SpatialGrid<Entity>(100);
    const entity = { id: "moving", x: 20, y: 20 };
    grid.insert(entity);
    expect(grid.queryRadius({ x: 0, y: 0 }, 50)).toEqual([entity]);

    const previous = { x: entity.x, y: entity.y };
    entity.x = 320;
    grid.update(entity, previous);
    expect(grid.queryRadius({ x: 0, y: 0 }, 50)).toEqual([]);
    expect(grid.queryRadius({ x: 300, y: 20 }, 50)).toEqual([entity]);

    grid.remove(entity.id);
    expect(grid.queryRadius({ x: 300, y: 20 }, 50)).toEqual([]);
  });

  it("returns only entities inside the circular radius", () => {
    const grid = new SpatialGrid<Entity>(64);
    const near = { id: "near", x: 30, y: 40 };
    const outsideCircle = { id: "corner", x: 49, y: 49 };
    const far = { id: "far", x: 200, y: 0 };
    for (const entity of [near, outsideCircle, far]) grid.insert(entity);

    expect(grid.queryRadius({ x: 0, y: 0 }, 50).map((entity) => entity.id)).toEqual(["near"]);
  });

  it("adds entering entities and removes entities beyond the exit radius", () => {
    const grid = new SpatialGrid<Entity>(100);
    const entity = { id: "subject", x: 90, y: 0 };
    grid.insert(entity);

    const entered = queryWithHysteresis(grid, { x: 0, y: 0 }, 100, 20, new Set());
    expect(entered.visibleIds.has(entity.id)).toBe(true);

    const previous = { x: entity.x, y: entity.y };
    entity.x = 121;
    grid.update(entity, previous);
    const exited = queryWithHysteresis(grid, { x: 0, y: 0 }, 100, 20, entered.visibleIds);
    expect(exited.visibleIds.has(entity.id)).toBe(false);
  });

  it("keeps an already visible entity stable inside the hysteresis margin", () => {
    const grid = new SpatialGrid<Entity>(100);
    const entity = { id: "edge", x: 99, y: 0 };
    grid.insert(entity);
    const entered = queryWithHysteresis(grid, { x: 0, y: 0 }, 100, 20, new Set());

    const previous = { x: entity.x, y: entity.y };
    entity.x = 110;
    grid.update(entity, previous);
    const retained = queryWithHysteresis(grid, { x: 0, y: 0 }, 100, 20, entered.visibleIds);
    expect(retained.visibleIds.has(entity.id)).toBe(true);

    const unknownAtSamePosition = queryWithHysteresis(grid, { x: 0, y: 0 }, 100, 20, new Set());
    expect(unknownAtSamePosition.visibleIds.has(entity.id)).toBe(false);
  });
});
