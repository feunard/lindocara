/**
 * Maps as stored things: load, create, delete, and the rules that keep the world enterable.
 *
 * Two of those rules exist only to make sure a hero always has somewhere to stand:
 *
 * - you cannot delete the last map, so nobody can empty the world by clicking delete enough times;
 * - the `is_first` flag names where a hero lands when their own map is gone, and deleting the
 *   flagged map hands the flag to a survivor rather than leaving the world without a front door.
 *
 * Placement and spawn validation live here rather than in the browser because the editor is open to
 * any logged-in player. The API is the only place these can actually be enforced.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  type AdventureGraph,
  parseAdventureGraph,
  validateAdventure,
} from "../shared/adventure.js";
import {
  bakeCollision,
  canPlaceElement,
  EMPTY_MARKERS,
  elementCoversCell,
  elementFitsMap,
  elementPlacementCells,
  elementsOverlap,
  isElementKind,
  legacyElementAssetId,
  MAP_LAYERS,
  MAX_MAP_ELEMENTS,
  type MapData,
  type MapElement,
  type MapMarkers,
  parseMapMarkers,
} from "../shared/map-data.js";
import { layersFromBlocks } from "../shared/map-migrate.js";
import {
  emptyLayer,
  encodeTileLayer,
  parseTileLayer,
  type TileLayer,
} from "../shared/tile-layer-codec.js";
import { isSolidKind, kindAt } from "../shared/tilemap.js";
import { tileIdInTileset } from "../shared/tileset.js";
import { TINY_SWORDS_TILESET_ID, tilesetById } from "../shared/tilesets/tiny-swords.js";
import { isEditorAssetId } from "../shared/tiny-swords-catalog.js";
import { adventure, adventureMap, type Db, map, mapElement } from "./db/index.js";

export const BUILTIN_MAP_ID = "builtin";

export interface StoredMap extends MapData {
  id: string;
  accountId: string | null;
  name: string;
  revision: number;
}

/**
 * The floor. Not a map you can list, edit or delete — the thing that exists so the world can always
 * start.
 *
 * Reachable only on an empty database: `deleteMap` refuses the last map, so nobody can delete their
 * way down to zero. This is the fresh-install case, not a delete outcome.
 */
const BUILTIN_BLOCKS = [
  "################",
  "#..............#",
  "#..............#",
  "#....######....#",
  "#....######....#",
  "#..............#",
  "#..............#",
  "################",
];

const BUILTIN_LAYERS = layersFromBlocks(BUILTIN_BLOCKS);

/** Deliberately 16x8 — below `MAP_MIN_*`, so it could never pass `validateMapInput`. It is the
 *  fallback room, not authored content. */
export const BUILTIN_MAP: StoredMap = {
  id: BUILTIN_MAP_ID,
  accountId: null,
  name: "Nowhere",
  revision: 1,
  tilesetId: TINY_SWORDS_TILESET_ID,
  cols: BUILTIN_LAYERS.cols,
  rows: BUILTIN_LAYERS.rows,
  layers: BUILTIN_LAYERS.layers,
  elements: [],
  spawn: { col: 2, row: 2 },
  markers: EMPTY_MARKERS,
};

export interface MapInput {
  name: string;
  tilesetId: string;
  cols: number;
  rows: number;
  layers: readonly TileLayer[];
  elements: readonly MapElement[];
  spawn: { col: number; row: number };
  // `| undefined` (not just `?:`) so forwarding an already-optional `MapData.markers` read, or a
  // test's explicit `markers: undefined`, type-checks under `exactOptionalPropertyTypes`.
  markers?: MapMarkers | undefined;
}

/** A map small enough to fit on screen is also small enough to be a maze of one-tile corridors;
 *  a map large enough to blow up storage and network payloads is not a design choice worth
 *  allowing. Both ends are enforced on write, not in the editor. */
export const MAP_MIN_COLS = 20;
export const MAP_MAX_COLS = 100;
export const MAP_MIN_ROWS = 15;
export const MAP_MAX_ROWS = 100;
export const MAP_NAME_MAX = 48;

/** Stored as a JSON array of run-length encoded layer strings — one column, three layers, and no
 *  second encoding for `tile-layer-codec.ts` to keep in step with. */
function encodeLayers(layers: readonly TileLayer[]): string {
  return JSON.stringify(layers.map(encodeTileLayer));
}

function blankLayers(cols: number, rows: number): TileLayer[] {
  return [emptyLayer(cols, rows), emptyLayer(cols, rows), emptyLayer(cols, rows)];
}

function warnCorruptLayers(mapId: string, reason: string): void {
  console.warn(JSON.stringify({ event: "map_layers_corrupt", mapId, reason }));
}

/** Never throws: a row written by an older build, or corrupted, degrades rather than failing
 *  every map the account owns. The degrade is NOT a blank *playable* map — an all-`EMPTY_TILE`
 *  ground layer bakes to all-`"water"` (`bakeCollision` in `shared/map-data.ts`), `isSolidKind`
 *  calls water solid, and `terrainFromMap` hands `World` a room whose spawn point sits on solid
 *  terrain. A hero routed there arrives stuck, with nothing in the protocol to explain why. The
 *  `console.warn` naming the map id is the only diagnostic signal that exists for this today. */
function decodeLayers(mapId: string, text: string, cols: number, rows: number): TileLayer[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    warnCorruptLayers(mapId, "invalid_json");
    return blankLayers(cols, rows);
  }
  if (!Array.isArray(raw) || raw.length !== MAP_LAYERS) {
    warnCorruptLayers(mapId, "wrong_layer_count");
    return blankLayers(cols, rows);
  }
  return raw.map((entry, index) => {
    const layer = parseTileLayer(entry, cols, rows);
    if (!layer) {
      warnCorruptLayers(mapId, `layer_${index}_malformed`);
      return emptyLayer(cols, rows);
    }
    return layer;
  });
}

/** NULL rather than an empty-array JSON string: legacy rows and freshly-emptied ones both read
 *  back as EMPTY_MARKERS via `markersOfRow`, so the column stays NULL until a map actually has
 *  markers worth persisting. */
function markersJson(markers: MapMarkers | undefined): string | null {
  if (
    !markers ||
    (markers.entries.length === 0 &&
      markers.exits.length === 0 &&
      markers.monsterSpawns.length === 0)
  ) {
    return null;
  }
  return JSON.stringify(markers);
}

/**
 * Rejects a map nobody could play before it reaches the database.
 *
 * A tree in the sea and a spawn inside a tree are the same class of bug: a map that loads fine and
 * is simply wrong. Both are cheap to check here and impossible to notice later.
 */
export function validateMapInput(input: MapInput): MapData & { name: string } {
  const name = input.name.trim();
  if (name.length === 0 || name.length > MAP_NAME_MAX) {
    throw new Error("name: 1-48 characters");
  }
  const { cols, rows } = input;
  if (cols < MAP_MIN_COLS || cols > MAP_MAX_COLS || rows < MAP_MIN_ROWS || rows > MAP_MAX_ROWS) {
    throw new Error(`size: ${MAP_MIN_COLS}x${MAP_MIN_ROWS} to ${MAP_MAX_COLS}x${MAP_MAX_ROWS}`);
  }
  if (input.layers.length !== MAP_LAYERS) {
    throw new Error(`layers: exactly ${MAP_LAYERS} required`);
  }
  for (const layer of input.layers) {
    if (layer.cols !== cols || layer.rows !== rows) {
      throw new Error("layers: every layer must match the map size");
    }
    if (layer.ids.length !== cols * rows) {
      throw new Error("layers: every layer's ids must match cols x rows");
    }
  }
  const tileset = tilesetById(input.tilesetId);
  if (!tileset) {
    throw new Error(`tileset: unknown tileset ${input.tilesetId}`);
  }
  for (const layer of input.layers) {
    // Mirrors the wire-side check in `parseMapData` (shared/map-data.ts): an id no autotile slot or
    // fixed-tile index in this tileset can answer for must be refused here, not baked as solid
    // terrain by `bakeCollision` below with no diagnostic anyone could see.
    if (layer.ids.some((id) => !tileIdInTileset(tileset, id))) {
      throw new Error(`layers: contains an id unknown to tileset ${input.tilesetId}`);
    }
  }
  if (input.elements.length > MAX_MAP_ELEMENTS) {
    // Caught here, before the body would silently blow past the 32 KiB `/api/maps` cap and 413.
    throw new Error(`elements: at most ${MAX_MAP_ELEMENTS}`);
  }
  const data: MapData = {
    tilesetId: input.tilesetId,
    cols,
    rows,
    layers: input.layers,
    elements: input.elements,
    spawn: input.spawn,
  };
  const ground = bakeCollision({ ...data, elements: [] });
  for (const [index, element] of input.elements.entries()) {
    if (!isEditorAssetId(element.assetId)) {
      throw new Error(`placement: unknown asset ${String(element.assetId)}`);
    }
    if (!elementFitsMap(element, ground.cols, ground.rows)) {
      throw new Error(`placement: ${element.assetId} exceeds map bounds`);
    }
    for (const cell of elementPlacementCells(element)) {
      const under = kindAt(ground, cell.col, cell.row);
      if (!canPlaceElement(element.assetId, under)) {
        throw new Error(`placement: ${element.assetId} cannot stand on ${under}`);
      }
    }
    if (elementCoversCell(element, input.spawn.col, input.spawn.row)) {
      throw new Error("spawn: cannot be covered by scenery");
    }
    if (input.elements.slice(0, index).some((other) => elementsOverlap(other, element))) {
      throw new Error(`placement: ${element.assetId} overlaps another element`);
    }
  }
  const baked = bakeCollision(data);
  if (isSolidKind(kindAt(baked, input.spawn.col, input.spawn.row))) {
    throw new Error("spawn: must be a cell a hero can stand on");
  }
  const markers = parseMapMarkers(input.markers, baked.cols, baked.rows);
  if (!markers) throw new Error("markers: malformed marker payload");
  const walkable = (col: number, row: number) => !isSolidKind(kindAt(baked, col, row));
  for (const entry of markers.entries) {
    if (!walkable(entry.col, entry.row))
      throw new Error(`markers: entry ${entry.id} must stand on walkable ground`);
  }
  const blockedCells = new Set(markers.entries.map((m) => `${m.col},${m.row}`));
  blockedCells.add(`${input.spawn.col},${input.spawn.row}`);
  for (const exit of markers.exits) {
    if (!walkable(exit.col, exit.row))
      throw new Error(`markers: exit ${exit.id} must stand on walkable ground`);
    if (blockedCells.has(`${exit.col},${exit.row}`)) {
      throw new Error(`markers: exit ${exit.id} may not share a cell with the spawn or an entry`);
    }
  }
  for (const spawn of markers.monsterSpawns) {
    if (!walkable(spawn.col, spawn.row))
      throw new Error("markers: monster spawns must stand on walkable ground");
  }
  // Trimmed, not raw: the name that passed validation is the name that gets stored.
  return { ...data, markers, name };
}

/** Corrupt or unknown JSON degrades the whole blob to empty, unlike `elementsOf`, which drops only
 *  the individual bad rows and keeps the rest of the map. */
export function markersOfRow(row: {
  markers: string | null;
  cols: number;
  rows: number;
}): MapMarkers {
  if (!row.markers) return EMPTY_MARKERS;
  try {
    return parseMapMarkers(JSON.parse(row.markers), row.cols, row.rows) ?? EMPTY_MARKERS;
  } catch {
    return EMPTY_MARKERS;
  }
}

function toStoredMap(row: typeof map.$inferSelect, elements: MapElement[]): StoredMap {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    revision: row.revision,
    tilesetId: row.tilesetId,
    cols: row.cols,
    rows: row.rows,
    layers: decodeLayers(row.id, row.layers, row.cols, row.rows),
    elements,
    spawn: { col: row.spawnCol, row: row.spawnRow },
    markers: markersOfRow(row),
  };
}

async function elementsOf(db: Db, mapId: string): Promise<MapElement[]> {
  const rows = await db.select().from(mapElement).where(eq(mapElement.mapId, mapId));
  return rows.flatMap((row): MapElement[] =>
    isEditorAssetId(row.kind)
      ? [{ col: row.col, row: row.row, assetId: row.kind }]
      : isElementKind(row.kind)
        ? [{ col: row.col, row: row.row, assetId: legacyElementAssetId(row.kind, row.variant) }]
        : // A kind this build does not know is scenery it cannot draw. Drop the element rather than
          // fail the whole map: one bad row must not make a world unenterable.
          [],
  );
}

export async function loadMap(db: Db, id: string): Promise<StoredMap | null> {
  const [row] = await db.select().from(map).where(eq(map.id, id)).limit(1);
  if (!row) return null;
  return toStoredMap(row, await elementsOf(db, id));
}

export async function loadOwnedMap(
  db: Db,
  accountId: string,
  id: string,
): Promise<StoredMap | null> {
  const [row] = await db
    .select()
    .from(map)
    .where(and(eq(map.id, id), eq(map.accountId, accountId)))
    .limit(1);
  if (!row) return null;
  return toStoredMap(row, await elementsOf(db, id));
}

export async function listMaps(
  db: Db,
  accountId: string,
): Promise<
  { id: string; name: string; revision: number; cols: number; rows: number; isFirst: boolean }[]
> {
  const rows = await db
    .select()
    .from(map)
    .where(eq(map.accountId, accountId))
    .orderBy(asc(map.createdAt));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    revision: row.revision,
    cols: row.cols,
    rows: row.rows,
    isFirst: row.isFirst === 1,
  }));
}

export async function firstMap(db: Db, accountId: string): Promise<StoredMap | null> {
  const [row] = await db
    .select()
    .from(map)
    .where(and(eq(map.accountId, accountId), eq(map.isFirst, 1)))
    .limit(1);
  if (!row) return null;
  return toStoredMap(row, await elementsOf(db, row.id));
}

function elementRows(mapId: string, elements: readonly MapElement[]) {
  return elements.map((element) => ({
    mapId,
    col: element.col,
    row: element.row,
    kind: element.assetId,
    variant: 0,
  }));
}

/**
 * D1 refuses any single query bound to more than 100 parameters. A multi-row `INSERT` binds one
 * parameter per column of `elementRows` above — mapId, col, row, kind, variant, five today — so one
 * unchunked statement tops out around `100 / 5` = 20 rows, well under `MAX_MAP_ELEMENTS` (400): a
 * map decorated with more than about twenty elements failed to save entirely, with nothing in
 * `validateMapInput` to catch it first. The chunk size is derived from the real column count rather
 * than a literal row number, so it keeps working if `mapElement` gains a column later, and it
 * targets 60% of the cap rather than sitting on it, so that future growth doesn't immediately
 * regress the headroom back onto the line.
 */
const D1_MAX_BOUND_PARAMETERS = 100;
const MAP_ELEMENT_PARAMS_PER_ROW = 5; // mapId, col, row, kind, variant — mirrors `mapElement` in db/schema.ts
const MAP_ELEMENT_CHUNK_ROWS = Math.floor(
  (D1_MAX_BOUND_PARAMETERS * 0.6) / MAP_ELEMENT_PARAMS_PER_ROW,
);

function chunkRows<T>(rows: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

/** One `INSERT` per chunk so no single statement can cross D1's bound-parameter cap. Every chunk
 *  still rides in the same `db.batch()` call as the rest of the write (see the callers), and D1
 *  treats one `batch()` call as one transaction, so splitting the INSERT here does not create a
 *  window where a map could persist with only some of its elements written. */
function insertElementStatements(db: Db, mapId: string, elements: readonly MapElement[]) {
  return chunkRows(elementRows(mapId, elements), MAP_ELEMENT_CHUNK_ROWS).map((rows) =>
    db.insert(mapElement).values(rows),
  );
}

export async function createMap(db: Db, accountId: string, input: MapInput): Promise<StoredMap> {
  const data = validateMapInput(input);
  const id = crypto.randomUUID();
  const insertMap = db.insert(map).values({
    id,
    accountId,
    name: data.name,
    cols: input.cols,
    rows: input.rows,
    tilesetId: input.tilesetId,
    layers: encodeLayers(input.layers),
    spawnCol: input.spawn.col,
    spawnRow: input.spawn.row,
    markers: markersJson(data.markers),
    // The front door is decided by the database at insert time, never by a read-then-write: the very
    // first row to exist wins. Two concurrent creates on an empty table cannot both flag themselves,
    // because SQLite serializes the writes and the second's CASE sees the first's committed row.
    isFirst: sql`CASE WHEN (SELECT count(*) FROM ${map} WHERE ${map.accountId} = ${accountId}) = 0 THEN 1 ELSE 0 END`,
  });
  const elementStatements = insertElementStatements(db, id, input.elements);
  if (elementStatements.length > 0) {
    // One transaction: the map and its scenery arrive together, never a map with no elements yet that
    // a room could load mid-create. Every element chunk rides in this same batch.
    await db.batch([insertMap, ...elementStatements]);
  } else {
    await insertMap;
  }
  return { id, accountId, revision: 1, ...data };
}

export async function updateMap(
  db: Db,
  accountId: string,
  id: string,
  input: MapInput,
): Promise<StoredMap> {
  const data = validateMapInput(input);
  const existing = await loadOwnedMap(db, accountId, id);
  if (!existing) throw new Error("not_found: no such map");
  const references = await db
    .select({
      id: adventure.id,
      accountId: adventure.accountId,
      title: adventure.title,
      maxPlayers: adventure.maxPlayers,
      graph: adventure.graph,
    })
    .from(adventureMap)
    .innerJoin(adventure, eq(adventureMap.adventureId, adventure.id))
    .where(eq(adventureMap.mapId, id));
  if (references.length > 0) {
    for (const row of references) {
      if (row.accountId !== accountId) {
        throw new Error(`referenced: adventure "${row.title}" belongs to another account`);
      }
      let graph: AdventureGraph | null = null;
      try {
        graph = parseAdventureGraph(JSON.parse(row.graph));
      } catch {
        graph = null;
      }
      if (!graph) throw new Error(`referenced: adventure "${row.title}" has a corrupt graph`);
      const members = await db
        .select({ mapId: adventureMap.mapId })
        .from(adventureMap)
        .where(eq(adventureMap.adventureId, row.id))
        .orderBy(asc(adventureMap.position));
      const mapIds = members.map((member) => member.mapId);
      const markerRows = await db
        .select({ id: map.id, markers: map.markers, cols: map.cols, rows: map.rows })
        .from(map)
        .where(inArray(map.id, mapIds));
      const markersByMap = new Map(
        markerRows.map((markerRow) => {
          const markers =
            markerRow.id === id ? (data.markers ?? EMPTY_MARKERS) : markersOfRow(markerRow);
          return [
            markerRow.id,
            {
              entryIds: markers.entries.map((marker) => marker.id),
              exitIds: markers.exits.map((marker) => marker.id),
            },
          ] as const;
        }),
      );
      try {
        validateAdventure(
          { title: row.title, maxPlayers: row.maxPlayers, mapIds, graph },
          markersByMap,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : "invalid graph";
        throw new Error(`referenced: adventure "${row.title}" would become invalid (${reason})`);
      }
    }
  }
  const updateRow = db
    .update(map)
    .set({
      name: data.name,
      cols: input.cols,
      rows: input.rows,
      tilesetId: input.tilesetId,
      layers: encodeLayers(input.layers),
      spawnCol: input.spawn.col,
      spawnRow: input.spawn.row,
      markers: markersJson(data.markers),
      revision: sql`${map.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(map.id, id), eq(map.accountId, accountId)))
    .returning({ revision: map.revision });
  // Replace wholesale (diffing would only be a slower way to reach the same rows), but as ONE
  // transaction: the new layers and the new elements land together, so a room admitted mid-update can
  // never load the new terrain paired with the old — or zero — elements.
  const clearElements = db.delete(mapElement).where(eq(mapElement.mapId, id));
  const elementStatements = insertElementStatements(db, id, input.elements);
  let updatedRows: { revision: number }[];
  if (elementStatements.length > 0) {
    // Every element chunk rides in this same batch, so a chunked write is exactly as atomic as the
    // single-statement write it replaces (see `insertElementStatements`).
    [updatedRows] = await db.batch([updateRow, clearElements, ...elementStatements]);
  } else {
    [updatedRows] = await db.batch([updateRow, clearElements]);
  }
  const updated = updatedRows[0];
  if (!updated) throw new Error("not_found: map ownership changed mid-update");
  return { id, accountId, revision: updated.revision, ...data };
}

/**
 * Hand the front-door flag to a chosen map. Exactly one map carries it, before and after — the
 * clear and the set are one `db.batch`, so a crash between them cannot leave zero maps flagged.
 */
export async function setFirstMap(db: Db, accountId: string, id: string): Promise<void> {
  const [row] = await db
    .select()
    .from(map)
    .where(and(eq(map.id, id), eq(map.accountId, accountId)))
    .limit(1);
  if (!row) throw new Error("not_found: no such map");
  await db.batch([
    db
      .update(map)
      .set({ isFirst: 0 })
      .where(and(eq(map.accountId, accountId), eq(map.isFirst, 1))),
    db
      .update(map)
      .set({ isFirst: 1 })
      .where(and(eq(map.accountId, accountId), eq(map.id, id))),
  ]);
}

/**
 * Deleting the last map is refused, and deleting the front door moves the flag rather than removing
 * it. Between them, there is always exactly one map flagged and at least one map to flag.
 *
 * Every write is one transaction, each guarded by the same live `count(*)`, so two concurrent deletes
 * of the last two maps cannot both win: SQLite serializes the batches, the second sees the first's
 * committed delete, and `count(*) > 1` refuses it. The heir handover rides in the same transaction,
 * so there is never an instant with the flagged map gone and nothing carrying the flag.
 */
export async function deleteMap(db: Db, accountId: string, id: string): Promise<void> {
  const [row] = await db
    .select()
    .from(map)
    .where(and(eq(map.id, id), eq(map.accountId, accountId)))
    .limit(1);
  if (!row) throw new Error("not_found: no such map");

  const used = await db
    .select({ adventureId: adventureMap.adventureId })
    .from(adventureMap)
    .where(eq(adventureMap.mapId, id))
    .limit(1);
  if (used.length > 0) throw new Error("referenced: an adventure still uses this map");

  const results = await db.$client.batch([
    db.$client
      .prepare(
        `DELETE FROM map_element WHERE map_id = ? AND (SELECT count(*) FROM map WHERE account_id = ?) > 1`,
      )
      .bind(id, accountId),
    db.$client
      .prepare(
        `DELETE FROM map WHERE id = ? AND account_id = ? AND (SELECT count(*) FROM map WHERE account_id = ?) > 1`,
      )
      .bind(id, accountId, accountId),
    // The old first row is gone before its successor is flagged, so the partial UNIQUE index never
    // observes two first maps. A non-first delete leaves the existing flag alone via NOT EXISTS.
    db.$client
      .prepare(
        `UPDATE map SET is_first = 1
           WHERE id = (
             SELECT id FROM map WHERE account_id = ? ORDER BY created_at ASC, id ASC LIMIT 1
           )
             AND NOT EXISTS (
               SELECT 1 FROM map WHERE account_id = ? AND is_first = 1
             )`,
      )
      .bind(accountId, accountId),
  ]);
  // The guarded DELETE refused it: this was the last owned map, and nothing in the batch changed.
  if ((results[1]?.meta.changes ?? 0) === 0) {
    throw new Error("last_map: the world needs somewhere to be");
  }
}

/**
 * Where this character actually goes. Never throws: a hero with a broken location still has to be
 * able to log in.
 *
 * Their own map, or the front door, or — only on an empty database — the built-in floor.
 */
export async function resolveMapFor(db: Db, accountId: string, zoneId: string): Promise<StoredMap> {
  const own = await loadOwnedMap(db, accountId, zoneId);
  if (own) return own;
  const first = await firstMap(db, accountId);
  if (first) return first;
  return BUILTIN_MAP;
}
