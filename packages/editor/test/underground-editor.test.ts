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

  it("authors a three-cell flight and round-trips it through the compiled heightfield", () => {
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
    expect(edited?.underground?.levels[0]?.cells).toContainEqual({ col: 4, row: 7, length: 1 });
    expect(edited?.underground?.levels[1]?.cells).toContainEqual({ col: 4, row: 3, length: 1 });
    const heightfield = edited ? decodeMap(toSaveInput(edited).heightfield) : null;
    expect(heightfield?.underground?.stairs).toEqual([
      { depth: 2, col: 4, row: 4, direction: "south", length: 3, width: 1 },
    ]);
    expect(heightfield?.ramps?.at(-1)).toMatchObject({ lowHeight: -4.8, highHeight: -2.4 });
    expect(toMapData(edited ?? map).underground).toEqual(edited?.underground);
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
