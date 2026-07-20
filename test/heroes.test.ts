/**
 * The heroes boundary: create in a party you belong to (with the start position resolved from the
 * adventure), the 3-hero cap, non-member refusal, owner-scoped list and delete. The starting
 * position comes from the start map's entry marker (door at col 5,row 5 → pixel centre).
 */
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { updateAdventure } from "../src/server/adventures.js";
import { account, createDb } from "../src/server/db/index.js";
import {
  claimHeroQuestReward,
  consumeHeroOwnedItem,
  loadHeroSkills,
  loadNormalizedHeroState,
} from "../src/server/hero-persistence.js";
import { acquireHeroEpoch, loadHeroProfile, saveHeroProfile } from "../src/server/hero-profile.js";
import { createHero, deleteHero, listHeroes } from "../src/server/heroes.js";
import { HEALTH_POTION_ID } from "../src/server/items.js";
import type { MapInput } from "../src/server/maps.js";
import { createParty, joinParty } from "../src/server/parties.js";
import type { AdventureInput } from "../src/shared/adventure.js";
import { EMPTY_MARKERS } from "../src/shared/map-data.js";
import { functionalEvent, type MapEvent } from "../src/shared/map-events.js";
import { TILE_SIZE } from "../src/shared/tilemap.js";
import { authorMap, seedAdventure } from "./support/adventure-fixtures.js";
import { layeredTerrain } from "./support/map-fixtures.js";

const COLS = 20;
const ROWS = 15;

// UX wave #12: the graph binds entry/exit EVENT uuids. Map A and map B use distinct uuid families
// because a `map_event` id is a global primary key.
const ENTRY_A = "aaaaaaaa-0000-4000-8000-000000000001";
const EXIT_A = "aaaaaaaa-0000-4000-8000-000000000002";
const ENTRY_B = "bbbbbbbb-0000-4000-8000-000000000001";
const EXIT_B = "bbbbbbbb-0000-4000-8000-000000000002";

function blocks(): string[] {
  const rows: string[] = [];
  while (rows.length < ROWS) rows.push(".".repeat(COLS));
  return rows;
}

function ev(id: string, kind: "entry" | "exit", col: number, row: number): MapEvent {
  return functionalEvent({ id, col, row, ordinal: 0, kind });
}

function eventsB(): MapEvent[] {
  return [ev(ENTRY_B, "entry", 5, 5), ev(EXIT_B, "exit", 7, 7)];
}

function mapInput(
  name: string,
  events: MapEvent[] = [ev(ENTRY_A, "entry", 5, 5), ev(EXIT_A, "exit", 7, 7)],
): MapInput {
  return {
    name,
    ...layeredTerrain(blocks()),
    elements: [],
    spawn: { col: 0, row: 0 },
    markers: EMPTY_MARKERS,
    events,
  };
}

async function seedAccount(id: string): Promise<void> {
  await createDb(env.DB)
    .insert(account)
    .values({ id, username: id, passwordHash: "h", passwordSalt: "s", passwordIterations: 1 });
}

function adventureGraph(a: string, b: string): AdventureInput {
  return {
    title: "Donjon",
    maxPlayers: 4,
    graph: {
      start: { mapId: a, entryId: ENTRY_A },
      links: [
        { mapId: a, exitId: EXIT_A, dest: { mapId: b, entryId: ENTRY_B } },
        { mapId: b, exitId: EXIT_B, dest: "end" },
      ],
    },
  };
}

/** Returns the party id and the start map id. */
async function seedParty(hostId: string): Promise<{ partyId: string; startMapId: string }> {
  const db = createDb(env.DB);
  const adventureId = await seedAdventure(db, hostId, "Donjon");
  const mapA = await authorMap(db, hostId, adventureId, mapInput("A"));
  const mapB = await authorMap(db, hostId, adventureId, mapInput("B", eventsB()));
  await updateAdventure(db, hostId, adventureId, adventureGraph(mapA.id, mapB.id));
  const party = await createParty(db, hostId, {
    adventureId,
    name: null,
    color: "blue",
  });
  return { partyId: party.id, startMapId: mapA.id };
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM hero");
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
  await env.DB.exec("DELETE FROM character");
  await env.DB.exec("DELETE FROM account");
});

describe("createHero", () => {
  it("creates a hero on the adventure's start entry and scopes the list to the owner", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    const { partyId, startMapId } = await seedParty("host");

    const hero = await createHero(db, "host", partyId, { name: "Mira", class: "priest" });
    expect(hero).toMatchObject({
      partyId,
      accountId: "host",
      name: "Mira",
      class: "priest",
      mapId: startMapId,
      x: 5 * TILE_SIZE + TILE_SIZE / 2,
      y: 5 * TILE_SIZE + TILE_SIZE / 2,
      level: 1,
      hp: 100,
      life: "alive",
    });

    const mine = await listHeroes(db, "host", partyId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.id).toBe(hero.id);

    const row = await db.query.hero.findFirst({ where: (table, { eq }) => eq(table.id, hero.id) });
    if (!row) throw new Error("missing created hero row");
    const normalized = await loadNormalizedHeroState(db, row);
    expect(normalized).toMatchObject({
      consumables: { health_potion: 2 },
      equipment: { mainHand: "heartwood_staff", offHand: null },
      quest: { chapter: "three_offerings", status: "available", progress: 0 },
    });
    const skills = await loadHeroSkills(db, hero.id);
    expect(skills).toHaveLength(5);
    expect(skills.find((skill) => skill.slot === 1)).toMatchObject({
      skillId: "radiant_bolt",
      unlocked: true,
      equipped: true,
    });
  });

  it("round-trips normalized progression and fences every stale child-table write", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    const { partyId } = await seedParty("host");
    const created = await createHero(db, "host", partyId, { name: "Mira", class: "priest" });
    expect(await acquireHeroEpoch(db, created.id)).toBe(1);
    const profile = await loadHeroProfile(db, created.id);
    if (!profile) throw new Error("missing hero profile");
    const now = Date.now();
    profile.inventory = {
      potions: 4,
      gold: 17,
      crystals: 3,
      consumables: {
        health_potion: 4,
        mana_potion: 3,
        damage_elixir: 1,
        oblivion_draught: 1,
        invisibility_potion: 2,
        resurrection_potion: 1,
      },
    };
    profile.quest = {
      chapter: "three_offerings",
      status: "active",
      progress: 2,
      target: 3,
    };
    if (!profile.resource) throw new Error("priest resource missing");
    profile.resource.current = 37;
    profile.cooldowns = {
      attackUntil: now + 200,
      healUntil: now + 500,
      skillCooldowns: [0, now + 1_000, 0, 0, 0],
      guardUntil: 0,
      resurrectUntil: 0,
    };
    profile.consumableCooldownUntil = now + 1_000;
    profile.damageBoostUntil = now + 2_000;
    profile.invisibleUntil = now + 2_000;
    expect(await saveHeroProfile(db, profile)).toBe(true);

    const restored = await loadHeroProfile(db, created.id);
    expect(restored).toMatchObject({
      inventory: {
        potions: 4,
        gold: 17,
        crystals: 3,
        consumables: { health_potion: 4, mana_potion: 3, invisibility_potion: 2 },
      },
      quest: { chapter: "three_offerings", status: "active", progress: 2 },
      resource: { kind: "mana", current: 37, max: 100 },
      consumableCooldownUntil: profile.consumableCooldownUntil,
      damageBoostUntil: profile.damageBoostUntil,
      invisibleUntil: profile.invisibleUntil,
    });
    expect(restored?.cooldowns?.skillCooldowns[1]).toBe(profile.cooldowns.skillCooldowns[1]);

    expect(await acquireHeroEpoch(db, created.id)).toBe(2);
    profile.inventory.gold = 999;
    if (!profile.inventory.consumables) throw new Error("consumable fixture missing");
    profile.inventory.consumables.mana_potion = 999;
    expect(await saveHeroProfile(db, profile)).toBe(false);
    expect(await consumeHeroOwnedItem(db, created.id, 1, HEALTH_POTION_ID)).toBeNull();
    const fenced = await loadHeroProfile(db, created.id);
    expect(fenced?.inventory.gold).toBe(17);
    expect(fenced?.inventory.consumables?.mana_potion).toBe(3);
    expect(fenced?.inventory.potions).toBe(4);
  });

  it("claims a hero quest reward exactly once", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    const { partyId } = await seedParty("host");
    const created = await createHero(db, "host", partyId, { name: "Mira", class: "priest" });
    expect(await acquireHeroEpoch(db, created.id)).toBe(1);
    const profile = await loadHeroProfile(db, created.id);
    if (!profile) throw new Error("missing hero profile");
    profile.quest.status = "ready";
    profile.quest.progress = profile.quest.target;
    expect(await saveHeroProfile(db, profile)).toBe(true);
    const reward = {
      heroId: created.id,
      sessionEpoch: 1,
      questId: "three_offerings",
      rewardGold: 9,
      rewardPotions: 1,
      resultingLevel: 2,
      resultingXp: 7,
      resultingHp: 112,
    };
    expect(await claimHeroQuestReward(db, reward)).toBe(true);
    expect(await claimHeroQuestReward(db, reward)).toBe(false);
    const restored = await loadHeroProfile(db, created.id);
    expect(restored).toMatchObject({
      level: 2,
      xp: 7,
      hp: 112,
      inventory: { gold: 9, potions: 3 },
      quest: { status: "completed" },
    });
  });

  it("refuses a non-member and caps at three heroes per player", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    await seedAccount("outsider");
    const { partyId } = await seedParty("host");

    await expect(
      createHero(db, "outsider", partyId, { name: "Sneak", class: "warrior" }),
    ).rejects.toThrow(/^not_member:/);

    await createHero(db, "host", partyId, { name: "One", class: "warrior" });
    await createHero(db, "host", partyId, { name: "Two", class: "ranger" });
    await createHero(db, "host", partyId, { name: "Three", class: "priest" });
    await expect(
      createHero(db, "host", partyId, { name: "Four", class: "warrior" }),
    ).rejects.toThrow(/^cap:/);

    await expect(
      createHero(db, "host", "no-such-party", { name: "Ghost", class: "warrior" }),
    ).rejects.toThrow(/^not_found:/);
  });

  it("keeps each member's heroes separate", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    await seedAccount("mate");
    const { partyId } = await seedParty("host");
    await joinParty(db, "mate", partyId, "red");

    await createHero(db, "host", partyId, { name: "Hostling", class: "warrior" });
    await createHero(db, "mate", partyId, { name: "Matey", class: "ranger" });

    expect(await listHeroes(db, "host", partyId)).toHaveLength(1);
    expect((await listHeroes(db, "mate", partyId))[0]?.name).toBe("Matey");
  });

  it("never exceeds the cap when two creations race for the last slot", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    const { partyId } = await seedParty("host");
    await createHero(db, "host", partyId, { name: "One", class: "warrior" });
    await createHero(db, "host", partyId, { name: "Two", class: "ranger" });

    const outcomes = await Promise.allSettled([
      createHero(db, "host", partyId, { name: "Three-A", class: "priest" }),
      createHero(db, "host", partyId, { name: "Three-B", class: "warrior" }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({ message: expect.stringMatching(/^cap:/) });
    expect(await listHeroes(db, "host", partyId)).toHaveLength(3);
  });
});

describe("deleteHero", () => {
  it("deletes only the caller's own hero", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    await seedAccount("mate");
    const { partyId } = await seedParty("host");
    await joinParty(db, "mate", partyId, "red");
    const mine = await createHero(db, "host", partyId, { name: "Mine", class: "warrior" });

    await expect(deleteHero(db, "mate", partyId, mine.id)).rejects.toThrow(/^not_found:/);
    await deleteHero(db, "host", partyId, mine.id);
    expect(await listHeroes(db, "host", partyId)).toEqual([]);
  });
});
