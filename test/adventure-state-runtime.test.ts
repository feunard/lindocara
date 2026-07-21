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
import { env, runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { AdventureRegistry, PartyAdventureState } from "../src/shared/adventure-state.js";
import { ATTACK_COOLDOWN_MS } from "../src/shared/game.js";
import type { MapEvent, MapEventPage } from "../src/shared/map-events.js";
import {
  Client,
  drainHeroRooms,
  type TestMapBody,
  type TestParty,
  testHero,
  testMapInput,
  testParty,
  tileCentre,
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
    commands: [],
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
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: [
      page({ graphicAssetId: PAGE1_GRAPHIC }),
      page({ graphicAssetId: PAGE2_GRAPHIC, condSwitchId: "0001" }),
    ],
  };
}

/** A single-page event gated on switch 0002: present while 0002 holds, dormant (and removed off the
 *  wire) the moment it stops. Its one page is a "page-1 event" — the stale-removal mutation proof. */
function vanishEvent(id: string): MapEvent {
  return {
    id,
    col: EVENT_COL + 1,
    row: EVENT_ROW,
    name: "Vanish",
    ordinal: 1,
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: [page({ graphicAssetId: PAGE1_GRAPHIC, condSwitchId: "0002" })],
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

async function seedAdventureRegistry(
  adventureId: string,
  registry: AdventureRegistry,
): Promise<void> {
  await env.DB.prepare("UPDATE adventure SET registry = ? WHERE id = ?")
    .bind(JSON.stringify(registry), adventureId)
    .run();
}

afterEach(async () => {
  await drainHeroRooms();
  await env.DB.exec("DELETE FROM party_adventure_state");
  await env.DB.exec("DELETE FROM hero");
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_event_page");
  await env.DB.exec("DELETE FROM map_event");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
  await env.DB.exec("DELETE FROM account");
}, 20_000);

describe("adventure state runtime", { timeout: 20_000 }, () => {
  it("runs a monster defeat hook and pushes the authored quest tracker to the hero", async () => {
    const monsterEventId = crypto.randomUUID();
    const monster: MapEvent = {
      id: monsterEventId,
      col: 10,
      row: 8,
      name: "Quest wolf",
      ordinal: 3,
      kind: "monster",
      species: "torch_goblin",
      patrolRadius: 32,
      pages: [
        page({
          commands: [{ t: "advanceQuest", questId: "0001", objectiveId: "0001", amount: 1 }],
        }),
      ],
    };
    const party = await testParty("monster-quest", {
      maps: [
        testMapInput("Quest hunt", {
          cols: 24,
          rows: 15,
          spawn: { col: 2, row: 2 },
          exit: { col: 22, row: 13 },
          events: [monster],
        }),
      ],
    });
    await seedAdventureRegistry(party.adventureId, {
      switches: [],
      variables: [],
      quests: [
        {
          id: "0001",
          title: "Clear the old road",
          description: "Defeat the prowling beast.",
          objectives: [{ id: "0001", label: "Defeat the beast", target: 1 }],
        },
      ],
    });

    const hero = await testHero("Hunter", {
      party,
      account: party.host,
      class: "warrior",
      level: 10,
      position: tileCentre(10, 8),
    });
    const client = await Client.joinHero(hero);
    await until("quest hunter welcomed", () => client.welcome);

    const coordinator = env.GAME_SESSION.getByName(party.partyId);
    await coordinator.applyStateChanges(party.partyId, [{ type: "startQuest", questId: "0001" }]);
    await until("authored quest started", () =>
      client.received.find(
        (message) => message.t === "state" && message.self.authoredQuests?.[0]?.status === "active",
      ),
    );

    let lastAttackAt = 0;
    await until("quest monster defeated", () => {
      if (Date.now() - lastAttackAt >= ATTACK_COOLDOWN_MS) {
        lastAttackAt = Date.now();
        client.action("attack");
      }
      return client.received.find(
        (message) => message.t === "event" && message.code === "monster.defeated",
      );
    });

    const progressed = await until("monster objective advanced", () =>
      client.received.find(
        (message) =>
          message.t === "state" && message.self.authoredQuests?.[0]?.objectives[0]?.progress === 1,
      ),
    );
    expect(progressed).toMatchObject({
      t: "state",
      self: {
        authoredQuests: [
          {
            id: "0001",
            title: "Clear the old road",
            status: "ready",
            objectives: [{ id: "0001", progress: 1, target: 1 }],
          },
        ],
      },
    });

    // A shaped but unregistered id cannot inflate or corrupt the party's durable quest state.
    await coordinator.applyStateChanges(party.partyId, [{ type: "startQuest", questId: "9999" }]);
    const held = await coordinator.getAdventureState(party.partyId);
    expect(held.state.quests?.["9999"]).toBeUndefined();

    client.close();
    await drainHeroRooms();
    // Wait for the coordinator's normal party-empty persistence boundary before fixture teardown;
    // otherwise its debounced alarm can race the next test's D1 cleanup.
    await coordinator.roomEmptied(party.partyId, hero.roomKey);
  });

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

  it("puts page 1 on the welcome wire, then upserts page 2 and removes a dormant event on flips", async () => {
    const gateId = crypto.randomUUID();
    const vanishId = crypto.randomUUID();
    const maps: TestMapBody[] = [
      testMapInput("wire ground", { events: [twoPageEvent(gateId), vanishEvent(vanishId)] }),
    ];
    const party = await testParty("wire", { maps });
    // 0002 on so the vanish event starts present; 0001 off so the gate starts on page 1.
    await seedPersistedState(party.partyId, {
      switches: { "0002": true },
      variables: {},
      selfSwitches: {},
    });

    const hero = await testHero("Wire", { party, account: party.host });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    // The welcome carries the active page's appearance for every holding event.
    const welcomeEvents = client.welcome?.world.events ?? [];
    expect(welcomeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: gateId, graphicAssetId: PAGE1_GRAPHIC, onTop: false }),
        expect.objectContaining({ id: vanishId, graphicAssetId: PAGE1_GRAPHIC }),
      ]),
    );

    // Flip 0001: the gate's active page becomes page 2, carried as a delta upsert.
    await env.GAME_SESSION.getByName(party.partyId).applyStateChangeForTest(party.partyId, {
      switchId: "0001",
      value: true,
    });
    await until(
      "gate shows page 2",
      () => client.events.find((event) => event.id === gateId)?.graphicAssetId === PAGE2_GRAPHIC,
    );
    const sawUpsert = client.received.some(
      (message) =>
        message.t === "world.delta" &&
        message.events.upsert.some(
          (event) => event.id === gateId && event.graphicAssetId === PAGE2_GRAPHIC,
        ),
    );
    expect(sawUpsert).toBe(true);

    // Flip 0002 off: the single-page vanish event goes dormant and must be REMOVED from the wire.
    // If the diff never emitted removals, the stale page-1 event would linger here.
    await env.GAME_SESSION.getByName(party.partyId).applyStateChangeForTest(party.partyId, {
      switchId: "0002",
      value: false,
    });
    await until("vanish removed", () => client.events.every((event) => event.id !== vanishId));
    expect(client.events.map((event) => event.id)).toEqual([gateId]);
  });

  it("serves the coordinator's held state to a restoring room — load-on-demand and ahead of D1", async () => {
    // A ticking World cannot be evicted (`evictDurableObject` hangs on its `setInterval`), so the
    // hibernation-restore obligation is proved as two halves: (A) the coordinator serves persisted
    // state on demand even when it is itself cold, and (B) the copy it serves is the held one, which
    // can be newer than D1's debounced row — exactly what a restoring World must pull instead of D1.

    // Half A: a fresh coordinator (no room ever admitted) loads the persisted row on first ask.
    const loadFixture = await seedFixture("hib-load");
    await seedPersistedState(loadFixture.party.partyId, {
      switches: { "0001": true },
      variables: {},
      selfSwitches: {},
    });
    const loaded = await env.GAME_SESSION.getByName(loadFixture.party.partyId).getAdventureState(
      loadFixture.party.partyId,
    );
    expect(loaded.state.switches).toEqual({ "0001": true });

    // Half B: after a seam flip the held state is ahead of D1 (the write is debounced 5s). A
    // restoring room pulling `getAdventureState` sees the flip; D1 does not yet.
    const heldFixture = await seedFixture("hib-held");
    const hero = await testHero("Hib", {
      party: heldFixture.party,
      account: heldFixture.party.host,
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    await env.GAME_SESSION.getByName(heldFixture.party.partyId).applyStateChangeForTest(
      heldFixture.party.partyId,
      { switchId: "0001", value: true },
    );
    const held = await env.GAME_SESSION.getByName(heldFixture.party.partyId).getAdventureState(
      heldFixture.party.partyId,
    );
    expect(held.state.switches["0001"]).toBe(true);
    expect(await readPersistedState(heldFixture.party.partyId)).toBeNull();
  });

  it("re-evaluates against the EMPTY snapshot when the hibernation restore pull fails", async () => {
    // A ticking World cannot be evicted, so the constructor's failed-pull catch is exercised through
    // its extracted recovery seam. With 0001 held true the gate shows page 2 at join; a failed
    // restore falls the room back to EMPTY state, and the ALWAYS-ON page 1 must survive rather than
    // the room waking with no events. Mutation proof: drop `#evaluateActiveEvents()` from the
    // recovery and the room keeps page 2 here, failing the page-1 assertion.
    const fixture = await seedFixture("restore-fail");
    await seedPersistedState(fixture.party.partyId, {
      switches: { "0001": true },
      variables: {},
      selfSwitches: {},
    });
    const hero = await testHero("Restore", { party: fixture.party, account: fixture.party.host });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    const room = env.WORLD.getByName(fixture.roomKeyA);
    const before = await room.roomDiagnostics();
    expect(before.activeEvents[0]?.graphicAssetId).toBe(PAGE2_GRAPHIC);

    await room.recoverEventsAfterFailedStateRestoreForTest();

    const after = await room.roomDiagnostics();
    expect(after.activeEvents).toEqual([
      {
        id: fixture.eventIdA,
        col: EVENT_COL,
        row: EVENT_ROW,
        graphicAssetId: PAGE1_GRAPHIC,
        onTop: false,
      },
    ]);
  });

  it("keeps a mutation that lands during a flush from being clobbered by the dirty clear", async () => {
    // A flush captures the version it is about to write and only clears `#dirty` when that version is
    // still current. A mutation landing during the awaited D1 write bumps the version, so the flush
    // leaves `#dirty` set and re-arms — a later flush lands the newer value. Mutation proof: clear
    // `#dirty` unconditionally and the newer 0002 never reaches D1 (the second flush no-ops).
    const fixture = await seedFixture("flush-race");
    const hero = await testHero("Racer", { party: fixture.party, account: fixture.party.host });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    const coordinator = env.GAME_SESSION.getByName(fixture.party.partyId);
    // First mutation: version 1, dirty, alarm armed (debounced — not in D1 yet).
    await coordinator.applyStateChangeForTest(fixture.party.partyId, {
      switchId: "0001",
      value: true,
    });

    // Race a second mutation (0002) into the flush window. The flush writes the v1 state to D1, sees
    // the version has since moved, and stays dirty rather than clobbering the 0002 flag.
    await coordinator.raceFlushWithMutationForTest(fixture.party.partyId, "0002");

    const afterRace = await readPersistedState(fixture.party.partyId);
    expect(afterRace?.switches).toEqual({ "0001": true }); // the flush wrote only the v1 state

    // The re-armed alarm flushes again; the newer 0002 must now land.
    const ran = await runDurableObjectAlarm(coordinator);
    expect(ran).toBe(true);
    const afterAlarm = await readPersistedState(fixture.party.partyId);
    expect(afterAlarm?.switches["0002"]).toBe(true);
    expect(afterAlarm?.switches["0001"]).toBe(true);
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
