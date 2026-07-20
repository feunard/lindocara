import { and, eq, sql } from "drizzle-orm";
import {
  isEquipmentForClass,
  type PrimaryColor,
  starterEquipmentFor,
} from "../shared/character.js";
import { normalizeConsumables } from "../shared/consumables.js";
import { emptyCombatCooldowns, normalizeCombatCooldowns } from "../shared/cooldowns.js";
import { isLifeState, type LifeState } from "../shared/death.js";
import { clampRestoredPosition, isWalkable, maxHpForLevel } from "../shared/game.js";
import { terrainFromMap } from "../shared/map-data.js";
import { initialResource } from "../shared/resources.js";
import type { Vec2 } from "../shared/simulation.js";
import { CLASS_SKILLS, isSkillUnlocked } from "../shared/skills.js";
import { normalizeTalentSelection } from "../shared/talents.js";
import { type Db, hero, partyMember } from "./db/index.js";
import { loadNormalizedHeroState } from "./hero-persistence.js";
import { ownedItemId } from "./items.js";
import { loadMap } from "./maps.js";
import type { PlayerProfile, SaveableProfile } from "./profile.js";

const COLOR_TO_APPEARANCE: Record<"blue" | "red" | "yellow" | "purple", PrimaryColor> = {
  blue: "azure",
  red: "ember",
  yellow: "moss",
  purple: "violet",
};

function talentsFromRow(playerClass: typeof hero.$inferSelect.class, level: number, json: string) {
  try {
    return normalizeTalentSelection(playerClass, level, JSON.parse(json));
  } catch {
    return [];
  }
}

function cooldownsFromRow(json: string) {
  try {
    return normalizeCombatCooldowns(JSON.parse(json), Date.now());
  } catch {
    return emptyCombatCooldowns();
  }
}

function safeDeadline(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function restoredLife(
  db: Db,
  row: typeof hero.$inferSelect,
): Promise<{ life: LifeState; corpse: Vec2 | null }> {
  const life = isLifeState(row.life) ? row.life : "alive";
  if (life === "alive" || row.corpseX === null || row.corpseY === null) {
    return { life: "alive", corpse: null };
  }
  const map = await loadMap(db, row.mapId);
  const corpse = { x: row.corpseX, y: row.corpseY };
  if (map && !isWalkable(corpse, undefined, terrainFromMap(map))) {
    return { life: "alive", corpse: null };
  }
  return { life, corpse };
}

export async function loadHeroProfile(db: Db, heroId: string): Promise<PlayerProfile | null> {
  const row = await db.select().from(hero).where(eq(hero.id, heroId)).get();
  if (!row) return null;
  const membership = await db
    .select({ color: partyMember.color })
    .from(partyMember)
    .where(and(eq(partyMember.partyId, row.partyId), eq(partyMember.accountId, row.accountId)))
    .get();
  if (!membership) return null;
  const map = await loadMap(db, row.mapId);
  const terrain = map ? terrainFromMap(map) : undefined;
  const position = clampRestoredPosition({ x: row.x, y: row.y }, row.id, terrain);
  const level = Math.max(1, row.level);
  const life = await restoredLife(db, row);
  const normalized = await loadNormalizedHeroState(db, row);
  const resource = initialResource(row.class);
  if (resource && row.resourceCurrent !== null && Number.isFinite(row.resourceCurrent)) {
    resource.current = Math.max(0, Math.min(resource.max, row.resourceCurrent));
  }
  return {
    id: row.id,
    nick: row.name,
    ...position,
    level,
    xp: Math.max(0, row.xp),
    hp: Math.min(maxHpForLevel(level), Math.max(life.life === "alive" ? 1 : 0, row.hp)),
    appearance: { body: "wayfarer", primaryColor: COLOR_TO_APPEARANCE[membership.color] },
    class: row.class,
    equipment: normalized.equipment,
    inventory: {
      potions: normalized.consumables.health_potion,
      gold: Math.max(0, row.gold),
      crystals: Math.max(0, row.crystals),
      consumables: normalized.consumables,
    },
    quest: normalized.quest,
    zoneId: row.mapId,
    instanceId: "main",
    sessionEpoch: Math.max(0, row.sessionEpoch),
    wardRunExpiresAt: normalized.wardRunExpiresAt,
    ...life,
    ...(resource ? { resource } : {}),
    talents: talentsFromRow(row.class, level, row.talents),
    cooldowns: cooldownsFromRow(row.combatCooldowns),
    consumableCooldownUntil: safeDeadline(row.consumableCooldownUntil),
    damageBoostUntil: safeDeadline(row.damageBoostUntil),
    forgottenUntil: safeDeadline(row.forgottenUntil),
    invisibleUntil: safeDeadline(row.invisibleUntil),
    resurrectionAt: safeDeadline(row.resurrectionAt),
  };
}

export async function acquireHeroEpoch(db: Db, heroId: string): Promise<number | null> {
  const updated = await db
    .update(hero)
    .set({ sessionEpoch: sql`${hero.sessionEpoch} + 1`, updatedAt: new Date() })
    .where(eq(hero.id, heroId))
    .returning({ sessionEpoch: hero.sessionEpoch })
    .get();
  return updated?.sessionEpoch ?? null;
}

export async function handoffHeroLocation(
  db: Db,
  profile: Pick<SaveableProfile, "id" | "sessionEpoch">,
  destination: { mapId: string; x: number; y: number },
): Promise<number | null> {
  const updated = await db
    .update(hero)
    .set({
      mapId: destination.mapId,
      x: destination.x,
      y: destination.y,
      sessionEpoch: sql`${hero.sessionEpoch} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(hero.id, profile.id), eq(hero.sessionEpoch, profile.sessionEpoch)))
    .returning({ sessionEpoch: hero.sessionEpoch })
    .get();
  return updated?.sessionEpoch ?? null;
}

export async function relocateHero(
  db: Db,
  fenced: { id: string; sessionEpoch: number },
  destination: { mapId: string; x: number; y: number },
): Promise<boolean> {
  const updated = await db
    .update(hero)
    .set({ ...destination, updatedAt: new Date() })
    .where(and(eq(hero.id, fenced.id), eq(hero.sessionEpoch, fenced.sessionEpoch)))
    .returning({ id: hero.id })
    .get();
  return updated !== undefined;
}

export async function saveHeroProfile(db: Db, profile: SaveableProfile): Promise<boolean> {
  const equipment = isEquipmentForClass(profile.equipment, profile.class)
    ? profile.equipment
    : starterEquipmentFor(profile.class);
  const consumables = normalizeConsumables(
    profile.inventory.consumables,
    profile.inventory.potions,
  );
  const chapter = profile.quest.chapter ?? "three_offerings";
  const now = Date.now();
  const cooldowns = normalizeCombatCooldowns(profile.cooldowns, now);
  const statements: D1PreparedStatement[] = [
    db.$client
      .prepare(
        `UPDATE hero SET
          x = ?, y = ?, level = ?, xp = ?, hp = ?, gold = ?, crystals = ?,
          resource_current = ?, combat_cooldowns = ?, consumable_cooldown_until = ?,
          damage_boost_until = ?, forgotten_until = ?, invisible_until = ?, resurrection_at = ?,
          talents = ?, life = ?, corpse_x = ?, corpse_y = ?, updated_at = ?
         WHERE id = ? AND session_epoch = ?
         RETURNING id`,
      )
      .bind(
        profile.x,
        profile.y,
        profile.level,
        profile.xp,
        profile.hp,
        Math.max(0, profile.inventory.gold),
        Math.max(0, profile.inventory.crystals),
        profile.resource?.current ?? null,
        JSON.stringify(cooldowns),
        safeDeadline(profile.consumableCooldownUntil ?? 0),
        safeDeadline(profile.damageBoostUntil ?? 0),
        safeDeadline(profile.forgottenUntil ?? 0),
        safeDeadline(profile.invisibleUntil ?? 0),
        safeDeadline(profile.resurrectionAt ?? 0),
        JSON.stringify(normalizeTalentSelection(profile.class, profile.level, profile.talents)),
        profile.life,
        profile.corpse?.x ?? null,
        profile.corpse?.y ?? null,
        now,
        profile.id,
        profile.sessionEpoch,
      ),
  ];
  const consumableEntries = Object.entries(consumables);
  const consumableValues = consumableEntries.map(() => "(?, ?, ?)").join(", ");
  statements.push(
    db.$client
      .prepare(
        `WITH items(item_id, definition_id, quantity) AS (VALUES ${consumableValues})
         INSERT INTO hero_item (id, hero_id, item_definition_id, quantity, created_at)
         SELECT items.item_id, owner.id, items.definition_id, items.quantity, ?
         FROM hero AS owner
         JOIN items ON 1 = 1
         WHERE owner.id = ? AND owner.session_epoch = ?
         ON CONFLICT(hero_id, item_definition_id) DO UPDATE SET quantity = excluded.quantity`,
      )
      .bind(
        ...consumableEntries.flatMap(([definitionId, quantity]) => [
          ownedItemId(profile.id, definitionId),
          definitionId,
          quantity,
        ]),
        now,
        profile.id,
        profile.sessionEpoch,
      ),
  );

  const equippedItems: Array<{
    slot: "main_hand" | "off_hand";
    itemId: string;
    definitionId: string;
  }> = [];
  const emptySlots: Array<"main_hand" | "off_hand"> = [];
  for (const [slot, definitionId] of [
    ["main_hand", equipment.mainHand],
    ["off_hand", equipment.offHand],
  ] as const) {
    if (definitionId === null) {
      emptySlots.push(slot);
      continue;
    }
    equippedItems.push({ slot, definitionId, itemId: ownedItemId(profile.id, definitionId) });
  }
  if (emptySlots.length > 0) {
    statements.push(
      db.$client
        .prepare(
          `DELETE FROM hero_equipment
           WHERE hero_id = ? AND slot IN (${emptySlots.map(() => "?").join(", ")})
             AND EXISTS (SELECT 1 FROM hero WHERE id = ? AND session_epoch = ?)`,
        )
        .bind(profile.id, ...emptySlots, profile.id, profile.sessionEpoch),
    );
  }
  if (equippedItems.length > 0) {
    const itemValues = equippedItems.map(() => "(?, ?)").join(", ");
    const equipmentValues = equippedItems.map(() => "(?, ?)").join(", ");
    statements.push(
      db.$client
        .prepare(
          `WITH items(item_id, definition_id) AS (VALUES ${itemValues})
           INSERT INTO hero_item (id, hero_id, item_definition_id, quantity, created_at)
           SELECT items.item_id, owner.id, items.definition_id, 1, ?
           FROM hero AS owner
           JOIN items ON 1 = 1
           WHERE owner.id = ? AND owner.session_epoch = ?
           ON CONFLICT(hero_id, item_definition_id) DO NOTHING`,
        )
        .bind(
          ...equippedItems.flatMap((item) => [item.itemId, item.definitionId]),
          now,
          profile.id,
          profile.sessionEpoch,
        ),
      db.$client
        .prepare(
          `WITH equipment(slot, item_id) AS (VALUES ${equipmentValues})
           INSERT INTO hero_equipment (hero_id, slot, hero_item_id, equipped_at)
           SELECT owner.id, equipment.slot, equipment.item_id, ?
           FROM hero AS owner
           JOIN equipment ON 1 = 1
           WHERE owner.id = ? AND owner.session_epoch = ?
           ON CONFLICT(hero_id, slot) DO UPDATE SET
             hero_item_id = excluded.hero_item_id, equipped_at = excluded.equipped_at`,
        )
        .bind(
          ...equippedItems.flatMap((item) => [item.slot, item.itemId]),
          now,
          profile.id,
          profile.sessionEpoch,
        ),
    );
  }
  statements.push(
    db.$client
      .prepare(
        `INSERT INTO hero_quest
          (hero_id, quest_id, status, progress, accepted_at, completed_at, data)
         SELECT id, ?, ?, ?,
           CASE WHEN ? = 'available' THEN NULL ELSE ? END,
           CASE WHEN ? = 'completed' THEN ? ELSE NULL END, ?
         FROM hero WHERE id = ? AND session_epoch = ?
         ON CONFLICT(hero_id, quest_id) DO UPDATE SET
           status = excluded.status,
           progress = excluded.progress,
           accepted_at = COALESCE(hero_quest.accepted_at, excluded.accepted_at),
           completed_at = excluded.completed_at,
           data = excluded.data
         WHERE hero_quest.reward_claim_id IS NULL OR excluded.status = 'completed'`,
      )
      .bind(
        chapter,
        profile.quest.status,
        profile.quest.progress,
        profile.quest.status,
        now,
        profile.quest.status,
        now,
        profile.wardRunExpiresAt === null
          ? null
          : JSON.stringify({ wardRunExpiresAt: profile.wardRunExpiresAt }),
        profile.id,
        profile.sessionEpoch,
      ),
  );
  const persistedSkills = CLASS_SKILLS[profile.class].map((skill) => {
    const unlocked = isSkillUnlocked(profile.level, skill.slot);
    return {
      id: skill.id,
      unlocked: unlocked ? 1 : 0,
      equipped: unlocked ? 1 : 0,
      slot: unlocked ? skill.slot : null,
      unlockedAt: unlocked ? now : null,
    };
  });
  const skillValues = persistedSkills.map(() => "(?, ?, ?, ?, ?)").join(", ");
  statements.push(
    db.$client
      .prepare(
        `WITH skills(skill_id, unlocked, equipped, slot, unlocked_at) AS (VALUES ${skillValues})
         INSERT INTO hero_skill (hero_id, skill_id, unlocked, equipped, slot, unlocked_at)
         SELECT owner.id, skills.skill_id, skills.unlocked, skills.equipped,
           skills.slot, skills.unlocked_at
         FROM hero AS owner
         JOIN skills ON 1 = 1
         WHERE owner.id = ? AND owner.session_epoch = ?
         ON CONFLICT(hero_id, skill_id) DO UPDATE SET
           unlocked = excluded.unlocked,
           equipped = excluded.equipped,
           slot = excluded.slot,
           unlocked_at = COALESCE(hero_skill.unlocked_at, excluded.unlocked_at)`,
      )
      .bind(
        ...persistedSkills.flatMap((skill) => [
          skill.id,
          skill.unlocked,
          skill.equipped,
          skill.slot,
          skill.unlockedAt,
        ]),
        profile.id,
        profile.sessionEpoch,
      ),
  );
  const results = await db.$client.batch(statements);
  return (results[0]?.results.length ?? 0) === 1;
}
