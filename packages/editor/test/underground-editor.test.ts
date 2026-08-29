import {
  applyTool,
  blankMap,
  toMapData,
  toSaveInput,
} from "@lindocara/editor/game/editor-state.js";
import { decodeMap } from "@lindocara/engine/hd2d/map-data.js";
import { describe, expect, it } from "vitest";

describe("underground editor tools", () => {
  it("digs and refills large blocks as one authored operation", () => {
    const map = blankMap("Deep map", 12, 12);
    const dug = applyTool(
      map,
      {
        kind: "underground",
        operation: "dig",
        depth: 4,
        style: "volcano",
        width: 5,
        length: 3,
        direction: "east",
      },
      2,
      3,
    );
    expect(dug?.underground?.levels).toEqual([
      {
        depth: 4,
        style: "volcano",
        cells: [
          { col: 2, row: 3, length: 5 },
          { col: 2, row: 4, length: 5 },
          { col: 2, row: 5, length: 5 },
        ],
      },
    ]);
    const filled = dug
      ? applyTool(
          dug,
          {
            kind: "underground",
            operation: "fill",
            depth: 4,
            style: "cave",
            width: 5,
            length: 3,
            direction: "east",
          },
          2,
          3,
        )
      : null;
    expect(filled?.underground?.levels).toEqual([]);
  });

  it("keeps a directed tunnel distinct from a rectangular room", () => {
    const map = blankMap("Tunnel", 12, 12);
    const east = applyTool(
      map,
      {
        kind: "underground",
        operation: "tunnel",
        depth: 2,
        style: "cave",
        width: 2,
        length: 6,
        direction: "east",
      },
      2,
      3,
    );
    const south = applyTool(
      map,
      {
        kind: "underground",
        operation: "tunnel",
        depth: 2,
        style: "cave",
        width: 2,
        length: 6,
        direction: "south",
      },
      2,
      3,
    );

    expect(east?.underground?.levels[0]?.cells).toHaveLength(2);
    expect(east?.underground?.levels[0]?.cells[0]?.length).toBe(6);
    expect(south?.underground?.levels[0]?.cells).toHaveLength(6);
    expect(south?.underground?.levels[0]?.cells[0]?.length).toBe(2);
  });

  it("extends a surface flight by three cells for every crossed storey", () => {
    const map = blankMap("Stairs", 12, 12);
    const edited = applyTool(
      map,
      {
        kind: "underground",
        operation: "stairs",
        depth: 2,
        style: "castle",
        width: 1,
        length: 3,
        direction: "south",
      },
      4,
      4,
    );
    expect(edited).not.toBeNull();
    expect(edited?.underground?.levels.map((level) => level.depth)).toEqual([1, 2]);
    expect(edited?.underground?.levels[0]?.cells).toContainEqual({ col: 4, row: 4, length: 1 });
    expect(edited?.underground?.levels[1]?.cells).toContainEqual({ col: 4, row: 3, length: 1 });
    const heightfield = edited ? decodeMap(toSaveInput(edited).heightfield) : null;
    expect(heightfield?.underground?.stairs).toEqual([
      { depth: 2, fromDepth: 0, col: 4, row: 4, direction: "south", length: 6, width: 1 },
    ]);
    expect(heightfield?.ramps?.at(-1)).toMatchObject({ lowHeight: -4.8, highHeight: 0 });
    expect(toMapData(edited ?? map).underground).toEqual(edited?.underground);
  });

  it("connects the selected underground storey to a deeper target without collision gaps", () => {
    const map = blankMap("Deep stairs", 32, 32);
    const edited = applyTool(
      map,
      {
        kind: "underground",
        operation: "stairs",
        depth: 8,
        style: "cave",
        width: 2,
        length: 5,
        direction: "west",
      },
      3,
      3,
      true,
      "field",
      0,
      0,
      3,
    );

    expect(edited?.underground?.stairs).toEqual([
      {
        depth: 8,
        fromDepth: 3,
        col: 3,
        row: 3,
        direction: "west",
        length: 15,
        width: 2,
      },
    ]);
    expect(edited?.underground?.levels.map((level) => level.depth)).toEqual([3, 4, 5, 6, 7, 8]);
    const heightfield = edited ? decodeMap(toSaveInput(edited).heightfield) : null;
    expect(heightfield?.ramps?.at(-1)?.lowHeight).toBeCloseTo(-19.2);
    expect(heightfield?.ramps?.at(-1)?.highHeight).toBeCloseTo(-7.2);
  });

  it("creates a long, traversable 0 to -16 flight instead of a near-vertical drop", () => {
    const map = blankMap("Maximum stairs", 56, 56);
    const edited = applyTool(
      map,
      {
        kind: "underground",
        operation: "stairs",
        depth: 16,
        style: "cave",
        width: 2,
        length: 3,
        direction: "east",
      },
      3,
      3,
    );

    expect(edited?.underground?.stairs[0]).toMatchObject({
      depth: 16,
      fromDepth: 0,
      length: 48,
      width: 2,
    });
    expect(edited?.underground?.levels.map((level) => level.depth)).toEqual(
      Array.from({ length: 16 }, (_unused, index) => index + 1),
    );
  });

  it("authors a true surface shaft through every storey and removes it when filled", () => {
    const map = blankMap("Shaft", 12, 12);
    const dug = applyTool(
      map,
      {
        kind: "underground",
        operation: "shaft",
        depth: 4,
        style: "cave",
        width: 2,
        length: 3,
        direction: "east",
      },
      5,
      4,
    );
    expect(dug?.underground?.levels.map((level) => level.depth)).toEqual([1, 2, 3, 4]);
    expect(dug?.underground?.shafts).toEqual([{ col: 5, row: 4, width: 2, length: 3, depth: 4 }]);
    const heightfield = dug ? decodeMap(toSaveInput(dug).heightfield) : null;
    expect(heightfield?.underground?.shafts).toEqual(dug?.underground?.shafts);
    expect(heightfield?.levels[4 * 12 + 5]).toBe(0);

    const filled = dug
      ? applyTool(
          dug,
          {
            kind: "underground",
            operation: "fill",
            depth: 2,
            style: "cave",
            width: 2,
            length: 3,
            direction: "east",
          },
          5,
          4,
        )
      : null;
    expect(filled?.underground?.shafts).toBeUndefined();
  });

  it("uses one cell by default and supports rectangle and fill shapes for direct holes", () => {
    const tool = {
      kind: "underground" as const,
      operation: "shaft" as const,
      depth: 2,
      style: "cave" as const,
      width: 1,
      length: 1,
      direction: "east" as const,
    };
    const unit = applyTool(blankMap("Unit hole", 12, 12), { ...tool, shape: "pencil" }, 5, 4);
    expect(unit?.underground?.shafts).toEqual([{ col: 5, row: 4, width: 1, length: 1, depth: 2 }]);

    const rectangleStart = applyTool(
      blankMap("Rectangle hole", 12, 12),
      { ...tool, shape: "rect" },
      2,
      3,
      true,
    );
    const rectangle = rectangleStart
      ? applyTool(rectangleStart, { ...tool, shape: "rect" }, 5, 4, false)
      : null;
    expect(rectangle?.underground?.shafts).toEqual([
      { col: 2, row: 3, width: 4, length: 2, depth: 2 },
    ]);

    const filled = applyTool(blankMap("Filled hole", 12, 12), { ...tool, shape: "fill" }, 6, 6);
    expect(filled?.underground?.shafts).toEqual([
      { col: 0, row: 0, width: 12, length: 12, depth: 2 },
    ]);
  });

  it("reuses pencil, rectangle and flood-fill shapes when filling underground rooms", () => {
    const dug = applyTool(
      blankMap("Fill shapes", 12, 12),
      {
        kind: "underground",
        operation: "dig",
        depth: 3,
        style: "cave",
        width: 4,
        length: 4,
        direction: "east",
      },
      3,
      3,
    );
    const fillTool = {
      kind: "underground" as const,
      operation: "fill" as const,
      depth: 3,
      style: "cave" as const,
      width: 1,
      length: 1,
      direction: "east" as const,
      shape: "rect" as const,
    };
    const anchored = dug ? applyTool(dug, fillTool, 3, 3, true, "field", 0, 0, 3) : null;
    const rectangle = anchored
      ? applyTool(anchored, fillTool, 4, 4, false, "field", 0, 0, 3)
      : null;
    expect(rectangle?.underground?.levels[0]?.cells).not.toContainEqual({
      col: 3,
      row: 3,
      length: 4,
    });

    const flooded = rectangle
      ? applyTool(rectangle, { ...fillTool, shape: "fill" }, 5, 3, true, "field", 0, 0, 3)
      : null;
    expect(flooded?.underground?.levels).toEqual([]);
  });

  it("reuses terrain, scenery and event tools per storey without mixing their content", () => {
    const tree = "decoration.terrain-decorations-bushes.bushe1";
    let map = blankMap("Layered content", 12, 12);
    map = applyTool(
      map,
      {
        kind: "underground",
        operation: "dig",
        depth: 3,
        style: "cave",
        width: 4,
        length: 4,
        direction: "east",
      },
      3,
      3,
    ) as typeof map;
    map = applyTool(
      map,
      { kind: "elevation", step: "keep", material: "volcan" },
      4,
      4,
      true,
      "field",
      0,
      0,
      3,
    ) as typeof map;
    map = applyTool(map, { kind: "element", assetId: tree }, 4, 4, true, "element") as typeof map;
    map = applyTool(
      map,
      { kind: "element", assetId: tree },
      4,
      4,
      true,
      "element",
      0,
      0,
      3,
    ) as typeof map;
    map = applyTool(map, { kind: "event", eventKind: "normal" }, 5, 5, true, "event") as typeof map;
    map = applyTool(
      map,
      { kind: "event", eventKind: "normal" },
      5,
      5,
      true,
      "event",
      0,
      0,
      3,
    ) as typeof map;

    expect(map.underground?.levels.find((level) => level.depth === 3)?.terrain).toEqual([
      { col: 4, row: 4, length: 1, material: "volcan" },
    ]);
    expect(map.elements.map((element) => element.undergroundDepth ?? 0)).toEqual([0, 3]);
    expect(map.events.map((event) => event.undergroundDepth ?? 0)).toEqual([0, 3]);
    expect(map.elements[0]?.id).toBeUndefined();
    expect(map.elements[1]?.id).toBeDefined();

    const stored = toMapData(map).underground;
    expect(stored?.elementDepths).toEqual([{ id: map.elements[1]?.id, depth: 3 }]);
    expect(stored?.eventDepths).toEqual([{ id: map.events[1]?.id, depth: 3 }]);
    const heightfield = decodeMap(toSaveInput(map).heightfield);
    expect(heightfield?.elements.filter((element) => element.undergroundDepth === 3)).toHaveLength(
      1,
    );
    expect(heightfield?.events.filter((event) => event.undergroundDepth === 3)).toHaveLength(1);
  });
});
