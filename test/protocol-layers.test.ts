import { parseServerMessage } from "@lindocara/engine/protocol.js";
import { emptyLayer, encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import { describe, expect, it } from "vitest";

function welcome(overrides: Record<string, unknown>) {
  const layer = encodeTileLayer(emptyLayer(4, 3));
  return {
    t: "welcome",
    tick: 0,
    selfId: "a",
    world: {
      zoneId: "verdant-reach",
      revision: 1,
      zoneNameKey: "zone.verdant",
      tiles: ["....", "....", "...."],
      elements: [],
      colliders: [],
      tilesetId: TINY_SWORDS_TILESET_ID,
      layers: [layer, layer, layer],
      events: [],
      width: 256,
      height: 192,
      playerSize: 32,
      obstacles: [],
      safeZone: null,
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
        x: 16,
        y: 16,
        ack: 0,
        hp: 100,
        maxHp: 100,
        level: 1,
        appearance: { body: "wayfarer", primaryColor: "azure" },
        class: "priest",
        equipment: { mainHand: "heartwood_staff", offHand: null },
        life: "alive",
        facing: { x: 1, y: 0 },
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
