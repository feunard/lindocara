/**
 * The parties boundary: create-from-owned-adventure, public listing, join with colour/cap/dup
 * fencing, host-only delete, and the adventure-delete guard. Truncate children before parents.
 */
import { env } from "cloudflare:test";
import type { AdventureInput } from "@lindocara/engine/adventure.js";
import { EMPTY_MARKERS } from "@lindocara/engine/map-data.js";
import { functionalEvent, type MapEvent } from "@lindocara/engine/map-events.js";
import { MAX_HOSTED_PARTIES } from "@lindocara/engine/party.js";
import { createAdventure, deleteAdventure, updateAdventure } from "@lindocara/server/adventures.js";
import { account, createDb } from "@lindocara/server/db/index.js";
import type { MapInput } from "@lindocara/server/maps.js";
import {
  createParty,
  deleteParty,
  joinParty,
  listPublicParties,
  listPublicPartiesPage,
} from "@lindocara/server/parties.js";
import { layeredTerrain } from "@lindocara/testing/map-fixtures.js";
import { afterEach, describe, expect, it } from "vitest";
import { authorMap } from "./adventure-fixtures.js";

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

function adventureGraph(a: string, b: string, maxPlayers: number): AdventureInput {
  return {
    title: "Donjon",
    maxPlayers,
    graph: {
      start: { mapId: a, entryId: ENTRY_A },
      links: [
        { mapId: a, exitId: EXIT_A, dest: { mapId: b, entryId: ENTRY_B } },
        { mapId: b, exitId: EXIT_B, dest: "end" },
      ],
    },
  };
}

async function seedAdventure(accountId: string, maxPlayers = 4): Promise<string> {
  const db = createDb(env.DB);
  const created = await createAdventure(db, accountId, { title: "Donjon", maxPlayers });
  const mapA = await authorMap(db, accountId, created.id, mapInput("A"));
  const mapB = await authorMap(db, accountId, created.id, mapInput("B", eventsB()));
  await updateAdventure(db, accountId, created.id, adventureGraph(mapA.id, mapB.id, maxPlayers));
  return created.id;
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
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

  it("creates from an adventure the caller does not own — the play flow is not owner-fenced", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    await seedAccount("rival");
    const adventureId = await seedAdventure("owner");
    const created = await createParty(db, "rival", { adventureId, name: null, color: "blue" });
    expect(created.adventureId).toBe(adventureId);
    expect(created.hostAccountId).toBe("rival");
  });

  it("refuses a draft adventure with a not_playable code, not a misleading hero error", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    // A draft adventure (created but never given a start) has nowhere for heroes to spawn.
    const draft = await createAdventure(db, "owner", { title: "WIP", maxPlayers: 4 });
    await expect(
      createParty(db, "owner", { adventureId: draft.id, name: null, color: "blue" }),
    ).rejects.toThrow(/^not_playable:/);
  });

  it("atomically enforces the hosted-party quota under a race", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    const adventureId = await seedAdventure("owner");
    const seeded = Array.from({ length: MAX_HOSTED_PARTIES - 1 }, (_, index) =>
      env.DB.prepare(
        `INSERT INTO party
          (id, adventure_id, adventure_version, max_players, host_account_id, name, status,
           created_at, updated_at)
         VALUES (?, ?, 1, 4, 'owner', NULL, 'open', ?, ?)`,
      ).bind(`seeded-${index}`, adventureId, index, index),
    );
    await env.DB.batch(seeded);

    const outcomes = await Promise.allSettled([
      createParty(db, "owner", { adventureId, name: "Last A", color: "red" }),
      createParty(db, "owner", { adventureId, name: "Last B", color: "yellow" }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({ message: expect.stringMatching(/^cap:/) });
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM party WHERE host_account_id = 'owner'",
      ).first<{ count: number }>(),
    ).toEqual({ count: MAX_HOSTED_PARTIES });
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

    await expect(joinParty(db, "host", party.id)).rejects.toThrow(/^already_member:/);

    // Colour is assigned automatically — the host holds "blue", so p2 takes the next free slot.
    await joinParty(db, "p2", party.id);
    const listing = await listPublicParties(db, "host");
    expect(listing[0]?.colors.sort()).toEqual(["blue", "red"]);

    // cap is 2, already full
    await expect(joinParty(db, "p3", party.id)).rejects.toThrow(/^full:/);
    await expect(joinParty(db, "p2", "missing-party")).rejects.toThrow(/^not_found:/);
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
      joinParty(db, "p2", party.id),
      joinParty(db, "p3", party.id),
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
      joinParty(db, "p2", party.id),
      joinParty(db, "p3", party.id),
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
      joinParty(db, "racer", party.id),
      joinParty(db, "racer", party.id),
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
    await joinParty(db, "guest", party.id);

    const asHost = await listPublicParties(db, "host");
    expect(asHost[0]).toMatchObject({ mine: true, myColor: "blue" });
    const asGuest = await listPublicParties(db, "guest");
    expect(asGuest[0]).toMatchObject({ mine: true, myColor: "red" });
    const asStranger = await listPublicParties(db, "nobody");
    expect(asStranger[0]).toMatchObject({ mine: false, myColor: null });
  });

  it("paginates more parties than one D1 IN query may bind", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    const adventureId = await seedAdventure("host");
    const statements = Array.from({ length: 55 }, (_, index) =>
      env.DB.prepare(
        `INSERT INTO party
          (id, adventure_id, adventure_version, max_players, host_account_id, name, status,
           created_at, updated_at)
         VALUES (?, ?, 1, 4, 'host', NULL, 'open', ?, ?)`,
      ).bind(`page-${String(index).padStart(3, "0")}`, adventureId, index, index),
    );
    await env.DB.batch(statements);

    const first = await listPublicPartiesPage(db, "host");
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    if (!first.nextCursor) throw new Error("expected a second party page");
    const second = await listPublicPartiesPage(db, "host", { cursor: first.nextCursor });
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(55);
  });
});
