/**
 * Adventures: account-owned authored graphs over library maps. This boundary owns the D1 reads
 * and writes; every rule about what a valid adventure IS lives in shared/adventure.ts, and every
 * marker fact comes from the stored map payloads — never from the client's body.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  type AdventureGraph,
  type AdventureInput,
  type MapMarkerIds,
  parseAdventureGraph,
  validateAdventure,
} from "../shared/adventure.js";
import {
  type AdventureRegistry,
  EMPTY_REGISTRY,
  parseAdventureRegistry,
} from "../shared/adventure-state.js";
import { adventure, adventureMap, type Db, map, party } from "./db/index.js";
import { markersOfRow } from "./maps.js";

export interface StoredAdventure {
  id: string;
  accountId: string;
  title: string;
  maxPlayers: number;
  version: number;
  mapIds: string[];
  graph: AdventureGraph;
  registry: AdventureRegistry;
}

/** `''` — the column default and the sentinel for "no registry authored yet" — reads back as
 *  `EMPTY_REGISTRY`. Anything else must be valid JSON that passes `parseAdventureRegistry`; a
 *  corrupt row throws, mirroring `toStored`'s handling of a corrupt `graph` column below. Unlike
 *  `maps.ts`'s `decodeLayers`, this never degrades silently — every write to this column already
 *  goes through `parseAdventureRegistry` (`updateAdventureRegistry`), so corruption here would
 *  mean the write path itself is broken, not that an old/foreign row predates validation. */
function storedRegistry(raw: string): AdventureRegistry {
  if (raw === "") return EMPTY_REGISTRY;
  const registry = parseAdventureRegistry(JSON.parse(raw));
  if (!registry) throw new Error("registry: stored registry is corrupt");
  return registry;
}

async function markerIdsFor(
  db: Db,
  accountId: string,
  mapIds: readonly string[],
): Promise<Map<string, MapMarkerIds>> {
  if (mapIds.length === 0) return new Map();
  const rows = await db
    .select({ id: map.id, markers: map.markers, cols: map.cols, rows: map.rows })
    .from(map)
    .where(and(eq(map.accountId, accountId), inArray(map.id, [...mapIds])));
  const byMap = new Map<string, MapMarkerIds>();
  for (const row of rows) {
    const markers = markersOfRow(row);
    byMap.set(row.id, {
      entryIds: markers.entries.map((m) => m.id),
      exitIds: markers.exits.map((m) => m.id),
    });
  }
  return byMap;
}

function memberRows(adventureId: string, mapIds: readonly string[]) {
  return mapIds.map((mapId, position) => ({ adventureId, mapId, position }));
}

function toStored(row: typeof adventure.$inferSelect, mapIds: string[]): StoredAdventure {
  const graph = parseAdventureGraph(JSON.parse(row.graph));
  if (!graph) throw new Error("graph: stored graph is corrupt");
  return {
    id: row.id,
    accountId: row.accountId,
    title: row.title,
    maxPlayers: row.maxPlayers,
    version: row.version,
    mapIds,
    graph,
    registry: storedRegistry(row.registry),
  };
}

async function ownedRow(db: Db, accountId: string, id: string) {
  const rows = await db.select().from(adventure).where(eq(adventure.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.accountId !== accountId) return null;
  return row;
}

export async function createAdventure(
  db: Db,
  accountId: string,
  input: AdventureInput,
): Promise<StoredAdventure> {
  validateAdventure(input, await markerIdsFor(db, accountId, input.mapIds));
  const id = crypto.randomUUID();
  const row = {
    id,
    accountId,
    title: input.title.trim(),
    maxPlayers: input.maxPlayers,
    graph: JSON.stringify(input.graph),
    // registry omitted: a new adventure always starts from the column DEFAULT '', which reads
    // back as EMPTY_REGISTRY. The database dialog (a later tranche) grows it afterwards via
    // updateAdventureRegistry.
  };
  await db.batch([
    db.insert(adventure).values(row),
    db.insert(adventureMap).values(memberRows(id, input.mapIds)),
  ]);
  const stored = await loadAdventure(db, accountId, id);
  if (!stored) throw new Error("not_found: adventure vanished mid-create");
  return stored;
}

export async function listAdventures(
  db: Db,
  accountId: string,
): Promise<{ id: string; title: string; maxPlayers: number }[]> {
  const rows = await db
    .select({ id: adventure.id, title: adventure.title, maxPlayers: adventure.maxPlayers })
    .from(adventure)
    .where(eq(adventure.accountId, accountId))
    .orderBy(asc(adventure.createdAt));
  return rows;
}

export async function loadAdventure(
  db: Db,
  accountId: string,
  id: string,
): Promise<StoredAdventure | null> {
  const row = await ownedRow(db, accountId, id);
  if (!row) return null;
  const members = await db
    .select({ mapId: adventureMap.mapId })
    .from(adventureMap)
    .where(eq(adventureMap.adventureId, id))
    .orderBy(asc(adventureMap.position));
  return toStored(
    row,
    members.map((m) => m.mapId),
  );
}

export async function updateAdventure(
  db: Db,
  accountId: string,
  id: string,
  input: AdventureInput,
): Promise<StoredAdventure> {
  const row = await ownedRow(db, accountId, id);
  if (!row) throw new Error("not_found: no such adventure");
  validateAdventure(input, await markerIdsFor(db, accountId, input.mapIds));
  await db.batch([
    db
      .update(adventure)
      .set({
        title: input.title.trim(),
        maxPlayers: input.maxPlayers,
        graph: JSON.stringify(input.graph),
        updatedAt: new Date(),
      })
      .where(eq(adventure.id, id)),
    db.delete(adventureMap).where(eq(adventureMap.adventureId, id)),
    db.insert(adventureMap).values(memberRows(id, input.mapIds)),
  ]);
  const stored = await loadAdventure(db, accountId, id);
  if (!stored) throw new Error("not_found: adventure vanished mid-update");
  return stored;
}

/**
 * Replaces an adventure's switch/variable registry. Deleting an entry that a still-authored
 * event page conditions on is ALLOWED — this function does not cross-check the registry against
 * any map's `map_event_page` rows, on purpose. `activePageIndex` (`shared/adventure-state.ts`)
 * already reads an unknown switch/variable id as `false`/`0`, its fail-closed default; a page
 * whose condition id got orphaned this way simply stops holding rather than doing anything
 * unsafe. Cross-checking would also require loading every member map's events on every registry
 * edit for a benefit that is purely cosmetic (an editor warning), so it stays a known gap here,
 * not a validation rule.
 */
export async function updateAdventureRegistry(
  db: Db,
  accountId: string,
  id: string,
  registry: unknown,
): Promise<AdventureRegistry> {
  const row = await ownedRow(db, accountId, id);
  if (!row) throw new Error("not_found: no such adventure");
  const parsed = parseAdventureRegistry(registry);
  if (!parsed) throw new Error("registry: invalid");
  await db
    .update(adventure)
    .set({ registry: JSON.stringify(parsed), updatedAt: new Date() })
    .where(eq(adventure.id, id));
  return parsed;
}

export async function deleteAdventure(db: Db, accountId: string, id: string): Promise<void> {
  const row = await ownedRow(db, accountId, id);
  if (!row) throw new Error("not_found: no such adventure");
  const used = await db
    .select({ partyId: party.id })
    .from(party)
    .where(eq(party.adventureId, id))
    .limit(1);
  if (used.length > 0) throw new Error("referenced: a party still uses this adventure");
  await db.batch([
    db.delete(adventureMap).where(eq(adventureMap.adventureId, id)),
    db.delete(adventure).where(eq(adventure.id, id)),
  ]);
}
