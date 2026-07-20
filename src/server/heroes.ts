/**
 * Heroes: party-owned characters. This boundary owns the D1 reads and writes; a hero is created
 * only in a party the caller belongs to, capped per player, and placed at the party adventure's
 * start entry so a later admission step can spawn it directly. Colour is never stored — it comes
 * from the owner's party_member slot.
 */
import { and, asc, eq } from "drizzle-orm";
import type { PlayerClass } from "../shared/game.js";
import type { CreateHeroInput } from "../shared/hero.js";
import { MAX_HEROES_PER_PARTY } from "../shared/hero.js";
import { mapSpawnPoint } from "../shared/map-data.js";
import { eventCellCentre } from "../shared/map-events.js";
import { loadAdventure } from "./adventures.js";
import { type Db, hero, party, partyMember } from "./db/index.js";
import { loadMap, type StoredMap } from "./maps.js";

export interface StoredHero {
  id: string;
  partyId: string;
  accountId: string;
  name: string;
  class: PlayerClass;
  mapId: string;
  x: number;
  y: number;
  level: number;
  xp: number;
  hp: number;
  life: "alive" | "corpse" | "ghost";
}

function toStored(row: typeof hero.$inferSelect): StoredHero {
  return {
    id: row.id,
    partyId: row.partyId,
    accountId: row.accountId,
    name: row.name,
    class: row.class,
    mapId: row.mapId,
    x: row.x,
    y: row.y,
    level: row.level,
    xp: row.xp,
    hp: row.hp,
    life: row.life,
  };
}

/** The pixel centre of the named entry EVENT's cell, or the map's fallback spawn if it is gone. */
function entryPosition(map: StoredMap, entryId: string): { x: number; y: number } {
  const entry = map.events.find((event) => event.kind === "entry" && event.id === entryId);
  if (!entry) return mapSpawnPoint(map);
  return eventCellCentre(entry);
}

export async function createHero(
  db: Db,
  accountId: string,
  partyId: string,
  input: CreateHeroInput,
): Promise<StoredHero> {
  const [partyRow] = await db.select().from(party).where(eq(party.id, partyId)).limit(1);
  if (!partyRow) throw new Error("not_found: no such party");

  const membership = await db
    .select({ accountId: partyMember.accountId })
    .from(partyMember)
    .where(and(eq(partyMember.partyId, partyId), eq(partyMember.accountId, accountId)))
    .limit(1);
  if (membership.length === 0) throw new Error("not_member: not a member of this party");

  const existing = await db
    .select({ id: hero.id })
    .from(hero)
    .where(and(eq(hero.partyId, partyId), eq(hero.accountId, accountId)));
  if (existing.length >= MAX_HEROES_PER_PARTY)
    throw new Error("cap: too many heroes in this party");

  // The adventure is owned by the party host; load it through them to read the start entry.
  const adventure = await loadAdventure(db, partyRow.hostAccountId, partyRow.adventureId);
  if (!adventure) throw new Error("not_found: party adventure is unavailable");
  // A draft adventure has no start authored yet — a hero has nowhere to spawn.
  const start = adventure.graph.start;
  if (!start) throw new Error("not_found: party adventure has no start");
  const startMap = await loadMap(db, start.mapId);
  if (!startMap) throw new Error("not_found: start map is unavailable");
  const position = entryPosition(startMap, start.entryId);

  const id = crypto.randomUUID();
  const result = await db.$client
    .prepare(
      `INSERT INTO hero (id, party_id, account_id, name, class, map_id, x, y,
                         created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, (unixepoch() * 1000), (unixepoch() * 1000)
       WHERE (SELECT count(*) FROM hero WHERE party_id = ? AND account_id = ?) < ?`,
    )
    .bind(
      id,
      partyId,
      accountId,
      input.name,
      input.class,
      startMap.id,
      position.x,
      position.y,
      partyId,
      accountId,
      MAX_HEROES_PER_PARTY,
    )
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new Error("cap: too many heroes in this party");
  }
  const [created] = await db.select().from(hero).where(eq(hero.id, id)).limit(1);
  if (!created) throw new Error("not_found: hero vanished mid-create");
  return toStored(created);
}

export async function listHeroes(
  db: Db,
  accountId: string,
  partyId: string,
): Promise<StoredHero[]> {
  const rows = await db
    .select()
    .from(hero)
    .where(and(eq(hero.partyId, partyId), eq(hero.accountId, accountId)))
    .orderBy(asc(hero.createdAt));
  return rows.map(toStored);
}

export async function loadOwnedHero(
  db: Db,
  accountId: string,
  partyId: string,
  heroId: string,
): Promise<StoredHero | null> {
  const row = await db
    .select()
    .from(hero)
    .where(and(eq(hero.id, heroId), eq(hero.partyId, partyId), eq(hero.accountId, accountId)))
    .get();
  return row ? toStored(row) : null;
}

export async function deleteHero(
  db: Db,
  accountId: string,
  partyId: string,
  heroId: string,
): Promise<void> {
  const result = await db.$client
    .prepare(`DELETE FROM hero WHERE id = ? AND party_id = ? AND account_id = ?`)
    .bind(heroId, partyId, accountId)
    .run();
  if ((result.meta.changes ?? 0) === 0) throw new Error("not_found: no such hero");
}
