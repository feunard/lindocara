/**
 * The heroes boundary: create in a party you belong to (with the start position resolved from the
 * adventure), the 3-hero cap, non-member refusal, owner-scoped list and delete. The starting
 * position comes from the start map's entry marker (door at col 5,row 5 → pixel centre).
 */
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { createAdventure } from "../src/server/adventures.js";
import { account, createDb } from "../src/server/db/index.js";
import { createHero, deleteHero, listHeroes } from "../src/server/heroes.js";
import { createMap, type MapInput } from "../src/server/maps.js";
import { createParty, joinParty } from "../src/server/parties.js";
import type { AdventureInput } from "../src/shared/adventure.js";
import { TILE_SIZE } from "../src/shared/tilemap.js";
import { layeredTerrain } from "./support/map-fixtures.js";

const COLS = 20;
const ROWS = 15;

function blocks(): string[] {
  const rows: string[] = [];
  while (rows.length < ROWS) rows.push(".".repeat(COLS));
  return rows;
}

function mapInput(name: string): MapInput {
  return {
    name,
    ...layeredTerrain(blocks()),
    elements: [],
    spawn: { col: 0, row: 0 },
    markers: {
      entries: [{ id: "door", col: 5, row: 5 }],
      exits: [{ id: "gate", col: 7, row: 7 }],
      monsterSpawns: [],
    },
  };
}

async function seedAccount(id: string): Promise<void> {
  await createDb(env.DB)
    .insert(account)
    .values({ id, username: id, passwordHash: "h", passwordSalt: "s", passwordIterations: 1 });
}

function adventureInput(mapIds: string[]): AdventureInput {
  const [a, b] = mapIds;
  if (!a || !b) throw new Error("expected two maps");
  return {
    title: "Donjon",
    maxPlayers: 4,
    mapIds,
    graph: {
      start: { mapId: a, entryId: "door" },
      links: [
        { mapId: a, exitId: "gate", dest: { mapId: b, entryId: "door" } },
        { mapId: b, exitId: "gate", dest: "end" },
      ],
    },
  };
}

/** Returns the party id and the start map id. */
async function seedParty(hostId: string): Promise<{ partyId: string; startMapId: string }> {
  const db = createDb(env.DB);
  const mapA = await createMap(db, hostId, mapInput("A"));
  const mapB = await createMap(db, hostId, mapInput("B"));
  const adventure = await createAdventure(db, hostId, adventureInput([mapA.id, mapB.id]));
  const party = await createParty(db, hostId, {
    adventureId: adventure.id,
    name: null,
    color: "blue",
  });
  return { partyId: party.id, startMapId: mapA.id };
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM hero");
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM adventure_map");
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
