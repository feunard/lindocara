import { describe, expect, it } from "vitest";
import { parseServerMessage, type WorldEventSnapshot } from "../src/shared/protocol.js";
import { emptyLayer, encodeTileLayer } from "../src/shared/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "../src/shared/tilesets/tiny-swords.js";

/** A real catalogue id: `graphicAssetId` must be `null` or one of these, appearance only. */
const GRAPHIC = "building.buildings-black-buildings.archery";

function event(overrides: Partial<Record<keyof WorldEventSnapshot, unknown>> = {}) {
  return { id: "event-a", col: 5, row: 5, graphicAssetId: GRAPHIC, onTop: false, ...overrides };
}

const layer = encodeTileLayer(emptyLayer(2, 2));

function welcome(events: unknown) {
  return {
    t: "welcome",
    tick: 0,
    selfId: "p1",
    world: {
      zoneId: "verdant-reach",
      revision: 0,
      tiles: ["..", "##"],
      elements: [],
      tilesetId: TINY_SWORDS_TILESET_ID,
      layers: [layer, layer, layer],
      events,
    },
    players: [],
    monsters: [],
    guards: [],
    loot: [],
    corpses: [],
    projectiles: [],
    self: {},
  };
}

const emptyDelta = { upsert: [], remove: [] };

function delta(events: unknown) {
  return {
    t: "world.delta",
    tick: 12,
    players: emptyDelta,
    monsters: emptyDelta,
    guards: emptyDelta,
    loot: emptyDelta,
    corpses: emptyDelta,
    projectiles: emptyDelta,
    events,
  };
}

function resync(events: unknown) {
  return {
    t: "world.resync",
    tick: 14,
    players: [],
    monsters: [],
    guards: [],
    loot: [],
    corpses: [],
    projectiles: [],
    events,
  };
}

describe("events on the wire", () => {
  it("accepts a well-formed event in welcome, delta and resync", () => {
    expect(parseServerMessage(JSON.stringify(welcome([event()])))).not.toBeNull();
    expect(
      parseServerMessage(JSON.stringify(delta({ upsert: [event()], remove: [] }))),
    ).not.toBeNull();
    expect(parseServerMessage(JSON.stringify(resync([event()])))).not.toBeNull();
  });

  it("accepts a null graphic — the authored blank tile is a legitimate active page", () => {
    expect(
      parseServerMessage(JSON.stringify(welcome([event({ graphicAssetId: null })]))),
    ).not.toBeNull();
  });

  it("drops a welcome whose event id is malformed", () => {
    expect(parseServerMessage(JSON.stringify(welcome([event({ id: "" })])))).toBeNull();
    expect(parseServerMessage(JSON.stringify(welcome([event({ id: "bad id!" })])))).toBeNull();
  });

  it("drops a welcome whose event cell is malformed", () => {
    expect(parseServerMessage(JSON.stringify(welcome([event({ col: -1 })])))).toBeNull();
    expect(parseServerMessage(JSON.stringify(welcome([event({ row: 1.5 })])))).toBeNull();
    expect(parseServerMessage(JSON.stringify(welcome([event({ col: "5" })])))).toBeNull();
  });

  // Mutation proof (a): this is the branch that fails if the `isEditorAssetId` guard is dropped and
  // the parser accepts any string graphic. Appearance only, so an unknown asset must never reach the
  // renderer.
  it("drops a welcome whose event graphic is not a real catalogue id", () => {
    expect(
      parseServerMessage(JSON.stringify(welcome([event({ graphicAssetId: "made.up.asset" })]))),
    ).toBeNull();
    expect(parseServerMessage(JSON.stringify(welcome([event({ graphicAssetId: 42 })])))).toBeNull();
  });

  it("drops an event missing onTop or carrying a non-boolean one", () => {
    expect(parseServerMessage(JSON.stringify(welcome([event({ onTop: "yes" })])))).toBeNull();
    expect(
      parseServerMessage(JSON.stringify(delta({ upsert: [event({ onTop: 1 })], remove: [] }))),
    ).toBeNull();
  });

  it("drops a delta whose events collection is not an entity delta", () => {
    expect(parseServerMessage(JSON.stringify(delta([event()])))).toBeNull();
    expect(parseServerMessage(JSON.stringify(delta(undefined)))).toBeNull();
  });
});
