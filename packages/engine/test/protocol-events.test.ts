import { encodeMap, type MapData } from "@lindocara/engine/hd2d/map-data.js";
import { parseServerMessage, type WorldEventSnapshot } from "@lindocara/engine/protocol.js";
import { emptyLayer, encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import { describe, expect, it } from "vitest";

/** A real catalogue id: `graphicAssetId` must be `null` or one of these, appearance only. */
const GRAPHIC = "building.buildings-black-buildings.archery";
const STUMP = "resource.terrain-resources-wood-trees.stump-1";

function event(overrides: Partial<Record<keyof WorldEventSnapshot, unknown>> = {}) {
  return {
    id: "event-a",
    col: 1,
    row: 1,
    graphicAssetId: GRAPHIC,
    graphicTint: 0xffffff,
    onTop: false,
    moveSpeed: 3,
    moveFrequency: 3,
    moveAnimation: true,
    directionFixed: false,
    ...overrides,
  };
}

/**
 * The grid the whole welcome is sized against. `WorldInfo` carries the encoded heightfield and its
 * `size`, and every event's `col`/`row` must fall inside it — an event outside the grid the client
 * is about to draw comes from a sender that disagrees with its own terrain, and the frame is
 * dropped rather than half-rendered.
 */
const SIZE = 2;
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
const layer = encodeTileLayer(emptyLayer(SIZE, SIZE));

function welcome(events: unknown, buildings?: unknown) {
  return {
    t: "welcome",
    tick: 0,
    selfId: "p1",
    world: {
      zoneId: "verdant-reach",
      revision: 0,
      zoneNameKey: "zone.verdant_reach.name",
      elements: [],
      tilesetId: TINY_SWORDS_TILESET_ID,
      layers: [layer, layer, layer],
      events,
      ...(buildings === undefined ? {} : { buildings }),
      heightfield: encodeMap(heightfield),
      size: SIZE,
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
    seaGuardians: [],
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
      displacement: { seq: 0, x: 0, y: 0, z: 0 },
    },
  };
}

const emptyDelta = { upsert: [], remove: [] };

function delta(events: unknown) {
  return {
    t: "world.delta",
    tick: 12,
    players: emptyDelta,
    seaGuardians: emptyDelta,
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
    seaGuardians: [],
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
    expect(
      parseServerMessage(JSON.stringify(welcome([event({ interactive: true })]))),
    ).not.toBeNull();
    expect(
      parseServerMessage(JSON.stringify(delta({ upsert: [event()], remove: [] }))),
    ).not.toBeNull();
    expect(parseServerMessage(JSON.stringify(resync([event()])))).not.toBeNull();
  });

  it("validates an active-page obstacle collider", () => {
    expect(
      parseServerMessage(JSON.stringify(welcome([event({ collider: [68, 26, 56, 38, 1] })]))),
    ).not.toBeNull();
    expect(
      parseServerMessage(JSON.stringify(welcome([event({ collider: [68, 26, 56, 38, 4] })]))),
    ).toBeNull();
    expect(parseServerMessage(JSON.stringify(welcome([event({ collider: null })])))).toBeNull();
  });

  it("accepts building durability in a welcome and rejects incoherent ruins", () => {
    const building = {
      id: "building-1",
      x: 0,
      z: 0,
      graphicAssetId: "building.factions-knights-buildings-house.house-blue",
      destroyedAssetId: "building.factions-knights-buildings-house.house-destroyed",
      hp: 900,
      maxHp: 900,
      destructible: true,
      destroyed: false,
      interactive: true,
      collider: { x: -1, z: -1, w: 2, h: 2 },
    };
    expect(parseServerMessage(JSON.stringify(welcome([], [building])))).not.toBeNull();
    expect(
      parseServerMessage(JSON.stringify(welcome([], [{ ...building, hp: 0, destroyed: false }]))),
    ).toBeNull();
  });

  it("rejects an invented false interaction flag", () => {
    expect(parseServerMessage(JSON.stringify(welcome([event({ interactive: false })])))).toBeNull();
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

  it("validates bounded harvest timestamps and lifecycle coherence", () => {
    const harvest = {
      state: "depleted",
      generation: 2,
      hits: 3,
      hitsRequired: 3,
      lastHitAt: 12_000,
      depletedAt: 12_000,
      respawnAt: 72_000,
      exhaustionBehavior: "fade",
      exhaustedAssetId: null,
      fadeDurationMs: 350,
      collider: null,
    };
    expect(parseServerMessage(JSON.stringify(welcome([event({ harvest })])))).not.toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify(welcome([event({ harvest: { ...harvest, hits: 10_001 } })])),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify(welcome([event({ harvest: { ...harvest, fadeDurationMs: 10_001 } })])),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify(
          welcome([event({ harvest: { ...harvest, state: "intact", depletedAt: 12_000 } })]),
        ),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify(welcome([event({ harvest: { ...harvest, lastHitAt: 11_999 } })])),
      ),
    ).toBeNull();
  });

  it("validates an explicit replacement asset before depletion without inferring from its path", () => {
    const intact = {
      state: "intact",
      generation: 0,
      hits: 1,
      hitsRequired: 3,
      lastHitAt: 12_000,
      depletedAt: null,
      respawnAt: null,
      exhaustionBehavior: "replace",
      exhaustedAssetId: STUMP,
      fadeDurationMs: 250,
      collider: [72, 96, 48, 24],
    };
    expect(
      parseServerMessage(JSON.stringify(welcome([event({ harvest: intact })]))),
    ).not.toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify(
          welcome([
            event({ harvest: { ...intact, exhaustedAssetId: "resource.looks-like-a-stump" } }),
          ]),
        ),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify(welcome([event({ harvest: { ...intact, exhaustedAssetId: null } })])),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify(
          welcome([
            event({
              harvest: {
                ...intact,
                exhaustionBehavior: "hide",
                exhaustedAssetId: STUMP,
              },
            }),
          ]),
        ),
      ),
    ).toBeNull();
  });

  it("accepts an explicit post-fade asset while still validating its catalogue identity", () => {
    const faded = {
      state: "depleted",
      generation: 0,
      hits: 3,
      hitsRequired: 3,
      lastHitAt: 12_000,
      depletedAt: 12_000,
      respawnAt: null,
      exhaustionBehavior: "fade",
      exhaustedAssetId: STUMP,
      fadeDurationMs: 250,
      collider: null,
    };
    expect(parseServerMessage(JSON.stringify(welcome([event({ harvest: faded })])))).not.toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify(
          welcome([
            event({ harvest: { ...faded, exhaustedAssetId: "resource.looks-like-a-stump" } }),
          ]),
        ),
      ),
    ).toBeNull();
  });

  it("drops a welcome whose event cell is malformed", () => {
    expect(parseServerMessage(JSON.stringify(welcome([event({ col: -1 })])))).toBeNull();
    expect(parseServerMessage(JSON.stringify(welcome([event({ row: 1.5 })])))).toBeNull();
    expect(parseServerMessage(JSON.stringify(welcome([event({ col: "5" })])))).toBeNull();
  });

  it("accepts bounded scenery scale and rejects malformed event scale", () => {
    expect(parseServerMessage(JSON.stringify(welcome([event({ scale: 2.25 })])))).not.toBeNull();
    expect(parseServerMessage(JSON.stringify(welcome([event({ scale: 0.1 })])))).toBeNull();
    expect(parseServerMessage(JSON.stringify(welcome([event({ scale: "2" })])))).toBeNull();
  });

  it("validates authoritative harvest progress, collision and native presentation", () => {
    const intact = {
      state: "intact",
      generation: 0,
      hits: 1,
      hitsRequired: 3,
      lastHitAt: 12_000,
      depletedAt: null,
      respawnAt: null,
      exhaustionBehavior: "replace",
      exhaustedAssetId: STUMP,
      fadeDurationMs: 250,
      collider: [72, 96, 48, 24],
    };
    expect(
      parseServerMessage(
        JSON.stringify(welcome([event({ presentation: "native", harvest: intact })])),
      ),
    ).not.toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify(welcome([event({ harvest: { ...intact, collider: [72, 96, 48, 24, 1] } })])),
      ),
    ).not.toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify(welcome([event({ harvest: { ...intact, collider: null } })])),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify(
          welcome([event({ harvest: { ...intact, collider: null, collisionPending: true } })]),
        ),
      ),
    ).not.toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify(welcome([event({ harvest: { ...intact, collisionPending: true } })])),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify(
          welcome([
            event({
              harvest: {
                ...intact,
                state: "depleted",
                hits: intact.hitsRequired,
                depletedAt: intact.lastHitAt,
                collider: null,
                collisionPending: true,
              },
            }),
          ]),
        ),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(JSON.stringify(welcome([event({ harvest: { ...intact, hits: 3 } })]))),
    ).toBeNull();
    expect(
      parseServerMessage(JSON.stringify(welcome([event({ presentation: "from-asset" })]))),
    ).toBeNull();
    // A valid scenery scale is decimal (0.25..4 by 0.05), so the server's projection of an
    // integral authored box is legitimately fractional. It may also overhang the map edge.
    for (const collider of [
      [72.5, 96, 48, 24],
      [72, 96, 48.5, 24],
      [-1, 96, 48, 24],
      [8553.4, 8273.8, 109.2, 46.2, 2],
    ]) {
      expect(
        parseServerMessage(JSON.stringify(welcome([event({ harvest: { ...intact, collider } })]))),
      ).not.toBeNull();
    }
    expect(
      parseServerMessage(
        JSON.stringify(
          welcome([
            event({
              harvest: {
                ...intact,
                collider: [Number.MAX_SAFE_INTEGER + 1, 96, 48, 24],
              },
            }),
          ]),
        ),
      ),
    ).toBeNull();
    for (const elevation of [0, 1.5, 4]) {
      expect(
        parseServerMessage(
          JSON.stringify(
            welcome([event({ harvest: { ...intact, collider: [72, 96, 48, 24, elevation] } })]),
          ),
        ),
      ).toBeNull();
    }
    expect(
      parseServerMessage(
        JSON.stringify(
          welcome([event({ harvest: { ...intact, collider: [72, 96, 48, 24, 1, 2] } })]),
        ),
      ),
    ).toBeNull();
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

  it("validates the optional RGB graphic tint while accepting legacy omission", () => {
    expect(
      parseServerMessage(JSON.stringify(welcome([event({ graphicTint: 0x7c3aed })]))),
    ).not.toBeNull();
    expect(
      parseServerMessage(JSON.stringify(welcome([event({ graphicTint: undefined })]))),
    ).not.toBeNull();
    expect(
      parseServerMessage(JSON.stringify(welcome([event({ graphicTint: 0x1000000 })]))),
    ).toBeNull();
    expect(parseServerMessage(JSON.stringify(welcome([event({ graphicTint: -1 })])))).toBeNull();
  });

  it("drops an event missing onTop or carrying a non-boolean one", () => {
    expect(parseServerMessage(JSON.stringify(welcome([event({ onTop: "yes" })])))).toBeNull();
    expect(
      parseServerMessage(JSON.stringify(delta({ upsert: [event({ onTop: 1 })], remove: [] }))),
    ).toBeNull();
  });

  it("validates the authored movement presentation fields", () => {
    expect(
      parseServerMessage(JSON.stringify(welcome([event({ showMarker: false })]))),
    ).not.toBeNull();
    expect(parseServerMessage(JSON.stringify(welcome([event({ showMarker: "no" })])))).toBeNull();
    expect(parseServerMessage(JSON.stringify(welcome([event({ moveSpeed: -1 })])))).toBeNull();
    expect(parseServerMessage(JSON.stringify(welcome([event({ moveSpeed: 6 })])))).toBeNull();
    expect(parseServerMessage(JSON.stringify(welcome([event({ moveFrequency: 5 })])))).toBeNull();
    expect(
      parseServerMessage(JSON.stringify(welcome([event({ moveAnimation: "yes" })]))),
    ).toBeNull();
    expect(parseServerMessage(JSON.stringify(welcome([event({ directionFixed: 0 })])))).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify(welcome([event({ elevationOffset: 2.25, floating: true })])),
      ),
    ).not.toBeNull();
    expect(
      parseServerMessage(JSON.stringify(welcome([event({ elevationOffset: 16.01 })]))),
    ).toBeNull();
    expect(parseServerMessage(JSON.stringify(welcome([event({ floating: false })])))).toBeNull();
  });

  it("validates authoritative movement-effect deadlines on self state", () => {
    const valid = welcome([]);
    Object.assign(valid.self, {
      serverNow: 1_000,
      movementEffects: [{ kind: "speed_boost", power: 1.35, until: 7_000 }],
    });
    expect(parseServerMessage(JSON.stringify(valid))).not.toBeNull();

    const invalid = welcome([]);
    Object.assign(invalid.self, {
      movementEffects: [{ kind: "double_jump", power: 1.5, until: 7_000 }],
    });
    expect(parseServerMessage(JSON.stringify(invalid))).toBeNull();
  });

  it("drops a delta whose events collection is not an entity delta", () => {
    expect(parseServerMessage(JSON.stringify(delta([event()])))).toBeNull();
    expect(parseServerMessage(JSON.stringify(delta(undefined)))).toBeNull();
  });
});
