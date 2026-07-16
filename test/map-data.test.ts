import { describe, expect, it } from "vitest";
import {
  bakeCollision,
  canPlaceElement,
  type MapData,
  parseMapData,
} from "../src/shared/map-data.js";
import { isSolidKind, kindAt } from "../src/shared/tilemap.js";

const MAP: MapData = {
  blocks: ["....", ".##.", "....", "...."],
  elements: [],
  spawn: { col: 0, row: 0 },
};

describe("baking a map's collision", () => {
  it("keeps grass walkable and water solid", () => {
    const tiles = bakeCollision(MAP);
    expect(kindAt(tiles, 0, 0)).toBe("grass");
    expect(isSolidKind(kindAt(tiles, 1, 1))).toBe(true);
  });

  it("bakes a tree solid but leaves a bush walkable", () => {
    const tiles = bakeCollision({
      ...MAP,
      elements: [
        { col: 0, row: 0, kind: "tree", variant: 0 },
        { col: 3, row: 0, kind: "bush", variant: 0 },
      ],
    });
    expect(isSolidKind(kindAt(tiles, 0, 0))).toBe(true);
    expect(isSolidKind(kindAt(tiles, 3, 0))).toBe(false);
  });

  it("leaves a stone on water solid — it was already water", () => {
    const tiles = bakeCollision({
      ...MAP,
      elements: [{ col: 1, row: 1, kind: "stone", variant: 0 }],
    });
    expect(isSolidKind(kindAt(tiles, 1, 1))).toBe(true);
    // Still water, not "forest": a stone does not turn the sea into land, and the renderer must
    // keep drawing water under it.
    expect(kindAt(tiles, 1, 1)).toBe("water");
  });

  it("does not mutate the map it was handed", () => {
    const elements = [{ col: 0, row: 0, kind: "tree", variant: 0 } as const];
    const source: MapData = { ...MAP, elements };
    bakeCollision(source);
    expect(source.blocks).toEqual(["....", ".##.", "....", "...."]);
    expect(source.elements).toEqual(elements);
  });
});

describe("placement rules", () => {
  it("refuses a tree or a bush on water, and allows a stone there", () => {
    expect(canPlaceElement("tree", "water")).toBe(false);
    expect(canPlaceElement("bush", "water")).toBe(false);
    expect(canPlaceElement("stone", "water")).toBe(true);
  });

  it("allows all three on grass", () => {
    for (const kind of ["tree", "bush", "stone"] as const) {
      expect(canPlaceElement(kind, "grass")).toBe(true);
    }
  });
});

describe("parsing a map off the wire", () => {
  it("accepts a well-formed map", () => {
    const map = parseMapData({
      blocks: ["..", "##"],
      elements: [{ col: 0, row: 0, kind: "tree", variant: 1 }],
      spawn: { col: 0, row: 0 },
    });
    expect(map).not.toBe(null);
    expect(map?.elements[0]?.kind).toBe("tree");
  });

  // Every one of these would otherwise reach decodeTileMap and throw on the first paint.
  it("rejects malformed terrain instead of throwing", () => {
    const bad: unknown[] = [
      null,
      "nope",
      {},
      { blocks: [], elements: [], spawn: { col: 0, row: 0 } },
      { blocks: ["..", "###"], elements: [], spawn: { col: 0, row: 0 } },
      { blocks: ["xx"], elements: [], spawn: { col: 0, row: 0 } },
      { blocks: [".."], elements: "nope", spawn: { col: 0, row: 0 } },
      {
        blocks: [".."],
        elements: [{ col: 0, row: 0, kind: "dragon", variant: 0 }],
        spawn: { col: 0, row: 0 },
      },
      {
        blocks: [".."],
        elements: [{ col: 99, row: 0, kind: "tree", variant: 0 }],
        spawn: { col: 0, row: 0 },
      },
      {
        blocks: [".."],
        elements: [{ col: -1, row: 0, kind: "tree", variant: 0 }],
        spawn: { col: 0, row: 0 },
      },
      { blocks: [".."], elements: [], spawn: { col: 99, row: 0 } },
      { blocks: [".."], elements: [], spawn: null },
    ];
    for (const value of bad) {
      expect(parseMapData(value), JSON.stringify(value)).toBe(null);
    }
  });
});
