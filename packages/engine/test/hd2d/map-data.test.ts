import {
  decodeMap,
  encodeMap,
  MAX_HEIGHTFIELD_SIZE,
  type MapData,
} from "@lindocara/engine/hd2d/map-data.js";
import { describe, expect, it } from "vitest";

const map: MapData = {
  version: 1,
  size: 4,
  levelHeight: 0.9,
  waterLevel: 0,
  levels: [null, 0, 0, null, 0, 1, 1, 0, 0, 1, 2, 0, null, 0, 0, null],
  materials: [
    "herbe",
    "herbe",
    "herbe",
    "herbe",
    "herbe",
    "neige",
    "glace",
    "herbe",
    "herbe",
    "neige",
    "neige",
    "herbe",
    "herbe",
    "herbe",
    "herbe",
    "herbe",
  ],
  ramps: [{ x: -1, z: -1, width: 1, depth: 2, direction: "east", lowLevel: 0 }],
  colliders: [{ x: 1, z: 1, w: 0.4, h: 0.4 }],
  spawns: [{ name: "depart", x: 0, z: 0 }],
  elements: [{ assetId: "tree_01", x: 2, z: 2 }],
  events: [{ id: "ev-1", x: 3, z: 3, graphicAssetId: "chest_closed" }],
};

describe("the map codec", () => {
  it("round-trips without losing anything", () => {
    expect(decodeMap(encodeMap(map))).toEqual(map);
  });

  it("never throws on a malformed input", () => {
    // The server will read this format one day: a `throw` on a corrupted map would take down a
    // room.
    for (const bad of ["", "{}", "null", "[1,2,3]", '{"version":99}', "not json"]) {
      expect(() => decodeMap(bad)).not.toThrow();
      expect(decodeMap(bad)).toBeNull();
    }
  });

  it("rejects a map whose grid isn't size²", () => {
    const truncated = { ...map, levels: map.levels.slice(0, 5) };
    expect(decodeMap(JSON.stringify(truncated))).toBeNull();
  });

  it("rejects a material outside the union", () => {
    const muddy: unknown = { ...map, materials: ["boue", ...map.materials.slice(1)] };
    expect(decodeMap(JSON.stringify(muddy))).toBeNull();
  });

  it("rejects a badly typed nested field", () => {
    const colliderText = { ...map, colliders: [{ x: "1", z: 1, w: 0.4, h: 0.4 }] };
    expect(decodeMap(JSON.stringify(colliderText))).toBeNull();

    const spawnWithoutName = { ...map, spawns: [{ name: 42, x: 0, z: 0 }] };
    expect(decodeMap(JSON.stringify(spawnWithoutName))).toBeNull();
  });

  it("keeps pre-stairs heightfields backward compatible and rejects malformed ramps", () => {
    const { ramps: _ramps, ...legacy } = map;
    expect(decodeMap(JSON.stringify(legacy))).toEqual(legacy);
    expect(
      decodeMap(JSON.stringify({ ...map, ramps: [{ ...map.ramps?.[0], direction: "north" }] })),
    ).toBeNull();
  });

  it("rejects a zero or fractional size", () => {
    expect(decodeMap(JSON.stringify({ ...map, size: 0 }))).toBeNull();
    expect(decodeMap(JSON.stringify({ ...map, size: 2.5 }))).toBeNull();
    expect(decodeMap(JSON.stringify({ ...map, size: -4 }))).toBeNull();
  });

  /**
   * The side has an upper bound, not just a lower one. `protocol.ts`'s `MOVE_COORDINATE_LIMIT`
   * derives from it: a position bound of half a grid side means nothing if the side is unbounded,
   * and a map that decoded past it would have every movement frame on it silently dropped.
   */
  it("rejects a size above the largest grid a heightfield may declare", () => {
    const side = MAX_HEIGHTFIELD_SIZE + 1;
    const oversized = {
      ...map,
      size: side,
      levels: new Array(side * side).fill(0),
      materials: new Array(side * side).fill("herbe"),
    };
    expect(decodeMap(JSON.stringify(oversized))).toBeNull();
    // The bound itself is inclusive: the largest legal map still decodes.
    const largest = {
      ...map,
      size: MAX_HEIGHTFIELD_SIZE,
      levels: new Array(MAX_HEIGHTFIELD_SIZE * MAX_HEIGHTFIELD_SIZE).fill(0),
      materials: new Array(MAX_HEIGHTFIELD_SIZE * MAX_HEIGHTFIELD_SIZE).fill("herbe"),
    };
    expect(decodeMap(JSON.stringify(largest))?.size).toBe(MAX_HEIGHTFIELD_SIZE);
  });

  it("rejects a colliders field that isn't an array", () => {
    expect(decodeMap(JSON.stringify({ ...map, colliders: "not-an-array" }))).toBeNull();
  });

  it("silently discards extra keys on a collider or a spawn", () => {
    // Same discipline as the top level: a nested object that is otherwise valid but carries an
    // unknown key must not let it surface out of decoding.
    const withPayload = {
      ...map,
      colliders: [{ x: 1, z: 1, w: 0.4, h: 0.4, evil: "payload" }],
    };
    const decoded = decodeMap(JSON.stringify(withPayload));
    expect(decoded).not.toBeNull();
    expect(decoded?.colliders).toEqual([{ x: 1, z: 1, w: 0.4, h: 0.4 }]);
    expect(decoded?.colliders[0]).not.toHaveProperty("evil");
  });
});
