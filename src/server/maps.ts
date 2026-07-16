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
  isElementKind,
  type MapData,
  type MapElement,
} from "../shared/map-data.js";
import { isSolidKind, kindAt } from "../shared/tilemap.js";
import { type Db, map, mapElement } from "./db/index.js";

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
};

export interface MapInput {
  name: string;
  blocks: readonly string[];
  elements: readonly MapElement[];
  spawn: { col: number; row: number };
}

/** Stored newline-joined; `decodeTileMap` wants one string per row. One format, two shapes. */
function encodeBlocks(blocks: readonly string[]): string {
  return blocks.join("\n");
}

function decodeBlocks(blocks: string): string[] {
  return blocks.split("\n");
}

/**
 * Rejects a map nobody could play before it reaches the database.
 *
 * A tree in the sea and a spawn inside a tree are the same class of bug: a map that loads fine and
 * is simply wrong. Both are cheap to check here and impossible to notice later.
 */
export function validateMapInput(input: MapInput): MapData {
  const data: MapData = { blocks: input.blocks, elements: input.elements, spawn: input.spawn };
  const ground = bakeCollision({ ...data, elements: [] });
  for (const element of input.elements) {
    if (!isElementKind(element.kind)) throw new Error(`placement: unknown element ${element.kind}`);
    const under = kindAt(ground, element.col, element.row);
    if (!canPlaceElement(element.kind, under)) {
      throw new Error(`placement: ${element.kind} cannot stand on ${under}`);
    }
  }
  const baked = bakeCollision(data);
  if (isSolidKind(kindAt(baked, input.spawn.col, input.spawn.row))) {
    throw new Error("spawn: must be a cell a hero can stand on");
  }
  return data;
}

function toStoredMap(row: typeof map.$inferSelect, elements: MapElement[]): StoredMap {
  return {
    id: row.id,
    name: row.name,
    blocks: decodeBlocks(row.blocks),
    elements,
    spawn: { col: row.spawnCol, row: row.spawnRow },
  };
}

async function elementsOf(db: Db, mapId: string): Promise<MapElement[]> {
  const rows = await db.select().from(mapElement).where(eq(mapElement.mapId, mapId));
  return rows.flatMap((row): MapElement[] =>
    isElementKind(row.kind)
      ? [{ col: row.col, row: row.row, kind: row.kind, variant: row.variant }]
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

async function countMaps(db: Db): Promise<number> {
  const [row] = await db.select({ total: sql<number>`count(*)` }).from(map);
  return row?.total ?? 0;
}

export async function createMap(db: Db, input: MapInput): Promise<StoredMap> {
  const data = validateMapInput(input);
  const id = crypto.randomUUID();
  const first = blocksFirstRow(input.blocks);
  // The very first map to exist becomes the front door. Nothing else could be.
  const isFirst = (await countMaps(db)) === 0 ? 1 : 0;
  await db.insert(map).values({
    id,
    name: input.name,
    cols: first.length,
    rows: input.blocks.length,
    blocks: encodeBlocks(input.blocks),
    spawnCol: input.spawn.col,
    spawnRow: input.spawn.row,
    isFirst,
  });
  if (input.elements.length > 0) {
    await db.insert(mapElement).values(
      input.elements.map((element) => ({
        mapId: id,
        col: element.col,
        row: element.row,
        kind: element.kind,
        variant: element.variant,
      })),
    );
  }
  return { id, name: input.name, ...data };
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
  await db
    .update(map)
    .set({
      name: input.name,
      cols: first.length,
      rows: input.blocks.length,
      blocks: encodeBlocks(input.blocks),
      spawnCol: input.spawn.col,
      spawnRow: input.spawn.row,
      updatedAt: new Date(),
    })
    .where(eq(map.id, id));
  // Replace wholesale: an edit is a new set of elements, and diffing them would only be a slower
  // way to reach the same rows.
  await db.delete(mapElement).where(eq(mapElement.mapId, id));
  if (input.elements.length > 0) {
    await db.insert(mapElement).values(
      input.elements.map((element) => ({
        mapId: id,
        col: element.col,
        row: element.row,
        kind: element.kind,
        variant: element.variant,
      })),
    );
  }
  return { id, name: input.name, ...data };
}

/**
 * Deleting the last map is refused, and deleting the front door moves the flag rather than removing
 * it. Between them, there is always exactly one map flagged and at least one map to flag.
 */
export async function deleteMap(db: Db, id: string): Promise<void> {
  const [row] = await db.select().from(map).where(eq(map.id, id)).limit(1);
  if (!row) throw new Error("not_found: no such map");
  if ((await countMaps(db)) <= 1) throw new Error("last_map: the world needs somewhere to be");

  if (row.isFirst === 1) {
    // Hand the flag over BEFORE the delete: a moment with no first map is a moment a hero whose own
    // map is gone has nowhere to land.
    const [heir] = await db
      .select()
      .from(map)
      .where(sql`${map.id} <> ${id}`)
      .orderBy(asc(map.createdAt))
      .limit(1);
    if (heir) await db.update(map).set({ isFirst: 1 }).where(eq(map.id, heir.id));
  }
  await db.delete(mapElement).where(eq(mapElement.mapId, id));
  await db.delete(map).where(eq(map.id, id));
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
