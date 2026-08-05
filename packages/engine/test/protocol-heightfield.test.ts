import { describe, expect, it } from "vitest";
import { encodeMap, type MapData } from "../src/hd2d/map-data.js";
import { parseServerMessage } from "../src/protocol.js";
import { emptyLayer, encodeTileLayer } from "../src/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "../src/tilesets/tiny-swords.js";

const SIZE = 2;
const map: MapData = {
  version: 1,
  size: SIZE,
  levelHeight: 0.5,
  waterLevel: 0,
  levels: [0, 0, 0, 0],
  materials: ["herbe", "herbe", "herbe", "herbe"],
  colliders: [],
  spawns: [],
  elements: [],
  events: [],
};

/**
 * Built here rather than pulled from `@lindocara/testing`'s `welcomeFixture`: that fixture still
 * describes the pixel world (`tiles`, `colliders`, `width`/`height`, `playerSize`, `obstacles`,
 * `safeZone`, a nullable `heightfield`) and no longer parses at all, which would make every
 * rejection below pass for the wrong reason — the frame would be dropped over the fixture, not over
 * the heightfield each case is actually about.
 */
function welcomeFixture(worldOverrides: Record<string, unknown> = {}) {
  const layer = encodeTileLayer(emptyLayer(SIZE, SIZE));
  return {
    t: "welcome",
    tick: 0,
    selfId: "a",
    world: {
      zoneId: "verdant-reach",
      revision: 1,
      zoneNameKey: "zone.verdant",
      elements: [],
      tilesetId: TINY_SWORDS_TILESET_ID,
      layers: [layer, layer, layer],
      events: [],
      heightfield: encodeMap(map),
      size: SIZE,
      questNpc: { id: "none", x: 0, y: 0 },
      questNpcs: [],
      questSites: [],
      cemeteries: [],
      portals: [],
      merchant: null,
      ...worldOverrides,
    },
    players: [
      {
        id: "a",
        nick: "Mira",
        // Tile units, grid centre as origin: `x`/`z` are the ground axes and `y` is elevation.
        x: 0,
        y: 0,
        z: 0,
        ack: 0,
        hp: 100,
        maxHp: 100,
        level: 1,
        appearance: { body: "wayfarer", primaryColor: "azure" },
        class: "priest",
        equipment: { mainHand: "heartwood_staff", offHand: null },
        life: "alive",
        facing: { x: 1, z: 0 },
        action: null,
      },
    ],
    monsters: [],
    guards: [],
    loot: [],
    corpses: [],
    projectiles: [],
    self: {
      xp: 0,
      xpToNext: 100,
      inventory: { potions: 0, gold: 0, crystals: 0 },
      quest: { status: "available", progress: 0, target: 3 },
      life: "alive",
      corpse: null,
    },
  };
}

describe("WorldInfo.heightfield", () => {
  it("accepts a welcome carrying a valid encoded heightfield", () => {
    const message = welcomeFixture({ heightfield: encodeMap(map) });
    const parsed = parseServerMessage(JSON.stringify(message));
    expect(parsed?.t).toBe("welcome");
  });

  /**
   * `heightfield` used to be nullable and an explicit `null` was accepted. It is the room's ONLY
   * geometry now — a map without one cannot produce a zone at all, so a room that is sending a
   * welcome has one by construction — and a `null` is exactly the half-converted sender this field
   * being non-nullable exists to catch.
   */
  it("drops a frame whose heightfield is null", () => {
    expect(parseServerMessage(JSON.stringify(welcomeFixture({ heightfield: null })))).toBeNull();
  });

  it("drops a frame whose heightfield does not decode", () => {
    const message = welcomeFixture({ heightfield: '{"version":1,"size":-4}' });
    expect(parseServerMessage(JSON.stringify(message))).toBeNull();
  });

  it("drops a frame whose heightfield is not a string", () => {
    const message = welcomeFixture({ heightfield: 7 });
    expect(parseServerMessage(JSON.stringify(message))).toBeNull();
  });

  /**
   * The heightfield is what everything else on a `WorldInfo` is sized against, so a `size` that
   * disagrees with the grid it travels beside is a sender contradicting itself.
   */
  it("drops a frame whose declared size disagrees with the heightfield", () => {
    expect(parseServerMessage(JSON.stringify(welcomeFixture({ size: SIZE + 1 })))).toBeNull();
  });
});
