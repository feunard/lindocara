import { encodeMap, type MapData } from "@lindocara/engine/hd2d/map-data.js";
import { parseServerMessage } from "@lindocara/engine/protocol.js";
import { emptyLayer, encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import { describe, expect, it } from "vitest";

/**
 * The heightfield is the room's only geometry now, and it is what every other collection on a
 * `WorldInfo` is sized against: `size`, the three tile layers and any element or event must all
 * agree with the grid the client is about to draw. A square grid replaces the old 4x3 pixel
 * rectangle for exactly that reason — a heightfield has one side, not a width and a height.
 */
const SIZE = 4;
const heightfield: MapData = {
  version: 1,
  size: SIZE,
  levelHeight: 0.5,
  waterLevel: -0.25,
  levels: new Array(SIZE * SIZE).fill(0),
  materials: new Array(SIZE * SIZE).fill("herbe"),
  colliders: [],
  spawns: [],
  elements: [],
  events: [],
};

function welcome(overrides: Record<string, unknown>) {
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
      heightfield: encodeMap(heightfield),
      size: SIZE,
      questNpc: { id: "none", x: 0, y: 0 },
      questNpcs: [],
      questSites: [],
      cemeteries: [],
      portals: [],
      merchant: null,
      ...overrides,
    },
    players: [
      {
        id: "a",
        nick: "Mira",
        // Tile units, grid centre as origin: `x`/`z` are the ground axes and `y` is elevation.
        x: 0,
        y: 0,
        z: 0,
        airborne: false,
        swimming: false,
        gliding: false,
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

describe("layers on the wire", () => {
  it("accepts a well-formed welcome carrying layers", () => {
    expect(parseServerMessage(JSON.stringify(welcome({})))).not.toBeNull();
  });

  it("rejects a welcome whose layer count is not three", () => {
    expect(parseServerMessage(JSON.stringify(welcome({ layers: ["0*12"] })))).toBeNull();
  });

  it("rejects a welcome naming an unknown tileset", () => {
    expect(parseServerMessage(JSON.stringify(welcome({ tilesetId: "nope" })))).toBeNull();
  });

  it("rejects a layer that is not a string", () => {
    expect(parseServerMessage(JSON.stringify(welcome({ layers: [1, 2, 3] })))).toBeNull();
  });
});
