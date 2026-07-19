/**
 * The runtime seam of adventure state (tranche 4, Task 3): the `GameSession` coordinator loads a
 * party's switches/variables/self-switches, holds the single copy, and pushes a read-only snapshot
 * to every `World` room; each room selects the active page of its authored events against that
 * snapshot on install and on hero join — never per tick — and saves on party-empty with the
 * orphan-self-switch prune.
 *
 * Everything here drives the REAL Durable Objects through the harness, exactly like the hero-world
 * suite: heroes are admitted through `/api/ws`, and state is observed through `roomDiagnostics()`
 * and asserted in D1. The only non-client poke is `applyStateChangeForTest`, the coordinator's test
 * seam standing in for tranche 5's interpreter.
 */
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { PartyAdventureState } from "../src/shared/adventure-state.js";
import type { MapEvent, MapEventPage } from "../src/shared/map-events.js";
import {
  Client,
  drainHeroRooms,
  type TestMapBody,
  type TestParty,
  testHero,
  testMapInput,
  testParty,
  until,
} from "./support/world-harness.js";

/** Page 1 shows when nothing holds; page 2 is gated on switch 0001 and shows a different graphic,
 *  so which page is active is legible from the appearance alone. */
const PAGE1_GRAPHIC = "building.buildings-black-buildings.archery";
const PAGE2_GRAPHIC = "resource.terrain-resources-wood-trees.tree3";
const EVENT_COL = 5;
const EVENT_ROW = 5;

function page(overrides: Partial<MapEventPage> = {}): MapEventPage {
  return {
    condSwitchId: null,
    condVariableId: null,
    condVariableMin: null,
    condSelfSwitch: null,
    graphicAssetId: null,
    moveType: "fixed",
    moveSpeed: 3,
    moveFreq: 2,
    optMoveAnim: false,
    optStopAnim: false,
    optDirFix: false,
    optThrough: false,
    optOnTop: false,
    trigger: "action",
    ...overrides,
  };
}

/** One event, two pages: the higher page (index 1) wins once switch 0001 holds. */
function twoPageEvent(id: string): MapEvent {
  return {
    id,
    col: EVENT_COL,
    row: EVENT_ROW,
    name: "Gate",
    ordinal: 0,
    pages: [
      page({ graphicAssetId: PAGE1_GRAPHIC }),
      page({ graphicAssetId: PAGE2_GRAPHIC, condSwitchId: "0001" }),
    ],
  };
}

interface StateFixture {
  party: TestParty;
  mapA: string;
  mapB: string;
  roomKeyA: string;
  roomKeyB: string;
  eventIdA: string;
  eventIdB: string;
}

/** A two-map adventure, each map carrying its own two-page event, and one party over it. */
async function seedFixture(label: string): Promise<StateFixture> {
  const eventIdA = crypto.randomUUID();
  const eventIdB = crypto.randomUUID();
  const maps: TestMapBody[] = [
    testMapInput(`${label} ground A`, { events: [twoPageEvent(eventIdA)] }),
    testMapInput(`${label} ground B`, { events: [twoPageEvent(eventIdB)] }),
  ];
  const party = await testParty(label, { maps });
  const [mapA, mapB] = party.mapIds;
  if (!mapA || !mapB) throw new Error("expected two seeded maps");
  return {
    party,
    mapA,
    mapB,
    roomKeyA: `${party.partyId}:${mapA}`,
    roomKeyB: `${party.partyId}:${mapB}`,
    eventIdA,
    eventIdB,
  };
}

async function seedPersistedState(partyId: string, state: PartyAdventureState): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO party_adventure_state (party_id, switches, variables, self_switches) VALUES (?, ?, ?, ?)",
  )
    .bind(
      partyId,
      JSON.stringify(state.switches),
      JSON.stringify(state.variables),
      JSON.stringify(state.selfSwitches),
    )
    .run();
}

async function readPersistedState(partyId: string): Promise<PartyAdventureState | null> {
  const row = await env.DB.prepare(
    "SELECT switches, variables, self_switches FROM party_adventure_state WHERE party_id = ?",
  )
    .bind(partyId)
    .first<{ switches: string; variables: string; self_switches: string }>();
  if (!row) return null;
  return {
    switches: JSON.parse(row.switches),
    variables: JSON.parse(row.variables),
    selfSwitches: JSON.parse(row.self_switches),
  };
}

afterEach(async () => {
  await drainHeroRooms();
  await env.DB.exec("DELETE FROM party_adventure_state");
  await env.DB.exec("DELETE FROM hero");
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM adventure_map");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_event_page");
  await env.DB.exec("DELETE FROM map_event");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
  await env.DB.exec("DELETE FROM account");
});

describe("adventure state runtime", () => {
  it("loads the party snapshot once and pushes the same state to both map rooms", async () => {
    const fixture = await seedFixture("snapshot");
    const persisted: PartyAdventureState = {
      switches: { "0003": true },
      variables: { "0002": 7 },
      selfSwitches: {},
    };
    await seedPersistedState(fixture.party.partyId, persisted);

    const heroA = await testHero("SnapA", { party: fixture.party, account: fixture.party.host });
    const heroB = await testHero("SnapB", { party: fixture.party, mapId: fixture.mapB });
    const clientA = await Client.joinHero(heroA);
    const clientB = await Client.joinHero(heroB);
    await until("both rooms welcomed", () => clientA.welcome && clientB.welcome);

    const diagA = await env.WORLD.getByName(fixture.roomKeyA).roomDiagnostics();
    const diagB = await env.WORLD.getByName(fixture.roomKeyB).roomDiagnostics();
    expect(diagA.adventureState).toEqual(persisted);
    expect(diagB.adventureState).toEqual(persisted);
  });

  it("shows page 1 in the active list at join when the gating switch is unset", async () => {
    const fixture = await seedFixture("join");
    const hero = await testHero("JoinHero", { party: fixture.party, account: fixture.party.host });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    const diag = await env.WORLD.getByName(fixture.roomKeyA).roomDiagnostics();
    expect(diag.activeEvents).toEqual([
      {
        id: fixture.eventIdA,
        col: EVENT_COL,
        row: EVENT_ROW,
        graphicAssetId: PAGE1_GRAPHIC,
        onTop: false,
      },
    ]);
  });

  it("re-evaluates pages in BOTH rooms when the coordinator flips a switch", async () => {
    const fixture = await seedFixture("flip");
    const heroA = await testHero("FlipA", { party: fixture.party, account: fixture.party.host });
    const heroB = await testHero("FlipB", { party: fixture.party, mapId: fixture.mapB });
    const clientA = await Client.joinHero(heroA);
    const clientB = await Client.joinHero(heroB);
    await until("both rooms welcomed", () => clientA.welcome && clientB.welcome);

    const before = await env.WORLD.getByName(fixture.roomKeyB).roomDiagnostics();
    expect(before.activeEvents[0]?.graphicAssetId).toBe(PAGE1_GRAPHIC);

    await env.GAME_SESSION.getByName(fixture.party.partyId).applyStateChangeForTest(
      fixture.party.partyId,
      { switchId: "0001", value: true },
    );

    const diagA = await env.WORLD.getByName(fixture.roomKeyA).roomDiagnostics();
    const diagB = await env.WORLD.getByName(fixture.roomKeyB).roomDiagnostics();
    expect(diagA.activeEvents[0]).toMatchObject({
      id: fixture.eventIdA,
      graphicAssetId: PAGE2_GRAPHIC,
    });
    expect(diagB.activeEvents[0]).toMatchObject({
      id: fixture.eventIdB,
      graphicAssetId: PAGE2_GRAPHIC,
    });
  });

  it("saves on party-empty and prunes an orphan self-switch", async () => {
    const fixture = await seedFixture("save");
    const orphanKey = `${crypto.randomUUID()}:A`;
    await seedPersistedState(fixture.party.partyId, {
      switches: {},
      variables: {},
      selfSwitches: { [orphanKey]: true },
    });

    const hero = await testHero("SaveHero", { party: fixture.party, account: fixture.party.host });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    await env.GAME_SESSION.getByName(fixture.party.partyId).applyStateChangeForTest(
      fixture.party.partyId,
      { switchId: "0001", value: true },
    );

    client.close();
    await drainHeroRooms();

    // The coordinator's party-empty flush runs after the room reports empty, so poll D1 for it.
    let saved: PartyAdventureState | null = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = await readPersistedState(fixture.party.partyId);
      if (current && current.switches["0001"] === true) {
        saved = current;
        break;
      }
      await scheduler.wait(50);
    }
    if (!saved) throw new Error("timed out waiting for the party-empty save");
    expect(saved.switches).toEqual({ "0001": true });
    expect(saved.selfSwitches).toEqual({});
  });
});
