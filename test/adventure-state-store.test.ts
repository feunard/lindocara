/**
 * `adventure-state-store.ts`: load/save round-trip through `party_adventure_state`, the
 * never-throw degrade on a missing/corrupt row (mirroring `maps.ts`'s `decodeLayers`), and the
 * self-switch prune `savePartyAdventureState` performs when the caller supplies the live
 * event-id set. Truncate children before parents, same discipline as `parties.test.ts`.
 */
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPartyAdventureState,
  savePartyAdventureState,
} from "../src/server/adventure-state-store.js";
import { createAdventure, updateAdventure } from "../src/server/adventures.js";
import { account, createDb, type Db, partyAdventureState } from "../src/server/db/index.js";
import type { MapInput } from "../src/server/maps.js";
import { createParty } from "../src/server/parties.js";
import type { AdventureInput } from "../src/shared/adventure.js";
import { EMPTY_ADVENTURE_STATE, type PartyAdventureState } from "../src/shared/adventure-state.js";
import { EMPTY_MARKERS } from "../src/shared/map-data.js";
import { functionalEvent, type MapEvent } from "../src/shared/map-events.js";
import { authorMap } from "./support/adventure-fixtures.js";
import { layeredTerrain } from "./support/map-fixtures.js";

const COLS = 20;
const ROWS = 15;

// Self-switch event ids under test — decoupled from the maps' own anchor events below.
const EVENT_A = "11111111-1111-4111-8111-111111111111";
const EVENT_B = "22222222-2222-4222-8222-222222222222";

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

async function seedParty(db: Db): Promise<string> {
  await seedAccount("owner");
  const adv = await createAdventure(db, "owner", { title: "Donjon", maxPlayers: 4 });
  const mapA = await authorMap(db, "owner", adv.id, mapInput("A"));
  const mapB = await authorMap(db, "owner", adv.id, mapInput("B", eventsB()));
  await updateAdventure(db, "owner", adv.id, adventureGraph(mapA.id, mapB.id));
  const party = await createParty(db, "owner", { adventureId: adv.id, name: null, color: "blue" });
  return party.id;
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM party_adventure_state");
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
  await env.DB.exec("DELETE FROM account");
});

describe("loadPartyAdventureState", () => {
  it("a party that never saved reads back the empty state", async () => {
    const db = createDb(env.DB);
    const partyId = await seedParty(db);
    expect(await loadPartyAdventureState(db, partyId)).toEqual(EMPTY_ADVENTURE_STATE);
  });

  it("round-trips a populated state through save then load", async () => {
    const db = createDb(env.DB);
    const partyId = await seedParty(db);
    const state: PartyAdventureState = {
      switches: { "0001": true, "0002": false },
      variables: { "0001": 5, "0002": -3 },
      selfSwitches: { [`${EVENT_A}:A`]: true },
    };
    await savePartyAdventureState(db, partyId, state);
    expect(await loadPartyAdventureState(db, partyId)).toEqual(state);
  });

  it("saving twice for the same party upserts rather than duplicating rows", async () => {
    const db = createDb(env.DB);
    const partyId = await seedParty(db);
    await savePartyAdventureState(db, partyId, {
      switches: { "0001": true },
      variables: {},
      selfSwitches: {},
    });
    await savePartyAdventureState(db, partyId, {
      switches: { "0001": false, "0002": true },
      variables: {},
      selfSwitches: {},
    });
    expect(await loadPartyAdventureState(db, partyId)).toEqual({
      switches: { "0001": false, "0002": true },
      variables: {},
      selfSwitches: {},
    });
    const rows = await db.select().from(partyAdventureState);
    expect(rows).toHaveLength(1);
  });

  it("a row that is not valid JSON degrades to empty state and logs a structured warning", async () => {
    const db = createDb(env.DB);
    const partyId = await seedParty(db);
    await db
      .insert(partyAdventureState)
      .values({ partyId, switches: "not json", variables: "{}", selfSwitches: "{}" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await loadPartyAdventureState(db, partyId)).toEqual(EMPTY_ADVENTURE_STATE);
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(warn.mock.calls[0]?.[0] as string);
      expect(logged).toMatchObject({ event: "party_adventure_state_corrupt", partyId });
    } finally {
      warn.mockRestore();
    }
  });

  it("a row that is valid JSON but fails the shape parser also degrades and logs", async () => {
    const db = createDb(env.DB);
    const partyId = await seedParty(db);
    await db.insert(partyAdventureState).values({
      partyId,
      switches: JSON.stringify({ "bad-key": true }),
      variables: "{}",
      selfSwitches: "{}",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await loadPartyAdventureState(db, partyId)).toEqual(EMPTY_ADVENTURE_STATE);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("savePartyAdventureState: self-switch pruning", () => {
  it("without a live-event-id set, save is a pass-through (no pruning)", async () => {
    const db = createDb(env.DB);
    const partyId = await seedParty(db);
    const state: PartyAdventureState = {
      switches: {},
      variables: {},
      selfSwitches: { [`${EVENT_A}:A`]: true, [`${EVENT_B}:A`]: true },
    };
    await savePartyAdventureState(db, partyId, state);
    expect(await loadPartyAdventureState(db, partyId)).toEqual(state);
  });

  it("prunes only self-switch entries whose event is absent from the live set", async () => {
    const db = createDb(env.DB);
    const partyId = await seedParty(db);
    const state: PartyAdventureState = {
      switches: { "0001": true },
      variables: { "0001": 3 },
      selfSwitches: {
        [`${EVENT_A}:A`]: true,
        [`${EVENT_A}:B`]: false,
        [`${EVENT_B}:A`]: true,
      },
    };
    // Only EVENT_A is still live; EVENT_B's entries are orphans.
    await savePartyAdventureState(db, partyId, state, new Set([EVENT_A]));
    expect(await loadPartyAdventureState(db, partyId)).toEqual({
      switches: { "0001": true },
      variables: { "0001": 3 },
      selfSwitches: { [`${EVENT_A}:A`]: true, [`${EVENT_A}:B`]: false },
    });
  });

  it("an empty live-event-id set prunes every self-switch entry", async () => {
    const db = createDb(env.DB);
    const partyId = await seedParty(db);
    await savePartyAdventureState(
      db,
      partyId,
      { switches: {}, variables: {}, selfSwitches: { [`${EVENT_A}:A`]: true } },
      new Set(),
    );
    expect(await loadPartyAdventureState(db, partyId)).toEqual(EMPTY_ADVENTURE_STATE);
  });
});
