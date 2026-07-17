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
import { asc, eq, sql } from "drizzle-orm";
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
  MAX_MAP_ELEMENTS,
  type MapData,
  type MapElement,
  type MapMarkers,
  parseMapMarkers,
} from "../shared/map-data.js";
import { isSolidKind, kindAt } from "../shared/tilemap.js";
import { isEditorAssetId } from "../shared/tiny-swords-catalog.js";
import { adventureMap, type Db, map, mapElement } from "./db/index.js";

export const BUILTIN_MAP_ID = "builtin";

export interface StoredMap extends MapData {
  id: string;
  name: string;
}

/**
 * The floor. Not a map you can list, edit or delete — the thing that exists so the world can always
 * start.
 *
 * Reachable only on an empty database: `deleteMap` refuses the last map, so nobody can delete their
 * way down to zero. This is the fresh-install case, not a delete outcome.
 */
export const BUILTIN_MAP: StoredMap = {
  id: BUILTIN_MAP_ID,
  name: "Nowhere",
  blocks: [
    "################",
    "#..............#",
    "#..............#",
    "#....######....#",
    "#....######....#",
    "#..............#",
    "#..............#",
    "################",
  ],
  elements: [],
  spawn: { col: 2, row: 2 },
  markers: EMPTY_MARKERS,
};

export interface MapInput {
  name: string;
  blocks: readonly string[];
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

/** Stored newline-joined; `decodeTileMap` wants one string per row. One format, two shapes. */
function encodeBlocks(blocks: readonly string[]): string {
  return blocks.join("\n");
}

function decodeBlocks(blocks: string): string[] {
  return blocks.split("\n");
}

/** NULL rather than an empty-array JSON string: legacy rows and freshly-emptied ones both read
 *  back as EMPTY_MARKERS via `storedMarkers`, so the column stays NULL until a map actually has
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
  const cols = input.blocks[0]?.length ?? 0;
  const rows = input.blocks.length;
  if (cols < MAP_MIN_COLS || cols > MAP_MAX_COLS || rows < MAP_MIN_ROWS || rows > MAP_MAX_ROWS) {
    throw new Error(`size: ${MAP_MIN_COLS}x${MAP_MIN_ROWS} to ${MAP_MAX_COLS}x${MAP_MAX_ROWS}`);
  }
  if (input.elements.length > MAX_MAP_ELEMENTS) {
    // Caught here, before the body would silently blow past the 32 KiB `/api/maps` cap and 413.
    throw new Error(`elements: at most ${MAX_MAP_ELEMENTS}`);
  }
  const data: MapData = { blocks: input.blocks, elements: input.elements, spawn: input.spawn };
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

/** Corrupt or unknown JSON degrades to empty, like `elementsOf` drops unknown element kinds
 *  rather than failing the whole map. */
function storedMarkers(row: typeof map.$inferSelect): MapMarkers {
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
    name: row.name,
    blocks: decodeBlocks(row.blocks),
    elements,
    spawn: { col: row.spawnCol, row: row.spawnRow },
    markers: storedMarkers(row),
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

export async function listMaps(db: Db): Promise<{ id: string; name: string; isFirst: boolean }[]> {
  const rows = await db.select().from(map).orderBy(asc(map.createdAt));
  return rows.map((row) => ({ id: row.id, name: row.name, isFirst: row.isFirst === 1 }));
}

export async function firstMap(db: Db): Promise<StoredMap | null> {
  const [row] = await db.select().from(map).where(eq(map.isFirst, 1)).limit(1);
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

export async function createMap(db: Db, input: MapInput): Promise<StoredMap> {
  const data = validateMapInput(input);
  const id = crypto.randomUUID();
  const first = blocksFirstRow(input.blocks);
  const insertMap = db.insert(map).values({
    id,
    name: data.name,
    cols: first.length,
    rows: input.blocks.length,
    blocks: encodeBlocks(input.blocks),
    spawnCol: input.spawn.col,
    spawnRow: input.spawn.row,
    markers: markersJson(data.markers),
    // The front door is decided by the database at insert time, never by a read-then-write: the very
    // first row to exist wins. Two concurrent creates on an empty table cannot both flag themselves,
    // because SQLite serializes the writes and the second's CASE sees the first's committed row.
    isFirst: sql`CASE WHEN (SELECT count(*) FROM ${map}) = 0 THEN 1 ELSE 0 END`,
  });
  if (input.elements.length > 0) {
    // One transaction: the map and its scenery arrive together, never a map with no elements yet that
    // a room could load mid-create.
    await db.batch([insertMap, db.insert(mapElement).values(elementRows(id, input.elements))]);
  } else {
    await insertMap;
  }
  return { id, ...data };
}

function blocksFirstRow(blocks: readonly string[]): string {
  const first = blocks[0];
  if (first === undefined) throw new Error("placement: a map needs at least one row");
  return first;
}

export async function updateMap(db: Db, id: string, input: MapInput): Promise<StoredMap> {
  const data = validateMapInput(input);
  const existing = await loadMap(db, id);
  if (!existing) throw new Error("not_found: no such map");
  const first = blocksFirstRow(input.blocks);
  const updateRow = db
    .update(map)
    .set({
      name: data.name,
      cols: first.length,
      rows: input.blocks.length,
      blocks: encodeBlocks(input.blocks),
      spawnCol: input.spawn.col,
      spawnRow: input.spawn.row,
      markers: markersJson(data.markers),
      updatedAt: new Date(),
    })
    .where(eq(map.id, id));
  // Replace wholesale (diffing would only be a slower way to reach the same rows), but as ONE
  // transaction: the new blocks and the new elements land together, so a room admitted mid-update can
  // never load the new terrain paired with the old — or zero — elements.
  const clearElements = db.delete(mapElement).where(eq(mapElement.mapId, id));
  if (input.elements.length > 0) {
    await db.batch([
      updateRow,
      clearElements,
      db.insert(mapElement).values(elementRows(id, input.elements)),
    ]);
  } else {
    await db.batch([updateRow, clearElements]);
  }
  return { id, ...data };
}

/**
 * Hand the front-door flag to a chosen map. Exactly one map carries it, before and after — the
 * clear and the set are one `db.batch`, so a crash between them cannot leave zero maps flagged.
 */
export async function setFirstMap(db: Db, id: string): Promise<void> {
  const [row] = await db.select().from(map).where(eq(map.id, id)).limit(1);
  if (!row) throw new Error("not_found: no such map");
  await db.batch([
    db.update(map).set({ isFirst: 0 }).where(eq(map.isFirst, 1)),
    db.update(map).set({ isFirst: 1 }).where(eq(map.id, id)),
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
export async function deleteMap(db: Db, id: string): Promise<void> {
  const [row] = await db.select().from(map).where(eq(map.id, id)).limit(1);
  if (!row) throw new Error("not_found: no such map");

  const used = await db
    .select({ adventureId: adventureMap.adventureId })
    .from(adventureMap)
    .where(eq(adventureMap.mapId, id))
    .limit(1);
  if (used.length > 0) throw new Error("referenced: an adventure still uses this map");

  const results = await db.$client.batch([
    // Hand the flag to the earliest survivor, but only when this row is the one carrying it and a
    // survivor exists — the guard on `count(*) > 1` keeps it in step with the delete below.
    db.$client
      .prepare(
        `UPDATE map SET is_first = 1
           WHERE id = (SELECT id FROM map WHERE id <> ? ORDER BY created_at ASC, id ASC LIMIT 1)
             AND (SELECT is_first FROM map WHERE id = ?) = 1
             AND (SELECT count(*) FROM map) > 1`,
      )
      .bind(id, id),
    db.$client
      .prepare(`DELETE FROM map_element WHERE map_id = ? AND (SELECT count(*) FROM map) > 1`)
      .bind(id),
    db.$client.prepare(`DELETE FROM map WHERE id = ? AND (SELECT count(*) FROM map) > 1`).bind(id),
  ]);
  // The guard on the final DELETE refused it: this was the last map, and nothing in the batch changed.
  if ((results[2]?.meta.changes ?? 0) === 0) {
    throw new Error("last_map: the world needs somewhere to be");
  }
}

/**
 * Where this character actually goes. Never throws: a hero with a broken location still has to be
 * able to log in.
 *
 * Their own map, or the front door, or — only on an empty database — the built-in floor.
 */
export async function resolveMapFor(db: Db, zoneId: string): Promise<StoredMap> {
  const own = await loadMap(db, zoneId);
  if (own) return own;
  const first = await firstMap(db);
  if (first) return first;
  return BUILTIN_MAP;
}
