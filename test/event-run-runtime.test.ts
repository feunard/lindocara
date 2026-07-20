/**
 * The interpreter INSIDE the Durable Objects (tranche 5, Task 3): a hero triggers an authored event
 * through the live interact/movement paths, the room drains its commands under the tick budget, and
 * the resulting state mutations flow up to the `GameSession` coordinator — the single writer — and
 * back down to every room. Everything drives the REAL objects through the harness, exactly like the
 * hero-world and adventure-state-runtime suites; the only non-client pokes are the coordinator's
 * `installAdventureState`/`getAdventureState` RPCs (for the version guard and alarm proofs) and the
 * `roomDiagnostics` run/dialogue seam standing in for the not-yet-existing dialogue protocol.
 */
import { env, evictDurableObject, runDurableObjectAlarm, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { EventCommand } from "../src/shared/event-commands.js";
import type { MapEvent, MapEventPage } from "../src/shared/map-events.js";
import { TILE_SIZE } from "../src/shared/tilemap.js";
import {
  Client,
  drainHeroRooms,
  ORIGIN,
  type TestMapBody,
  type TestParty,
  testHero,
  testMapInput,
  testParty,
  until,
} from "./support/world-harness.js";

const PAGE1_GRAPHIC = "building.buildings-black-buildings.archery";
const PAGE2_GRAPHIC = "resource.terrain-resources-wood-trees.tree3";

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

/** A scripted `normal` event: one page, a trigger and a program. */
function scriptEvent(
  id: string,
  col: number,
  row: number,
  trigger: MapEventPage["trigger"],
  program: readonly EventCommand[],
): MapEvent {
  return {
    id,
    col,
    row,
    name: "Script",
    ordinal: 10,
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: [page({ trigger, commands: program })],
  };
}

/** A two-page appearance event: page 1 until switch 0001 holds, page 2 after — the cross-room flip
 *  observed through the active appearance alone. */
function gateEvent(id: string, col: number, row: number): MapEvent {
  return {
    id,
    col,
    row,
    name: "Gate",
    ordinal: 20,
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: [
      page({ graphicAssetId: PAGE1_GRAPHIC }),
      page({ graphicAssetId: PAGE2_GRAPHIC, condSwitchId: "0001" }),
    ],
  };
}

async function putMap(party: TestParty, mapId: string, body: TestMapBody): Promise<void> {
  const response = await SELF.fetch(`${ORIGIN}/api/maps/${mapId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: party.host.cookie },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
}

type RoomDiag = Awaited<ReturnType<ReturnType<typeof env.WORLD.getByName>["roomDiagnostics"]>>;

/** Poll a room's diagnostics (an async RPC) until `ok` holds — `until` above only takes a sync
 *  predicate, and the run/dialogue state must be read off the real object each pass. */
async function awaitDiag(
  roomKey: string,
  label: string,
  ok: (diag: RoomDiag) => boolean,
  timeoutMs = 5000,
): Promise<RoomDiag> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const diag = await env.WORLD.getByName(roomKey).roomDiagnostics();
    if (ok(diag)) return diag;
    await scheduler.wait(30);
  }
  throw new Error(`timed out waiting for ${label}`);
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
});

describe("triggers, the run, and cross-room state", () => {
  it("an interact runs a program whose switch flip is visible on another map room", async () => {
    // Map A: a scripted action event at (5,5) that flips 0001, plus a gate on map A; map B: a gate.
    const scriptId = crypto.randomUUID();
    const gateAId = crypto.randomUUID();
    const gateBId = crypto.randomUUID();
    const maps: TestMapBody[] = [
      testMapInput("flip A", {
        events: [
          scriptEvent(scriptId, 5, 5, "action", [
            { t: "setSwitch", switchId: "0001", value: true },
          ]),
          gateEvent(gateAId, 6, 6),
        ],
      }),
      testMapInput("flip B", { events: [gateEvent(gateBId, 6, 6)] }),
    ];
    const party = await testParty("flip", { maps });
    const [mapA, mapB] = party.mapIds;
    if (!mapA || !mapB) throw new Error("expected two maps");
    const roomKeyB = `${party.partyId}:${mapB}`;

    // Hero A stands on the scripted event cell so interact is always in range.
    const heroA = await testHero("FlipA", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const heroB = await testHero("FlipB", { party, mapId: mapB });
    const clientA = await Client.joinHero(heroA);
    const clientB = await Client.joinHero(heroB);
    await until("both welcomed", () => clientA.welcome && clientB.welcome);

    const before = await env.WORLD.getByName(roomKeyB).roomDiagnostics();
    expect(before.activeEvents.find((e) => e.id === gateBId)?.graphicAssetId).toBe(PAGE1_GRAPHIC);

    clientA.action("interact");

    // The run flips 0001 -> coordinator -> both rooms re-evaluate; map B's gate becomes page 2.
    const diagB = await awaitDiag(
      roomKeyB,
      "map B gate on page 2",
      (diag) => diag.activeEvents.find((e) => e.id === gateBId)?.graphicAssetId === PAGE2_GRAPHIC,
    );
    expect(diagB.adventureState.switches["0001"]).toBe(true);
  });

  it("a player-touch event fires when a hero walks onto its cell", async () => {
    const touchId = crypto.randomUUID();
    const party = await testParty("touch", {
      maps: [
        testMapInput("touch ground", {
          spawn: { col: 20, row: 15 },
          events: [
            scriptEvent(touchId, 23, 15, "player-touch", [
              { t: "setSwitch", switchId: "0001", value: true },
            ]),
          ],
        }),
      ],
    });
    const hero = await testHero("Toucher", { party, account: party.host });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    client.press("right");
    await awaitDiag(
      hero.roomKey,
      "touch flipped 0001",
      (diag) => diag.adventureState.switches["0001"] === true,
    );
  });

  it("keeps only one run per event when triggered twice (the lock)", async () => {
    // A say program parks the run (waiting-advance), holding the lock indefinitely — a second
    // interact must be dropped, so exactly one dialogue beat is ever buffered.
    const scriptId = crypto.randomUUID();
    const party = await testParty("lock", {
      maps: [
        testMapInput("lock ground", {
          events: [scriptEvent(scriptId, 5, 5, "action", [{ t: "say", text: "hail", name: null }])],
        }),
      ],
    });
    const hero = await testHero("Locker", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    client.action("interact");
    await awaitDiag(hero.roomKey, "dialogue buffered", (diag) => diag.eventDialogue.length === 1);
    client.action("interact");
    client.action("interact");
    // Give the room time to (wrongly) start more runs, then assert still exactly one.
    await scheduler.wait(300);
    const diag = await env.WORLD.getByName(hero.roomKey).roomDiagnostics();
    expect(diag.eventDialogue).toHaveLength(1);
    expect(diag.eventRuns).toHaveLength(1);
    expect(diag.eventRuns[0]?.status).toBe("waiting-advance");
  });

  it("stays live while an authored infinite loop spins — another hero keeps moving", async () => {
    // Hero A triggers an event that loops forever (no-op body). The room MUST keep ticking: hero B,
    // in the same room, keeps moving. The budget is what makes this true — the drain always returns.
    const spinId = crypto.randomUUID();
    const party = await testParty("spin", {
      maps: [
        testMapInput("spin ground", {
          spawn: { col: 10, row: 15 },
          events: [
            scriptEvent(spinId, 5, 15, "action", [
              { t: "loop", body: [{ t: "comment", text: "x" }] },
            ]),
          ],
        }),
      ],
    });
    const heroA = await testHero("SpinA", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 15 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const heroB = await testHero("SpinB", {
      party,
      position: { x: 10 * TILE_SIZE + TILE_SIZE / 2, y: 15 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const clientA = await Client.joinHero(heroA);
    const clientB = await Client.joinHero(heroB);
    await until("both welcomed", () => clientA.welcome && clientB.welcome);

    clientA.action("interact");
    await awaitDiag(heroA.roomKey, "loop is spinning", (diag) =>
      diag.eventRuns.some((r) => r.eventId === spinId && r.status === "running"),
    );

    const startX = clientB.self()?.x ?? 0;
    clientB.press("right");
    await until(
      "hero B advanced while the loop spins",
      () => (clientB.self()?.x ?? 0) > startX + TILE_SIZE,
    );
  });
});

describe("teleport", () => {
  it("clears the command queue on a same-map teleport (no post-teleport sprint)", async () => {
    // A scripted action event at (6,15) teleports the hero straight UP to (6,5) on the same map. The
    // triggerer arrives holding a full queue of RIGHT commands; if the queue is not cleared they
    // replay and sprint the hero rightward off the destination column.
    const teleId = crypto.randomUUID();
    // Default spawn is (20,15), so the entry event sits there; the teleport event lives at (6,15).
    const body = testMapInput("tele ground", {
      events: [
        scriptEvent(teleId, 6, 15, "action", [
          { t: "teleport", mapId: "00000000-0000-4000-8000-000000000000", col: 6, row: 5 },
        ]),
      ],
    });
    const party = await testParty("tele", { maps: [body] });
    const mapId = party.mapIds[0];
    if (!mapId) throw new Error("expected a map");
    // Re-author the event with the teleport pointing at the map's OWN id (same-map).
    const fixed: TestMapBody = {
      ...body,
      events: body.events.map((event) =>
        event.id === teleId
          ? {
              ...event,
              pages: event.pages.map((p) => ({
                ...p,
                commands: [{ t: "teleport", mapId, col: 6, row: 5 } satisfies EventCommand],
              })),
            }
          : event,
      ),
    };
    await putMap(party, mapId, fixed);

    const hero = await testHero("Teleporter", {
      party,
      account: party.host,
      position: { x: 6 * TILE_SIZE + TILE_SIZE / 2, y: 15 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero, { pump: false });
    await until("welcomed", () => client.welcome);
    const destColumnX = 6 * TILE_SIZE + TILE_SIZE / 2;

    // Fill the queue with RIGHT commands, then interact in the same breath (still on the cell).
    for (let i = 0; i < 12; i++)
      client.sendCommand({ up: false, down: false, left: false, right: true });
    client.action("interact");

    // Wait for the teleport (row 15 -> row 5): the hero's Y jumps up by ten tiles.
    await until("teleported up", () => (client.self()?.y ?? Infinity) < 10 * TILE_SIZE);
    // Let any residual queue drain, then assert the hero rests ON the destination column — a cleared
    // queue leaves it here; an uncleared one sprints it right by ~a hundred pixels.
    await scheduler.wait(500);
    const restingX = client.self()?.x ?? 0;
    expect(Math.abs(restingX - destColumnX)).toBeLessThan(TILE_SIZE);
  });
});

describe("aborts", () => {
  it("aborts a hero's run when they disconnect (no zombie context)", async () => {
    const scriptId = crypto.randomUUID();
    const party = await testParty("dc", {
      maps: [
        testMapInput("dc ground", {
          events: [scriptEvent(scriptId, 5, 5, "action", [{ t: "say", text: "wait", name: null }])],
        }),
      ],
    });
    // Two heroes share the room so a disconnect does not simply empty (and reset) it.
    const heroA = await testHero("DcA", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const heroB = await testHero("DcB", { party });
    const clientA = await Client.joinHero(heroA);
    const clientB = await Client.joinHero(heroB);
    await until("both welcomed", () => clientA.welcome && clientB.welcome);

    clientA.action("interact");
    await awaitDiag(heroA.roomKey, "run parked", (diag) => diag.eventRuns.length === 1);

    clientA.close();
    await awaitDiag(
      heroA.roomKey,
      "run aborted on disconnect",
      (diag) => diag.playerIds.includes(heroB.heroId) && diag.eventRuns.length === 0,
    );
  });

  it("aborts a run whose own switch flip changes its active page (no zombie), and shows the new page", async () => {
    // Page 0 (action): flip self-switch A, then park on a long wait BEFORE any further command.
    // Page 1 gates on self-switch A and shows PAGE2. Setting A makes page 1 active, which must abort
    // the page-0 run BEFORE it can resume — the abort is ordered ahead of re-evaluation.
    const eventId = crypto.randomUUID();
    const zombie: MapEvent = {
      id: eventId,
      col: 5,
      row: 5,
      name: "Zombie",
      ordinal: 30,
      kind: "normal",
      species: null,
      patrolRadius: null,
      pages: [
        page({
          trigger: "action",
          commands: [
            { t: "setSelfSwitch", selfSwitch: "A", value: true },
            { t: "wait", frames: 600 },
            { t: "setVariable", variableId: "0002", op: "add", value: 1 },
          ],
        }),
        page({ graphicAssetId: PAGE2_GRAPHIC, condSelfSwitch: "A" }),
      ],
    };
    const party = await testParty("zombie", {
      maps: [testMapInput("zombie ground", { events: [zombie] })],
    });
    const hero = await testHero("Zombie", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    client.action("interact");
    // The page flips to page 2 AND the run is gone: the self-switch flip aborted the page-0 context
    // before its parked wait could ever resume.
    await awaitDiag(hero.roomKey, "page 2 active and run aborted", (diag) => {
      const shows =
        diag.activeEvents.find((e) => e.id === eventId)?.graphicAssetId === PAGE2_GRAPHIC;
      return shows && diag.eventRuns.length === 0;
    });
  });
});

describe("the coordinator", () => {
  it("drops a stale out-of-order install and accepts an equal-version one (the >= guard)", async () => {
    const roomKey = `guard:${crypto.randomUUID()}`;
    const partyId = crypto.randomUUID();
    const stub = env.WORLD.getByName(roomKey);
    const a = { switches: { "0001": true }, variables: {}, selfSwitches: {} };
    const b = { switches: { "0002": true }, variables: {}, selfSwitches: {} };
    const c = { switches: { "0003": true }, variables: {}, selfSwitches: {} };

    await stub.installAdventureState(partyId, a, 2);
    await stub.installAdventureState(partyId, b, 1); // stale: 1 < 2, dropped
    const afterStale = await stub.roomDiagnostics();
    expect(afterStale.adventureState).toEqual(a);
    expect(afterStale.adventureStateVersion).toBe(2);

    // MUTATION PROOF (d): equal version is ACCEPTED (>=). Flip the guard `<` to `<=` and this equal
    // install is dropped, leaving state at `a` and failing the assertion below.
    await stub.installAdventureState(partyId, c, 2);
    const afterEqual = await stub.roomDiagnostics();
    expect(afterEqual.adventureState).toEqual(c);
  });

  it("flushes the debounced adventure state to D1 via the storage alarm, even after an eviction", async () => {
    // A real hero+room so the coordinator has a party and loads state. A flip is debounced (D1 not
    // written yet). Evicting the coordinator clears its memory; the alarm reloads the dirty state
    // from ctx.storage and writes D1 — the durability the setAlarm obligation buys.
    const party = await testParty("alarm", { maps: [testMapInput("alarm ground")] });
    const hero = await testHero("Alarm", { party, account: party.host });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    await env.GAME_SESSION.getByName(party.partyId).applyStateChangeForTest(party.partyId, {
      switchId: "0001",
      value: true,
    });
    expect(await readPersistedState(party.partyId)).toBeNull(); // debounced, not yet in D1

    const coordinator = env.GAME_SESSION.getByName(party.partyId);
    await evictDurableObject(coordinator); // clear the coordinator's in-memory dirty state
    const ran = await runDurableObjectAlarm(coordinator);
    expect(ran).toBe(true);

    const saved = await readPersistedState(party.partyId);
    expect(saved?.switches["0001"]).toBe(true);
  });
});

async function readPersistedState(
  partyId: string,
): Promise<{ switches: Record<string, boolean> } | null> {
  const row = await env.DB.prepare("SELECT switches FROM party_adventure_state WHERE party_id = ?")
    .bind(partyId)
    .first<{ switches: string }>();
  return row ? { switches: JSON.parse(row.switches) } : null;
}
