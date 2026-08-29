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
    const heightfield = edited ? decodeMap(toSaveInput(edited).heightfield) : null;
    expect(heightfield?.underground?.stairs).toEqual([
      { depth: 2, col: 4, row: 4, direction: "south", length: 3, width: 1 },
    ]);
    expect(heightfield?.ramps?.at(-1)).toMatchObject({ lowHeight: -4.8, highHeight: -2.4 });
    expect(toMapData(edited ?? map).underground).toEqual(edited?.underground);
  });
});
