import {
  decodeMap,
  encodeMap,
  MAX_HEIGHTFIELD_SIZE,
  type MapData,
} from "@lindocara/engine/hd2d/map-data.js";
import { describe, expect, it } from "vitest";

const map: MapData = {
  version: 1,
  environment: "interior",
  interiorShell: { style: "cave" },
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

  it("round-trips ramps excavated below level zero", () => {
    const excavated: MapData = {
      ...map,
      ramps: [{ x: -1, z: -1, width: 1, depth: 1, direction: "south", lowLevel: -2 }],
    };
    expect(decodeMap(encodeMap(excavated))).toEqual(excavated);
  });

  it("rejects an envelope outside an interior or with an unknown material", () => {
    expect(decodeMap(JSON.stringify({ ...map, environment: "exterior" }))).toBeNull();
    expect(decodeMap(JSON.stringify({ ...map, interiorShell: { style: "water" } }))).toBeNull();
  });

  it("round-trips explicit liquid surfaces and rejects ambiguous grids", () => {
    const liquids = Array<"water" | "lava" | null>(16).fill(null);
    const liquidLevels = Array<number | null>(16).fill(null);
    const levels = [...map.levels];
    liquids[5] = "water";
    liquidLevels[5] = 2;
    levels[5] = null;
    liquids[6] = "lava";
    liquidLevels[6] = 3;
    levels[6] = null;
    const wet: MapData = { ...map, levels, liquids, liquidLevels };
    expect(decodeMap(encodeMap(wet))).toEqual(wet);
    expect(decodeMap(JSON.stringify({ ...wet, liquidLevels: undefined }))).toBeNull();
    expect(
      decodeMap(JSON.stringify({ ...wet, liquidLevels: liquidLevels.map(() => null) })),
    ).toBeNull();
    expect(decodeMap(JSON.stringify({ ...wet, levels: map.levels }))).toBeNull();
  });

  it("round-trips resized bridge appearance metadata and rejects it on another asset", () => {
    const bridgeMap: MapData = {
      ...map,
      elements: [
        {
          assetId: "terrain.bridge.wood.horizontal",
          x: 0,
          z: 0,
          bridge: { length: 7, width: 2 },
        },
      ],
    };
    expect(decodeMap(encodeMap(bridgeMap))).toEqual(bridgeMap);
    expect(
      decodeMap(
        JSON.stringify({
          ...bridgeMap,
          elements: [{ assetId: "tree", x: 0, z: 0, bridge: { length: 7, width: 2 } }],
        }),
      ),
    ).toBeNull();
  });

  it("round-trips resized native-building metadata and rejects it on another asset", () => {
    const buildingMap: MapData = {
      ...map,
      elements: [
        {
          assetId: "building.buildings-blue-buildings.house1",
          x: 0,
          z: 0,
          building: { width: 5, depth: 3.125 },
        },
      ],
    };
    expect(decodeMap(encodeMap(buildingMap))).toEqual(buildingMap);
    expect(
      decodeMap(
        JSON.stringify({
          ...buildingMap,
          elements: [{ assetId: "tree", x: 0, z: 0, building: { width: 5, depth: 3 } }],
        }),
      ),
    ).toBeNull();
  });

  it("round-trips native shaped roof collision without trusting malformed variants", () => {
    const shaped: MapData = {
      ...map,
      colliders: [
        {
          x: -1,
          z: -1,
          w: 2,
          h: 2,
          top: 2.7,
          footprint: "ellipse",
          support: "center",
          surface: { shape: "cone", eave: 1.8, peak: 2.7 },
        },
      ],
    };
    expect(decodeMap(encodeMap(shaped))).toEqual(shaped);
    expect(
      decodeMap(
        JSON.stringify({
          ...shaped,
          colliders: [{ ...shaped.colliders[0], surface: { shape: "sphere", eave: 1, peak: 2 } }],
        }),
      ),
    ).toBeNull();
  });

  it("keeps legacy heightfields exterior by default", () => {
    const { environment: _environment, interiorShell: _interiorShell, ...legacy } = map;
    expect(decodeMap(JSON.stringify(legacy))).toEqual({ ...legacy, environment: "exterior" });
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
      decodeMap(JSON.stringify({ ...map, ramps: [{ ...map.ramps?.[0], direction: "up" }] })),
    ).toBeNull();
    expect(
      decodeMap(JSON.stringify({ ...map, ramps: [{ ...map.ramps?.[0], direction: 3 }] })),
    ).toBeNull();
  });

  /**
   * A one-cell ramp climbs any of four ways, and this parser is where that has to be TRUE rather
   * than merely typed. It spelled out `"east"`/`"west"` while `RampDirection` had grown to four,
   * so the editor happily stamped a staircase up a north-facing bank, compiled it, and then could
   * not store it: `decodeMap` refused the whole heightfield over the one ramp it did not
   * recognise, and the author was told the map data was invalid with no way to save.
   */
  it("decodes a ramp climbing any of the four directions", () => {
    for (const direction of ["east", "west", "north", "south"] as const) {
      const encoded = JSON.stringify({
        ...map,
        ramps: [{ ...map.ramps?.[0], direction }],
      });
      expect(decodeMap(encoded)?.ramps?.[0]?.direction, direction).toBe(direction);
    }
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

  it("still reads a map painted with the retired thin ice, as ordinary ice", () => {
    // Thin ice was removed as a mechanic. It was NOT removed from storage, and it cannot be:
    // authored maps live in the database, and this decoder rejects a map OUTRIGHT on one unknown
    // material — the whole grid, not the one cell. Dropping the name from the union would
    // therefore have turned every map ever painted with that brush into an unjoinable map, with
    // no error anyone would trace back to it.
    //
    // Reading it as ice is the whole migration: thin ice already shared ice's friction and its
    // appearance, so a coerced cell behaves exactly as it looked, minus the cracking.
    const painted = {
      ...map,
      materials: map.materials.map((m, i) => (i === 6 ? "glace-fine" : m)),
    };
    const decoded = decodeMap(JSON.stringify(painted));
    expect(decoded).not.toBeNull();
    expect(decoded?.materials[6]).toBe("glace");
    // And every other cell is untouched — the coercion is one value, not a pass over the grid.
    expect(decoded?.materials).toEqual(map.materials);
  });

  it("still rejects a material that was never real", () => {
    expect(
      decodeMap(JSON.stringify({ ...map, materials: map.materials.map(() => "magma") })),
    ).toBeNull();
  });
});
