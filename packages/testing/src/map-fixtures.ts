/**
 * Block-grid fixtures, projected onto the layered map model.
 *
 * Most of this suite predates tile layers and describes its terrain as `"#..#"` strings, which is
 * still the clearest way to write a 20x15 room in a test. These helpers are the one place that
 * projection happens, and it delegates to `layersFromBlocks` — the same function the editor and the
 * D1 migration use — so a fixture cannot resolve its autotile edges differently from real content.
 *
 * `#` is water (an empty ground cell, solid), everything else is grass.
 */
import type { MapData, MapElement, MapMarkers } from "@lindocara/engine/map-data.js";
import { layersFromBlocks } from "@lindocara/engine/map-migrate.js";
import { emptyLayer, encodeTileLayer, type TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";

/** The size and terrain half of a `MapInput`, ready to spread. */
export function layeredTerrain(blocks: readonly string[]): {
  tilesetId: string;
  cols: number;
  rows: number;
  layers: TileLayer[];
} {
  const { cols, rows, layers } = layersFromBlocks(blocks);
  return { tilesetId: TINY_SWORDS_TILESET_ID, cols, rows, layers };
}

/** The same, encoded the way an HTTP body carries it. */
export function layeredWireTerrain(blocks: readonly string[]): {
  tilesetId: string;
  cols: number;
  rows: number;
  layers: string[];
} {
  const terrain = layeredTerrain(blocks);
  return { ...terrain, layers: terrain.layers.map(encodeTileLayer) };
}

/** A whole `MapData` from a block grid — the fixture shape `bakeCollision`/`terrainFromMap` want. */
export function mapDataFromBlocks(input: {
  blocks: readonly string[];
  elements: readonly MapElement[];
  spawn: { col: number; row: number };
  markers?: MapMarkers | undefined;
}): MapData {
  const base = {
    ...layeredTerrain(input.blocks),
    elements: input.elements,
    spawn: input.spawn,
  };
  return input.markers ? { ...base, markers: input.markers } : base;
}

/**
 * A minimal, valid `welcome` server message — the shape `isWorldInfo`/`parseServerMessage` accept
 * — with `worldOverrides` shallow-merged onto `world`. Shared by engine/server tests so each one
 * asserts on the one field it cares about instead of re-typing the whole message by hand. Left
 * untyped on purpose: a test overriding a field with a deliberately invalid value (to prove a
 * frame gets rejected) must still be able to pass it through.
 */
export function welcomeFixture(worldOverrides: Record<string, unknown> = {}) {
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
      heightfield: null,
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
      ...worldOverrides,
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
