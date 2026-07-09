import { eq } from "drizzle-orm";
import { clampRestoredPosition, maxHpForLevel, spawnPosition } from "../shared/game.js";
import type { Appearance, Inventory, QuestState } from "../shared/protocol.js";
import type { Vec2 } from "../shared/simulation.js";
import { type Db, player } from "./db/index.js";

export interface PlayerProfile extends Vec2 {
  id: string;
  nick: string;
  level: number;
  xp: number;
  hp: number;
  appearance: Appearance;
  inventory: Inventory;
  quest: QuestState;
}

const APPEARANCES: readonly Appearance[] = ["azure", "ember", "moss", "violet"];

function appearanceForId(id: string): Appearance {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return APPEARANCES[hash % APPEARANCES.length] ?? "azure";
}

function fromRow(row: typeof player.$inferSelect): PlayerProfile {
  const position = clampRestoredPosition({ x: row.x, y: row.y });
  const maxHp = maxHpForLevel(row.level);
  return {
    id: row.id,
    nick: row.nick,
    ...position,
    level: Math.max(1, row.level),
    xp: Math.max(0, row.xp),
    hp: Math.min(maxHp, Math.max(1, row.hp)),
    appearance: row.appearance,
    inventory: {
      potions: Math.max(0, row.potions),
      gold: Math.max(0, row.gold),
      crystals: Math.max(0, row.crystals),
      weapon: row.weapon,
    },
    quest: {
      status: row.questStatus,
      progress: Math.max(0, row.questProgress),
      target: 3,
    },
  };
}

export async function loadOrCreateProfile(
  db: Db,
  id: string,
  nick: string,
): Promise<PlayerProfile> {
  const existing = await db.select().from(player).where(eq(player.id, id)).get();
  if (existing) {
    await db.update(player).set({ nick, lastSeenAt: new Date() }).where(eq(player.id, id));
    return fromRow({ ...existing, nick });
  }

  const position = spawnPosition();
  const appearance = appearanceForId(id);
  await db.insert(player).values({
    id,
    nick,
    ...position,
    appearance,
    hp: maxHpForLevel(1),
  });
  const created = await db.select().from(player).where(eq(player.id, id)).get();
  if (!created) throw new Error("player profile insert did not return a row");
  return fromRow(created);
}

export type SaveableProfile = PlayerProfile;

export async function saveProfile(db: Db, profile: SaveableProfile): Promise<void> {
  await db
    .update(player)
    .set({
      nick: profile.nick,
      x: profile.x,
      y: profile.y,
      level: profile.level,
      xp: profile.xp,
      hp: profile.hp,
      appearance: profile.appearance,
      potions: profile.inventory.potions,
      gold: profile.inventory.gold,
      crystals: profile.inventory.crystals,
      weapon: profile.inventory.weapon,
      questStatus: profile.quest.status,
      questProgress: profile.quest.progress,
      lastSeenAt: new Date(),
    })
    .where(eq(player.id, profile.id));
}
