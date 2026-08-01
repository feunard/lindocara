/**
 * Fenced map handoff between Alepha world rooms (Task 8): a hero standing on an authored `exit`
 * event, or hit by an authored cross-map `teleport` command, rides `WorldRoom.transitionAdventureExit`
 * / `WorldRoom.teleportCrossMap` — freeze, checkpoint cooldowns, force-save, epoch-fenced
 * `PresenceRoom.handoff`, remove, close `ZONE_TRANSITION` (4008). Ported from legacy
 * `world.ts:3616-3739` (`#transitionAdventureExit`) and `:5112-5218` (`#teleportCrossMap`).
 *
 * Pinned here:
 * 1. a hero walking onto an exit closes 4008; D1 shows the destination map + entry position +
 *    epoch N+1; a fresh `GET /api/join` + a real reconnect lands in the destination room at the
 *    saved position — two rooms, one hero, end-to-end over real sockets;
 * 2. a stale handoff (the epoch races via a second `PresenceRoom.acquire` before the transition
 *    fires) aborts without corrupting D1 — the same `rejectStaleSave`/4003 path every other
 *    epoch-loss in this codebase uses (not 4008: a lease that already moved to a different
 *    connection can never be allowed to keep simulating on the old one);
 * 3. a cooldown checkpointed before the exit survives the transition into the destination room's
 *    welcome AND the persisted hero row (promotion + checkpoint, `PresenceRoom.handoff`'s own
 *    `promoteCooldowns`);
 * 4. an authored cross-map `teleport` command (the Task-7 refusal stub) now rides the identical
 *    choreography as an exit;
 * 5. the source room's state drops the player immediately (no ghost entry), and the empty room
 *    reports `roomEmptied` to `PartyRoom` once its last socket actually disconnects.
 *
 * Tests 2-5 use the `RoomEngine`/`FakeClock` idiom (`world-room-persistence.test.ts`,
 * `world-room-events.test.ts`): the REAL `WorldRoom.roomOptions` hosted in a bare engine, so
 * `detectAdventureExits`/`drainEventRuns` tick deterministically without sleeping. Test 1 is the
 * one true end-to-end proof — real HTTP, real production-wired rooms, real sockets — because it is
 * the only one that needs a genuine SECOND room admission through `resolveJoin` rather than a
 * second bare engine standing in for one.
 */

import { WS_CLOSE } from "@lindocara/engine/close-codes.js";
import { harvestPreset, harvestProfileFromPreset } from "@lindocara/engine/harvest-presets.js";
import {
  eventCellCentre,
  functionalEvent,
  type MapEvent,
  type MapEventPage,
} from "@lindocara/engine/map-events.js";
import {
  defaultMapHeroSettings,
  type MapHeroSettings,
} from "@lindocara/engine/map-hero-settings.js";
import { MAP_MIN_COLS, MAP_MIN_ROWS } from "@lindocara/engine/map-limits.js";
import type { ServerMessage } from "@lindocara/engine/protocol.js";
import { PLAYER_SIZE } from "@lindocara/engine/simulation.js";
import type { PlayerRuntime } from "@lindocara/server/world/world-runtime.js";
import { layeredWireTerrain } from "@lindocara/testing/map-fixtures.js";
import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { type RoomClock, RoomEngine, type RoomSocket } from "alepha/websocket";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { WebSocket } from "ws";
import { heroes } from "../src/api/entities/heroes.ts";
import {
  type HitHarvestNodeResult,
  PartyRoom,
  type ReserveHarvestNodeResult,
} from "../src/api/realtime/PartyRoom.ts";
import { PresenceRoom } from "../src/api/realtime/PresenceRoom.ts";
import { WorldRoom } from "../src/api/realtime/WorldRoom.ts";
import type { WorldRoomState } from "../src/api/realtime/worldState.ts";
import { createTestApp } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";
const TICK_MS = 50;
const COLS = MAP_MIN_COLS;
const ROWS = MAP_MIN_ROWS;

// -------------------------------------------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------------------------------------------

function blocks(): string[] {
  return Array.from({ length: ROWS }, () => ".".repeat(COLS));
}

function grassTerrain(): Record<string, unknown> {
  return layeredWireTerrain(blocks());
}

function ev(id: string, kind: "entry" | "exit", col: number, row: number): MapEvent {
  return functionalEvent({ id, col, row, ordinal: 0, kind });
}

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

function channelledTree(id: string, col: number, row: number): MapEvent {
  const preset = harvestPreset("tree");
  const event = functionalEvent({
    id,
    col,
    row,
    ordinal: 30 + col,
    kind: "harvestable",
    name: "Arbre de transition",
    harvestProfile: {
      ...harvestProfileFromPreset("tree"),
      yieldAmount: 17,
      hitsRequired: 1,
      harvestDurationMs: 5_000,
    },
  });
  return { ...event, pages: [page({ graphicAssetId: preset.intactAssetId })] };
}

let alepha: ReturnType<typeof createTestApp>;
let presenceRoom: PresenceRoom;
let partyRoom: PartyRoom;
let hostname: string;
let userCount = 0;
let openSockets: WebSocket[];
let savedCheatsEnabled: string | undefined;

class Probe {
  heroes = $repository(heroes);
}
let probe: Probe;

beforeEach(async () => {
  alepha = createTestApp();
  probe = alepha.inject(Probe);
  presenceRoom = alepha.inject(PresenceRoom);
  partyRoom = alepha.inject(PartyRoom);
  openSockets = [];
  savedCheatsEnabled = process.env.CHEATS_ENABLED;
  await alepha.start();
  hostname = alepha.inject(ServerProvider).hostname;
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (savedCheatsEnabled === undefined) delete process.env.CHEATS_ENABLED;
  else process.env.CHEATS_ENABLED = savedCheatsEnabled;
  for (const socket of openSockets) {
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  }
  await alepha.stop();
});

/**
 * `WorldRoom.env` (`websocketTransportCap.ts`'s conversion sibling, `worldRoomEnvSchema`)
 * resolves `CHEATS_ENABLED` through `$env` once at construction — matching real Cloudflare
 * Workers semantics, where there is no live env to mutate mid-request. A test that only needs the
 * `/tp` cheat as SETUP plumbing (moving a hero onto an exit tile deterministically, not exercising
 * the gate itself) must boot its own app with the env var already set, rather than flip
 * `process.env` under the app `beforeEach` already started.
 */
async function bootAppWithCheats(): Promise<void> {
  await alepha.stop();
  process.env.CHEATS_ENABLED = "true";
  alepha = createTestApp();
  probe = alepha.inject(Probe);
  presenceRoom = alepha.inject(PresenceRoom);
  partyRoom = alepha.inject(PartyRoom);
  await alepha.start();
  hostname = alepha.inject(ServerProvider).hostname;
}

async function registerAndLogin(prefix: string): Promise<{ token: string; userId: string }> {
  userCount += 1;
  const username = `${prefix}${userCount}`;
  const users = alepha.inject(UserController);
  const intent = await users.createRegistrationIntent.fetch({
    body: { username, password: PASSWORD },
  });
  await users.createUserFromIntent.fetch({ body: { intentId: intent.data.intentId } });
  const login = await fetch(`${hostname}/_auth/token?provider=credentials`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const tokens = (await login.json()) as { access_token: string };
  const whoami = await fetch(`${hostname}/api/whoami`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const me = (await whoami.json()) as { id: string };
  return { token: tokens.access_token, userId: me.id };
}

function authed(token: string) {
  return (path: string, init: RequestInit = {}) =>
    fetch(`${hostname}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
}

interface TwoMapFixture {
  token: string;
  userId: string;
  adventureId: string;
  mapAId: string;
  mapBId: string;
  partyId: string;
  heroId: string;
  roomAId: string;
  roomBId: string;
  entryA: MapEvent;
  exitA: MapEvent;
  entryB: MapEvent;
}

/** One account, an adventure whose default map (A) carries an entry+exit pair bound by the graph
 *  to a second authored map's (B) entry, one party and one hero spawned at A's entry — end-to-end
 *  over HTTP, the `adventures.test.ts`/`world-room-events.test.ts` authoring idiom combined. */
async function twoMapAdventure(
  prefix: string,
  heroSettings: {
    mapA?: MapHeroSettings;
    mapB?: MapHeroSettings;
    mapAEvents?: readonly MapEvent[];
    mapBEvents?: readonly MapEvent[];
    heroClass?: "warrior" | "peasant";
  } = {},
): Promise<TwoMapFixture> {
  const { token, userId } = await registerAndLogin(prefix);
  const api = authed(token);
  const adventureResponse = await api("/api/adventures", {
    method: "POST",
    body: JSON.stringify({ title: "Donjon", maxPlayers: 4 }),
  });
  expect(adventureResponse.status).toBe(201);
  const adventure = (await adventureResponse.json()) as { id: string; defaultMap: { id: string } };
  const mapAId = adventure.defaultMap.id;

  const entryA = ev(crypto.randomUUID(), "entry", 5, 5);
  const exitA = ev(crypto.randomUUID(), "exit", 7, 7);
  const putA = await api(`/api/maps/${mapAId}`, {
    method: "PUT",
    body: JSON.stringify({
      name: "A",
      ...grassTerrain(),
      elements: [],
      events: [entryA, exitA, ...(heroSettings.mapAEvents ?? [])],
      spawn: { col: 0, row: 0 },
      ...(heroSettings.mapA === undefined ? {} : { heroSettings: heroSettings.mapA }),
    }),
  });
  expect(putA.status).toBe(200);

  const mapBResponse = await api("/api/maps", {
    method: "POST",
    body: JSON.stringify({ adventureId: adventure.id, name: "B" }),
  });
  expect(mapBResponse.status).toBe(201);
  const mapBId = ((await mapBResponse.json()) as { id: string }).id;
  const entryB = ev(crypto.randomUUID(), "entry", 4, 4);
  const putB = await api(`/api/maps/${mapBId}`, {
    method: "PUT",
    body: JSON.stringify({
      name: "B",
      ...grassTerrain(),
      elements: [],
      events: [entryB, ...(heroSettings.mapBEvents ?? [])],
      spawn: { col: 0, row: 0 },
      ...(heroSettings.mapB === undefined ? {} : { heroSettings: heroSettings.mapB }),
    }),
  });
  expect(putB.status).toBe(200);

  const graphResponse = await api(`/api/adventures/${adventure.id}`, {
    method: "PUT",
    body: JSON.stringify({
      title: "Donjon",
      maxPlayers: 4,
      graph: {
        start: { mapId: mapAId, entryId: entryA.id },
        links: [{ mapId: mapAId, exitId: exitA.id, dest: { mapId: mapBId, entryId: entryB.id } }],
      },
    }),
  });
  expect(graphResponse.status).toBe(200);

  const partyResponse = await api("/api/parties", {
    method: "POST",
    body: JSON.stringify({ adventureId: adventure.id }),
  });
  expect(partyResponse.status).toBe(201);
  const partyId = ((await partyResponse.json()) as { id: string }).id;
  const heroResponse = await api(`/api/parties/${partyId}/heroes`, {
    method: "POST",
    body: JSON.stringify({ name: "Mira", class: heroSettings.heroClass ?? "warrior" }),
  });
  expect(heroResponse.status).toBe(201);
  const heroId = ((await heroResponse.json()) as { id: string }).id;

  return {
    token,
    userId,
    adventureId: adventure.id,
    mapAId,
    mapBId,
    partyId,
    heroId,
    roomAId: `${partyId}:${mapAId}`,
    roomBId: `${partyId}:${mapBId}`,
    entryA,
    exitA,
    entryB,
  };
}

interface TeleportFixture {
  userId: string;
  mapAId: string;
  mapBId: string;
  partyId: string;
  heroId: string;
  roomAId: string;
  teleporter: MapEvent;
  destination: { col: number; row: number };
}

/** A member map B with nothing but walkable grass, and map A carrying a scripted `action` event
 *  whose program teleports straight to a cell on B — no exit anchor or graph link involved, proving
 *  the authored-teleport path rides the same handoff independently of the exit-graph path. */
async function teleportAdventure(prefix: string): Promise<TeleportFixture> {
  const { token, userId } = await registerAndLogin(prefix);
  const api = authed(token);
  const adventureResponse = await api("/api/adventures", {
    method: "POST",
    body: JSON.stringify({ title: "Donjon", maxPlayers: 4 }),
  });
  expect(adventureResponse.status).toBe(201);
  const adventure = (await adventureResponse.json()) as { id: string; defaultMap: { id: string } };
  const mapAId = adventure.defaultMap.id;

  const mapBResponse = await api("/api/maps", {
    method: "POST",
    body: JSON.stringify({ adventureId: adventure.id, name: "B" }),
  });
  expect(mapBResponse.status).toBe(201);
  const mapBId = ((await mapBResponse.json()) as { id: string }).id;
  const putB = await api(`/api/maps/${mapBId}`, {
    method: "PUT",
    body: JSON.stringify({
      name: "B",
      ...grassTerrain(),
      elements: [],
      events: [],
      spawn: { col: 0, row: 0 },
    }),
  });
  expect(putB.status).toBe(200);

  const destination = { col: 2, row: 2 };
  const entryA = ev(crypto.randomUUID(), "entry", 5, 5);
  const teleporter: MapEvent = {
    id: crypto.randomUUID(),
    col: 6,
    row: 5,
    name: "Portal",
    ordinal: 10,
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: [
      page({
        trigger: "action",
        commands: [
          {
            t: "teleport",
            mapId: mapBId,
            col: destination.col,
            row: destination.row,
            category: "geographic",
          },
        ],
      }),
    ],
  };
  const putA = await api(`/api/maps/${mapAId}`, {
    method: "PUT",
    body: JSON.stringify({
      name: "A",
      ...grassTerrain(),
      elements: [],
      events: [entryA, teleporter],
      spawn: { col: 0, row: 0 },
    }),
  });
  expect(putA.status).toBe(200);

  const graphResponse = await api(`/api/adventures/${adventure.id}`, {
    method: "PUT",
    body: JSON.stringify({
      title: "Donjon",
      maxPlayers: 4,
      graph: { start: { mapId: mapAId, entryId: entryA.id }, links: [] },
    }),
  });
  expect(graphResponse.status).toBe(200);

  const partyResponse = await api("/api/parties", {
    method: "POST",
    body: JSON.stringify({ adventureId: adventure.id }),
  });
  expect(partyResponse.status).toBe(201);
  const partyId = ((await partyResponse.json()) as { id: string }).id;
  const heroResponse = await api(`/api/parties/${partyId}/heroes`, {
    method: "POST",
    body: JSON.stringify({ name: "Mira", class: "warrior" }),
  });
  expect(heroResponse.status).toBe(201);
  const heroId = ((await heroResponse.json()) as { id: string }).id;

  return {
    userId,
    mapAId,
    mapBId,
    partyId,
    heroId,
    roomAId: `${partyId}:${mapAId}`,
    teleporter,
    destination,
  };
}

// -------------------------------------------------------------------------------------------------
// FakeClock engine harness (tests 2-5)
// -------------------------------------------------------------------------------------------------

class FakeClock implements RoomClock {
  protected ms = 0;
  protected handlers = new Map<number, () => void>();
  protected nextId = 1;

  setInterval(fn: () => void): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.handlers.set(id, fn);
    return id;
  }

  clearInterval(handle: unknown): void {
    this.handlers.delete(handle as number);
  }

  now(): number {
    return this.ms;
  }

  advance(ms: number): void {
    this.ms += ms;
    for (const fn of [...this.handlers.values()]) fn();
  }

  advanceTicks(count: number): void {
    for (let i = 0; i < count; i += 1) this.advance(TICK_MS);
  }
}

interface FakeSocket extends RoomSocket {
  sent: string[];
  closed?: { code?: number; reason?: string };
}

function fakeSocket(userId: string, heroId: string, connectionId: string): FakeSocket {
  const sent: string[] = [];
  const socket: FakeSocket = {
    id: connectionId,
    userId,
    query: { hero: heroId },
    data: {},
    sent,
    closed: undefined,
    sendRaw: (data: string) => {
      sent.push(data);
    },
    close: (code?: number, reason?: string) => {
      socket.closed = { code, reason };
    },
  };
  return socket;
}

const engines = new Map<string, RoomEngine<never, never, WorldRoomState>>();

function createEngine(roomId: string, clock: FakeClock) {
  const worldRoom = alepha.inject(WorldRoom);
  const engine = new RoomEngine({
    roomId,
    clock,
    options: worldRoom.roomOptions,
    validate: () => {},
  }) as unknown as RoomEngine<never, never, WorldRoomState>;
  engines.set(roomId, engine);
  return engine;
}

function roomState(engine: object): WorldRoomState {
  return (engine as unknown as { state: WorldRoomState }).state;
}

function playerOf(state: WorldRoomState, heroId: string): PlayerRuntime {
  const connectionId = state.connectionIdByHeroId.get(heroId);
  const player = connectionId === undefined ? undefined : state.players.get(connectionId);
  if (!player) throw new Error(`hero ${heroId} is not in the room`);
  return player;
}

function messagesOf(socket: FakeSocket): ServerMessage[] {
  return socket.sent.map((raw) => JSON.parse(raw) as ServerMessage);
}

function welcomeSelfState(socket: FakeSocket) {
  for (const message of messagesOf(socket)) {
    if (message.t === "welcome") return message.self;
  }
  return undefined;
}

function welcomeMessage(socket: FakeSocket): Extract<ServerMessage, { t: "welcome" }> {
  const welcome = messagesOf(socket).find(
    (message): message is Extract<ServerMessage, { t: "welcome" }> => message.t === "welcome",
  );
  if (!welcome) throw new Error("welcome missing");
  return welcome;
}

// -------------------------------------------------------------------------------------------------
// Real-socket harness (test 1)
// -------------------------------------------------------------------------------------------------

interface SocketProbe {
  socket: WebSocket;
  messages: ServerMessage[];
  closeCode: Promise<number | undefined>;
  waitFor(predicate: (message: ServerMessage) => boolean, label: string): Promise<ServerMessage>;
}

function openWorldSocket(roomId: string, heroId: string, token: string): SocketProbe {
  const wsHost = hostname.replace(/^http/, "ws");
  const socket = new WebSocket(`${wsHost}/ws/world?roomId=${roomId}&hero=${heroId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  openSockets.push(socket);
  const messages: ServerMessage[] = [];
  const waiters: {
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
  }[] = [];
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter?.predicate(message)) {
        waiters.splice(index, 1);
        waiter.resolve(message);
      }
    }
  });
  const closeCode = new Promise<number | undefined>((resolve) => {
    socket.on("close", (code) => resolve(code));
  });
  return {
    socket,
    messages,
    closeCode,
    waitFor: (predicate, label) =>
      new Promise<ServerMessage>((resolve, reject) => {
        const existing = messages.find(predicate);
        if (existing) return resolve(existing);
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 10_000);
        waiters.push({
          predicate,
          resolve: (message) => {
            clearTimeout(timer);
            resolve(message);
          },
        });
      }),
  };
}

// -------------------------------------------------------------------------------------------------
// 1. Real end-to-end: exit -> 4008 -> D1 -> resolveJoin -> destination room welcome
// -------------------------------------------------------------------------------------------------

describe("adventure exit, end-to-end over real sockets", () => {
  test("closes 4008, persists the destination in D1, and a fresh join lands there", async () => {
    await bootAppWithCheats();
    const fixture = await twoMapAdventure("exite2e");
    const beforeRow = await probe.heroes.findById(fixture.heroId);
    if (!beforeRow) throw new Error("hero row missing");

    const roomA = openWorldSocket(fixture.roomAId, fixture.heroId, fixture.token);
    await roomA.waitFor((message) => message.t === "welcome", "room A welcome");

    // Walk exactly onto the exit tile via the dev cheat (deterministic; real WASD timing is not
    // what this test is about) and let the real 20Hz tick detect + transition.
    roomA.socket.send(
      JSON.stringify({ t: "chat", text: `/tp ${fixture.exitA.col} ${fixture.exitA.row}` }),
    );
    const closeCode = await roomA.closeCode;
    expect(closeCode).toBe(WS_CLOSE.ZONE_TRANSITION);

    const afterRow = await probe.heroes.findById(fixture.heroId);
    expect(afterRow?.mapId).toBe(fixture.mapBId);
    const entryCentre = eventCellCentre(fixture.entryB);
    expect(afterRow?.x).toBe(entryCentre.x);
    expect(afterRow?.y).toBe(entryCentre.y);
    expect(afterRow?.sessionEpoch ?? 0).toBeGreaterThan(beforeRow.sessionEpoch);

    // A fresh `resolveJoin` now reads the NEW map from D1 — never anything the client claims.
    const api = authed(fixture.token);
    const joinResponse = await api(`/api/join?party=${fixture.partyId}&hero=${fixture.heroId}`);
    expect(joinResponse.status).toBe(200);
    const join = (await joinResponse.json()) as { roomId: string; channelPath: string };
    expect(join.roomId).toBe(fixture.roomBId);
    expect(join.channelPath).toBe("/ws/world");

    const roomB = openWorldSocket(join.roomId, fixture.heroId, fixture.token);
    const welcomeB = await roomB.waitFor((message) => message.t === "welcome", "room B welcome");
    if (welcomeB.t !== "welcome") throw new Error("unreachable");
    expect(welcomeB.world.zoneId).toBe(fixture.mapBId);
    const self = welcomeB.players.find((candidate) => candidate.id === fixture.heroId);
    expect(self?.x).toBe(entryCentre.x);
    expect(self?.y).toBe(entryCentre.y);
  }, 20_000);
});

// -------------------------------------------------------------------------------------------------
// 2-5. FakeClock engine
// -------------------------------------------------------------------------------------------------

describe("world room transitions (FakeClock)", () => {
  test("a handoff cancels map A harvesting and a destination reconnect targets only map B", async () => {
    const exhaustedA = channelledTree(crypto.randomUUID(), 3, 3);
    const resourceA = channelledTree(crypto.randomUUID(), 6, 7);
    const resourceB = channelledTree(crypto.randomUUID(), 6, 4);
    const fixture = await twoMapAdventure("harvesthandoff", {
      heroClass: "peasant",
      mapAEvents: [exhaustedA, resourceA],
      mapBEvents: [resourceB],
    });
    const clock = new FakeClock();
    vi.spyOn(Date, "now").mockImplementation(() => clock.now());

    // Seed one completed A node through the real coordinator before admission. It must survive the
    // handoff as party state, without ever becoming a candidate on map B.
    const reservation = (await partyRoom.room.call(fixture.partyId, "reserveHarvestNode", {
      heroId: fixture.heroId,
      eventId: exhaustedA.id,
      generation: 0,
      requiredHits: 1,
      reward: { wood: 17 },
      goldValue: 0,
      respawnDelayMs: null,
    })) as ReserveHarvestNodeResult;
    if (!reservation.ok) throw new Error("map A harvest reservation was rejected");
    const exhausted = (await partyRoom.room.call(fixture.partyId, "hitHarvestNode", {
      heroId: fixture.heroId,
      eventId: exhaustedA.id,
      reservationId: reservation.reservationId,
    })) as HitHarvestNodeResult;
    expect(exhausted).toMatchObject({ ok: true, rewarded: true });

    const engineA = createEngine(fixture.roomAId, clock);
    const socketA = fakeSocket(fixture.userId, fixture.heroId, "c-harvest-a");
    await engineA.join(socketA);
    const stateA = roomState(engineA);
    const playerA = playerOf(stateA, fixture.heroId);
    playerA.level = 10;
    const resourceACentre = eventCellCentre(resourceA);
    const previousA = { x: playerA.x, y: playerA.y };
    playerA.x = resourceACentre.x - PLAYER_SIZE / 2 - 32;
    playerA.y = resourceACentre.y - PLAYER_SIZE / 2;
    playerA.facing = { x: 1, y: 0 };
    stateA.playerGrid.update(playerA, previousA);

    clock.advanceTicks(20);
    await engineA.message(socketA.id, { t: "skill", slot: 1 });
    clock.advance(300);
    const jobA = stateA.harvestJobs.get(fixture.heroId);
    expect(jobA).toMatchObject({ committing: false });
    expect(jobA?.targets[0]).toMatchObject({
      targetRuntimeId: resourceA.id,
      nodeId: resourceA.id,
    });

    const exitCentre = eventCellCentre(fixture.exitA);
    playerA.x = exitCentre.x;
    playerA.y = exitCentre.y;
    clock.advanceTicks(1);
    await vi.waitFor(() => {
      expect(socketA.closed?.code).toBe(WS_CLOSE.ZONE_TRANSITION);
    });
    // The handoff is now terminal: absence is read directly from the completed source cycle.
    expect(stateA.harvestJobs.size).toBe(0);
    expect(stateA.players.size).toBe(0);
    const heldAfterA = (await partyRoom.room.call(fixture.partyId, "getAdventureState")) as {
      state: { harvestNodes?: Record<string, unknown>; materials: { wood: number } };
    };
    expect(heldAfterA.state.harvestNodes?.[exhaustedA.id]).toBeDefined();
    expect(heldAfterA.state.harvestNodes?.[resourceA.id]).toBeUndefined();
    expect(heldAfterA.state.materials.wood).toBe(17);

    await engineA.leave(socketA.id);
    engineA.dispose();
    const engineB = createEngine(fixture.roomBId, clock);
    const socketB = fakeSocket(fixture.userId, fixture.heroId, "c-harvest-b");
    await engineB.join(socketB);
    const stateB = roomState(engineB);
    const playerB = playerOf(stateB, fixture.heroId);
    const resourceBCentre = eventCellCentre(resourceB);
    const previousB = { x: playerB.x, y: playerB.y };
    playerB.x = resourceBCentre.x - PLAYER_SIZE / 2 - 32;
    playerB.y = resourceBCentre.y - PLAYER_SIZE / 2;
    playerB.facing = { x: 1, y: 0 };
    stateB.playerGrid.update(playerB, previousB);

    clock.advance(2_000);
    await engineB.message(socketB.id, { t: "skill", slot: 1 });
    clock.advance(300);
    const jobB = stateB.harvestJobs.get(fixture.heroId);
    expect(jobB).toMatchObject({ committing: false });
    expect(jobB?.targets[0]).toMatchObject({
      targetRuntimeId: resourceB.id,
      nodeId: resourceB.id,
    });
    expect(stateB.activeEvents.map((event) => event.id)).toContain(resourceB.id);
    expect(stateB.activeEvents.map((event) => event.id)).not.toContain(resourceA.id);
    expect(stateB.activeEvents.map((event) => event.id)).not.toContain(exhaustedA.id);

    await engineB.leave(socketB.id);
    expect(stateB.harvestJobs.size).toBe(0);
    engineB.dispose();
    const reconnectB = createEngine(fixture.roomBId, clock);
    const reconnectSocket = fakeSocket(fixture.userId, fixture.heroId, "c-harvest-b-reconnect");
    await reconnectB.join(reconnectSocket);
    const reconnectState = roomState(reconnectB);
    expect(reconnectState.activeEvents).toHaveLength(1);
    expect(reconnectState.activeEvents[0]).toMatchObject({
      id: resourceB.id,
      harvest: { state: "intact", generation: 0 },
    });
    expect(reconnectState.adventureState.state.harvestNodes?.[exhaustedA.id]).toMatchObject({
      generation: 0,
      depleted: true,
    });
    expect(reconnectState.adventureState.state.harvestNodes?.[resourceB.id]).toBeUndefined();
    expect(reconnectState.adventureState.state.materials?.wood).toBe(17);
    expect(playerOf(reconnectState, fixture.heroId).roomKey).toBe(fixture.roomBId);
    reconnectB.dispose();
  });

  test("refreshes map hero rules on transition and a direct destination reconnect", async () => {
    const mapASettings = defaultMapHeroSettings();
    mapASettings.classes.warrior.stats.movementSpeed = 100;
    mapASettings.classes.warrior.disabledSkills = [1];
    const fixture = await twoMapAdventure("herorules", { mapA: mapASettings });
    const clockA = new FakeClock();
    const engineA = createEngine(fixture.roomAId, clockA);
    const socketA = fakeSocket(fixture.userId, fixture.heroId, "c-rules-a");
    await engineA.join(socketA);

    const welcomeA = welcomeMessage(socketA);
    expect(welcomeA.world.heroSettings?.classes.warrior).toMatchObject({
      stats: { movementSpeed: 100 },
      disabledSkills: [1],
    });
    const stateA = roomState(engineA);
    const playerA = playerOf(stateA, fixture.heroId);
    const startA = { x: playerA.x, y: playerA.y };
    await engineA.message(socketA.id, {
      t: "input",
      seq: 1,
      input: { up: false, down: false, left: false, right: true },
    });
    clockA.advanceTicks(1);
    expect(playerA.x - startA.x).toBeCloseTo(100 * (TICK_MS / 1_000));
    expect(playerA.y).toBe(startA.y);

    await engineA.message(socketA.id, { t: "attack" });
    expect(playerA.lastAttackAt).toBe(0);
    expect(messagesOf(socketA)).toContainEqual({
      t: "event",
      code: "skill.disabled",
      params: { skill: "cleave" },
      tone: "info",
    });

    const exitCentre = eventCellCentre(fixture.exitA);
    playerA.x = exitCentre.x;
    playerA.y = exitCentre.y;
    clockA.advanceTicks(1);
    await vi.waitFor(() => {
      expect(socketA.closed?.code).toBe(WS_CLOSE.ZONE_TRANSITION);
    });

    // Map B was never customized. Its authoritative welcome and simulation must replace every
    // rule from A with the central defaults, not retain A's speed or ability lock.
    const defaults = defaultMapHeroSettings();
    const clockB = new FakeClock();
    const engineB = createEngine(fixture.roomBId, clockB);
    const socketB = fakeSocket(fixture.userId, fixture.heroId, "c-rules-b");
    await engineB.join(socketB);
    const welcomeB = welcomeMessage(socketB);
    expect(welcomeB.world.heroSettings).toEqual(defaults);

    const stateB = roomState(engineB);
    const playerB = playerOf(stateB, fixture.heroId);
    const startB = { x: playerB.x, y: playerB.y };
    await engineB.message(socketB.id, {
      t: "input",
      seq: 2,
      input: { up: false, down: false, left: false, right: true },
    });
    clockB.advanceTicks(1);
    expect(playerB.x - startB.x).toBeCloseTo(
      defaults.classes.warrior.stats.movementSpeed * (TICK_MS / 1_000),
    );
    await engineB.message(socketB.id, { t: "attack" });
    expect(playerB.lastAttackAt).toBeGreaterThan(0);

    await engineB.leave(socketB.id);
    engineB.dispose();
    const reconnectEngine = createEngine(fixture.roomBId, new FakeClock());
    const reconnectSocket = fakeSocket(fixture.userId, fixture.heroId, "c-rules-b-reconnect");
    await reconnectEngine.join(reconnectSocket);
    expect(welcomeMessage(reconnectSocket).world.heroSettings).toEqual(defaults);

    engineA.dispose();
    reconnectEngine.dispose();
  });

  test("a stale handoff aborts without corrupting D1, and closes 4003 not 4008", async () => {
    const fixture = await twoMapAdventure("stalehandoff");
    const clock = new FakeClock();
    const engine = createEngine(fixture.roomAId, clock);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "c-1");
    await engine.join(socket);
    const state = roomState(engine);
    clock.advanceTicks(20); // clears the exit's 750ms re-trigger guard against `lastTransitionAt=0`

    const player = playerOf(state, fixture.heroId);
    const exitCentre = eventCellCentre(fixture.exitA);
    player.x = exitCentre.x;
    player.y = exitCentre.y;

    // A competing acquire (a second session for the same hero, exactly like a reconnect racing
    // ahead of this room) bumps the D1 epoch AND replaces the in-memory presence lease out from
    // under this room's held `player.sessionEpoch` — before the tick that would detect the exit.
    await presenceRoom.room.call(fixture.heroId, "acquire", {
      connectionId: "c-elsewhere",
      roomKey: state.roomKey,
      zoneId: state.mapId,
      instanceId: "main",
    });
    const beforeRow = await probe.heroes.findById(fixture.heroId);

    clock.advanceTicks(1);

    // The checkpoint-cooldowns step (the first fenced call the transition makes) already fails
    // against the moved lease, so this is the identical `rejectStaleSave`/4003 outcome every other
    // stale-epoch discovery in this codebase uses — never 4008, and never a partial handoff.
    await vi.waitFor(() => {
      expect(socket.closed?.code).toBe(WS_CLOSE.PRESENCE_LOST);
    });
    expect(socket.closed?.code).not.toBe(WS_CLOSE.ZONE_TRANSITION);

    const afterRow = await probe.heroes.findById(fixture.heroId);
    expect(afterRow).toEqual(beforeRow);
    expect(afterRow?.mapId).toBe(fixture.mapAId);

    // No ghost entry left behind by the aborted attempt either.
    expect(state.players.size).toBe(0);
    engine.dispose();
  });

  test("a cooldown checkpointed before the exit survives into the destination room", async () => {
    const fixture = await twoMapAdventure("cooldownexit");
    const clock = new FakeClock();
    const engineA = createEngine(fixture.roomAId, clock);
    const socketA = fakeSocket(fixture.userId, fixture.heroId, "c-1");
    await engineA.join(socketA);
    const stateA = roomState(engineA);

    await engineA.message(socketA.id, { t: "attack" });
    const playerBefore = playerOf(stateA, fixture.heroId);
    const checkpointedBefore = (await presenceRoom.room.call(
      fixture.heroId,
      "readCooldowns",
      playerBefore.connectionId,
      playerBefore.sessionEpoch,
    )) as { attackUntil?: number } | null;
    expect(checkpointedBefore?.attackUntil ?? 0).toBeGreaterThan(Date.now());

    clock.advanceTicks(20);
    const player = playerOf(stateA, fixture.heroId);
    const exitCentre = eventCellCentre(fixture.exitA);
    player.x = exitCentre.x;
    player.y = exitCentre.y;
    clock.advanceTicks(1);
    await vi.waitFor(() => {
      expect(socketA.closed?.code).toBe(WS_CLOSE.ZONE_TRANSITION);
    });

    // The destination room's admission restores the checkpointed (and promoted) cooldown, both in
    // the fresh welcome AND in the epoch-fenced hero row `HeroSaveService` wrote during the forced
    // pre-handoff save.
    const engineB = createEngine(fixture.roomBId, clock);
    const socketB = fakeSocket(fixture.userId, fixture.heroId, "c-2");
    await engineB.join(socketB);
    const self = welcomeSelfState(socketB);
    expect(self?.cooldowns?.attackUntil ?? 0).toBeGreaterThan(Date.now());

    const row = await probe.heroes.findById(fixture.heroId);
    const persisted = JSON.parse(row?.combatCooldowns ?? "{}") as { attackUntil?: number };
    expect(persisted.attackUntil ?? 0).toBeGreaterThan(Date.now());
    engineA.dispose();
    engineB.dispose();
  });

  test("an authored cross-map teleport rides the same handoff as an exit", async () => {
    const fixture = await teleportAdventure("teleexit");
    const clock = new FakeClock();
    const engine = createEngine(fixture.roomAId, clock);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "c-1");
    await engine.join(socket);
    const state = roomState(engine);
    clock.advanceTicks(20);

    const player = playerOf(state, fixture.heroId);
    const teleporterCentre = eventCellCentre(fixture.teleporter);
    player.x = teleporterCentre.x - 20;
    player.y = teleporterCentre.y;

    await engine.message(socket.id, { t: "interact" });
    clock.advanceTicks(1);

    await vi.waitFor(() => {
      expect(socket.closed?.code).toBe(WS_CLOSE.ZONE_TRANSITION);
    });
    const row = await probe.heroes.findById(fixture.heroId);
    expect(row?.mapId).toBe(fixture.mapBId);
    const destinationCentre = eventCellCentre(fixture.destination);
    expect(row?.x).toBe(destinationCentre.x);
    expect(row?.y).toBe(destinationCentre.y);
    engine.dispose();
  });

  test("the source room drops the player and reports roomEmptied once the socket actually leaves", async () => {
    const fixture = await twoMapAdventure("emptyroom");
    const clock = new FakeClock();
    const engine = createEngine(fixture.roomAId, clock);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "c-1");
    await engine.join(socket);
    const state = roomState(engine);
    clock.advanceTicks(20);

    const player = playerOf(state, fixture.heroId);
    const exitCentre = eventCellCentre(fixture.exitA);
    player.x = exitCentre.x;
    player.y = exitCentre.y;
    clock.advanceTicks(1);
    await vi.waitFor(() => {
      expect(socket.closed?.code).toBe(WS_CLOSE.ZONE_TRANSITION);
    });

    // No ghost entry: the transition drops the player from room state before the socket even
    // finishes closing, well before the transport notices the disconnect.
    expect(state.players.size).toBe(0);
    expect(state.connectionIdByHeroId.has(fixture.heroId)).toBe(false);

    // The transport's own close handshake is what actually calls `engine.leave()` in production;
    // simulate that here (the `world-room-persistence.test.ts` disconnect idiom) and prove the last
    // socket leaving reports `roomEmptied` to the party coordinator, unregistering room A from its
    // directory.
    const roomEmptiedCall = vi.spyOn(partyRoom.room, "call");
    await engine.leave(socket.id);
    expect(roomEmptiedCall).toHaveBeenCalledWith(fixture.partyId, "roomEmptied", fixture.roomAId);
    engine.dispose();
  });
});
