import { describe, expect, it } from "vitest";
import { decodeMap, encodeMap, type MapData } from "../src/hd2d/map-data.js";

const base: MapData = {
  version: 1,
  size: 2,
  levelHeight: 0.5,
  waterLevel: 0,
  levels: [0, 0, 0, null],
  materials: ["herbe", "herbe", "sable", "herbe"],
  colliders: [],
  spawns: [],
  elements: [],
  events: [],
};

describe("MapData content", () => {
  it("round-trips elements and events", () => {
    const map: MapData = {
      ...base,
      elements: [{ assetId: "tree_01", x: -0.5, z: 0.25 }],
      events: [{ id: "ev-1", x: 0, z: 0, graphicAssetId: "chest_closed" }],
    };
    expect(decodeMap(encodeMap(map))).toEqual(map);
  });

  it("defaults both collections to empty for a map that predates them", () => {
    const { elements: _e, events: _v, ...withoutContent } = base;
    expect(decodeMap(JSON.stringify(withoutContent))).toEqual(base);
  });

  it("rejects a malformed element rather than dropping it silently", () => {
    const broken = { ...base, elements: [{ assetId: 42, x: 0, z: 0 }] };
    expect(decodeMap(JSON.stringify(broken))).toBeNull();
  });

  it("rejects a non-finite event coordinate", () => {
    const broken = { ...base, events: [{ id: "e", x: "0", z: 0, graphicAssetId: null }] };
    expect(decodeMap(JSON.stringify(broken))).toBeNull();
  });
});
