import { describe, expect, it } from "vitest";
import { parseServerMessage, type WorldEventSnapshot } from "../src/shared/protocol.js";
import { emptyLayer, encodeTileLayer } from "../src/shared/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "../src/shared/tilesets/tiny-swords.js";

/** A real catalogue id: `graphicAssetId` must be `null` or one of these, appearance only. */
const GRAPHIC = "building.buildings-black-buildings.archery";

function event(overrides: Partial<Record<keyof WorldEventSnapshot, unknown>> = {}) {
  return { id: "event-a", col: 1, row: 1, graphicAssetId: GRAPHIC, onTop: false, ...overrides };
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
      zoneNameKey: "zone.verdant_reach.name",
      tiles: ["..", "##"],
      elements: [],
      tilesetId: TINY_SWORDS_TILESET_ID,
      layers: [layer, layer, layer],
      events,
      width: 64,
      height: 64,
      playerSize: 32,
      obstacles: [],
      safeZone: null,
      questNpc: { id: "none", x: 0, y: 0 },
      questNpcs: [],
      questSites: [],
      cemeteries: [],
      portals: [],
      merchant: null,
    },
    players: [
      {
        id: "p1",
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
