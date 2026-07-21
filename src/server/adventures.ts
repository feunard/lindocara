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
import { and, asc, eq, inArray, sql } from "drizzle-orm";
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
import { mapSpawnPoint } from "../shared/map-data.js";
import { eventCellCentre } from "../shared/map-events.js";
import { adventure, type Db, map, mapEvent, party } from "./db/index.js";
import { DEFAULT_FIRST_MAP_NAME, loadMap, prepareDefaultMap, type StoredMap } from "./maps.js";

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

/**
 * The entry/exit-EVENT uuids of every map the adventure owns (UX wave #12) — the member set
 * `validateAdventure` checks the graph against. Every owned map appears (even one with no events yet),
 * so a graph naming a map outside this set is, by construction, a foreign reference. Reads the
 * `map_event` rows directly, filtered by kind, rather than the quarantined `map.markers` column.
 */
export async function markerIdsFor(
  db: Db,
  adventureId: string,
): Promise<Map<string, MapMarkerIds>> {
  const mapRows = await db
    .select({ id: map.id })
    .from(map)
    .where(eq(map.adventureId, adventureId))
    .orderBy(asc(map.createdAt));
  const byMap = new Map<string, { entryIds: string[]; exitIds: string[] }>();
  for (const row of mapRows) byMap.set(row.id, { entryIds: [], exitIds: [] });
  if (mapRows.length === 0) return byMap;
  const eventRows = await db
    .select({ mapId: mapEvent.mapId, id: mapEvent.id, kind: mapEvent.kind })
    .from(mapEvent)
    .where(
      inArray(
        mapEvent.mapId,
        mapRows.map((row) => row.id),
      ),
    );
  for (const event of eventRows) {
    const anchors = byMap.get(event.mapId);
    if (!anchors) continue;
    if (event.kind === "entry") anchors.entryIds.push(event.id);
    else if (event.kind === "exit") anchors.exitIds.push(event.id);
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

/**
 * One atomic POST creates an adventure AND the blank map it is born with (UX wave #2/#3): a single
 * `db.batch` writes the adventure row and its default flat-grass map. The response carries both the
 * stored adventure and its default map so the client lands straight in the editor with no second
 * round-trip.
 *
 * The born adventure is a DRAFT (`EMPTY_GRAPH`): the map is genuinely blank with no auto-seeded
 * entry/exit events, so there is nothing to point a start at or bind an exit to. Spawn/entry are
 * explicit author choices — the author places them and wires the graph later, and validation never
 * blocks the save while the graph is incomplete.
 */
export async function createAdventureWithDefaultMap(
  db: Db,
  accountId: string,
  input: CreateAdventureInput,
): Promise<{ adventure: StoredAdventure; map: StoredMap }> {
  const title = input.title.trim();
  if (title.length === 0 || title.length > 48) throw new Error("title: 1-48 characters");
  if (input.maxPlayers < 1 || input.maxPlayers > 4) throw new Error("players: between 1 and 4");
  const adventureId = crypto.randomUUID();
  // The born map is named `Map1` (UX wave #16), never the adventure title: a fresh adventure has zero
  // maps, so the lowest free `MapN` is unconditionally the first.
  const prepared = prepareDefaultMap(db, accountId, adventureId, DEFAULT_FIRST_MAP_NAME);
  // The adventure row is inserted before its map so the map's `adventure_id` foreign key resolves
  // within the one transaction.
  await db.batch([
    db.insert(adventure).values({
      id: adventureId,
      accountId,
      title,
      maxPlayers: input.maxPlayers,
      graph: JSON.stringify(EMPTY_GRAPH),
      ...(input.registry !== undefined ? { registry: JSON.stringify(input.registry) } : {}),
    }),
    ...prepared.inserts,
  ]);
  const stored = await loadAdventure(db, accountId, adventureId);
  if (!stored) throw new Error("not_found: adventure vanished mid-create");
  return { adventure: stored, map: prepared.stored };
}

export async function listAdventures(
  db: Db,
  accountId: string,
): Promise<
  { id: string; title: string; maxPlayers: number; mapCount: number; playable: boolean }[]
> {
  const rows = await db
    .select({
      id: adventure.id,
      title: adventure.title,
      maxPlayers: adventure.maxPlayers,
    })
    .from(adventure)
    .where(eq(adventure.accountId, accountId))
    .orderBy(asc(adventure.createdAt));
  const counts = await db
    .select({ adventureId: map.adventureId, count: sql<number>`count(*)` })
    .from(map)
    .where(eq(map.accountId, accountId))
    .groupBy(map.adventureId);
  const countByAdventure = new Map(counts.map((row) => [row.adventureId, Number(row.count)]));
  return rows.map((row) => {
    // D25: an adventure is playable as soon as it owns a map. The first map + spawn position are
    // DERIVED (`resolveAdventureStart`) — a spawn event, else the legacy graph start, else the first
    // map's walkable spawn — so no `graph.start` is required. Only a mapless draft is unplayable.
    const mapCount = countByAdventure.get(row.id) ?? 0;
    return {
      id: row.id,
      title: row.title,
      maxPlayers: row.maxPlayers,
      mapCount,
      playable: mapCount > 0,
    };
  });
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

/**
 * Where a hero spawns in this adventure (D25). The FIRST map is DERIVED, not read from
 * `graph.start`, in three tiers of decreasing preference:
 *
 *  1. Spawn EVENT — the earliest-created member map carrying a `spawn`-kind event; the hero spawns
 *     on that event's cell. This is the authored, graph-free start of the new model: the map with a
 *     spawn event IS the first map.
 *  2. Graph start — COMPAT for adventures authored before spawn events: `graph.start` names a member
 *     map + entry event, and the hero spawns on that entry (or the map's fallback spawn if the entry
 *     event is gone). This keeps every existing deployed adventure spawning exactly where it did.
 *  3. First map — a deterministic silent fallback: the earliest-created member map at its authored
 *     walkable spawn point. There is no "missing spawn" error — any adventure with a map is
 *     enterable, which is what lets a party launch a spawn-less draft.
 *
 * Returns null only for an adventure with no maps at all (nowhere to admit a hero).
 */
export async function resolveAdventureStart(
  db: Db,
  advnt: StoredAdventure,
): Promise<{ mapId: string; x: number; y: number } | null> {
  if (advnt.mapIds.length === 0) return null;
  // Tier 1: the earliest-created member map carrying a spawn event.
  const spawnRows = await db
    .select({ mapId: mapEvent.mapId, col: mapEvent.col, row: mapEvent.row })
    .from(mapEvent)
    .where(and(inArray(mapEvent.mapId, advnt.mapIds), eq(mapEvent.kind, "spawn")));
  if (spawnRows.length > 0) {
    for (const mapId of advnt.mapIds) {
      // Deterministic pick if an author placed more than one spawn on a single map.
      const chosen = spawnRows
        .filter((row) => row.mapId === mapId)
        .sort((a, b) => a.row - b.row || a.col - b.col)[0];
      if (chosen) return { mapId, ...eventCellCentre(chosen) };
    }
  }
  // Tier 2: the legacy graph start (an entry event on a member map).
  const start = advnt.graph.start;
  if (start && advnt.mapIds.includes(start.mapId)) {
    const startMap = await loadMap(db, start.mapId);
    if (startMap) {
      const entry = startMap.events.find(
        (event) => event.kind === "entry" && event.id === start.entryId,
      );
      return { mapId: startMap.id, ...(entry ? eventCellCentre(entry) : mapSpawnPoint(startMap)) };
    }
  }
  // Tier 3: the first member map at its walkable spawn point.
  const firstMapId = advnt.mapIds[0];
  if (firstMapId) {
    const firstMap = await loadMap(db, firstMapId);
    if (firstMap) return { mapId: firstMap.id, ...mapSpawnPoint(firstMap) };
  }
  return null;
}

export async function updateAdventure(
  db: Db,
  accountId: string,
  id: string,
  input: AdventureInput,
): Promise<StoredAdventure> {
  const row = await ownedRow(db, accountId, id);
  if (!row) throw new Error("not_found: no such adventure");
  const title = input.title.trim();
  if (title.length === 0 || title.length > 48) throw new Error("title: 1-48 characters");
  if (input.maxPlayers < 1 || input.maxPlayers > 4) throw new Error("players: between 1 and 4");
  // The editor no longer authors a graph, so a real PUT omits it and the stored graph is preserved
  // exactly. A graph is validated and written only when a legacy/test writer explicitly seeds one —
  // that (and only that) path keeps the referential-integrity guard and the live-party start pin.
  const proposedGraph = input.graph;
  if (proposedGraph !== undefined) {
    validateAdventure(
      { title: input.title, maxPlayers: input.maxPlayers, graph: proposedGraph },
      await markerIdsFor(db, id),
    );
    // A live party pins where its heroes spawn (the adventure's start). Refuse nulling or moving the
    // start while a party still references this adventure — mirrors `deleteAdventure`'s party guard.
    const storedStart = parseAdventureGraph(JSON.parse(row.graph))?.start ?? null;
    const nextStart = proposedGraph.start;
    const startMoved =
      storedStart === null
        ? nextStart !== null
        : nextStart === null ||
          nextStart.mapId !== storedStart.mapId ||
          nextStart.entryId !== storedStart.entryId;
    if (startMoved) {
      const used = await db
        .select({ partyId: party.id })
        .from(party)
        .where(eq(party.adventureId, id))
        .limit(1);
      if (used.length > 0) throw new Error("in_use: a party still references this adventure");
    }
  }
  await db
    .update(adventure)
    .set({
      title,
      maxPlayers: input.maxPlayers,
      // Absent graph preserves the stored one (authoring never touches it now); present graph is the
      // compat/seed write. Same rule for the registry column: omitting it never wipes the switches.
      ...(proposedGraph !== undefined ? { graph: JSON.stringify(proposedGraph) } : {}),
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
