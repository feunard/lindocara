/**
 * Unit-test helpers for the UX-wave "a map belongs to one adventure" model. A map can no longer be
 * created bare — it is created inside an adventure as a 5x5 template and then authored with real
 * terrain/markers via `updateMap`. These wrap that two-step flow so a test that just needs an
 * authored map keeps reading like one.
 */

import type { MonsterSpecies } from "@lindocara/engine/game.js";
import { EMPTY_MARKERS } from "@lindocara/engine/map-data.js";
import {
  entryEvents,
  exitEvents,
  functionalEvent,
  type MapEvent,
} from "@lindocara/engine/map-events.js";
import { createAdventure } from "@lindocara/server/adventures.js";
import type { Db } from "@lindocara/server/db/index.js";
import { createMap, type MapInput, type StoredMap, updateMap } from "@lindocara/server/maps.js";

export interface EventMapCells {
  entry: { col: number; row: number };
  exit: { col: number; row: number };
  monsters?: readonly {
    col: number;
    row: number;
    species: MonsterSpecies;
    patrolRadius: number;
  }[];
}

/**
 * The entry/exit (and optional monster) EVENTS a functional test map carries (UX wave #12: markers
 * are dead). Uuids are minted here; a graph binds them by reading `anchorsOf` off the stored map.
 */
export function eventMapEvents(cells: EventMapCells): MapEvent[] {
  let ordinal = 1;
  return [
    functionalEvent({ id: crypto.randomUUID(), ...cells.entry, ordinal: ordinal++, kind: "entry" }),
    functionalEvent({ id: crypto.randomUUID(), ...cells.exit, ordinal: ordinal++, kind: "exit" }),
    ...(cells.monsters ?? []).map((monster) =>
      functionalEvent({
        id: crypto.randomUUID(),
        col: monster.col,
        row: monster.row,
        ordinal: ordinal++,
        kind: "monster",
        species: monster.species,
        patrolRadius: monster.patrolRadius,
      }),
    ),
  ];
}

/** The entry/exit event uuids a stored map exposes — exactly what the adventure graph binds. */
export function anchorsOf(stored: { events: readonly MapEvent[] }): {
  entryId: string;
  exitId: string;
} {
  const entryId = entryEvents(stored.events)[0]?.id;
  const exitId = exitEvents(stored.events)[0]?.id;
  if (!entryId || !exitId) throw new Error("map has no entry/exit event to anchor a graph on");
  return { entryId, exitId };
}

export { EMPTY_MARKERS };

/** Create a draft adventure the account owns and return its id. */
export async function seedAdventure(
  db: Db,
  accountId: string,
  title = "Adventure",
): Promise<string> {
  const adventure = await createAdventure(db, accountId, { title, maxPlayers: 4 });
  return adventure.id;
}

/**
 * Create a template map inside `adventureId` and author it with `input`. The owning adventure is a
 * draft (empty graph) unless a caller wired it, so the author step's graph revalidation passes
 * freely. Returns the fully authored `StoredMap`.
 */
export async function authorMap(
  db: Db,
  accountId: string,
  adventureId: string,
  input: MapInput,
): Promise<StoredMap> {
  const created = await createMap(db, accountId, adventureId, input.name);
  return updateMap(db, accountId, created.id, input);
}
