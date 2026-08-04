import { decodeMap, encodeMap, type MapData } from "@lindocara/engine/hd2d/map-data.js";
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

  it("rejects a zero or fractional size", () => {
    expect(decodeMap(JSON.stringify({ ...map, size: 0 }))).toBeNull();
    expect(decodeMap(JSON.stringify({ ...map, size: 2.5 }))).toBeNull();
    expect(decodeMap(JSON.stringify({ ...map, size: -4 }))).toBeNull();
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
