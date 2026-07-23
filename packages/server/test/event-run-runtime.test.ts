/**
 * The interpreter INSIDE the Durable Objects (tranche 5, Task 3): a hero triggers an authored event
 * through the live interact/movement paths, the room drains its commands under the tick budget, and
 * the resulting state mutations flow up to the `GameSession` coordinator — the single writer — and
 * back down to every room. Everything drives the REAL objects through the harness, exactly like the
 * hero-world and adventure-state-runtime suites; the only non-client pokes are the coordinator's
 * `installAdventureState`/`getAdventureState` RPCs (for the version guard and alarm proofs) and the
 * `roomDiagnostics` run seam. Dialogue itself rides the wire now (Task 4), asserted off the client.
 */
import { env, evictDurableObject, runDurableObjectAlarm, SELF } from "cloudflare:test";
import type { EventCommand } from "@lindocara/engine/event-commands.js";
import type { MapEvent, MapEventPage } from "@lindocara/engine/map-events.js";
import type { ServerMessage } from "@lindocara/engine/protocol.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
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
} from "./world-harness.js";

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
}, 20_000);

describe("triggers, the run, and cross-room state", { timeout: 20_000 }, () => {
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
    // interact must be dropped, so exactly one say beat ever reaches the wire.
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
    await until(
      "say beat on the wire",
      () => client.received.filter((m) => m.t === "event.say").length === 1,
    );
    client.action("interact");
    client.action("interact");
    // Give the room time to (wrongly) start more runs, then assert still exactly one run + one beat.
    await scheduler.wait(300);
    const diag = await env.WORLD.getByName(hero.roomKey).roomDiagnostics();
    expect(diag.eventRuns).toHaveLength(1);
    expect(diag.eventRuns[0]?.status).toBe("waiting-advance");
    expect(client.received.filter((m) => m.t === "event.say")).toHaveLength(1);
  });

  it("reads its OWN switch write within the drain: set-then-branch takes THEN", async () => {
    // `setSwitch 0001; if 0001 then {set 0002} else {set 0003}` — the branch runs in the SAME drain
    // as the write, so it must see 0001 and set 0002, NOT 0003. Mutation proof: drop the drain-local
    // working copy and the `if` reads the frozen (pre-flip) snapshot, takes ELSE, and sets 0003.
    const scriptId = crypto.randomUUID();
    const party = await testParty("raw-branch", {
      maps: [
        testMapInput("branch ground", {
          events: [
            scriptEvent(scriptId, 5, 5, "action", [
              { t: "setSwitch", switchId: "0001", value: true },
              {
                t: "if",
                cond: { type: "switch", switchId: "0001" },
                then: [{ t: "setSwitch", switchId: "0002", value: true }],
                else: [{ t: "setSwitch", switchId: "0003", value: true }],
              },
            ]),
          ],
        }),
      ],
    });
    const hero = await testHero("Brancher", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    client.action("interact");
    const diag = await awaitDiag(
      hero.roomKey,
      "branch resolved",
      (d) =>
        d.adventureState.switches["0002"] === true || d.adventureState.switches["0003"] === true,
    );
    expect(diag.adventureState.switches["0002"]).toBe(true);
    expect(diag.adventureState.switches["0003"]).toBeUndefined();
  });

  it("reads its OWN variable writes within the drain: a counter loop exits at exactly 10", async () => {
    // `loop { add 0001 += 1; if 0001 >= 10 break }` — the guard reads the running total THIS drain, so
    // it breaks the instant the count reaches 10 and never overshoots. Mutation proof: drop the
    // working copy and every `if` reads the stale snapshot, so the loop keeps adding past 10 (the RPC
    // round-trip is one-to-two ticks behind), landing above 10.
    const scriptId = crypto.randomUUID();
    const party = await testParty("raw-loop", {
      maps: [
        testMapInput("loop ground", {
          events: [
            scriptEvent(scriptId, 5, 5, "action", [
              {
                t: "loop",
                body: [
                  { t: "setVariable", variableId: "0001", op: "add", value: 1 },
                  {
                    t: "if",
                    cond: { type: "variable", variableId: "0001", min: 10 },
                    then: [{ t: "breakLoop" }],
                    else: [],
                  },
                ],
              },
            ]),
          ],
        }),
      ],
    });
    const hero = await testHero("Counter", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    client.action("interact");
    // The count crosses 10 exactly once; the first diagnostics reading at-or-past 10 must read 10.
    const diag = await awaitDiag(
      hero.roomKey,
      "counter reached 10",
      (d) => (d.adventureState.variables["0001"] ?? 0) >= 10,
    );
    expect(diag.adventureState.variables["0001"]).toBe(10);
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

describe("the dialogue conversation (Task 4)", { timeout: 20_000 }, () => {
  it("runs say -> advance -> choices -> choose(1), the chosen branch's flip landing", async () => {
    // A door-keeper scene: greet, then offer two answers. Option 0 flips 0001; option 1 flips 0007.
    // choosing 1 must land 0007 (not 0001), then the run ends and the panel closes.
    const scriptId = crypto.randomUUID();
    const program: EventCommand[] = [
      { t: "say", text: "Hail, traveller.", name: "Keeper" },
      {
        t: "choices",
        prompt: "Open the door?",
        options: [
          { label: "Open", body: [{ t: "setSwitch", switchId: "0001", value: true }] },
          { label: "Leave", body: [{ t: "setSwitch", switchId: "0007", value: true }] },
        ],
      },
    ];
    const party = await testParty("convo", {
      maps: [
        testMapInput("convo ground", {
          events: [scriptEvent(scriptId, 5, 5, "action", program)],
        }),
      ],
    });
    const hero = await testHero("Talker", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    // 1) interact -> the say beat reaches THIS client on the wire (authored prose, verbatim).
    client.action("interact");
    const say = await until(
      "say beat",
      () =>
        client.received.find((m) => m.t === "event.say") as
          | Extract<ServerMessage, { t: "event.say" }>
          | undefined,
    );
    expect(say.text).toBe("Hail, traveller.");
    expect(say.name).toBe("Keeper");

    // 2) advance -> the choices offer arrives.
    client.sendRaw(JSON.stringify({ t: "event.advance", runId: say.runId }));
    const choices = await until(
      "choices beat",
      () =>
        client.received.find((m) => m.t === "event.choices") as
          | Extract<ServerMessage, { t: "event.choices" }>
          | undefined,
    );
    expect(choices.prompt).toBe("Open the door?");
    expect(choices.options).toEqual(["Open", "Leave"]);
    expect(choices.runId).toBe(say.runId);

    // 3) choose(1) -> option 1's body flips 0007; the run then ends and pushes event.close.
    client.sendRaw(JSON.stringify({ t: "event.choose", runId: say.runId, index: 1 }));
    const diag = await awaitDiag(
      hero.roomKey,
      "chosen branch flipped 0007",
      (d) => d.adventureState.switches["0007"] === true,
    );
    expect(diag.adventureState.switches["0001"]).toBeUndefined();
    await until("panel closed", () =>
      client.received.some((m) => m.t === "event.close" && m.runId === say.runId),
    );
    await awaitDiag(hero.roomKey, "run released", (d) => d.eventRuns.length === 0);
  });

  it("closes the panel and ends the run when the triggerer walks past DIALOGUE_CLOSE_RADIUS", async () => {
    // A say parks the run. The hero walks four tiles away (> 3 * TILE_SIZE): the server closes the
    // dialogue and drops the run. Mutation proof: drop the `> DIALOGUE_CLOSE_RADIUS` check in
    // `#closeDistantDialogues` and no event.close ever arrives — this test times out.
    const scriptId = crypto.randomUUID();
    const party = await testParty("walkaway", {
      maps: [
        testMapInput("walkaway ground", {
          events: [
            scriptEvent(scriptId, 5, 5, "action", [{ t: "say", text: "stay a while", name: null }]),
          ],
        }),
      ],
    });
    const hero = await testHero("Walker", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    client.action("interact");
    const say = await until(
      "say beat",
      () =>
        client.received.find((m) => m.t === "event.say") as
          | Extract<ServerMessage, { t: "event.say" }>
          | undefined,
    );
    await awaitDiag(hero.roomKey, "run parked", (d) => d.eventRuns.length === 1);

    // Walk right, well beyond three tiles from the event cell (5,5).
    client.press("right");
    await until("walked four tiles away", () => (client.self()?.x ?? 0) > 9 * TILE_SIZE);
    await until("panel closed on walk-away", () =>
      client.received.some((m) => m.t === "event.close" && m.runId === say.runId),
    );
    await awaitDiag(hero.roomKey, "run ended on walk-away", (d) => d.eventRuns.length === 0);
  });

  it("mid-dialogue: a raw interact does NOT re-trigger, and event.advance turns the page", async () => {
    // While parked on a say (waiting-advance), a bare interact must be dropped by the one-run lock —
    // it never starts a second run. The advance intent is what turns the page.
    const scriptId = crypto.randomUUID();
    const party = await testParty("mid", {
      maps: [
        testMapInput("mid ground", {
          events: [
            scriptEvent(scriptId, 5, 5, "action", [
              { t: "say", text: "one", name: null },
              { t: "say", text: "two", name: null },
            ]),
          ],
        }),
      ],
    });
    const hero = await testHero("Mid", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    client.action("interact");
    const first = await until(
      "first say",
      () =>
        client.received.find((m) => m.t === "event.say") as
          | Extract<ServerMessage, { t: "event.say" }>
          | undefined,
    );
    expect(first.text).toBe("one");

    // A second bare interact while parked: the lock drops it. Give the room ticks to (wrongly) act.
    client.action("interact");
    client.action("interact");
    await scheduler.wait(300);
    const diag = await env.WORLD.getByName(hero.roomKey).roomDiagnostics();
    expect(diag.eventRuns).toHaveLength(1);
    expect(diag.eventRuns[0]?.runId).toBe(first.runId);
    // Still exactly one say has been sent — no re-trigger produced a duplicate greeting.
    expect(client.received.filter((m) => m.t === "event.say" && m.text === "one")).toHaveLength(1);

    // event.advance turns to the second page.
    client.sendRaw(JSON.stringify({ t: "event.advance", runId: first.runId }));
    await until("advanced to page two", () =>
      client.received.some((m) => m.t === "event.say" && m.text === "two"),
    );
  });
});

describe("teleport", { timeout: 20_000 }, () => {
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

  it("launches exactly ONE handoff for two back-to-back cross-map teleports", {
    timeout: 20_000,
  }, async () => {
    // A program with two consecutive cross-map teleports. `transitioning` is claimed synchronously by
    // the first dispatch, so the second is dropped and only one handoff launches. Mutation proof: move
    // the claim back into the async handoff and BOTH dispatches launch (crossMapTeleports === 2).
    const teleId = crypto.randomUUID();
    const bodyA = testMapInput("double A", {
      events: [
        scriptEvent(teleId, 5, 5, "action", [
          { t: "teleport", mapId: "00000000-0000-4000-8000-000000000000", col: 10, row: 10 },
          { t: "teleport", mapId: "00000000-0000-4000-8000-000000000000", col: 10, row: 10 },
        ]),
      ],
    });
    const party = await testParty("double-tp", {
      maps: [bodyA, testMapInput("double B")],
    });
    const [mapA, mapB] = party.mapIds;
    if (!mapA || !mapB) throw new Error("expected two maps");
    const roomKeyA = `${party.partyId}:${mapA}`;
    // Re-author mapA's event so both teleports point at the real map B.
    const fixedA: TestMapBody = {
      ...bodyA,
      events: bodyA.events.map((event) =>
        event.id === teleId
          ? {
              ...event,
              pages: event.pages.map((p) => ({
                ...p,
                commands: [
                  { t: "teleport", mapId: mapB, col: 10, row: 10 } satisfies EventCommand,
                  { t: "teleport", mapId: mapB, col: 10, row: 10 } satisfies EventCommand,
                ],
              })),
            }
          : event,
      ),
    };
    await putMap(party, mapA, fixedA);

    // Two heroes in map A so the room stays alive (and keeps its counter) after the teleporter leaves.
    const teleporter = await testHero("Double", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const stay = await testHero("Stay", {
      party,
      position: { x: 12 * TILE_SIZE + TILE_SIZE / 2, y: 12 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const teleClient = await Client.joinHero(teleporter);
    const stayClient = await Client.joinHero(stay);
    await until("both welcomed", () => teleClient.welcome && stayClient.welcome);

    teleClient.action("interact");
    const diag = await awaitDiag(
      roomKeyA,
      "a cross-map handoff launched",
      (d) => d.crossMapTeleports >= 1,
    );
    expect(diag.crossMapTeleports).toBe(1);
  });

  it("releases transitioning and authorized after a D1 write failure mid cross-map handoff", {
    timeout: 10_000,
  }, async () => {
    // `#teleportCrossMap`'s five validation early-returns already released `player.transitioning`
    // (proven above); the gap was a THROWN exception past those checks — the D1 loads,
    // `#checkpointCooldowns`, `#savePlayer` (which deliberately re-throws D1 write failures), or the
    // handoff RPC — escaping the `waitUntil` and stranding `transitioning = true` (and, once past the
    // point where the claim also flips `authorized = false`, stranding that too) forever. That flag
    // gates `#resolvePlayerAction`, so a stranded hero could walk (if still authorized) but never
    // fight again without a reconnect. Force a genuine D1 write failure with a trigger scoped to this
    // test's own hero row — `saveHeroProfile`'s `UPDATE hero ...` is exactly the write `#savePlayer`
    // performs before the handoff RPC — and prove both flags come back: the socket stays open and
    // authorized (no reconnect needed), AND the combat gate itself reopens (an attack actually lands).
    const teleId = crypto.randomUUID();
    const bodyA = testMapInput("fault A", {
      events: [
        scriptEvent(teleId, 5, 5, "action", [
          { t: "teleport", mapId: "00000000-0000-4000-8000-000000000000", col: 10, row: 10 },
        ]),
      ],
      monsterSpawns: [{ col: 6, row: 5, species: "spear_goblin", patrolRadius: 32 }],
    });
    const party = await testParty("fault-tp", {
      maps: [bodyA, testMapInput("fault B")],
    });
    const [mapA, mapB] = party.mapIds;
    if (!mapA || !mapB) throw new Error("expected two maps");
    const roomKeyA = `${party.partyId}:${mapA}`;
    const fixedA: TestMapBody = {
      ...bodyA,
      events: bodyA.events.map((event) =>
        event.id === teleId
          ? {
              ...event,
              pages: event.pages.map((p) => ({
                ...p,
                commands: [{ t: "teleport", mapId: mapB, col: 10, row: 10 } satisfies EventCommand],
              })),
            }
          : event,
      ),
    };
    await putMap(party, mapA, fixedA);

    const hero = await testHero("Faulted", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero);
    const welcome = await until("fault welcomed", () => client.welcome);
    const monster = welcome.monsters[0];
    if (!monster) throw new Error("expected the fixture monster in the welcome snapshot");

    // Scoped to this hero's id alone: it can never touch another test's rows, even if cleanup ran
    // late. A genuine SQLite trigger, not a mock — the real Durable Object drives the real D1 write.
    const triggerName = `fail_hero_save_${hero.heroId.replaceAll("-", "")}`;
    await env.DB.exec(
      `CREATE TRIGGER ${triggerName} BEFORE UPDATE ON hero WHEN NEW.id = '${hero.heroId}' ` +
        `BEGIN SELECT RAISE(ABORT, 'injected d1 write failure'); END`,
    );
    try {
      client.action("interact");
      // Let the failed handoff attempt run to completion (or, pre-fix, strand the claim forever).
      await scheduler.wait(400);
      // The failure happens before the player is ever removed or the socket closed.
      expect(client.closeInfo).toBeNull();
    } finally {
      await env.DB.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }

    // `authorized` is back: `roomDiagnostics().playerIds` only lists authorized players, and the
    // socket itself accepts messages again (`webSocketMessage` gates every frame on `authorized`).
    const diag = await awaitDiag(roomKeyA, "hero still authorized after the fault", (d) =>
      d.playerIds.includes(hero.heroId),
    );
    expect(diag.playerIds).toContain(hero.heroId);

    // `transitioning` is back too: `#startPlayerAction` doesn't gate on it, but `#resolvePlayerAction`
    // does, so only an actual landed hit proves the combat gate itself reopened, not just the socket.
    client.action("attack");
    await until("post-failure attack lands", () => {
      const current = client.latestSnapshot?.monsters.find(
        (candidate) => candidate.id === monster.id,
      );
      return current && current.hp < monster.hp ? current : undefined;
    });
  });

  it("logs a refused authored teleport at most ONCE per room lifetime, not every tick", async () => {
    // `loop { teleport <out-of-bounds> }` refuses on every command forever. The (event, reason) dedupe
    // set collapses the flood to a single log. Mutation proof: drop the dedupe and the spinning loop
    // emits a refusal log every tick.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => warnSpy.mockRestore());

    const spinId = crypto.randomUUID();
    const body = testMapInput("refuse ground", {
      events: [
        scriptEvent(spinId, 5, 5, "action", [
          { t: "loop", body: [{ t: "teleport", mapId: PLACEHOLDER_MAP, col: 9999, row: 9999 }] },
        ]),
      ],
    });
    const party = await testParty("refuse", { maps: [body] });
    const mapId = party.mapIds[0];
    if (!mapId) throw new Error("expected a map");
    // Point the teleport at the map's OWN id (same-map path) so the out-of-bounds cell is refused.
    const fixed: TestMapBody = {
      ...body,
      events: body.events.map((event) =>
        event.id === spinId
          ? {
              ...event,
              pages: event.pages.map((p) => ({
                ...p,
                commands: [
                  {
                    t: "loop",
                    body: [{ t: "teleport", mapId, col: 9999, row: 9999 }],
                  } satisfies EventCommand,
                ],
              })),
            }
          : event,
      ),
    };
    await putMap(party, mapId, fixed);

    const hero = await testHero("Refuser", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    client.action("interact");
    // Let the loop spin many ticks (each would flood without the dedupe), then count refusal logs.
    await scheduler.wait(400);
    const refusals = warnSpy.mock.calls.filter(
      ([arg]) => typeof arg === "string" && arg.includes("event_teleport_refused"),
    );
    expect(refusals).toHaveLength(1);
  });
});

const PLACEHOLDER_MAP = "00000000-0000-4000-8000-000000000000";

describe("aborts", { timeout: 20_000 }, () => {
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

  it("closes the panel and ends the run when the triggerer dies mid-dialogue (final-review must-fix)", async () => {
    // Death (`#killPlayer` -> `#freeze` -> `abortRunsForHero`) tears down a run parked on a say, but
    // unlike a disconnect the hero's socket stays open. Without buffering a close beat the panel
    // would stay undismissable, swallowing interact and 1-4 forever. Mutation proof: revert the
    // `isDialogueParked` buffering in `abortRunsForHero` and this test times out waiting for
    // event.close.
    const scriptId = crypto.randomUUID();
    const party = await testParty("diemid", {
      maps: [
        testMapInput("diemid ground", {
          events: [
            scriptEvent(scriptId, 5, 5, "action", [
              { t: "say", text: "before you go...", name: null },
            ]),
          ],
        }),
      ],
    });
    const hero = await testHero("Doomed", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    client.action("interact");
    const say = await until(
      "say beat",
      () =>
        client.received.find((m) => m.t === "event.say") as
          | Extract<ServerMessage, { t: "event.say" }>
          | undefined,
    );
    await awaitDiag(hero.roomKey, "run parked", (d) => d.eventRuns.length === 1);

    client.chat("/die");
    await until("hero fell", () => client.self()?.life === "corpse");
    await until("panel closed on death", () =>
      client.received.some((m) => m.t === "event.close" && m.runId === say.runId),
    );
    await awaitDiag(hero.roomKey, "run aborted on death", (d) => d.eventRuns.length === 0);
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

  it("closes the panel and ends the run when a page flip aborts it mid-dialogue (final-review must-fix)", async () => {
    // Page 0 (action) opens a say and parks (waiting-advance) — unlike the zombie test above, the
    // flip is NOT this run's own command: it comes from an external state mutation (another hero's
    // event, or here the coordinator test seam), which is exactly the reachable "page flip under a
    // parked run" path. `installAdventureState` -> `#abortRunsForStalePages` -> `abortRunForEvent`
    // must buffer a close, or the triggerer's panel is left undismissable. Mutation proof: revert the
    // `isDialogueParked` buffering in `abortRunForEvent` and this test times out waiting for
    // event.close.
    const eventId = crypto.randomUUID();
    const gated: MapEvent = {
      id: eventId,
      col: 5,
      row: 5,
      name: "Gated",
      ordinal: 30,
      kind: "normal",
      species: null,
      patrolRadius: null,
      pages: [
        page({ trigger: "action", commands: [{ t: "say", text: "hold on...", name: null }] }),
        page({ graphicAssetId: PAGE2_GRAPHIC, condSwitchId: "0001" }),
      ],
    };
    const party = await testParty("gateddialogue", {
      maps: [testMapInput("gateddialogue ground", { events: [gated] })],
    });
    const hero = await testHero("Gated", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    client.action("interact");
    const say = await until(
      "say beat",
      () =>
        client.received.find((m) => m.t === "event.say") as
          | Extract<ServerMessage, { t: "event.say" }>
          | undefined,
    );
    await awaitDiag(hero.roomKey, "run parked", (d) => d.eventRuns.length === 1);

    // An external mutation (not the parked run's own doing) flips the gate switch, changing page 0's
    // active page out from under the parked context.
    await env.GAME_SESSION.getByName(party.partyId).applyStateChangeForTest(party.partyId, {
      switchId: "0001",
      value: true,
    });

    await until("panel closed on page flip", () =>
      client.received.some((m) => m.t === "event.close" && m.runId === say.runId),
    );
    await awaitDiag(hero.roomKey, "page 2 active and run aborted", (diag) => {
      const shows =
        diag.activeEvents.find((e) => e.id === eventId)?.graphicAssetId === PAGE2_GRAPHIC;
      return shows && diag.eventRuns.length === 0;
    });
  });
});

describe("the coordinator", { timeout: 20_000 }, () => {
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

    // `GameSession.fetch()` delegates the live WebSocket to World. workerd correctly refuses to
    // evict a DO with that request still in flight, so drain it before arming the mutation this test
    // wants to survive. The explicit idempotent notification is a rendezvous with room teardown.
    const coordinator = env.GAME_SESSION.getByName(party.partyId);
    client.close();
    await drainHeroRooms();
    await coordinator.roomEmptied(party.partyId, hero.roomKey);

    await coordinator.applyStateChangeForTest(party.partyId, {
      switchId: "0001",
      value: true,
    });
    expect(await readPersistedState(party.partyId)).toBeNull(); // debounced, not yet in D1

    await evictDurableObject(coordinator); // clear the coordinator's in-memory dirty state
    const ran = await runDurableObjectAlarm(coordinator);
    expect(ran).toBe(true);

    const saved = await readPersistedState(party.partyId);
    expect(saved?.switches["0001"]).toBe(true);
  });
});

describe("gold and items (Task 5)", { timeout: 20_000 }, () => {
  it("grants gold to the triggerer's own snapshot alone (per-hero, Q5)", async () => {
    const scriptId = crypto.randomUUID();
    const party = await testParty("gold", {
      maps: [
        testMapInput("gold ground", {
          spawn: { col: 10, row: 15 },
          events: [scriptEvent(scriptId, 5, 15, "action", [{ t: "changeGold", amount: 25 }])],
        }),
      ],
    });
    const heroA = await testHero("GoldA", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 15 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const heroB = await testHero("GoldB", {
      party,
      position: { x: 10 * TILE_SIZE + TILE_SIZE / 2, y: 15 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const clientA = await Client.joinHero(heroA);
    const clientB = await Client.joinHero(heroB);
    await until("both welcomed", () => clientA.welcome && clientB.welcome);

    clientA.action("interact");
    await until(
      "A's own snapshot shows +25 gold",
      () => clientA.latestState?.inventory.gold === 25,
    );
    // B is a different hero: the grant is personal and never touched B's inventory.
    expect(clientB.latestState?.inventory.gold ?? 0).toBe(0);
  });

  it("clamps a change that would drive gold below zero to exactly zero", async () => {
    // `changeGold +10; changeGold -50` in one program: 0 -> 10 -> clamp 0. MUTATION PROOF (a): remove
    // `Math.max(0, ...)` in `#dispatchGold` and the balance lands at -40, failing the `=== 0` below.
    const scriptId = crypto.randomUUID();
    const party = await testParty("clamp", {
      maps: [
        testMapInput("clamp ground", {
          events: [
            scriptEvent(scriptId, 5, 5, "action", [
              { t: "changeGold", amount: 10 },
              { t: "changeGold", amount: -50 },
            ]),
          ],
        }),
      ],
    });
    const hero = await testHero("Clamper", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    client.action("interact");
    // The +10 grant emits a personal loot beat — proof the run executed at all (0 -> 0 is invisible).
    await until("the grant landed", () =>
      client.received.some((m) => m.t === "event" && m.code === "loot.picked"),
    );
    await scheduler.wait(200); // let the -50 apply on top
    expect(client.latestState?.inventory.gold).toBe(0);
  });

  it("lands an item grant in the session inventory, and drops a grant against a full stack", async () => {
    // +3 mana potions land (from 0); then a program fills to the cap and one more is refused with the
    // personal `item.full` code — the loot precedent for a pickup that cannot land.
    const grantId = crypto.randomUUID();
    const fillId = crypto.randomUUID();
    const party = await testParty("items", {
      maps: [
        testMapInput("items ground", {
          spawn: { col: 20, row: 15 },
          events: [
            scriptEvent(grantId, 5, 5, "action", [
              { t: "changeItems", itemId: "mana_potion", count: 3 },
            ]),
            scriptEvent(fillId, 8, 5, "action", [
              { t: "changeItems", itemId: "mana_potion", count: 99 },
              { t: "changeItems", itemId: "mana_potion", count: 5 },
            ]),
          ],
        }),
      ],
    });
    const hero = await testHero("Collector", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    // Grant lands: 0 -> 3 mana potions in the session bag.
    client.action("interact");
    await until(
      "three mana potions in the bag",
      () => client.latestState?.inventory.consumables?.mana_potion === 3,
    );

    // Walk to the fill event (8,5): it grants 99 (3 -> capped at 99), then a further 5 is dropped as
    // the stack is already full — the hero is told with `item.full`.
    client.press("right");
    await until(
      "reached the fill event",
      () => (client.self()?.x ?? 0) > 8 * TILE_SIZE - TILE_SIZE,
    );
    client.release();
    client.action("interact");
    await until("stack full-drop reported", () =>
      client.received.some((m) => m.t === "event" && m.code === "item.full"),
    );
    expect(client.latestState?.inventory.consumables?.mana_potion).toBe(99);
  });

  it("refuses an unknown item id ONCE per room lifetime, not every tick (dedupe)", async () => {
    // `loop { changeItems <unknown> +1 }` refuses on every command forever. MUTATION PROOF (c): drop
    // the `#itemRefusalsLogged` dedupe and the spinning loop emits a refusal log every tick.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => warnSpy.mockRestore());

    const spinId = crypto.randomUUID();
    const party = await testParty("unknown-item", {
      maps: [
        testMapInput("unknown ground", {
          events: [
            scriptEvent(spinId, 5, 5, "action", [
              { t: "loop", body: [{ t: "changeItems", itemId: "dragon_egg", count: 1 }] },
            ]),
          ],
        }),
      ],
    });
    const hero = await testHero("Seeker", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    client.action("interact");
    await scheduler.wait(400); // many ticks: each would flood a log without the dedupe
    const refusals = warnSpy.mock.calls.filter(
      ([arg]) => typeof arg === "string" && arg.includes("event_item_refused"),
    );
    expect(refusals).toHaveLength(1);
  });

  it("makes a zero-net gold change a no-op: no dirty, no reship, no event (review fix 2)", async () => {
    // `changeGold -50` on a fresh hero (0 gold) clamps to 0 -> the NET change is zero. MUTATION PROOF:
    // revert the before/after no-op check in `#dispatchGold` and a spurious `state` beat reaches the
    // wire even though the balance never actually moved.
    const scriptId = crypto.randomUUID();
    const party = await testParty("noop-gold", {
      maps: [
        testMapInput("noop-gold ground", {
          events: [scriptEvent(scriptId, 5, 5, "action", [{ t: "changeGold", amount: -50 }])],
        }),
      ],
    });
    const hero = await testHero("NoopGold", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    client.action("interact");
    await scheduler.wait(300); // give the room ticks to (wrongly) reship a no-op state beat
    expect(client.received.some((m) => m.t === "state")).toBe(false);
    expect(client.latestState?.inventory.gold).toBe(0);
  });

  it("refuses a changeGold grant landing mid cross-map transition, with a deduped log (review fix 1)", async () => {
    // Program: `teleport(cross-map); changeGold +5` in one drain. The teleport claims
    // `player.transitioning` SYNCHRONOUSLY before its async handoff runs, so the very next effect in
    // the SAME drain — the gold grant — must see it and refuse, not silently land in the handoff
    // window. MUTATION PROOF: drop the `player.transitioning` guard in `#dispatchGold` and this
    // refusal log never appears (the grant would instead land, or vanish unaccounted for).
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => warnSpy.mockRestore());

    const teleId = crypto.randomUUID();
    const bodyA = testMapInput("guard-gold A", {
      events: [
        scriptEvent(teleId, 5, 5, "action", [
          { t: "teleport", mapId: PLACEHOLDER_MAP, col: 10, row: 10 },
          { t: "changeGold", amount: 5 },
        ]),
      ],
    });
    const party = await testParty("guard-gold", { maps: [bodyA, testMapInput("guard-gold B")] });
    const [mapA, mapB] = party.mapIds;
    if (!mapA || !mapB) throw new Error("expected two maps");
    const fixedA: TestMapBody = {
      ...bodyA,
      events: bodyA.events.map((event) =>
        event.id === teleId
          ? {
              ...event,
              pages: event.pages.map((p) => ({
                ...p,
                commands: [
                  { t: "teleport", mapId: mapB, col: 10, row: 10 } satisfies EventCommand,
                  { t: "changeGold", amount: 5 } satisfies EventCommand,
                ],
              })),
            }
          : event,
      ),
    };
    await putMap(party, mapA, fixedA);

    const hero = await testHero("GuardGold", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    client.action("interact");
    await until("gold refusal logged", () =>
      warnSpy.mock.calls.some(
        ([arg]) =>
          typeof arg === "string" &&
          arg.includes("event_gold_refused") &&
          arg.includes('"reason":"transitioning"'),
      ),
    );
    // Never landed: no loot.picked (gold) beat ever reached the client.
    expect(client.received.some((m) => m.t === "event" && m.code === "loot.picked")).toBe(false);
  });

  it("refuses a changeItems grant landing mid cross-map transition, with a deduped log (review fix 1)", async () => {
    // Same guard, same drain-ordering, on the item dispatcher. MUTATION PROOF: drop the
    // `player.transitioning` guard in `#dispatchItems` and this refusal log never appears.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => warnSpy.mockRestore());

    const teleId = crypto.randomUUID();
    const bodyA = testMapInput("guard-items A", {
      events: [
        scriptEvent(teleId, 5, 5, "action", [
          { t: "teleport", mapId: PLACEHOLDER_MAP, col: 10, row: 10 },
          { t: "changeItems", itemId: "mana_potion", count: 3 },
        ]),
      ],
    });
    const party = await testParty("guard-items", { maps: [bodyA, testMapInput("guard-items B")] });
    const [mapA, mapB] = party.mapIds;
    if (!mapA || !mapB) throw new Error("expected two maps");
    const fixedA: TestMapBody = {
      ...bodyA,
      events: bodyA.events.map((event) =>
        event.id === teleId
          ? {
              ...event,
              pages: event.pages.map((p) => ({
                ...p,
                commands: [
                  { t: "teleport", mapId: mapB, col: 10, row: 10 } satisfies EventCommand,
                  { t: "changeItems", itemId: "mana_potion", count: 3 } satisfies EventCommand,
                ],
              })),
            }
          : event,
      ),
    };
    await putMap(party, mapA, fixedA);

    const hero = await testHero("GuardItems", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    client.action("interact");
    await until("item refusal logged", () =>
      warnSpy.mock.calls.some(
        ([arg]) =>
          typeof arg === "string" &&
          arg.includes("event_item_refused") &&
          arg.includes('"reason":"transitioning"'),
      ),
    );
    expect(client.received.some((m) => m.t === "event" && m.code === "loot.picked")).toBe(false);
  });
});

describe("the per-hero dialogue cap (Task 4 review)", { timeout: 20_000 }, () => {
  it("refuses a second dialogue while the first panel is open, and allows it once closed", async () => {
    // A touch event opens dialogue "one"; an adjacent action event's dialogue "two" must be refused
    // while "one" is open (WoW: one conversation at a time), then allowed after "one" closes. The
    // deterministic cap mutation proof (b) lives in the unit suite; this pins the end-to-end behaviour.
    const touchId = crypto.randomUUID();
    const actionId = crypto.randomUUID();
    const party = await testParty("cap", {
      maps: [
        testMapInput("cap ground", {
          spawn: { col: 5, row: 5 },
          events: [
            scriptEvent(touchId, 6, 5, "player-touch", [{ t: "say", text: "one", name: null }]),
            scriptEvent(actionId, 6, 6, "action", [{ t: "say", text: "two", name: null }]),
          ],
        }),
      ],
    });
    const hero = await testHero("Capped", {
      party,
      account: party.host,
      position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 5 * TILE_SIZE + TILE_SIZE / 2 },
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    // 1) Walk one cell right onto the touch cell -> "one" parks the run.
    client.press("right");
    await until(
      "entered the touch cell",
      () => Math.floor((client.self()?.x ?? 0) / TILE_SIZE) >= 6,
    );
    client.release();
    const one = await until(
      "first dialogue (touch)",
      () =>
        client.received.find((m) => m.t === "event.say" && m.text === "one") as
          | Extract<ServerMessage, { t: "event.say" }>
          | undefined,
    );

    // 2) Interact the adjacent action event WHILE parked -> the per-hero cap drops it silently.
    client.action("interact");
    await scheduler.wait(300); // give the room ticks to (wrongly) start a second dialogue
    expect(client.received.some((m) => m.t === "event.say" && m.text === "two")).toBe(false);
    const capped = await env.WORLD.getByName(hero.roomKey).roomDiagnostics();
    expect(capped.eventRuns).toHaveLength(1);
    expect(capped.eventRuns[0]?.runId).toBe(one.runId);

    // 3) Close "one" (advance the single-page say to done), then interact again -> now allowed.
    client.sendRaw(JSON.stringify({ t: "event.advance", runId: one.runId }));
    await awaitDiag(hero.roomKey, "first run released", (d) => d.eventRuns.length === 0);
    client.action("interact");
    await until("second dialogue now allowed", () =>
      client.received.some((m) => m.t === "event.say" && m.text === "two"),
    );
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
