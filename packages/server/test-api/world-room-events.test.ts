/**
 * Events, quests and the adventure-state round-trip on the Alepha rooms (Task 7) — the spec's own
 * proof obligations, driven against the REAL `WorldRoom.roomOptions` hosted in a bare `RoomEngine`
 * on a `FakeClock` (the `world-room-movement/combat/persistence` idiom), plus one real-socket
 * end-to-end for the cross-room state flip (the production `PartyRoom.pushToRoom -> this.room.call`
 * transport).
 *
 * Pinned here:
 * 1. two heroes triggering one gold chest the SAME tick yield exactly ONE grant (the eventId-keyed
 *    run lock — the second trigger drops silently);
 * 2. an authored `loop { setVariable add }` with no exit consumes at most its 16-command slice per
 *    drain and the room keeps ticking (bounded assertion, never a hang);
 * 3. walk-away beyond DIALOGUE_CLOSE_RADIUS closes the panel and abandons the REMAINDER without
 *    rolling back already-applied writes;
 * 4. cross-room flip: a hero in room A flips a switch -> PartyRoom write-through -> room B's
 *    active page changes after the push (two real world rooms, one party room, real sockets);
 * 5. a run reads its OWN same-tick write (the drain-local working copy) and takes the right branch;
 * 6. an out-of-order double install keeps the newer version; install never throws on garbage;
 * 7. `/tp` works only with CHEATS_ENABLED and moves the hero server-side;
 * 8. an event grant of gold+items lands in D1 through the epoch-fenced save — and a stale epoch
 *    changes nothing.
 *
 * The FakeClock engines are NOT the `$room`-managed engines the production `pushToRoom` targets
 * (`this.room.call` routes to the provider's own registry, keyed by channelPath:roomId), so these
 * tests re-route the three PartyRoom seams into the bare engines under test — the same
 * reassignable-seam idiom `PartyRoom`'s docblock sanctions. Test 4 covers the untouched production
 * transport end-to-end.
 */

import {
  EMPTY_ADVENTURE_STATE,
  type PartyAdventureState,
} from "@lindocara/engine/adventure-state.js";
import { WS_CLOSE } from "@lindocara/engine/close-codes.js";
import { DIALOGUE_CLOSE_RADIUS, type EventCommand } from "@lindocara/engine/event-commands.js";
import type { HarvestProfile } from "@lindocara/engine/harvest.js";
import {
  type HarvestPresetId,
  harvestPreset,
  harvestProfileFromPreset,
} from "@lindocara/engine/harvest-presets.js";
import {
  eventCellCentre,
  functionalEvent,
  type MapEvent,
  type MapEventPage,
} from "@lindocara/engine/map-events.js";
import { MAP_MIN_COLS, MAP_MIN_ROWS } from "@lindocara/engine/map-limits.js";
import type { ServerMessage } from "@lindocara/engine/protocol.js";
import { PLAYER_SIZE } from "@lindocara/engine/simulation.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import type { PlayerRuntime } from "@lindocara/server/world/world-runtime.js";
import { D1_SAVE_EVERY_TICKS } from "@lindocara/server/world/world-runtime.js";
import { layeredWireTerrain } from "@lindocara/testing/map-fixtures.js";
import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { type RoomClock, RoomEngine, type RoomSocket } from "alepha/websocket";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { WebSocket } from "ws";
import { heroes } from "../src/api/entities/heroes.ts";
import { heroItems } from "../src/api/entities/heroItems.ts";
import { heroQuests } from "../src/api/entities/heroQuests.ts";
import { parties } from "../src/api/entities/parties.ts";
import { PartyRoom } from "../src/api/realtime/PartyRoom.ts";
import { PresenceRoom } from "../src/api/realtime/PresenceRoom.ts";
import { WorldRoom } from "../src/api/realtime/WorldRoom.ts";
import { refreshHarvestEventVisuals } from "../src/api/realtime/worldEvents.ts";
import type { WorldRoomState } from "../src/api/realtime/worldState.ts";
import { createTestApp } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";
const TICK_MS = 50;
const PAGE1_GRAPHIC = "building.buildings-black-buildings.archery";
const PAGE2_GRAPHIC = "resource.terrain-resources-wood-trees.tree3";
const HARVEST_PROFILE: HarvestProfile = {
  resource: "wood",
  tool: "axe",
  yieldAmount: 6,
  goldValue: 0,
  hitsRequired: 3,
  range: 96,
  harvestDurationMs: 900,
  exhaustedAssetId: "resource.terrain-resources-wood-trees.stump-1",
  exhaustionBehavior: "replace",
  respawn: "permanent",
  respawnDelayMs: 0,
  fadeDurationMs: 350,
};

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

/** One tick, then let every detached promise the tick fired (coordinator RPC, install push, save)
 *  settle — the FakeClock's synchronous `advance` never yields on its own, and the drain-pause
 *  (`eventStateSync`) only lifts once the coordinator round trip has actually resolved. */
async function advanceTickSettled(clock: FakeClock): Promise<void> {
  clock.advance(TICK_MS);
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
}

/** Advance one authoritative tick at an arbitrary elapsed duration, then drain every detached
 * coordinator/save promise it started. FakeClock deliberately fires the interval once per call. */
async function advanceElapsedSettled(clock: FakeClock, elapsedMs: number): Promise<void> {
  clock.advance(elapsedMs);
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
}

interface FakeSocket extends RoomSocket {
  query: { hero: string };
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

class Probe {
  heroes = $repository(heroes);
  heroItems = $repository(heroItems);
  heroQuests = $repository(heroQuests);
  parties = $repository(parties);
}

let alepha: ReturnType<typeof createTestApp>;
let probe: Probe;
let partyRoom: PartyRoom;
let presenceRoom: PresenceRoom;
let hostname: string;
let userCount = 0;
let openSockets: WebSocket[];
let savedCheatsEnabled: string | undefined;

beforeEach(async () => {
  alepha = createTestApp();
  probe = alepha.inject(Probe);
  partyRoom = alepha.inject(PartyRoom);
  presenceRoom = alepha.inject(PresenceRoom);
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
 * Workers semantics, where there is no live env to mutate mid-request. A test proving the cheat
 * gate is actually ON must therefore boot its own app with the env var already set, rather than
 * flip `process.env` under the app `beforeEach` already started.
 */
async function bootAppWithCheats(): Promise<void> {
  await alepha.stop();
  process.env.CHEATS_ENABLED = "true";
  alepha = createTestApp();
  probe = alepha.inject(Probe);
  partyRoom = alepha.inject(PartyRoom);
  presenceRoom = alepha.inject(PresenceRoom);
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

// -------------------------------------------------------------------------------------------------
// Authored fixtures
// -------------------------------------------------------------------------------------------------

/** All-grass wire terrain at the minimum legal size (the `maps.test.ts` fixture idiom). */
function grassTerrain(): Record<string, unknown> {
  const blocks: string[] = [];
  while (blocks.length < MAP_MIN_ROWS) blocks.push(".".repeat(MAP_MIN_COLS));
  return layeredWireTerrain(blocks);
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

function guardDialogueEvent(id: string, col: number, row: number): MapEvent {
  return {
    id,
    col,
    row,
    name: "Garde",
    ordinal: 11,
    kind: "guard",
    species: null,
    patrolRadius: 160,
    pages: [
      page({
        moveSpeed: 4,
        moveFreq: 3,
        optMoveAnim: true,
        commands: [{ t: "say", name: "Garde", text: "La route est sûre." }],
      }),
    ],
  };
}

/** A two-page appearance event: page 1 until switch 0001 holds, page 2 after. */
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

function harvestableEvent(id: string, col: number, row: number): MapEvent {
  return {
    id,
    col,
    row,
    name: "Oak",
    ordinal: 21,
    kind: "harvestable",
    species: null,
    patrolRadius: null,
    harvestProfile: HARVEST_PROFILE,
    pages: [page({ graphicAssetId: PAGE2_GRAPHIC })],
  };
}

function harvestPresetEvent(
  id: string,
  col: number,
  row: number,
  presetId: HarvestPresetId,
  overrides: Partial<HarvestProfile> = {},
): MapEvent {
  const preset = harvestPreset(presetId);
  return {
    id,
    col,
    row,
    name: presetId,
    ordinal: 30 + col,
    kind: "harvestable",
    species: null,
    patrolRadius: null,
    harvestProfile: { ...harvestProfileFromPreset(presetId), ...overrides },
    pages: [page({ graphicAssetId: preset.intactAssetId })],
  };
}

function warPigEvent(
  id: string,
  col: number,
  row: number,
  respawnMode: "never" | "timed",
  respawnDelayMs: number,
): MapEvent {
  return functionalEvent({
    id,
    col,
    row,
    ordinal: 50 + col,
    kind: "monster",
    name: respawnMode === "never" ? "Sanglier permanent" : "Sanglier temporaire",
    species: "war_pig",
    patrolRadius: 0,
    monsterRespawnMode: respawnMode,
    monsterRespawnDelayMs: respawnDelayMs,
  });
}

interface PlayableParty {
  token: string;
  userId: string;
  adventureId: string;
  mapId: string;
  partyId: string;
  heroId: string;
  roomId: string;
}

/** One account + adventure (with a switch/variable registry) + a map carrying `events` at the
 *  spawn + a party + one hero, end-to-end over HTTP. */
async function newPlayableParty(
  prefix: string,
  events: readonly MapEvent[],
  heroClass: "warrior" | "peasant" = "warrior",
): Promise<PlayableParty> {
  const { token, userId } = await registerAndLogin(prefix);
  const api = authed(token);
  const adventureResponse = await api("/api/adventures", {
    method: "POST",
    body: JSON.stringify({
      title: "Donjon",
      maxPlayers: 4,
      registry: {
        switches: [
          { id: "0001", name: "S1" },
          { id: "0002", name: "S2" },
        ],
        variables: [{ id: "0001", name: "V1" }],
      },
    }),
  });
  expect(adventureResponse.status).toBe(201);
  const adventure = (await adventureResponse.json()) as { id: string; defaultMap: { id: string } };
  const mapId = adventure.defaultMap.id;
  const putResponse = await api(`/api/maps/${mapId}`, {
    method: "PUT",
    body: JSON.stringify({
      name: "Salle",
      ...grassTerrain(),
      elements: [],
      events,
      spawn: { col: 1, row: 1 },
    }),
  });
  expect(putResponse.status).toBe(200);
  const partyResponse = await api("/api/parties", {
    method: "POST",
    body: JSON.stringify({ adventureId: adventure.id }),
  });
  expect(partyResponse.status).toBe(201);
  const partyId = ((await partyResponse.json()) as { id: string }).id;
  const heroResponse = await api(`/api/parties/${partyId}/heroes`, {
    method: "POST",
    body: JSON.stringify({ name: "Mira", class: heroClass }),
  });
  expect(heroResponse.status).toBe(201);
  const heroId = ((await heroResponse.json()) as { id: string }).id;
  return {
    token,
    userId,
    adventureId: adventure.id,
    mapId,
    partyId,
    heroId,
    roomId: `${partyId}:${mapId}`,
  };
}

/** A second account joining the party with its own hero. */
async function joinPartyWithHero(
  prefix: string,
  partyId: string,
  heroClass: "ranger" | "peasant" = "ranger",
): Promise<{ token: string; userId: string; heroId: string }> {
  const { token, userId } = await registerAndLogin(prefix);
  const api = authed(token);
  const joinResponse = await api(`/api/parties/${partyId}/join`, { method: "POST" });
  expect(joinResponse.status).toBe(204);
  const heroResponse = await api(`/api/parties/${partyId}/heroes`, {
    method: "POST",
    body: JSON.stringify({ name: "Liin", class: heroClass }),
  });
  expect(heroResponse.status).toBe(201);
  return { token, userId, heroId: ((await heroResponse.json()) as { id: string }).id };
}

// -------------------------------------------------------------------------------------------------
// FakeClock engine harness
// -------------------------------------------------------------------------------------------------

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
  // Route the coordinator's pushes into the bare engines under test (see the module docblock).
  partyRoom.pushToRoom = async (roomKey, state, version) => {
    await engines.get(roomKey)?.call("installAdventureState", [state, version]);
  };
  partyRoom.sendToRoom = async (roomKey, message) => {
    engines.get(roomKey)?.broadcast(message);
  };
  partyRoom.pushPersonalToRoom = async (roomKey, heroId, progress) => {
    await engines.get(roomKey)?.call("installPersonalQuestProgress", [heroId, progress]);
  };
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

function placeHarvester(state: WorldRoomState, heroId: string, event: MapEvent): PlayerRuntime {
  const player = playerOf(state, heroId);
  const previous = { x: player.x, y: player.y };
  const target = eventCellCentre(event);
  player.x = target.x - PLAYER_SIZE / 2 - 32;
  player.y = target.y - PLAYER_SIZE / 2;
  player.facing = { x: 1, y: 0 };
  player.level = 10;
  state.playerGrid.update(player, previous);
  return player;
}

async function completeHarvestAction(input: {
  engine: RoomEngine<never, never, WorldRoomState>;
  socket: FakeSocket;
  state: WorldRoomState;
  clock: FakeClock;
  event: MapEvent;
  slot: 1 | 2 | 3;
}): Promise<void> {
  const { engine, socket, state, clock, event, slot } = input;
  const before = state.adventureState.state.harvestNodes?.[event.id]?.hits ?? 0;
  placeHarvester(state, socket.query.hero ?? "", event);
  // Clear the preceding recovery/cooldown through elapsed authoritative time, never by mutating it.
  await advanceElapsedSettled(clock, 2_000);
  await engine.message(socket.id, { t: "skill", slot });
  // All three tool anticipations are <= 360ms. The following tick starts the server-owned job.
  await advanceElapsedSettled(clock, 400);
  // Integration profiles use an immediate channel except the dedicated disconnect case below;
  // depending on tick order the zero-duration job may already be committed here.
  await advanceTickSettled(clock);
  await vi.waitFor(() => {
    expect(state.adventureState.state.harvestNodes?.[event.id]?.hits).toBeGreaterThan(before);
  });
}

async function completeWarPigCarcassHit(input: {
  engine: RoomEngine<never, never, WorldRoomState>;
  socket: FakeSocket;
  state: WorldRoomState;
  clock: FakeClock;
  event: MapEvent;
}): Promise<void> {
  const { engine, socket, state, clock, event } = input;
  const runtimeId = `mon-${event.id}`;
  const monster = state.monsters.find((candidate) => candidate.id === runtimeId);
  if (!monster || monster.hp > 0 || monster.deadUntil <= clock.now()) {
    throw new Error(`war pig ${runtimeId} is not an active carcass`);
  }
  const player = playerOf(state, socket.query.hero ?? "");
  const previous = { x: player.x, y: player.y };
  player.x = monster.x - 32;
  player.y = monster.y;
  player.facing = { x: 1, y: 0 };
  player.level = 10;
  state.playerGrid.update(player, previous);
  const before = state.adventureState.state.harvestNodes?.[event.id];

  await advanceElapsedSettled(clock, 400);
  await engine.message(socket.id, { t: "skill", slot: 3 });
  await advanceElapsedSettled(clock, 300);
  const job = state.harvestJobs.get(player.id);
  expect(job).toMatchObject({ committing: false });
  expect(job?.targets[0]).toMatchObject({
    targetKind: "animal_carcass",
    targetRuntimeId: runtimeId,
    nodeId: event.id,
  });
  await advanceElapsedSettled(clock, 700);
  await vi.waitFor(() => {
    const after = state.adventureState.state.harvestNodes?.[event.id];
    expect(
      after !== undefined &&
        (before === undefined ||
          after.generation > before.generation ||
          (after.generation === before.generation && after.hits > before.hits)),
    ).toBe(true);
  });
}

function messagesOf(socket: FakeSocket): ServerMessage[] {
  return socket.sent.map((raw) => JSON.parse(raw) as ServerMessage);
}

async function heldPartyState(partyId: string): Promise<PartyAdventureState> {
  const held = (await partyRoom.room.call(partyId, "getAdventureState")) as {
    state: PartyAdventureState;
  };
  return held.state;
}

// -------------------------------------------------------------------------------------------------
// The proofs
// -------------------------------------------------------------------------------------------------

describe("world room events (FakeClock)", () => {
  test("a harvestable resource is active scenery but never NPC movement", async () => {
    const resource = harvestableEvent(crypto.randomUUID(), 5, 5);
    const fixture = await newPlayableParty("harvestproj", [resource]);
    const clock = new FakeClock();
    const engine = createEngine(fixture.roomId, clock);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "c-1");
    await engine.join(socket);
    const state = roomState(engine);

    expect(state.activeEvents.find((event) => event.id === resource.id)).toMatchObject({
      col: 5,
      row: 5,
      graphicAssetId: PAGE2_GRAPHIC,
      harvest: { state: "intact", generation: 0, hits: 0, respawnAt: null },
    });
    expect(state.npcMovement.has(resource.id)).toBe(false);

    const stable = state.activeEvents.find((event) => event.id === resource.id);
    refreshHarvestEventVisuals(state, clock.now());
    expect(state.activeEvents.find((event) => event.id === resource.id)).toBe(stable);

    state.adventureState = {
      version: 1,
      state: {
        ...state.adventureState.state,
        harvestNodes: {
          [resource.id]: {
            eventId: resource.id,
            generation: 0,
            hits: HARVEST_PROFILE.hitsRequired,
            lastHitAt: clock.now(),
            depleted: true,
            depletedAt: clock.now(),
            respawnAt: null,
          },
        },
      },
    };
    refreshHarvestEventVisuals(state, clock.now());
    const depleted = state.activeEvents.find((event) => event.id === resource.id);
    expect(depleted).toMatchObject({
      graphicAssetId: HARVEST_PROFILE.exhaustedAssetId,
      harvest: { state: "depleted", hits: HARVEST_PROFILE.hitsRequired },
    });
    refreshHarvestEventVisuals(state, clock.now());
    expect(state.activeEvents.find((event) => event.id === resource.id)).toBe(depleted);
    engine.dispose();
  });

  test("two Peasants gather an authored resource map without duplicate rewards and reconnect to durable exhaustion", async () => {
    const tree = harvestPresetEvent(crypto.randomUUID(), 3, 2, "tree", {
      yieldAmount: 13,
      hitsRequired: 1,
      harvestDurationMs: 0,
    });
    const stone = harvestPresetEvent(crypto.randomUUID(), 5, 2, "stone_outcrop", {
      yieldAmount: 3,
      hitsRequired: 1,
      harvestDurationMs: 0,
    });
    const iron = harvestPresetEvent(crypto.randomUUID(), 7, 2, "iron_outcrop", {
      yieldAmount: 4,
      hitsRequired: 1,
      harvestDurationMs: 0,
    });
    const smallGold = harvestPresetEvent(crypto.randomUUID(), 9, 2, "gold_small", {
      goldValue: 7,
      hitsRequired: 1,
      harvestDurationMs: 0,
    });
    const largeGold = harvestPresetEvent(crypto.randomUUID(), 11, 2, "gold_large", {
      goldValue: 31,
      hitsRequired: 1,
      harvestDurationMs: 0,
    });
    const sheep = harvestPresetEvent(crypto.randomUUID(), 13, 2, "sheep", {
      yieldAmount: 5,
      hitsRequired: 1,
      harvestDurationMs: 0,
      respawnDelayMs: 1_000,
    });
    const resources = [tree, stone, iron, smallGold, largeGold, sheep];
    const fixture = await newPlayableParty("harvestmap", resources, "peasant");
    const ally = await joinPartyWithHero("harvestmapally", fixture.partyId, "peasant");
    const clock = new FakeClock();
    vi.spyOn(Date, "now").mockImplementation(() => clock.now());
    const engine = createEngine(fixture.roomId, clock);
    const hostSocket = fakeSocket(fixture.userId, fixture.heroId, "c-harvest-host");
    const allySocket = fakeSocket(ally.userId, ally.heroId, "c-harvest-ally");
    await engine.join(hostSocket);
    await engine.join(allySocket);
    const state = roomState(engine);
    placeHarvester(state, fixture.heroId, tree);
    placeHarvester(state, ally.heroId, tree);

    // Both actions resolve on the same authoritative beat. PartyRoom's reservation is the only
    // winner fence, so this proves the real WorldRoom path cannot double-credit the custom yield.
    await advanceElapsedSettled(clock, 2_000);
    await engine.message(hostSocket.id, { t: "skill", slot: 1 });
    await engine.message(allySocket.id, { t: "skill", slot: 1 });
    await advanceElapsedSettled(clock, 400);
    await advanceTickSettled(clock);
    await vi.waitFor(async () => {
      expect((await heldPartyState(fixture.partyId)).materials?.wood ?? 0).toBe(13);
    });
    expect(state.adventureState.state.harvestNodes?.[tree.id]).toMatchObject({
      hits: 1,
      depleted: true,
    });
    expect(state.activeEvents.find((event) => event.id === tree.id)).toMatchObject({
      graphicAssetId: tree.harvestProfile?.exhaustedAssetId,
      harvest: { state: "depleted" },
    });

    await completeHarvestAction({
      engine,
      socket: hostSocket,
      state,
      clock,
      event: stone,
      slot: 2,
    });
    await completeHarvestAction({
      engine,
      socket: hostSocket,
      state,
      clock,
      event: iron,
      slot: 2,
    });
    await completeHarvestAction({
      engine,
      socket: hostSocket,
      state,
      clock,
      event: smallGold,
      slot: 2,
    });
    await completeHarvestAction({
      engine,
      socket: hostSocket,
      state,
      clock,
      event: largeGold,
      slot: 2,
    });
    await completeHarvestAction({
      engine,
      socket: hostSocket,
      state,
      clock,
      event: sheep,
      slot: 3,
    });

    await vi.waitFor(async () => {
      const held = await heldPartyState(fixture.partyId);
      expect(held.materials).toEqual({ wood: 13, stone: 3, iron: 4, meat: 5 });
      expect((await probe.heroes.findById(fixture.heroId))?.gold).toBe(38);
    });
    // Gold went through the existing hero economy; PartyAdventureState has no parallel gold key.
    expect((await heldPartyState(fixture.partyId)).materials).not.toHaveProperty("gold");

    const sheepNode = state.adventureState.state.harvestNodes?.[sheep.id];
    const sheepDepletedAt = sheepNode?.depletedAt;
    const sheepRespawnAt = sheepNode?.respawnAt;
    expect(sheepDepletedAt).toBeTypeOf("number");
    if (sheepRespawnAt === null || sheepRespawnAt === undefined) {
      throw new Error("timed sheep did not receive a respawn deadline");
    }
    await advanceElapsedSettled(clock, Math.max(0, sheepRespawnAt - clock.now() - 1));
    expect(state.activeEvents.find((event) => event.id === sheep.id)?.harvest).toMatchObject({
      state: "depleted",
      generation: 0,
    });
    await advanceElapsedSettled(clock, sheepRespawnAt - clock.now());
    expect(state.activeEvents.find((event) => event.id === sheep.id)).toMatchObject({
      graphicAssetId: sheep.pages[0]?.graphicAssetId,
      harvest: { state: "intact", generation: 1, hits: 0 },
    });
    expect(state.activeEvents.find((event) => event.id === tree.id)?.harvest).toMatchObject({
      state: "depleted",
      generation: 0,
    });

    await engine.leave(hostSocket.id);
    await engine.leave(allySocket.id);
    engine.dispose();
    const reconnectEngine = createEngine(fixture.roomId, new FakeClock());
    const reconnectSocket = fakeSocket(fixture.userId, fixture.heroId, "c-harvest-reconnect");
    await reconnectEngine.join(reconnectSocket);
    const reconnectState = roomState(reconnectEngine);
    expect(reconnectState.activeEvents.find((event) => event.id === tree.id)).toMatchObject({
      graphicAssetId: tree.harvestProfile?.exhaustedAssetId,
      harvest: { state: "depleted", generation: 0 },
    });
    expect(reconnectState.adventureState.state.materials).toEqual({
      wood: 13,
      stone: 3,
      iron: 4,
      meat: 5,
    });
    expect(playerOf(reconnectState, fixture.heroId).inventory.gold).toBe(38);
    reconnectEngine.dispose();
  });

  test("disconnecting during a real harvest channel leaves the node and reward untouched", async () => {
    const tree = harvestPresetEvent(crypto.randomUUID(), 3, 2, "tree", {
      yieldAmount: 99,
      hitsRequired: 1,
      harvestDurationMs: 750,
    });
    const fixture = await newPlayableParty("harvestchannel", [tree], "peasant");
    const clock = new FakeClock();
    vi.spyOn(Date, "now").mockImplementation(() => clock.now());
    const engine = createEngine(fixture.roomId, clock);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "c-harvest-channel");
    await engine.join(socket);
    const state = roomState(engine);
    placeHarvester(state, fixture.heroId, tree);
    await advanceElapsedSettled(clock, 2_000);
    await engine.message(socket.id, { t: "skill", slot: 1 });
    await advanceElapsedSettled(clock, 300);
    const job = state.harvestJobs.get(fixture.heroId);
    expect(job).toMatchObject({ committing: false });
    expect(job?.targets[0]).toMatchObject({
      targetRuntimeId: tree.id,
      nodeId: tree.id,
    });

    await engine.leave(socket.id);
    expect(state.harvestJobs.has(fixture.heroId)).toBe(false);
    await advanceElapsedSettled(clock, 1_000);
    const held = await heldPartyState(fixture.partyId);
    expect(held.materials?.wood ?? 0).toBe(0);
    expect(held.harvestNodes?.[tree.id]).toBeUndefined();
    engine.dispose();
  });

  test("authored war-pig carcasses keep UUID node identity across permanent reconnect and timed generations", async () => {
    const permanent = warPigEvent(crypto.randomUUID(), 4, 4, "never", 1_000);
    const timed = warPigEvent(crypto.randomUUID(), 8, 4, "timed", 10_000);
    const fixture = await newPlayableParty("harvestanimals", [permanent, timed], "peasant");
    const clock = new FakeClock();
    vi.spyOn(Date, "now").mockImplementation(() => clock.now());
    const engine = createEngine(fixture.roomId, clock);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "c-harvest-animals");
    await engine.join(socket);
    const state = roomState(engine);

    // This is the same coordinator mutation the authoritative death path emits. Its push keeps
    // the current animal as a corpse until that explicit UUID-keyed node is actually depleted.
    await partyRoom.room.call(fixture.partyId, "markPermanentMonsterDefeated", permanent.id);
    await vi.waitFor(() => {
      expect(state.monsters.find((monster) => monster.id === `mon-${permanent.id}`)).toMatchObject({
        hp: 0,
        deadUntil: Number.POSITIVE_INFINITY,
      });
    });
    await completeWarPigCarcassHit({ engine, socket, state, clock, event: permanent });
    await completeWarPigCarcassHit({ engine, socket, state, clock, event: permanent });
    expect(state.adventureState.state.harvestNodes?.[permanent.id]).toMatchObject({
      eventId: permanent.id,
      generation: 0,
      hits: 2,
      depleted: true,
    });
    expect(
      Object.keys(state.adventureState.state.harvestNodes ?? {}).some((id) =>
        id.startsWith("carcass:"),
      ),
    ).toBe(false);
    expect(state.monsters.some((monster) => monster.id === `mon-${permanent.id}`)).toBe(false);

    const timedMonster = state.monsters.find((monster) => monster.id === `mon-${timed.id}`);
    if (!timedMonster) throw new Error("timed war pig is missing");
    timedMonster.hp = 0;
    timedMonster.deadUntil = clock.now() + 10_000;
    timedMonster.action = null;
    await completeWarPigCarcassHit({ engine, socket, state, clock, event: timed });
    await completeWarPigCarcassHit({ engine, socket, state, clock, event: timed });
    const exhaustedGeneration = state.adventureState.state.harvestNodes?.[timed.id];
    expect(exhaustedGeneration).toMatchObject({
      eventId: timed.id,
      generation: 0,
      hits: 2,
      depleted: true,
    });
    if (exhaustedGeneration?.respawnAt === null || exhaustedGeneration?.respawnAt === undefined) {
      throw new Error("timed carcass did not receive a respawn deadline");
    }
    await advanceElapsedSettled(clock, Math.max(0, exhaustedGeneration.respawnAt - clock.now()));
    const respawnedTimed = state.monsters.find((monster) => monster.id === `mon-${timed.id}`);
    if (!respawnedTimed) throw new Error("timed war pig disappeared at respawn");
    expect(respawnedTimed.hp).toBe(respawnedTimed.maxHp);

    // A second authoritative death after both timers have elapsed reads generation 1 from the
    // same authored UUID; it never invents an asset-derived or runtime-prefixed node id.
    respawnedTimed.hp = 0;
    respawnedTimed.deadUntil = clock.now() + 10_000;
    await completeWarPigCarcassHit({ engine, socket, state, clock, event: timed });
    expect(state.adventureState.state.harvestNodes?.[timed.id]).toMatchObject({
      eventId: timed.id,
      generation: 1,
      hits: 1,
      depleted: false,
    });

    await engine.leave(socket.id);
    engine.dispose();
    const reconnectEngine = createEngine(fixture.roomId, new FakeClock());
    const reconnectSocket = fakeSocket(
      fixture.userId,
      fixture.heroId,
      "c-harvest-animals-reconnect",
    );
    await reconnectEngine.join(reconnectSocket);
    const reconnectState = roomState(reconnectEngine);
    expect(reconnectState.monsters.some((monster) => monster.id === `mon-${permanent.id}`)).toBe(
      false,
    );
    expect(reconnectState.adventureState.state.harvestNodes?.[permanent.id]).toMatchObject({
      generation: 0,
      depleted: true,
    });
    reconnectEngine.dispose();
  });

  test("a legacy map without harvest profiles still admits normally with empty harvest state", async () => {
    const fixture = await newPlayableParty("harvestlegacy", [], "peasant");
    const engine = createEngine(fixture.roomId, new FakeClock());
    const socket = fakeSocket(fixture.userId, fixture.heroId, "c-harvest-legacy");
    await engine.join(socket);
    const state = roomState(engine);
    expect(state.activeEvents).toEqual([]);
    expect(state.adventureState.state.harvestNodes).toEqual({});
    expect(state.adventureState.state.materials).toEqual({
      wood: 0,
      stone: 0,
      iron: 0,
      meat: 0,
    });
    expect(messagesOf(socket).some((message) => message.t === "welcome")).toBe(true);
    engine.dispose();
  });

  test("an authored guard speaks from its current patrol position", async () => {
    const guard = guardDialogueEvent(crypto.randomUUID(), 5, 5);
    const fixture = await newPlayableParty("guardtalk", [guard]);
    const clock = new FakeClock();
    const engine = createEngine(fixture.roomId, clock);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "c-1");
    await engine.join(socket);
    const state = roomState(engine);
    const runtimeGuard = state.guards.find((candidate) => candidate.id === `guard-${guard.id}`);
    if (!runtimeGuard) throw new Error("authored guard runtime missing");

    // The guard has patrolled two cells away from its authored cell. Interaction must follow the
    // moving authoritative entity instead of opening dialogue at the stale map coordinate.
    runtimeGuard.x += 2 * TILE_SIZE;
    const player = playerOf(state, fixture.heroId);
    player.x = runtimeGuard.x - 40;
    player.y = runtimeGuard.y;

    await engine.message(socket.id, { t: "interact" });
    await advanceTickSettled(clock);

    expect(messagesOf(socket).find((message) => message.t === "event.say")).toMatchObject({
      text: "La route est sûre.",
      name: "Garde",
    });
    engine.dispose();
  });

  test("two heroes triggering one gold chest the same tick yield exactly ONE grant", async () => {
    const eventId = crypto.randomUUID();
    const chest = scriptEvent(eventId, 1, 1, "action", [
      { t: "changeGold", amount: 25 },
      { t: "setSelfSwitch", selfSwitch: "A", value: true },
    ]);
    const host = await newPlayableParty("runlock", [chest]);
    const guest = await joinPartyWithHero("runlockguest", host.partyId);
    const clock = new FakeClock();
    const engine = createEngine(host.roomId, clock);
    const s1 = fakeSocket(host.userId, host.heroId, "c-1");
    const s2 = fakeSocket(guest.userId, guest.heroId, "c-2");
    await engine.join(s1);
    await engine.join(s2);
    const state = roomState(engine);
    const p1 = playerOf(state, host.heroId);
    const p2 = playerOf(state, guest.heroId);
    // Both bodies beside the chest cell, inside INTERACTION_RANGE.
    const centre = eventCellCentre(chest);
    p1.x = centre.x - 40;
    p1.y = centre.y;
    p2.x = centre.x + 20;
    p2.y = centre.y;
    const gold1 = p1.inventory.gold;
    const gold2 = p2.inventory.gold;

    // Same tick: both interacts land before the next drain. The first takes the event's run lock;
    // the second is dropped SILENTLY (never an error the player sees).
    await engine.message(s1.id, { t: "interact" });
    await engine.message(s2.id, { t: "interact" });
    expect(state.eventRuns.contexts.size).toBe(1);

    await advanceTickSettled(clock);

    expect(p1.inventory.gold).toBe(gold1 + 25);
    expect(p2.inventory.gold).toBe(gold2);
    // No second run appeared once the first finished within the drain.
    expect(state.eventRuns.contexts.size).toBe(0);
    engine.dispose();
  });

  test("an authored infinite loop consumes at most its 16-command slice per drain; the room keeps ticking", async () => {
    const eventId = crypto.randomUUID();
    const runaway = scriptEvent(eventId, 1, 1, "action", [
      { t: "loop", body: [{ t: "setVariable", variableId: "0001", op: "add", value: 1 }] },
    ]);
    const fixture = await newPlayableParty("runaway", [runaway]);
    const clock = new FakeClock();
    const engine = createEngine(fixture.roomId, clock);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "c-1");
    await engine.join(socket);
    const state = roomState(engine);
    await engine.message(socket.id, { t: "interact" });
    expect(state.eventRuns.contexts.size).toBe(1);

    // Bounded assertion, never a hang: each settled tick returns, the tick counter advances, and
    // the variable grows by AT MOST the 16-command budget per drain while the run never exits.
    let previous = 0;
    const startTick = state.tick;
    for (let i = 0; i < 3; i += 1) {
      await advanceTickSettled(clock);
      const value = (await heldPartyState(fixture.partyId)).variables?.["0001"] ?? 0;
      expect(value).toBeGreaterThan(previous); // progress...
      expect(value - previous).toBeLessThanOrEqual(16); // ...but never past the budget
      previous = value;
    }
    expect(state.tick).toBe(startTick + 3); // the room kept ticking
    expect(state.eventRuns.contexts.size).toBe(1); // and the loop never exited
    engine.dispose();
  });

  test("walk-away beyond DIALOGUE_CLOSE_RADIUS abandons the remainder without rolling back", async () => {
    const eventId = crypto.randomUUID();
    const talker = scriptEvent(eventId, 1, 1, "action", [
      { t: "setSwitch", switchId: "0001", value: true },
      { t: "say", text: "Bienvenue, voyageuse.", name: "Mira" },
      { t: "setSwitch", switchId: "0002", value: true },
    ]);
    const fixture = await newPlayableParty("walkaway", [talker]);
    const clock = new FakeClock();
    const engine = createEngine(fixture.roomId, clock);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "c-1");
    await engine.join(socket);
    const state = roomState(engine);
    await engine.message(socket.id, { t: "interact" });
    await advanceTickSettled(clock);

    // The panel opened for the triggerer with the authored prose (the sanctioned data exception).
    const say = messagesOf(socket).find((message) => message.t === "event.say");
    expect(say).toMatchObject({ text: "Bienvenue, voyageuse.", name: "Mira" });
    expect((await heldPartyState(fixture.partyId)).switches?.["0001"]).toBe(true);

    // Walk beyond the close radius; the next drain ends the conversation (WoW's rule).
    const player = playerOf(state, fixture.heroId);
    player.x += DIALOGUE_CLOSE_RADIUS + 64;
    await advanceTickSettled(clock);

    expect(messagesOf(socket).some((message) => message.t === "event.close")).toBe(true);
    expect(state.eventRuns.contexts.size).toBe(0);
    const held = await heldPartyState(fixture.partyId);
    expect(held.switches?.["0001"]).toBe(true); // already-applied write NOT rolled back
    expect(held.switches?.["0002"]).toBeUndefined(); // the remainder was abandoned
    engine.dispose();
  });

  test("a run reads its own same-tick write through the drain-local working copy", async () => {
    const eventId = crypto.randomUUID();
    const counter = scriptEvent(eventId, 1, 1, "action", [
      { t: "setVariable", variableId: "0001", op: "add", value: 1 },
      {
        t: "if",
        cond: { type: "variable", variableId: "0001", min: 1 },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the conditional's branch field, not a thenable.
        then: [{ t: "say", text: "OUI", name: null }],
        else: [{ t: "say", text: "NON", name: null }],
      },
    ]);
    const fixture = await newPlayableParty("workingcopy", [counter]);
    const clock = new FakeClock();
    const engine = createEngine(fixture.roomId, clock);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "c-1");
    await engine.join(socket);
    await engine.message(socket.id, { t: "interact" });
    await advanceTickSettled(clock);

    // The `if` evaluated against the JUST-written variable (snapshot still held 0 at drain start).
    const say = messagesOf(socket).find((message) => message.t === "event.say");
    expect(say).toMatchObject({ text: "OUI" });
    engine.dispose();
  });

  test("out-of-order double install keeps the newer version; garbage never throws", async () => {
    const fixture = await newPlayableParty("install", [gateEvent(crypto.randomUUID(), 4, 4)]);
    const clock = new FakeClock();
    const engine = createEngine(fixture.roomId, clock);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "c-1");
    await engine.join(socket);
    const state = roomState(engine);

    const newer: PartyAdventureState = { ...EMPTY_ADVENTURE_STATE, switches: { "0001": true } };
    const older: PartyAdventureState = { ...EMPTY_ADVENTURE_STATE, switches: {} };
    await engine.call("installAdventureState", [newer, 5]);
    expect(state.adventureState.version).toBe(5);
    // Page 2 (cond switch 0001) took over on install — re-evaluated exactly then, never per tick.
    expect(state.activeEvents[0]?.graphicAssetId).toBe(PAGE2_GRAPHIC);

    await engine.call("installAdventureState", [older, 3]);
    expect(state.adventureState.version).toBe(5); // the older push was dropped
    expect(state.adventureState.state.switches?.["0001"]).toBe(true);
    expect(state.activeEvents[0]?.graphicAssetId).toBe(PAGE2_GRAPHIC);

    // Never throws — PartyRoom awaits the push ahead of room admission.
    await expect(engine.call("installAdventureState", [null, Number.NaN])).resolves.toBeUndefined();
    await expect(
      engine.call("installAdventureState", ["garbage", "worse" as unknown as number]),
    ).resolves.toBeUndefined();
    expect(state.adventureState.version).toBe(5);
    engine.dispose();
  });

  // Split in two (was one test flipping `process.env.CHEATS_ENABLED` mid-test): `WorldRoom.env`
  // now resolves `CHEATS_ENABLED` through `$env` once at construction, so a value change after
  // the app has booted no longer has any effect — see `bootAppWithCheats`'s docblock above.
  test("/tp is refused when CHEATS_ENABLED is not set", async () => {
    // `beforeEach` boots with `CHEATS_ENABLED` unset, matching the schema's `false` default.
    const fixture = await newPlayableParty("cheattpoff", []);
    const clock = new FakeClock();
    const engine = createEngine(fixture.roomId, clock);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "c-1");
    await engine.join(socket);
    const state = roomState(engine);
    const player = playerOf(state, fixture.heroId);
    const before = { x: player.x, y: player.y };

    await engine.message(socket.id, { t: "chat", text: "/tp 5 3" });
    expect(player.x).toBe(before.x);
    expect(player.y).toBe(before.y);
    expect(
      messagesOf(socket).some(
        (message) => message.t === "event" && message.code === "cheat.disabled",
      ),
    ).toBe(true);
    engine.dispose();
  });

  test("/tp moves the hero server-side once CHEATS_ENABLED is set", async () => {
    await bootAppWithCheats();
    const fixture = await newPlayableParty("cheattpon", []);
    const clock = new FakeClock();
    const engine = createEngine(fixture.roomId, clock);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "c-1");
    await engine.join(socket);
    const state = roomState(engine);
    const player = playerOf(state, fixture.heroId);

    await engine.message(socket.id, { t: "chat", text: "/tp 5 3" });
    const destination = eventCellCentre({ col: 5, row: 3 });
    expect(player.x).toBe(destination.x);
    expect(player.y).toBe(destination.y);
    expect(
      messagesOf(socket).some((message) => message.t === "event" && message.code === "cheat.tp"),
    ).toBe(true);
    engine.dispose();
  });

  test("an event grant of gold+items lands in D1 through the fenced save; a stale epoch doesn't", async () => {
    const eventId = crypto.randomUUID();
    const chest = scriptEvent(eventId, 1, 1, "action", [
      { t: "changeGold", amount: 25 },
      { t: "changeItems", itemId: "health_potion", count: 2 },
    ]);
    const fixture = await newPlayableParty("grantsave", [chest]);
    const clock = new FakeClock();
    const engine = createEngine(fixture.roomId, clock);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "c-1");
    await engine.join(socket);
    const state = roomState(engine);
    const player = playerOf(state, fixture.heroId);
    const goldBefore = player.inventory.gold;
    const potionsBefore = player.inventory.potions;

    await engine.message(socket.id, { t: "interact" });
    await advanceTickSettled(clock);
    expect(player.inventory.gold).toBe(goldBefore + 25);
    expect(player.inventory.potions).toBe(potionsBefore + 2);

    clock.advanceTicks(D1_SAVE_EVERY_TICKS);
    await vi.waitFor(async () => {
      const row = await probe.heroes.findById(fixture.heroId);
      expect(row?.gold).toBe(goldBefore + 25);
      const item = await probe.heroItems.findOne({
        where: { heroId: { eq: fixture.heroId }, itemDefinitionId: { eq: "health_potion" } },
      });
      expect(item?.quantity).toBe(potionsBefore + 2);
    });

    // A competing acquire bumps the epoch out from under the room; the next save is stale and
    // must change ZERO rows (the fence), closing the socket 4003.
    await presenceRoom.room.call(fixture.heroId, "acquire", {
      connectionId: "c-elsewhere",
      roomKey: state.roomKey,
      zoneId: state.mapId,
      instanceId: "main",
    });
    const beforeRow = await probe.heroes.findById(fixture.heroId);
    player.inventory.gold += 999;
    player.dirty = true;
    clock.advanceTicks(D1_SAVE_EVERY_TICKS);
    await vi.waitFor(() => {
      expect(socket.closed?.code).toBe(WS_CLOSE.PRESENCE_LOST);
    });
    expect(await probe.heroes.findById(fixture.heroId)).toEqual(beforeRow);
    engine.dispose();
  });

  test("an authored endAdventure completes the party save once and broadcasts victory", async () => {
    const shrine = scriptEvent(crypto.randomUUID(), 1, 1, "action", [{ t: "endAdventure" }]);
    const fixture = await newPlayableParty("endadv", [shrine]);
    const clock = new FakeClock();
    const engine = createEngine(fixture.roomId, clock);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "c-1");
    await engine.join(socket);

    await engine.message(socket.id, { t: "interact" });
    await advanceTickSettled(clock);

    await vi.waitFor(async () => {
      const row = await probe.parties.findById(fixture.partyId);
      expect(row?.status).toBe("completed");
    });
    expect(
      messagesOf(socket).some(
        (message) => message.t === "event" && message.code === "adventure.victory",
      ),
    ).toBe(true);
    engine.dispose();
  });

  test("drinking a potion runs the fenced save-then-decrement chain against D1", async () => {
    const chest = scriptEvent(crypto.randomUUID(), 1, 1, "action", [
      { t: "changeItems", itemId: "health_potion", count: 2 },
    ]);
    const fixture = await newPlayableParty("potion", [chest]);
    const clock = new FakeClock();
    const engine = createEngine(fixture.roomId, clock);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "c-1");
    await engine.join(socket);
    const state = roomState(engine);
    const player = playerOf(state, fixture.heroId);
    const potionsBefore = player.inventory.potions;

    await engine.message(socket.id, { t: "interact" });
    await advanceTickSettled(clock);
    expect(player.inventory.potions).toBe(potionsBefore + 2);

    player.hp = 1; // something to heal, else `use` refuses
    await engine.message(socket.id, { t: "use", item: "potion" });
    expect(player.inventory.potions).toBe(potionsBefore + 1);
    expect(player.hp).toBeGreaterThan(1);
    // The decrement is a direct fenced D1 statement (after a forced save), not the periodic beat.
    const item = await probe.heroItems.findOne({
      where: { heroId: { eq: fixture.heroId }, itemDefinitionId: { eq: "health_potion" } },
    });
    expect(item?.quantity).toBe(potionsBefore + 1);
    engine.dispose();
  });

  test("the built-in quest-chapter reward claim is idempotent and epoch-fenced", async () => {
    const fixture = await newPlayableParty("chapterclaim", []);
    const worldRoom = alepha.inject(WorldRoom);
    const heroRow = await probe.heroes.findById(fixture.heroId);
    if (!heroRow) throw new Error("hero row missing");
    // Hero creation already seeded the chapter row; flip it to the claimable state.
    const questRow = await probe.heroQuests.findOne({
      where: { heroId: { eq: fixture.heroId }, questId: { eq: "three_offerings" } },
    });
    if (!questRow) throw new Error("seeded quest row missing");
    await probe.heroQuests.updateById(questRow.id, { status: "ready", progress: 3 });
    const claim = {
      heroId: fixture.heroId,
      sessionEpoch: heroRow.sessionEpoch,
      questId: "three_offerings",
      rewardGold: 10,
      rewardPotions: 1,
      resultingLevel: 2,
      resultingXp: 5,
      resultingHp: 120,
    };
    await expect(worldRoom.heroSaveService.claimQuestReward(claim)).resolves.toBe(true);
    const afterFirst = await probe.heroes.findById(fixture.heroId);
    expect(afterFirst?.gold).toBe(heroRow.gold + 10);
    expect(afterFirst?.level).toBe(2);
    const item = await probe.heroItems.findOne({
      where: { heroId: { eq: fixture.heroId }, itemDefinitionId: { eq: "health_potion" } },
    });
    expect(item?.quantity ?? 0).toBeGreaterThanOrEqual(1);

    // Replay: the claim id guard refuses, and nothing is granted twice.
    await expect(worldRoom.heroSaveService.claimQuestReward(claim)).resolves.toBe(false);
    expect(await probe.heroes.findById(fixture.heroId)).toEqual(afterFirst);
  });
});

// -------------------------------------------------------------------------------------------------
// The cross-room flip, end-to-end over real sockets (production pushToRoom transport)
// -------------------------------------------------------------------------------------------------

interface SocketProbe {
  socket: WebSocket;
  messages: ServerMessage[];
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
  return {
    socket,
    messages,
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

describe("cross-room adventure-state flip (real sockets)", () => {
  test("a switch flipped in room A changes room B's active page after the coordinator push", async () => {
    // Map A carries the lever; map B carries the two-page gate.
    const leverId = crypto.randomUUID();
    const gateId = crypto.randomUUID();
    const lever = scriptEvent(leverId, 1, 1, "action", [
      { t: "setSwitch", switchId: "0001", value: true },
    ]);
    const host = await newPlayableParty("flipA", [lever]);
    const guest = await joinPartyWithHero("flipB", host.partyId);
    const api = authed(host.token);

    const mapBResponse = await api("/api/maps", {
      method: "POST",
      body: JSON.stringify({ adventureId: host.adventureId, name: "Annexe" }),
    });
    expect(mapBResponse.status).toBe(201);
    const mapBId = ((await mapBResponse.json()) as { id: string }).id;
    const putB = await api(`/api/maps/${mapBId}`, {
      method: "PUT",
      body: JSON.stringify({
        name: "Annexe",
        ...grassTerrain(),
        elements: [],
        events: [gateEvent(gateId, 4, 4)],
        spawn: { col: 1, row: 1 },
      }),
    });
    expect(putB.status).toBe(200);

    // Seed the guest hero onto map B directly in D1 (map transitions are Task 8's flow).
    const spawn = eventCellCentre({ col: 1, row: 1 });
    await probe.heroes.updateById(guest.heroId, { mapId: mapBId, x: spawn.x, y: spawn.y });

    const roomA = openWorldSocket(`${host.partyId}:${host.mapId}`, host.heroId, host.token);
    const roomB = openWorldSocket(`${host.partyId}:${mapBId}`, guest.heroId, guest.token);
    const welcomeB = await roomB.waitFor((message) => message.t === "welcome", "room B welcome");
    if (welcomeB.t !== "welcome") throw new Error("unreachable");
    expect(welcomeB.world.events[0]?.graphicAssetId).toBe(PAGE1_GRAPHIC);
    await roomA.waitFor((message) => message.t === "welcome", "room A welcome");

    // Room A's hero pulls the lever; the real 20Hz tick drains the run, the write-through commits
    // and the production `pushToRoom -> this.room.call` fan-out reaches BOTH live rooms.
    roomA.socket.send(JSON.stringify({ t: "interact" }));
    await vi.waitFor(
      async () => {
        expect((await heldPartyState(host.partyId)).switches?.["0001"]).toBe(true);
      },
      { timeout: 10_000 },
    );

    // Room B re-evaluated its pages on install; a resync ships the gate's NEW active appearance.
    await vi.waitFor(
      async () => {
        roomB.socket.send(JSON.stringify({ t: "world.resync" }));
        const resync = roomB.messages.find(
          (message) =>
            message.t === "world.resync" &&
            message.events.some((event) => event.graphicAssetId === PAGE2_GRAPHIC),
        );
        expect(resync).toBeDefined();
      },
      { timeout: 10_000, interval: 1_100 },
    );
  });
});
