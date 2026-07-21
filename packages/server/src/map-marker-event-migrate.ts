/**
 * UX wave #12 / Task 5: the one-shot transform that turns old markers into typed EVENTS.
 *
 * Migration `0022` adds the `map_event.kind`/`species`/`patrol_radius` columns; SQL cannot mint v4
 * uuids or restructure adventure-graph JSON, so the data transform lives here — the same
 * planner-vs-SQL split migration `0021` uses. `planMarkerEventMigration` is a pure, deterministic
 * function (injected `mintId`) so the attribution and graph-rewrite rules are unit-testable without a
 * database; `migrateMarkersToEvents` runs it against a live D1. The runtime-equivalence proof drives
 * the runner and then asserts a migrated map behaves identically through the real World DO.
 *
 * The rules, from a world where entries/exits/monster spawns still live in `map.markers`:
 * - each entry marker becomes an `entry` event, each exit an `exit` event, each monster spawn a
 *   `monster` event (species + patrolRadius on the event), all single-page;
 * - the owning adventure's graph is rewritten so every `entryId`/`exitId` that named a marker now
 *   names the new event's uuid (a marker id shared across two maps resolves per-map — a structural
 *   rewrite, never a blind string swap);
 * - a map that ALREADY carries functional events is skipped (idempotent, and it leaves post-deploy
 *   event-native maps untouched), and a graph anchor already shaped like a uuid is left alone.
 */

import type { MapMarkers } from "@lindocara/engine/map-data.js";
import { functionalEvent, type MapEvent } from "@lindocara/engine/map-events.js";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { adventure, type Db, map, mapEvent } from "./db/index.js";
import { insertEventStatements, markersOfRow } from "./maps.js";

export interface MarkerMigrationMapInput {
  id: string;
  adventureId: string;
  markers: MapMarkers;
  /** One past the largest ordinal already on the map, so new event ordinals never collide. */
  nextOrdinal: number;
  /** A map that already has any entry/exit/monster event is treated as already migrated. */
  hasFunctionalEvents: boolean;
}

export interface MarkerMigrationInput {
  maps: readonly MarkerMigrationMapInput[];
  /** adventureId -> stored graph JSON. */
  adventureGraphs: ReadonlyMap<string, string>;
}

export interface MarkerMigrationPlan {
  /** mapId -> the functional events to insert (each already carries its single default page). */
  eventsByMap: Map<string, MapEvent[]>;
  /** adventureId -> rewritten graph JSON, only for graphs whose anchors actually moved. */
  graphRewrites: Map<string, string>;
}

/** Replace a graph anchor's marker id with the migrated event uuid, keyed by (mapId, markerId).
 *  Leaves an id that is not in the mapping (already a uuid, or missing) untouched. */
function rewriteAnchorEntry(
  anchor: unknown,
  entryUuidByMap: Map<string, Map<string, string>>,
): void {
  if (!anchor || typeof anchor !== "object") return;
  const record = anchor as { mapId?: unknown; entryId?: unknown };
  if (typeof record.mapId !== "string" || typeof record.entryId !== "string") return;
  const next = entryUuidByMap.get(record.mapId)?.get(record.entryId);
  if (next) record.entryId = next;
}

/**
 * Structurally rewrite one adventure graph. The graph still holds OLD marker ids, which the new
 * `parseAdventureGraph` would reject (they are not uuids), so this reads the raw JSON rather than the
 * typed parser — the same reason `planOwnershipMigration` operates on graph strings.
 */
function rewriteGraph(
  graphJson: string,
  entryUuidByMap: Map<string, Map<string, string>>,
  exitUuidByMap: Map<string, Map<string, string>>,
): string | null {
  let graph: unknown;
  try {
    graph = JSON.parse(graphJson);
  } catch {
    return null;
  }
  if (!graph || typeof graph !== "object") return null;
  const record = graph as { start?: unknown; links?: unknown };
  rewriteAnchorEntry(record.start, entryUuidByMap);
  if (Array.isArray(record.links)) {
    for (const link of record.links) {
      if (!link || typeof link !== "object") continue;
      const linkRecord = link as { mapId?: unknown; exitId?: unknown; dest?: unknown };
      if (typeof linkRecord.mapId === "string" && typeof linkRecord.exitId === "string") {
        const next = exitUuidByMap.get(linkRecord.mapId)?.get(linkRecord.exitId);
        if (next) linkRecord.exitId = next;
      }
      rewriteAnchorEntry(linkRecord.dest, entryUuidByMap);
    }
  }
  return JSON.stringify(graph);
}

export function planMarkerEventMigration(
  input: MarkerMigrationInput,
  mintId: () => string,
): MarkerMigrationPlan {
  const eventsByMap = new Map<string, MapEvent[]>();
  const entryUuidByMap = new Map<string, Map<string, string>>();
  const exitUuidByMap = new Map<string, Map<string, string>>();

  for (const mapInput of input.maps) {
    if (mapInput.hasFunctionalEvents) continue;
    const { entries, exits, monsterSpawns } = mapInput.markers;
    if (entries.length === 0 && exits.length === 0 && monsterSpawns.length === 0) continue;

    const events: MapEvent[] = [];
    let ordinal = mapInput.nextOrdinal;
    const entryMap = new Map<string, string>();
    const exitMap = new Map<string, string>();

    for (const entry of entries) {
      const id = mintId();
      entryMap.set(entry.id, id);
      events.push(
        functionalEvent({
          id,
          col: entry.col,
          row: entry.row,
          ordinal: ordinal++,
          kind: "entry",
          name: entry.label,
        }),
      );
    }
    for (const exit of exits) {
      const id = mintId();
      exitMap.set(exit.id, id);
      events.push(
        functionalEvent({
          id,
          col: exit.col,
          row: exit.row,
          ordinal: ordinal++,
          kind: "exit",
          name: exit.label,
        }),
      );
    }
    for (const spawn of monsterSpawns) {
      events.push(
        functionalEvent({
          id: mintId(),
          col: spawn.col,
          row: spawn.row,
          ordinal: ordinal++,
          kind: "monster",
          species: spawn.species,
          patrolRadius: spawn.patrolRadius,
        }),
      );
    }

    eventsByMap.set(mapInput.id, events);
    if (entryMap.size > 0) entryUuidByMap.set(mapInput.id, entryMap);
    if (exitMap.size > 0) exitUuidByMap.set(mapInput.id, exitMap);
  }

  const graphRewrites = new Map<string, string>();
  for (const [adventureId, graphJson] of input.adventureGraphs) {
    const rewritten = rewriteGraph(graphJson, entryUuidByMap, exitUuidByMap);
    if (rewritten !== null && rewritten !== graphJson) graphRewrites.set(adventureId, rewritten);
  }

  return { eventsByMap, graphRewrites };
}

/**
 * Run the plan against D1. Reads every map's markers + every adventure's graph, plans the transform,
 * then inserts the events/pages and rewrites the graphs in one batch (one transaction — a graph never
 * points at a half-inserted event). Each map's event inserts are already chunked under D1's
 * bound-parameter cap by `insertEventStatements`. Idempotent: a re-run skips maps that already have
 * functional events and rewrites no graph whose anchors are already uuids.
 */
export async function migrateMarkersToEvents(
  db: Db,
): Promise<{ migratedMaps: number; rewrittenGraphs: number }> {
  const mapRows = await db
    .select({
      id: map.id,
      adventureId: map.adventureId,
      markers: map.markers,
      cols: map.cols,
      rows: map.rows,
    })
    .from(map);
  const adventureRows = await db
    .select({ id: adventure.id, graph: adventure.graph })
    .from(adventure);
  const eventRows = await db
    .select({ mapId: mapEvent.mapId, ordinal: mapEvent.ordinal, kind: mapEvent.kind })
    .from(mapEvent);

  const maxOrdinal = new Map<string, number>();
  const hasFunctional = new Set<string>();
  for (const row of eventRows) {
    maxOrdinal.set(row.mapId, Math.max(maxOrdinal.get(row.mapId) ?? 0, row.ordinal));
    if (row.kind !== "normal") hasFunctional.add(row.mapId);
  }

  const plan = planMarkerEventMigration(
    {
      maps: mapRows.map((row) => ({
        id: row.id,
        adventureId: row.adventureId,
        markers: markersOfRow(row),
        nextOrdinal: (maxOrdinal.get(row.id) ?? 0) + 1,
        hasFunctionalEvents: hasFunctional.has(row.id),
      })),
      adventureGraphs: new Map(adventureRows.map((row) => [row.id, row.graph])),
    },
    () => crypto.randomUUID(),
  );

  const statements: BatchItem<"sqlite">[] = [];
  for (const [mapId, events] of plan.eventsByMap) {
    statements.push(...insertEventStatements(db, mapId, events));
  }
  for (const [adventureId, graph] of plan.graphRewrites) {
    statements.push(db.update(adventure).set({ graph }).where(eq(adventure.id, adventureId)));
  }
  if (statements.length > 0) {
    await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }

  return { migratedMaps: plan.eventsByMap.size, rewrittenGraphs: plan.graphRewrites.size };
}
