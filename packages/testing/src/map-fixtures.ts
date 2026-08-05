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
import { encodeTileLayer, type TileLayer } from "@lindocara/engine/tile-layer-codec.js";
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
