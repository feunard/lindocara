/**
 * The parties boundary: create-from-owned-adventure, public listing, join with colour/cap/dup
 * fencing, host-only delete, and the adventure-delete guard. Truncate children before parents.
 */
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { createAdventure, deleteAdventure } from "../src/server/adventures.js";
import { account, createDb } from "../src/server/db/index.js";
import { createMap, type MapInput } from "../src/server/maps.js";
import { createParty, deleteParty, joinParty, listPublicParties } from "../src/server/parties.js";
import type { AdventureInput } from "../src/shared/adventure.js";
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

function adventureInput(mapIds: string[], maxPlayers: number): AdventureInput {
  const [a, b] = mapIds;
  if (!a || !b) throw new Error("expected two maps");
  return {
    title: "Donjon",
    maxPlayers,
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

async function seedAdventure(accountId: string, maxPlayers = 4): Promise<string> {
  const db = createDb(env.DB);
  const mapA = await createMap(db, accountId, mapInput("A"));
  const mapB = await createMap(db, accountId, mapInput("B"));
  const created = await createAdventure(
    db,
    accountId,
    adventureInput([mapA.id, mapB.id], maxPlayers),
  );
  return created.id;
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM adventure_map");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
  await env.DB.exec("DELETE FROM character");
  await env.DB.exec("DELETE FROM account");
});

describe("createParty", () => {
  it("creates from an owned adventure, pinning version and cap, host auto-joined", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    const adventureId = await seedAdventure("owner", 3);
    const party = await createParty(db, "owner", { adventureId, name: "Chez Nico", color: "red" });
    expect(party).toMatchObject({
      adventureId,
      adventureVersion: 1,
      maxPlayers: 3,
      hostAccountId: "owner",
      name: "Chez Nico",
      status: "open",
    });
    const listing = await listPublicParties(db, "owner");
    expect(listing).toHaveLength(1);
    expect(listing[0]).toMatchObject({ id: party.id, adventureTitle: "Donjon", colors: ["red"] });
  });

  it("refuses creating from an adventure the caller does not own", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    await seedAccount("rival");
    const adventureId = await seedAdventure("owner");
    await expect(
      createParty(db, "rival", { adventureId, name: null, color: "blue" }),
    ).rejects.toThrow(/^adventure:/);
  });
});

describe("joinParty", () => {
  it("adds a member with a free colour and fences dup account, dup colour, and the cap", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    await seedAccount("p2");
    await seedAccount("p3");
    const adventureId = await seedAdventure("host", 2);
    const party = await createParty(db, "host", { adventureId, name: null, color: "blue" });

    await expect(joinParty(db, "host", party.id, "red")).rejects.toThrow(/^already_member:/);
    await expect(joinParty(db, "p2", party.id, "blue")).rejects.toThrow(/^color_taken:/);

    await joinParty(db, "p2", party.id, "yellow");
    const listing = await listPublicParties(db, "host");
    expect(listing[0]?.colors.sort()).toEqual(["blue", "yellow"]);

    // cap is 2, already full
    await expect(joinParty(db, "p3", party.id, "purple")).rejects.toThrow(/^full:/);
    await expect(joinParty(db, "p2", "missing-party", "red")).rejects.toThrow(/^not_found:/);
  });
});

describe("deleteParty", () => {
  it("lets only the host delete, and cascades members", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    await seedAccount("rival");
    const adventureId = await seedAdventure("host");
    const party = await createParty(db, "host", { adventureId, name: null, color: "blue" });

    await expect(deleteParty(db, "rival", party.id)).rejects.toThrow(/^not_found:/);
    await deleteParty(db, "host", party.id);
    expect(await listPublicParties(db, "host")).toEqual([]);
  });
});

describe("adventure delete guard", () => {
  it("refuses deleting an adventure a party references", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    const adventureId = await seedAdventure("host");
    const party = await createParty(db, "host", { adventureId, name: null, color: "blue" });

    await expect(deleteAdventure(db, "host", adventureId)).rejects.toThrow(/^referenced:/);
    await deleteParty(db, "host", party.id);
    await deleteAdventure(db, "host", adventureId); // free once no party references it
  });
});

describe("joinParty concurrency", () => {
  it("never exceeds the cap when two accounts race for the last slot", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    await seedAccount("p2");
    await seedAccount("p3");
    const adventureId = await seedAdventure("host", 2);
    const party = await createParty(db, "host", { adventureId, name: null, color: "blue" });
    // host holds slot 1; p2 and p3 both race for the single remaining slot, distinct
    // accounts and colours so only the cap fence can reject either.
    const results = await Promise.allSettled([
      joinParty(db, "p2", party.id, "red"),
      joinParty(db, "p3", party.id, "yellow"),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      message: expect.stringMatching(/^full:/),
    });
    const listing = await listPublicParties(db, "host");
    expect(listing[0]?.colors).toHaveLength(2); // cap respected: exactly maxPlayers members
  });

  it("classifies a concurrent colour collision as party_color_taken", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    await seedAccount("p2");
    await seedAccount("p3");
    const adventureId = await seedAdventure("host", 4);
    const party = await createParty(db, "host", { adventureId, name: null, color: "blue" });

    const outcomes = await Promise.allSettled([
      joinParty(db, "p2", party.id, "red"),
      joinParty(db, "p3", party.id, "red"),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({ message: expect.stringMatching(/^color_taken:/) });
  });

  it("classifies two concurrent joins from one account as party_already_member", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    await seedAccount("racer");
    const adventureId = await seedAdventure("host", 4);
    const party = await createParty(db, "host", { adventureId, name: null, color: "blue" });

    const outcomes = await Promise.allSettled([
      joinParty(db, "racer", party.id, "red"),
      joinParty(db, "racer", party.id, "yellow"),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({ message: expect.stringMatching(/^already_member:/) });
  });
});

describe("listPublicParties caller annotation", () => {
  it("marks the caller's own party and colour", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    await seedAccount("guest");
    const adventureId = await seedAdventure("host");
    const party = await createParty(db, "host", { adventureId, name: null, color: "blue" });
    await joinParty(db, "guest", party.id, "red");

    const asHost = await listPublicParties(db, "host");
    expect(asHost[0]).toMatchObject({ mine: true, myColor: "blue" });
    const asGuest = await listPublicParties(db, "guest");
    expect(asGuest[0]).toMatchObject({ mine: true, myColor: "red" });
    const asStranger = await listPublicParties(db, "nobody");
    expect(asStranger[0]).toMatchObject({ mine: false, myColor: null });
  });
});
