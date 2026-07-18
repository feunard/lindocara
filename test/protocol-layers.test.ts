import { describe, expect, it } from "vitest";
import { parseServerMessage } from "../src/shared/protocol.js";
import { emptyLayer, encodeTileLayer } from "../src/shared/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "../src/shared/tilesets/tiny-swords.js";

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
      tilesetId: TINY_SWORDS_TILESET_ID,
      layers: [layer, layer, layer],
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
      ...overrides,
    },
    players: [],
    monsters: [],
    guards: [],
    loot: [],
    corpses: [],
    self: {},
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
