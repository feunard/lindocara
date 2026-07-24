/**
 * The one-shot transform that turns authored EXITS into scripted TELEPORT events.
 *
 * Two mechanisms could move a hero between maps: the `teleport` command an author writes on an
 * ordinary event, and a separate `exit`-kind event whose destination lived in the adventure GRAPH
 * (`#detectAdventureExits` / `#transitionAdventureExit` in `world.ts`). The graph is no longer
 * authored — the editor removed every affordance that wrote a link — so exits became a mechanism
 * only old adventures can express and no author can edit. This collapses the two into one: after
 * migrating, every map-to-map move in an adventure is a `teleport` command an author can open and
 * retarget.
 *
 * The split follows `map-marker-event-migrate.ts`: `planExitTeleportMigration` is a pure,
 * deterministic function so the conversion rules are unit-testable without a database, and
 * `migrateExitsToTeleports` runs the plan against a live D1.
 *
 * The rules:
 * - an `exit` event bound by a graph link becomes a `normal` event on the same cell, keeping its id,
 *   ordinal, name and page appearance, with a `player-touch` trigger — the exit's own semantics, since
 *   `#detectAdventureExits` fired on standing in the cell — and a one-command program;
 * - `dest: { mapId, entryId }` becomes `teleport` at the destination ENTRY event's cell, or that
 *   map's spawn when the entry is gone (the same fallback `resolveAdventureStart` already applies);
 * - `dest: "end"` becomes `endAdventure`, which is what that link did;
 * - migrated links are dropped from the graph, so nothing resolves them twice;
 * - an exit with NO link is left untouched. It moves nobody today, and inventing a destination for it
 *   would author behaviour the adventure never had;
 * - a map with no exit events is skipped entirely, which makes the whole thing idempotent: run it
 *   twice and the second pass finds nothing to do.
 *
 * `entry` events are deliberately NOT removed. They are inert anchors once the links are gone, and
 * `resolveAdventureStart` still reads one for an adventure whose `graph.start` predates spawn events.
 * Deleting them belongs to the teardown that follows this migration, not to the migration itself.
 */

import type { AdventureGraph } from "@lindocara/engine/adventure.js";
import { parseAdventureGraph } from "@lindocara/engine/adventure.js";
import type { EventCommand } from "@lindocara/engine/event-commands.js";
import { defaultEventPage, type MapEvent } from "@lindocara/engine/map-events.js";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { adventure, type Db, mapEvent, map as mapTable } from "./db/index.js";
import { insertEventStatements, loadMap } from "./maps.js";

export interface ExitMigrationMapInput {
  id: string;
  adventureId: string;
  /** The map's stored events, exits included. */
  events: readonly MapEvent[];
  /** Where the map's fallback spawn sits, used when a link's destination entry has been deleted. */
  spawn: { col: number; row: number };
}

export interface ExitMigrationInput {
  maps: readonly ExitMigrationMapInput[];
  /** adventureId -> stored graph JSON, exactly as the `adventure` row holds it. */
  adventureGraphs: ReadonlyMap<string, string>;
}

/** One exit that could not be converted, so a run can report rather than silently skip. */
export interface ExitMigrationSkip {
  mapId: string;
  eventId: string;
  reason: "no_link" | "unknown_destination_map";
}

export interface ExitMigrationPlan {
  /** mapId -> the converted events, in the map's original event order. Only maps that changed. */
  rewrittenEvents: Map<string, MapEvent[]>;
  /** adventureId -> rewritten graph JSON, only for graphs whose links actually moved. */
  graphRewrites: Map<string, string>;
  /** Exits left alone, with why. */
  skipped: ExitMigrationSkip[];
  /** How many exits became teleport/endAdventure events. */
  converted: number;
}

/** The cell a link's destination lands on: its entry event, else the destination map's spawn. */
function destinationCell(
  destination: { mapId: string; entryId: string },
  maps: readonly ExitMigrationMapInput[],
): { col: number; row: number } | null {
  const target = maps.find((candidate) => candidate.id === destination.mapId);
  // A link pointing at a map the adventure no longer owns cannot be honoured, and guessing a cell on
  // a map we cannot see would be worse than leaving the exit as it is.
  if (!target) return null;
  const entry = target.events.find(
    (event) => event.kind === "entry" && event.id === destination.entryId,
  );
  return entry ? { col: entry.col, row: entry.row } : { ...target.spawn };
}

/** The exit event, rebuilt as the scripted event that does the same thing. */
function scriptedFromExit(exit: MapEvent, commands: EventCommand[]): MapEvent {
  // Keep the authored page's appearance (its graphic, its movement options) so the map still LOOKS
  // the same; only the trigger and the program change. Conditions stay off: an exit had none, and a
  // migration must not invent a page that could fail to activate.
  const page = exit.pages[0] ?? defaultEventPage();
  return {
    id: exit.id,
    col: exit.col,
    row: exit.row,
    name: exit.name,
    ordinal: exit.ordinal,
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: [
      {
        ...page,
        condSwitchId: null,
        condVariableId: null,
        condVariableMin: null,
        condSelfSwitch: null,
        trigger: "player-touch",
        commands,
      },
    ],
  };
}

export function planExitTeleportMigration(input: ExitMigrationInput): ExitMigrationPlan {
  const plan: ExitMigrationPlan = {
    rewrittenEvents: new Map(),
    graphRewrites: new Map(),
    skipped: [],
    converted: 0,
  };

  // Parse each adventure's graph once. An unparseable graph is left strictly alone — this migration
  // must never be the thing that destroys a graph it could not read.
  const graphs = new Map<string, AdventureGraph>();
  for (const [adventureId, json] of input.adventureGraphs) {
    let parsed: AdventureGraph | null = null;
    try {
      parsed = parseAdventureGraph(JSON.parse(json));
    } catch {
      parsed = null;
    }
    if (parsed) graphs.set(adventureId, parsed);
  }

  const consumedLinks = new Map<string, Set<string>>();

  for (const map of input.maps) {
    const exits = map.events.filter((event) => event.kind === "exit");
    if (exits.length === 0) continue;
    const graph = graphs.get(map.adventureId);
    const converted = new Map<string, MapEvent>();

    for (const exit of exits) {
      const link = graph?.links.find(
        (candidate) => candidate.mapId === map.id && candidate.exitId === exit.id,
      );
      if (!link) {
        plan.skipped.push({ mapId: map.id, eventId: exit.id, reason: "no_link" });
        continue;
      }
      let commands: EventCommand[];
      if (link.dest === "end") {
        commands = [{ t: "endAdventure" }];
      } else {
        const cell = destinationCell(link.dest, input.maps);
        if (!cell) {
          plan.skipped.push({
            mapId: map.id,
            eventId: exit.id,
            reason: "unknown_destination_map",
          });
          continue;
        }
        commands = [{ t: "teleport", mapId: link.dest.mapId, col: cell.col, row: cell.row }];
      }
      converted.set(exit.id, scriptedFromExit(exit, commands));
      plan.converted += 1;
      const consumed = consumedLinks.get(map.adventureId) ?? new Set<string>();
      consumed.add(`${map.id}:${exit.id}`);
      consumedLinks.set(map.adventureId, consumed);
    }

    if (converted.size === 0) continue;
    // Rewrite in place so event order — and therefore the `EV{ordinal}` reading order — is untouched.
    plan.rewrittenEvents.set(
      map.id,
      map.events.map((event) => converted.get(event.id) ?? event),
    );
  }

  for (const [adventureId, consumed] of consumedLinks) {
    const graph = graphs.get(adventureId);
    if (!graph) continue;
    const links = graph.links.filter((link) => !consumed.has(`${link.mapId}:${link.exitId}`));
    if (links.length === graph.links.length) continue;
    plan.graphRewrites.set(adventureId, JSON.stringify({ start: graph.start, links }));
  }

  return plan;
}

/**
 * Run the plan against D1. Reads every map's events and every adventure's graph, plans the
 * conversion, then replaces the events of each changed map and rewrites its graph in ONE batch (one
 * transaction), so a graph can never lose a link while the event that replaced it failed to land.
 *
 * Events are replaced wholesale — clear then re-insert, the same shape `updateMap` uses — because a
 * converted event changes its `kind` and its page's program, and clearing `map_event` cascades to
 * `map_event_page` so a stale page cannot outlive its event. `insertEventStatements` already chunks
 * under D1's bound-parameter cap.
 *
 * Idempotent by construction: the planner skips a map with no `exit` events, so a second run finds
 * nothing and writes nothing.
 */
export async function migrateExitsToTeleports(
  db: Db,
): Promise<{ migratedMaps: number; convertedExits: number; skipped: ExitMigrationSkip[] }> {
  const mapRows = await db
    .select({ id: mapTable.id, adventureId: mapTable.adventureId })
    .from(mapTable);
  const adventureRows = await db
    .select({ id: adventure.id, graph: adventure.graph })
    .from(adventure);

  // `loadMap` is the one reader that assembles a map's events and spawn the way the rest of the
  // server sees them, so the migration plans against exactly what the runtime would load.
  const maps: ExitMigrationMapInput[] = [];
  for (const row of mapRows) {
    const stored = await loadMap(db, row.id);
    if (!stored) continue;
    maps.push({
      id: row.id,
      adventureId: row.adventureId,
      events: stored.events,
      spawn: stored.spawn,
    });
  }

  const plan = planExitTeleportMigration({
    maps,
    adventureGraphs: new Map(adventureRows.map((row) => [row.id, row.graph])),
  });

  const statements: BatchItem<"sqlite">[] = [];
  for (const [mapId, events] of plan.rewrittenEvents) {
    statements.push(db.delete(mapEvent).where(eq(mapEvent.mapId, mapId)));
    statements.push(...insertEventStatements(db, mapId, events));
  }
  for (const [adventureId, graph] of plan.graphRewrites) {
    statements.push(db.update(adventure).set({ graph }).where(eq(adventure.id, adventureId)));
  }
  if (statements.length > 0) {
    await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }

  return {
    migratedMaps: plan.rewrittenEvents.size,
    convertedExits: plan.converted,
    skipped: plan.skipped,
  };
}
