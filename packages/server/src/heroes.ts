/**
 * Heroes: party-owned characters. This boundary owns the D1 reads and writes; a hero is created
 * only in a party the caller belongs to, capped per player, and placed at the party adventure's
 * start entry so a later admission step can spawn it directly. Colour is never stored — it comes
 * from the owner's party_member slot.
 */

import { starterEquipmentFor } from "@lindocara/engine/character.js";
import type { PlayerClass } from "@lindocara/engine/game.js";
import type { CreateHeroInput } from "@lindocara/engine/hero.js";
import { MAX_HEROES_PER_PARTY } from "@lindocara/engine/hero.js";
import { CLASS_SKILLS, isSkillUnlocked } from "@lindocara/engine/skills.js";
import { and, asc, eq } from "drizzle-orm";
import { loadAdventureById, resolveAdventureStart } from "./adventures.js";
import { type Db, hero, party, partyMember } from "./db/index.js";
import { HEALTH_POTION_ID, ownedItemId } from "./items.js";

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

  // The party may run anyone's adventure (the play flow is not owner-fenced): load it by id to
  // derive where a hero spawns. The party row itself is the authorization — membership was checked.
  const adventure = await loadAdventureById(db, partyRow.adventureId);
  if (!adventure) throw new Error("not_found: party adventure is unavailable");
  // D25: the first map + position are DERIVED — a spawn event, else the legacy graph start, else the
  // first map's walkable spawn. Only a mapless adventure leaves a hero nowhere to spawn.
  const start = await resolveAdventureStart(db, adventure);
  if (!start) throw new Error("not_found: party adventure has no map");
  const position = { x: start.x, y: start.y };

  const id = crypto.randomUUID();
  const equipment = starterEquipmentFor(input.class);
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    db.$client
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
        start.mapId,
        position.x,
        position.y,
        partyId,
        accountId,
        MAX_HEROES_PER_PARTY,
      ),
    db.$client
      .prepare(
        `INSERT INTO hero_item (id, hero_id, item_definition_id, quantity, created_at)
         SELECT ?, id, ?, 2, ? FROM hero WHERE id = ?`,
      )
      .bind(ownedItemId(id, HEALTH_POTION_ID), HEALTH_POTION_ID, now, id),
  ];
  for (const definitionId of [equipment.mainHand, equipment.offHand].filter(
    (candidate): candidate is NonNullable<typeof candidate> => candidate !== null,
  )) {
    statements.push(
      db.$client
        .prepare(
          `INSERT INTO hero_item (id, hero_id, item_definition_id, quantity, created_at)
           SELECT ?, id, ?, 1, ? FROM hero WHERE id = ?`,
        )
        .bind(ownedItemId(id, definitionId), definitionId, now, id),
    );
  }
  statements.push(
    db.$client
      .prepare(
        `INSERT INTO hero_equipment (hero_id, slot, hero_item_id, equipped_at)
         SELECT id, 'main_hand', ?, ? FROM hero WHERE id = ?`,
      )
      .bind(ownedItemId(id, equipment.mainHand), now, id),
  );
  if (equipment.offHand !== null) {
    statements.push(
      db.$client
        .prepare(
          `INSERT INTO hero_equipment (hero_id, slot, hero_item_id, equipped_at)
           SELECT id, 'off_hand', ?, ? FROM hero WHERE id = ?`,
        )
        .bind(ownedItemId(id, equipment.offHand), now, id),
    );
  }
  statements.push(
    db.$client
      .prepare(
        `INSERT INTO hero_quest (hero_id, quest_id, status, progress)
         SELECT id, 'three_offerings', 'available', 0 FROM hero WHERE id = ?`,
      )
      .bind(id),
  );
  for (const skill of CLASS_SKILLS[input.class]) {
    const unlocked = isSkillUnlocked(1, skill.slot);
    statements.push(
      db.$client
        .prepare(
          `INSERT INTO hero_skill (hero_id, skill_id, unlocked, equipped, slot, unlocked_at)
           SELECT id, ?, ?, ?, ?, ? FROM hero WHERE id = ?`,
        )
        .bind(
          skill.id,
          unlocked ? 1 : 0,
          unlocked ? 1 : 0,
          unlocked ? skill.slot : null,
          unlocked ? now : null,
          id,
        ),
    );
  }
  const results = await db.$client.batch(statements);
  if ((results[0]?.meta.changes ?? 0) === 0) {
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
