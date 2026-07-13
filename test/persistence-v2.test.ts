import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimQuestReward,
  consumeOwnedItem,
  equipOwnedItem,
  listCharacterQuests,
  loadCharacterSkills,
} from "../src/server/character-persistence.js";
import { createCharacter } from "../src/server/characters.js";
import {
  account,
  character,
  characterEquipment,
  characterItem,
  characterQuest,
  createDb,
} from "../src/server/db/index.js";
import { HEALTH_POTION_ID, ownedItemId } from "../src/server/items.js";
import { handoffProfileLocation, loadProfile, saveProfile } from "../src/server/profile.js";
import { starterEquipmentFor } from "../src/shared/character.js";

let sequence = 0;

async function legacyCharacter() {
  const suffix = ++sequence;
  const accountId = `legacy-account-${suffix}`;
  const characterId = `legacy-character-${suffix}`;
  const db = createDb(env.DB);
  await db.insert(account).values({
    id: accountId,
    username: `legacy${suffix}`,
    passwordHash: "hash",
    passwordSalt: "salt",
    passwordIterations: 1,
  });
  await db.insert(character).values({
    id: characterId,
    accountId,
    name: "LegacyHero",
    x: 333,
    y: 444,
    level: 7,
    xp: 61,
    hp: 72,
    class: "warrior",
    potions: 5,
    gold: 23,
    crystals: 4,
    mainHand: "weathered_sword",
    offHand: "oak_shield",
    questChapter: "mire_runes",
    questStatus: "active",
    questProgress: 2,
    zoneId: "mmo-test-zone",
    instanceId: "main",
    wardRunExpiresAt: new Date(9_000_000),
    persistenceVersion: 0,
  });
  return { db, accountId, characterId };
}

async function normalizedCharacter(playerClass: "warrior" | "ranger" = "warrior") {
  const suffix = ++sequence;
  const accountId = `account-v2-${suffix}`;
  const db = createDb(env.DB);
  await db.insert(account).values({
    id: accountId,
    username: `normal${suffix}`,
    passwordHash: "hash",
    passwordSalt: "salt",
    passwordIterations: 1,
  });
  const created = await createCharacter(
    db,
    accountId,
    `Hero${suffix}`,
    { body: "wayfarer", primaryColor: "azure" },
    playerClass,
  );
  if (created === "limit_reached") throw new Error("unexpected character limit");
  return { db, accountId, characterId: created.id };
}

describe("normalized character persistence", () => {
  afterEach(async () => {
    await env.DB.exec("DELETE FROM character");
    await env.DB.exec("DELETE FROM account");
  });

  it("installs the five normalized persistence tables", async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN (
         'item_definition', 'character_item', 'character_equipment',
         'character_skill', 'character_quest'
       ) ORDER BY name`,
    ).all<{ name: string }>();
    expect(results.map((row) => row.name)).toEqual([
      "character_equipment",
      "character_item",
      "character_quest",
      "character_skill",
      "item_definition",
    ]);
  });

  it("migrates an old character without losing core progression or location", async () => {
    const { db, characterId } = await legacyCharacter();
    const profile = await loadProfile(db, characterId);

    expect(profile).toMatchObject({
      x: 333,
      y: 444,
      level: 7,
      xp: 61,
      hp: 72,
      zoneId: "mmo-test-zone",
      instanceId: "main",
      inventory: { gold: 23, crystals: 4 },
    });
    expect(
      await db
        .select({ version: character.persistenceVersion })
        .from(character)
        .where(eq(character.id, characterId)),
    ).toEqual([{ version: 1 }]);
  });

  it("preserves the legacy character's owned items", async () => {
    const { db, characterId } = await legacyCharacter();
    await loadProfile(db, characterId);
    const items = await db
      .select()
      .from(characterItem)
      .where(eq(characterItem.characterId, characterId));

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemDefinitionId: HEALTH_POTION_ID, quantity: 5 }),
        expect.objectContaining({ itemDefinitionId: "weathered_sword", quantity: 1 }),
        expect.objectContaining({ itemDefinitionId: "oak_shield", quantity: 1 }),
      ]),
    );
  });

  it("preserves the legacy character's equipment", async () => {
    const { db, characterId } = await legacyCharacter();
    const profile = await loadProfile(db, characterId);
    expect(profile?.equipment).toEqual(starterEquipmentFor("warrior"));
    expect(await db.select().from(characterEquipment)).toHaveLength(2);
  });

  it("preserves the legacy character's current quest", async () => {
    const { db, characterId } = await legacyCharacter();
    const profile = await loadProfile(db, characterId);
    expect(profile?.quest).toMatchObject({
      chapter: "mire_runes",
      status: "active",
      progress: 2,
    });
    expect(await listCharacterQuests(db, characterId)).toHaveLength(1);
  });

  it("persists level-derived skill unlocks and equipped slots", async () => {
    const { db, characterId } = await legacyCharacter();
    await loadProfile(db, characterId);
    const skills = await loadCharacterSkills(db, characterId);
    expect(skills.filter((skill) => skill.unlocked).map((skill) => skill.slot)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(skills.find((skill) => skill.skillId === "whirlwind")).toMatchObject({
      unlocked: false,
      equipped: false,
      slot: null,
    });
  });

  it("consumes one potion atomically", async () => {
    const { db, characterId } = await normalizedCharacter();
    expect(await consumeOwnedItem(db, characterId, HEALTH_POTION_ID)).toBe(1);
    expect((await loadProfile(db, characterId))?.inventory.potions).toBe(1);
  });

  it("cannot consume the same last potion twice", async () => {
    const { db, characterId } = await normalizedCharacter();
    await db
      .update(characterItem)
      .set({ quantity: 1 })
      .where(eq(characterItem.itemDefinitionId, HEALTH_POTION_ID));

    const results = await Promise.all([
      consumeOwnedItem(db, characterId, HEALTH_POTION_ID),
      consumeOwnedItem(db, characterId, HEALTH_POTION_ID),
    ]);
    expect(results).toEqual(expect.arrayContaining([0, null]));
  });

  it("rejects a negative owned-item quantity", async () => {
    const { db, characterId } = await normalizedCharacter();
    await expect(
      db
        .update(characterItem)
        .set({ quantity: -1 })
        .where(eq(characterItem.characterId, characterId)),
    ).rejects.toThrow();
  });

  it("cannot equip an item owned by another character", async () => {
    const first = await normalizedCharacter();
    const second = await normalizedCharacter();
    expect(
      await equipOwnedItem(
        first.db,
        first.characterId,
        ownedItemId(second.characterId, "weathered_sword"),
        "main_hand",
      ),
    ).toBe(false);
  });

  it("cannot equip an item incompatible with the character class", async () => {
    const { db, characterId } = await normalizedCharacter("warrior");
    await db.insert(characterItem).values({
      id: ownedItemId(characterId, "hunter_bow"),
      characterId,
      itemDefinitionId: "hunter_bow",
      quantity: 1,
    });
    expect(
      await equipOwnedItem(db, characterId, ownedItemId(characterId, "hunter_bow"), "main_hand"),
    ).toBe(false);
  });

  it("awards a ready quest only once", async () => {
    const { db, characterId } = await normalizedCharacter();
    await db
      .update(characterQuest)
      .set({ status: "ready", progress: 3 })
      .where(eq(characterQuest.characterId, characterId));
    const input = {
      characterId,
      sessionEpoch: 0,
      questId: "three_offerings",
      rewardGold: 8,
      rewardPotions: 1,
      resultingLevel: 1,
      resultingXp: 20,
      resultingHp: 100,
    };

    expect(await claimQuestReward(db, input)).toBe(true);
    expect(await claimQuestReward(db, input)).toBe(false);
    const profile = await loadProfile(db, characterId);
    expect(profile?.inventory).toMatchObject({ gold: 8, potions: 3 });
    expect(profile?.xp).toBe(20);
  });

  it("allows several persistent quests to coexist", async () => {
    const { db, characterId } = await normalizedCharacter();
    await db.insert(characterQuest).values({
      characterId,
      questId: "bone_choir",
      status: "active",
      progress: 1,
      acceptedAt: new Date(),
    });
    expect(await listCharacterQuests(db, characterId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ questId: "three_offerings" }),
        expect.objectContaining({ questId: "bone_choir" }),
      ]),
    );
  });

  it("reconnects with inventory read from the normalized tables", async () => {
    const { db, characterId } = await normalizedCharacter();
    const profile = await loadProfile(db, characterId);
    if (!profile) throw new Error("missing profile");
    profile.inventory.potions = 7;
    expect(await saveProfile(db, profile)).toBe(true);

    expect((await loadProfile(db, characterId))?.inventory.potions).toBe(7);
  });

  it("preserves normalized inventory through a zone handoff", async () => {
    const { db, characterId } = await normalizedCharacter();
    const profile = await loadProfile(db, characterId);
    if (!profile) throw new Error("missing profile");
    profile.inventory.potions = 6;
    expect(await saveProfile(db, profile)).toBe(true);
    expect(
      await handoffProfileLocation(db, profile, {
        zoneId: "mmo-test-zone",
        instanceId: "main",
        x: 120,
        y: 160,
      }),
    ).toBe(1);

    expect(await loadProfile(db, characterId)).toMatchObject({
      zoneId: "mmo-test-zone",
      instanceId: "main",
      inventory: { potions: 6 },
    });
  });
});
