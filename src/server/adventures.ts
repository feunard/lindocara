/**
 * Adventures: account-owned authored graphs over their OWN maps. A map belongs to exactly one
 * adventure (UX wave #5), so membership is implicit — `map.adventure_id` IS the membership, and
 * there is no n-n table any more. This boundary owns the D1 reads and writes; every rule about what
 * a valid adventure IS lives in shared/adventure.ts, and every marker fact comes from the stored map
 * payloads — never from the client's body.
 *
 * A freshly created adventure is an empty draft: no maps, `EMPTY_GRAPH`. Maps are created under it
 * afterward (`createMap`), and the graph is authored through `updateAdventure` once maps exist.
 */
import { asc, eq } from "drizzle-orm";
import {
  type AdventureGraph,
  type AdventureInput,
  type CreateAdventureInput,
  EMPTY_GRAPH,
  type MapMarkerIds,
  parseAdventureGraph,
  validateAdventure,
} from "../shared/adventure.js";
import {
  type AdventureRegistry,
  EMPTY_REGISTRY,
  parseAdventureRegistry,
} from "../shared/adventure-state.js";
import { adventure, type Db, map, party } from "./db/index.js";
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
 *  `EMPTY_REGISTRY`. Anything else must be valid JSON that passes `parseAdventureRegistry`. */
function storedRegistry(raw: string): AdventureRegistry {
  if (raw === "") return EMPTY_REGISTRY;
  const registry = parseAdventureRegistry(JSON.parse(raw));
  if (!registry) throw new Error("registry: stored registry is corrupt");
  return registry;
}

/** Every map the adventure owns (its members), oldest first, with just the columns markers need. */
async function ownedMapRows(db: Db, adventureId: string) {
  return db
    .select({ id: map.id, markers: map.markers, cols: map.cols, rows: map.rows })
    .from(map)
    .where(eq(map.adventureId, adventureId))
    .orderBy(asc(map.createdAt));
}

/** The marker ids of every map the adventure owns — the member set `validateAdventure` checks the
 *  graph against. A graph naming a map outside this set is, by construction, a foreign reference. */
export async function markerIdsFor(
  db: Db,
  adventureId: string,
): Promise<Map<string, MapMarkerIds>> {
  const rows = await ownedMapRows(db, adventureId);
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
  input: CreateAdventureInput,
): Promise<StoredAdventure> {
  const title = input.title.trim();
  if (title.length === 0 || title.length > 48) throw new Error("title: 1-48 characters");
  if (input.maxPlayers < 1 || input.maxPlayers > 4) throw new Error("players: between 1 and 4");
  const id = crypto.randomUUID();
  await db.insert(adventure).values({
    id,
    accountId,
    title,
    maxPlayers: input.maxPlayers,
    graph: JSON.stringify(EMPTY_GRAPH),
    ...(input.registry !== undefined ? { registry: JSON.stringify(input.registry) } : {}),
  });
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
    .select({ id: map.id })
    .from(map)
    .where(eq(map.adventureId, id))
    .orderBy(asc(map.createdAt));
  return toStored(
    row,
    members.map((m) => m.id),
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
  validateAdventure(input, await markerIdsFor(db, id));
  await db
    .update(adventure)
    .set({
      title: input.title.trim(),
      maxPlayers: input.maxPlayers,
      graph: JSON.stringify(input.graph),
      // Only a body that carries a registry rewrites the column; omitting it preserves the stored
      // one so an unrelated adventure PUT never wipes the switches/variables.
      ...(input.registry !== undefined ? { registry: JSON.stringify(input.registry) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(adventure.id, id));
  const stored = await loadAdventure(db, accountId, id);
  if (!stored) throw new Error("not_found: adventure vanished mid-update");
  return stored;
}

/**
 * Replaces an adventure's switch/variable registry. Deleting an entry that a still-authored event
 * page conditions on is ALLOWED — this function does not cross-check the registry against any map's
 * `map_event_page` rows, on purpose (see `activePageIndex`'s fail-closed default).
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
  // The adventure's maps (and their elements/events) cascade off `map.adventure_id`.
  await db.delete(adventure).where(eq(adventure.id, id));
}
