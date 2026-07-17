/**
 * What a map IS, as pure rules.
 *
 * This is the only place a map payload becomes collision, and that is the whole point of the file.
 * Terrain now arrives over the wire instead of being imported, so the old guarantee — client and
 * server read the same compile-time constant — has to be replaced by a deliberate one: both sides
 * call `bakeCollision` on the same payload. Two decoders that "should" agree is exactly how
 * prediction becomes unfixable; `step()` carries the same argument about movement, for the same
 * reason.
 */

import type { Rect, TerrainGeometry } from "./game.js";
import { isMonsterSpecies, type MonsterSpecies } from "./game.js";
import { TILE_SIZE, type TileKind, type TileMap } from "./tilemap.js";
import { decodeTileMap } from "./tilemap-codec.js";
import { type EditorAssetId, editorAsset, isEditorAssetId } from "./tiny-swords-catalog.js";

export const ELEMENT_KINDS = ["tree", "bush", "stone"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

export interface MapElement {
  col: number;
  row: number;
  assetId: EditorAssetId;
}

export interface LegacyMapElement {
  col: number;
  row: number;
  kind: ElementKind;
  variant: number;
}

export interface EntryMarker {
  id: string;
  col: number;
  row: number;
}

export interface ExitMarker {
  id: string;
  col: number;
  row: number;
}

export interface MonsterSpawnMarker {
  col: number;
  row: number;
  species: MonsterSpecies;
  patrolRadius: number;
}

/**
 * Functional markers are deliberately not MapElements: they carry no catalogue asset, no
 * footprint and no collision. Entries/exits are spatial anchors whose meaning (destinations)
 * lives in the adventure graph, never here.
 */
export interface MapMarkers {
  entries: readonly EntryMarker[];
  exits: readonly ExitMarker[];
  monsterSpawns: readonly MonsterSpawnMarker[];
}

export const EMPTY_MARKERS: MapMarkers = { entries: [], exits: [], monsterSpawns: [] };

export const MAX_MAP_ENTRIES = 8;
export const MAX_MAP_EXITS = 8;
export const MAX_MAP_MONSTER_SPAWNS = 32;
export const MIN_PATROL_RADIUS = 32;
export const MAX_PATROL_RADIUS = 768;
export const MARKER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export interface MapData {
  blocks: readonly string[];
  elements: readonly MapElement[];
  spawn: { col: number; row: number };
  /** Absent on legacy payloads; parseMapData always fills it (EMPTY_MARKERS when omitted). */
  markers?: MapMarkers;
}

/**
 * The most elements one map may carry. A 100x100 map's blocks alone are ~10.4 KB, so without a
 * cap on the count a few hundred elements push the body past the 32 KiB `/api/maps` limit and 413
 * with no useful message. Enforced on the server (`validateMapInput`) and refused up front by the
 * editor (`applyTool`) so a builder never paints past what will save. Lives beside the shared
 * catalogue lookup because both server and browser read it and neither may import the other.
 */
/** Stable replacements for maps written before catalogue ids existed. */
export const LEGACY_ELEMENT_ASSETS = {
  tree: [
    "resource.terrain-resources-wood-trees.tree3",
    "resource.terrain-resources-wood-trees.tree4",
  ],
  bush: [
    "decoration.terrain-decorations-bushes.bushe1",
    "decoration.terrain-decorations-bushes.bushe2",
    "decoration.terrain-decorations-bushes.bushe3",
    "decoration.terrain-decorations-bushes.bushe4",
  ],
  stone: [
    "decoration.terrain-decorations-rocks.rock1",
    "decoration.terrain-decorations-rocks.rock2",
    "decoration.terrain-decorations-rocks.rock3",
    "decoration.terrain-decorations-rocks.rock4",
  ],
} as const satisfies Readonly<Record<ElementKind, readonly EditorAssetId[]>>;

export const MAX_MAP_ELEMENTS = 400;

export function isElementKind(value: unknown): value is ElementKind {
  return typeof value === "string" && (ELEMENT_KINDS as readonly string[]).includes(value);
}

function parseAnchoredMarkers(
  value: unknown,
  max: number,
  cols: number,
  rows: number,
): { id: string; col: number; row: number }[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const seen = new Set<string>();
  const parsed: { id: string; col: number; row: number }[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const { id, col, row } = raw as Record<string, unknown>;
    if (typeof id !== "string" || !MARKER_ID_PATTERN.test(id) || seen.has(id)) return null;
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) return null;
    const c = col as number;
    const r = row as number;
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    seen.add(id);
    parsed.push({ id, col: c, row: r });
  }
  return parsed;
}

export function parseMapMarkers(value: unknown, cols: number, rows: number): MapMarkers | null {
  if (value === undefined) return EMPTY_MARKERS;
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const entries = parseAnchoredMarkers(record.entries, MAX_MAP_ENTRIES, cols, rows);
  const exits = parseAnchoredMarkers(record.exits, MAX_MAP_EXITS, cols, rows);
  if (!entries || !exits) return null;
  const spawnsRaw = record.monsterSpawns;
  if (!Array.isArray(spawnsRaw) || spawnsRaw.length > MAX_MAP_MONSTER_SPAWNS) return null;
  const monsterSpawns: MonsterSpawnMarker[] = [];
  for (const raw of spawnsRaw) {
    if (typeof raw !== "object" || raw === null) return null;
    const { col, row, species, patrolRadius } = raw as Record<string, unknown>;
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) return null;
    const c = col as number;
    const r = row as number;
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    if (!isMonsterSpecies(species)) return null;
    if (!Number.isSafeInteger(patrolRadius)) return null;
    const radius = patrolRadius as number;
    if (radius < MIN_PATROL_RADIUS || radius > MAX_PATROL_RADIUS) return null;
    monsterSpawns.push({ col: c, row: r, species, patrolRadius: radius });
  }
  return { entries, exits, monsterSpawns };
}

export function legacyElementAssetId(kind: ElementKind, variant: number): EditorAssetId {
  const choices = LEGACY_ELEMENT_ASSETS[kind];
  const index = ((Math.trunc(variant) % choices.length) + choices.length) % choices.length;
  return choices[index] ?? choices[0];
}

/** Where a hero appears: the centre of the map's one spawn cell. */
export function mapSpawnPoint(data: MapData): { x: number; y: number } {
  return {
    x: data.spawn.col * TILE_SIZE + TILE_SIZE / 2,
    y: data.spawn.row * TILE_SIZE + TILE_SIZE / 2,
  };
}

/**
 * A map as the world geometry both sides run on. Shared because the server builds rooms from it
 * and the preview sandbox walks it — one builder, so they cannot disagree.
 */
export function terrainFromMap(data: MapData): TerrainGeometry {
  const tiles = bakeCollision(data);
  const width = tiles.cols * TILE_SIZE;
  const height = tiles.rows * TILE_SIZE;
  const safeZone: Rect = { x: 0, y: 0, width, height };
  return { width, height, obstacles: [], spawnPoints: [mapSpawnPoint(data)], safeZone, tiles };
}

export function canPlaceElement(assetId: EditorAssetId, on: TileKind): boolean {
  const asset = editorAsset(assetId);
  return asset?.editor.allowedTerrain.some((terrain) => terrain === on) ?? false;
}

export function elementCells(
  element: MapElement,
  footprint: "visual" | "collision" = "visual",
): { col: number; row: number }[] {
  const asset = editorAsset(element.assetId);
  if (!asset) return [];
  const offsets =
    footprint === "collision" ? asset.editor.collisionFootprint : asset.editor.visualFootprint;
  return offsets.map((offset) => ({
    col: element.col + offset.col,
    row: element.row + offset.row,
  }));
}

export function elementCoversCell(element: MapElement, col: number, row: number): boolean {
  return elementCells(element).some((cell) => cell.col === col && cell.row === row);
}

/** Cells whose ground type constrains placement. Canopies may overhang shoreline; solid bases and
 * walkable bridge decks must stand on terrain allowed by the catalogue. */
export function elementPlacementCells(element: MapElement): { col: number; row: number }[] {
  const asset = editorAsset(element.assetId);
  if (!asset) return [];
  if (asset.editor.terrainOverride) return elementCells(element);
  const collision = elementCells(element, "collision");
  return collision.length > 0 ? collision : [{ col: element.col, row: element.row }];
}

export function elementFitsMap(element: MapElement, cols: number, rows: number): boolean {
  return elementCells(element).every(
    (cell) => cell.col >= 0 && cell.row >= 0 && cell.col < cols && cell.row < rows,
  );
}

export function elementsOverlap(left: MapElement, right: MapElement): boolean {
  const occupied = new Set(elementCells(left).map((cell) => `${cell.col}:${cell.row}`));
  return elementCells(right).some((cell) => occupied.has(`${cell.col}:${cell.row}`));
}

/**
 * The ground, plus everything standing on it that you bump into.
 *
 * Colliding elements are baked into the tilemap rather than taught to the collision code, so
 * `isWalkableBox`, `step` and `prediction.ts` never learn that elements exist. On the day terrain
 * starts arriving over the wire, exactly one thing changes.
 *
 * A colliding element becomes `forest` — the existing kind for "land you cannot walk through" — and
 * never overwrites water, which is already solid and should keep looking like water underneath.
 */
export function bakeCollision(map: MapData): TileMap {
  const tiles = decodeTileMap(map.blocks);
  const kinds = [...tiles.kinds];
  for (const element of map.elements) {
    const asset = editorAsset(element.assetId);
    if (asset?.editor.terrainOverride !== "walkable") continue;
    for (const cell of elementCells(element)) {
      const index = cell.row * tiles.cols + cell.col;
      if (kinds[index] === "water") kinds[index] = "grass";
    }
  }
  for (const element of map.elements) {
    for (const cell of elementCells(element, "collision")) {
      const index = cell.row * tiles.cols + cell.col;
      if (kinds[index] === "grass") kinds[index] = "forest";
    }
  }
  return { ...tiles, kinds };
}

/**
 * Elements off the wire, checked like the untrusted data they are.
 *
 * Bounds are NOT checked here: the caller knows the map's size and this does not. An element with a
 * silly cell draws nowhere and collides with nothing — collision is already baked into the tiles by
 * the time these arrive — so the shape is what matters.
 */
export function parseMapElements(value: unknown): MapElement[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: MapElement[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const item = raw as Record<string, unknown>;
    const { col, row } = item;
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) return null;
    let assetId: EditorAssetId;
    if (isEditorAssetId(item.assetId)) assetId = item.assetId;
    else if (isElementKind(item.kind) && Number.isSafeInteger(item.variant)) {
      assetId = legacyElementAssetId(item.kind, item.variant as number);
    } else return null;
    parsed.push({ col: col as number, row: row as number, assetId });
  }
  return parsed;
}

/** The only two block characters a map may contain. Everything else is scenery standing on them. */
const BLOCK_CHARS = new Set([".", "#"]);

/**
 * Defensive, exactly like client intent already is.
 *
 * A malformed map that reaches `decodeTileMap` throws on the first paint — a ragged row, an unknown
 * character, an element hanging off the edge. This returns null instead and the frame is dropped.
 * `parseServerMessage` only checks its top level and casts what is nested (known debt, recorded in
 * docs/mmo-migration-plan.md §11); terrain is not a field to extend that habit to.
 */
export function parseMapData(value: unknown): MapData | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { blocks, elements, spawn } = record;

  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const first: unknown = blocks[0];
  if (typeof first !== "string" || first.length === 0) return null;
  const cols = first.length;
  for (const row of blocks) {
    if (typeof row !== "string" || row.length !== cols) return null;
    for (const char of row) if (!BLOCK_CHARS.has(char)) return null;
  }
  const rows = blocks.length;

  const parsed = parseMapElements(elements);
  if (!parsed) return null;
  // Wire compatibility checks the legacy anchor only. New writes receive the stricter full visual
  // footprint validation in server/maps.ts; old edge trees must remain readable.
  for (const element of parsed) {
    if (element.col < 0 || element.col >= cols || element.row < 0 || element.row >= rows)
      return null;
  }

  if (typeof spawn !== "object" || spawn === null) return null;
  const spawnRecord = spawn as Record<string, unknown>;
  const { col: spawnCol, row: spawnRow } = spawnRecord;
  if (!Number.isSafeInteger(spawnCol) || !Number.isSafeInteger(spawnRow)) return null;
  if ((spawnCol as number) < 0 || (spawnCol as number) >= cols) return null;
  if ((spawnRow as number) < 0 || (spawnRow as number) >= rows) return null;

  const markers = parseMapMarkers(record.markers, cols, rows);
  if (!markers) return null;

  return {
    blocks: blocks as string[],
    elements: parsed,
    spawn: { col: spawnCol as number, row: spawnRow as number },
    markers,
  };
}
