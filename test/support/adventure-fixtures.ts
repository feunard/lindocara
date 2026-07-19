/**
 * Unit-test helpers for the UX-wave "a map belongs to one adventure" model. A map can no longer be
 * created bare — it is created inside an adventure as a 5x5 template and then authored with real
 * terrain/markers via `updateMap`. These wrap that two-step flow so a test that just needs an
 * authored map keeps reading like one.
 */
import { createAdventure } from "../../src/server/adventures.js";
import type { Db } from "../../src/server/db/index.js";
import { createMap, type MapInput, type StoredMap, updateMap } from "../../src/server/maps.js";

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
