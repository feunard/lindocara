import { and, eq, sql } from "drizzle-orm";
import { type PrimaryColor, starterEquipmentFor } from "../shared/character.js";
import { isLifeState, type LifeState } from "../shared/death.js";
import { clampRestoredPosition, isWalkable, maxHpForLevel } from "../shared/game.js";
import { terrainFromMap } from "../shared/map-data.js";
import { initialResource } from "../shared/resources.js";
import type { Vec2 } from "../shared/simulation.js";
import { normalizeTalentSelection } from "../shared/talents.js";
import { type Db, hero, partyMember } from "./db/index.js";
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
  const resource = initialResource(row.class);
  return {
    id: row.id,
    nick: row.name,
    ...position,
    level,
    xp: Math.max(0, row.xp),
    hp: Math.min(maxHpForLevel(level), Math.max(life.life === "alive" ? 1 : 0, row.hp)),
    appearance: { body: "wayfarer", primaryColor: COLOR_TO_APPEARANCE[membership.color] },
    class: row.class,
    equipment: starterEquipmentFor(row.class),
    inventory: { potions: 2, gold: 0, crystals: 0 },
    quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
    zoneId: row.mapId,
    instanceId: "main",
    sessionEpoch: Math.max(0, row.sessionEpoch),
    wardRunExpiresAt: null,
    ...life,
    ...(resource ? { resource } : {}),
    talents: talentsFromRow(row.class, level, row.talents),
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
  const updated = await db
    .update(hero)
    .set({
      x: profile.x,
      y: profile.y,
      level: profile.level,
      xp: profile.xp,
      hp: profile.hp,
      talents: JSON.stringify(
        normalizeTalentSelection(profile.class, profile.level, profile.talents),
      ),
      life: profile.life,
      corpseX: profile.corpse?.x ?? null,
      corpseY: profile.corpse?.y ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(hero.id, profile.id), eq(hero.sessionEpoch, profile.sessionEpoch)))
    .returning({ id: hero.id })
    .get();
  return updated !== undefined;
}
