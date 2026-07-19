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

import type { TerrainGeometry } from "./game.js";
import { isMonsterSpecies, type MonsterSpecies } from "./game.js";
import { parseTileLayer, type TileLayer } from "./tile-layer-codec.js";
import { TILE_SIZE, type TileKind, type TileMap } from "./tilemap.js";
import { decodeTileId, EMPTY_TILE, type Tileset, tileIdInTileset } from "./tileset.js";
import { tilesetById } from "./tilesets/tiny-swords.js";
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
  label?: string;
  col: number;
  row: number;
}

export interface ExitMarker {
  id: string;
  label?: string;
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
 * QUARANTINED (UX wave #12 / Task 5): markers are dead. Entries, exits and monster spawns are now
 * typed EVENTS (`kind` on `MapEvent`), read by the runtime and bound by the adventure graph. These
 * types and their parser survive only so the `map.markers` column keeps decoding without a throw and
 * the one-shot migration can read old rows; nothing functional reads a marker any more. Do not add a
 * new marker — add an event kind. See `docs/superpowers/plans/2026-07-19-ux-wave.md` Task 5.
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
export const MARKER_LABEL_MAX = 48;

export const MAP_LAYERS = 3;

export interface MapData {
  tilesetId: string;
  cols: number;
  rows: number;
  /** Exactly `MAP_LAYERS`. Index 0 is the ground; an empty ground cell is the void. */
  layers: readonly TileLayer[];
  elements: readonly MapElement[];
  spawn: { col: number; row: number };
  /** Absent on legacy payloads; parseMapData always fills it (EMPTY_MARKERS when omitted). */
  markers?: MapMarkers;
}

/**
 * The most elements one map may carry. Independent of the layer/body byte cap
 * (`MAX_MAP_JSON_BYTES` in `server/index.ts`, sized against the tile layers, not this): a run-length
 * layer already dominates that cap on its own, but leaving the element count unbounded would still
 * let a few thousand elements push a legitimate body past it with no useful message. Enforced on
 * the server (`validateMapInput`) and refused up front by the editor (`applyTool`) so a builder
 * never paints past what will save. Lives beside the shared catalogue lookup because both server
 * and browser read it and neither may import the other.
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
): { id: string; label?: string; col: number; row: number }[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const seen = new Set<string>();
  const parsed: { id: string; label?: string; col: number; row: number }[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const { id, label, col, row } = raw as Record<string, unknown>;
    if (typeof id !== "string" || !MARKER_ID_PATTERN.test(id) || seen.has(id)) return null;
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) return null;
    const c = col as number;
    const r = row as number;
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    if (label !== undefined && typeof label !== "string") return null;
    const normalizedLabel = typeof label === "string" ? label.trim() : "";
    if (normalizedLabel.length > MARKER_LABEL_MAX) return null;
    seen.add(id);
    parsed.push(
      normalizedLabel.length > 0
        ? { id, label: normalizedLabel, col: c, row: r }
        : { id, col: c, row: r },
    );
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
  // No safe zone: an authored map has no way to declare one, and `monster-system` reads that rect
  // as "monsters may not touch a player here". Declaring the whole map safe — as this used to —
  // made every placed monster permanently harmless on the only maps a hero can play. Spawn
  // protection on an authored map is the author's job: place spawns away from the entry.
  return {
    width,
    height,
    obstacles: [],
    spawnPoints: [mapSpawnPoint(data)],
    safeZone: null,
    tiles,
  };
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

/** Whether a tile blocks movement, resolved through the tileset. An empty cell blocks nothing —
 *  on the ground layer it is the void, which the ground pass has already called water. */
function tileBlocks(tileset: Tileset, id: number): boolean {
  const ref = decodeTileId(id);
  if (ref.kind === "empty") return false;
  const entry = ref.kind === "autotile" ? tileset.autotiles[ref.slot] : tileset.fixed[ref.index];
  // An id no tileset entry answers for is treated as solid: an unknown obstacle you cannot walk
  // into is recoverable, an invisible hole you fall through is not.
  return entry ? !entry.passable : true;
}

/**
 * The ground, plus everything standing on it that you bump into.
 *
 * Unchanged in meaning from the `blocks` era: colliding things are baked into the tilemap rather
 * than taught to the collision code, so `isWalkableBox`, `step` and `prediction.ts` never learn
 * that layers or elements exist. Only the input changed.
 */
export function bakeCollision(map: MapData): TileMap {
  const tileset = tilesetById(map.tilesetId);
  const cells = map.cols * map.rows;
  const kinds: TileKind[] = new Array<TileKind>(cells).fill("water");
  const ground = map.layers[0];
  for (let index = 0; index < cells; index += 1) {
    const id = ground?.ids[index] ?? EMPTY_TILE;
    kinds[index] = id === EMPTY_TILE ? "water" : "grass";
  }
  for (const layer of map.layers) {
    for (let index = 0; index < cells; index += 1) {
      const id = layer.ids[index] ?? EMPTY_TILE;
      if (id === EMPTY_TILE) continue;
      // No tileset means no entry can answer for any id, so every drawn tile is solid — the same
      // fail-closed posture `tileBlocks` takes one level down. Skipping the sweep instead would
      // make an unknown-tileset map entirely walkable, which is the invisible-hole failure.
      if (!tileset || tileBlocks(tileset, id)) kinds[index] = "forest";
    }
  }
  const tiles: TileMap = { cols: map.cols, rows: map.rows, kinds };
  return bakeElements(tiles, map.elements);
}

/** The element pass, unchanged: walkable overrides reclaim water, collision footprints become
 *  forest. Split out only so `bakeCollision` reads as two steps rather than four loops. */
function bakeElements(tiles: TileMap, elements: readonly MapElement[]): TileMap {
  const kinds = [...tiles.kinds];
  for (const element of elements) {
    const asset = editorAsset(element.assetId);
    if (asset?.editor.terrainOverride !== "walkable") continue;
    // Deliberate: a walkable override reclaims only "water", never a tile-authored solid. A bridge
    // over water still works, because water is an empty ground cell. A bridge laid across a cliff
    // face stays impassable. Accepted for this tranche rather than an oversight: letting scenery
    // punch through authored terrain would make a cliff wall — the whole point of the layered
    // model — cancellable by dropping one element on it. Revisit only with an explicit
    // "overrides terrain" asset flag, not by widening this condition.
    for (const cell of elementCells(element)) {
      const index = cell.row * tiles.cols + cell.col;
      if (kinds[index] === "water") kinds[index] = "grass";
    }
  }
  for (const element of elements) {
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

/**
 * Defensive, exactly like client intent already is.
 *
 * A malformed map that reaches the renderer throws on the first paint — a short layer, an unknown
 * tileset, a spawn off the edge. This returns null instead and the frame is dropped.
 */
export function parseMapData(value: unknown): MapData | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { tilesetId, cols, rows, layers, elements, spawn } = record;

  if (typeof tilesetId !== "string") return null;
  const tileset = tilesetById(tilesetId);
  if (!tileset) return null;
  if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows)) return null;
  const width = cols as number;
  const height = rows as number;
  if (width <= 0 || height <= 0) return null;

  if (!Array.isArray(layers) || layers.length !== MAP_LAYERS) return null;
  const parsedLayers: TileLayer[] = [];
  for (const raw of layers) {
    const layer = parseTileLayer(raw, width, height);
    if (!layer) return null;
    // `parseTileLayer` only knows the id SHAPE (a safe integer); it has no tileset to check the id
    // against. An id no autotile slot or fixed-tile index in THIS tileset can answer for is refused
    // here rather than silently baked as solid terrain later by `tileBlocks`.
    if (layer.ids.some((id) => !tileIdInTileset(tileset, id))) return null;
    parsedLayers.push(layer);
  }

  const parsed = parseMapElements(elements);
  if (!parsed) return null;
  for (const element of parsed) {
    if (element.col < 0 || element.col >= width || element.row < 0 || element.row >= height)
      return null;
  }

  if (typeof spawn !== "object" || spawn === null) return null;
  const spawnRecord = spawn as Record<string, unknown>;
  const { col: spawnCol, row: spawnRow } = spawnRecord;
  if (!Number.isSafeInteger(spawnCol) || !Number.isSafeInteger(spawnRow)) return null;
  if ((spawnCol as number) < 0 || (spawnCol as number) >= width) return null;
  if ((spawnRow as number) < 0 || (spawnRow as number) >= height) return null;

  const markers = parseMapMarkers(record.markers, width, height);
  if (!markers) return null;

  return {
    tilesetId,
    cols: width,
    rows: height,
    layers: parsedLayers,
    elements: parsed,
    spawn: { col: spawnCol as number, row: spawnRow as number },
    markers,
  };
}
