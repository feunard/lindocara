/**
 * Deterministic combat invariants for the Alepha world room, the tranche-β counterpart of
 * `world-room-movement.test.ts`: the REAL `WorldRoom` option bag hosted in a bare `RoomEngine`
 * (FakeClock idiom) against real D1 rows created through the ordinary HTTP flow. Timing-sensitive
 * combat assertions drive the exported `worldTick` functions directly with a controlled `now` —
 * the same shape as the legacy isolated-system suite (`test/world-systems.test.ts`) — while
 * wire-visible invariants (chat AOI, personal-loot deltas, the attack intent) go through the
 * engine's real join/message path.
 *
 * Pinned here, ported from the legacy invariant suite:
 * 1. attack consumes its cooldown even on a miss;
 * 2. a monster's strike direction freezes at wind-up and damages only actors inside the capsule
 *    at the active frame;
 * 3. a guard kill grants NO player XP/loot and sets the respawn state directly;
 * 4. monsters skip players who are not `alive` (the corpse run stays winnable);
 * 5. personal loot is omitted from another player's delta (AOI + ownerId);
 * 6. local chat reaches only in-AOI players; oversized chat is dropped;
 * 7. one tick advances players before monsters before guards (composed-state probe, no mocks).
 *
 * Everything here runs in TILE units, grid centre as origin: `x` and `z` are the two GROUND axes
 * and `y` is elevation. Every length below is the exact quotient of its former pixel value by
 * `TILE_SIZE`, written as the division rather than as a decimal so a fixture stays readable against
 * the balance table it was tuned from. Each fixture map stores a flat `provingHeightfield`, without
 * which no zone can be built at all and every join is refused 4007.
 */

import {
  MAX_PROJECTILES_PER_PLAYER,
  MONSTER_ACTIONS,
  MONSTER_SPECIAL_ACTIONS,
} from "@lindocara/engine/combat-actions.js";
import {
  ATTACK_COOLDOWN_MS,
  CLASS_STATS,
  MONSTER_AGGRO_RANGE,
  MONSTER_RESPAWN_MS,
  type MonsterSpawn,
  maxHpForLevel,
  monsterBodyHitbox,
} from "@lindocara/engine/game.js";
import { groundDistance } from "@lindocara/engine/ground.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import {
  encodeServerMessage,
  parseServerMessage,
  type ServerMessage,
} from "@lindocara/engine/protocol.js";
import { TICK_DT } from "@lindocara/engine/simulation.js";
import {
  BODY_RADIUS,
  canStand,
  groundUnder,
  type ZoneTerrain,
  zoneTerrainFromHeightfield,
} from "@lindocara/engine/terrain-access.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { advanceCombatActions } from "@lindocara/server/world/combat-action-system.js";
import { projectileOrigin, spawnProjectile } from "@lindocara/server/world/projectile-system.js";
import {
  CHAT_MAX_LENGTH,
  type CombatActionRuntime,
  createGuards,
  createMonsters,
  type PlayerRuntime,
} from "@lindocara/server/world/world-runtime.js";
import { UserController } from "alepha/api/users";
import { ServerProvider } from "alepha/server";
import {
  type RoomClock,
  RoomEngine,
  type RoomSocket,
  WebSocketServerProvider,
} from "alepha/websocket";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PartyRoom } from "../src/api/realtime/PartyRoom.ts";
import { WorldRoom } from "../src/api/realtime/WorldRoom.ts";
import type { WorldRoomState } from "../src/api/realtime/worldState.ts";
import {
  advanceWorldTick,
  applyReportedMove,
  finishHeldPlayerAction,
  resolveMonsterAction,
  resolvePlayerAction,
  startMonsterAttack,
  startPlayerAction,
  type WorldGlue,
  type WorldTickDeps,
} from "../src/api/realtime/worldTick.ts";
import { MapService } from "../src/api/services/MapService.ts";
import { createTestApp, provingHeightfield } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";
const TICK_MS = 50;

/**
 * The side of every fixture map's heightfield, in cells — wider than {@link PROVING_SIZE}'s 16 on
 * purpose. Every length in this file is the exact quotient of its former pixel value by
 * `TILE_SIZE`, and the widest of them (a listener pushed 2 000 px out of local-chat range) is 31.25
 * tiles. The grid is centred on the origin, so a 64-cell side spans `-32..32` and every converted
 * fixture still lands on real ground rather than in the void off the map's edge.
 */
const GRID_SIZE = 64;

/** Half the grid, i.e. the world coordinate of its western/northern edge, negated. */
const GRID_HALF = GRID_SIZE / 2;

/** The flat, entirely walkable proving grid every fixture map in this file is stored with. */
function heightfield(): string {
  return provingHeightfield(GRID_SIZE);
}

/** The world height of one level tier on {@link heightfield}'s grid. */
const LEVEL_HEIGHT = 0.9;

/**
 * The proving grid with one raised column of cells — the heightfield's replacement for the pixel
 * fixture's `obstacles` rectangle.
 *
 * It has to be RELIEF and not a collider: `groundLineOfSight` (what a blast asks before it damages
 * anything) is interrupted by ground higher than both of its ends and deliberately ignores props,
 * exactly as the pixel version consulted `tiles` and never the collider index. `cells` names the
 * raised cells by their grid indices, so the caller reads the wall in the same space the terrain
 * query buckets it into.
 */
function terrainWithWall(cells: {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
}): ZoneTerrain {
  const levels: (number | null)[] = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const raised =
        col >= cells.minCol && col <= cells.maxCol && row >= cells.minRow && row <= cells.maxRow;
      levels.push(raised ? 1 : 0);
    }
  }
  const map: MapData = {
    version: 1,
    size: GRID_SIZE,
    levelHeight: LEVEL_HEIGHT,
    waterLevel: -0.05,
    levels,
    materials: new Array(GRID_SIZE * GRID_SIZE).fill("herbe"),
    colliders: [],
    spawns: [{ name: "default", x: 0, z: 0 }],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

/** The RoomEngine.spec FakeClock: intervals fire once per `advance` of their period. */
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
}

interface FakeSocket extends RoomSocket {
  sent: string[];
  closed?: { code?: number; reason?: string };
}

function fakeSocket(userId: string, heroId: string): FakeSocket {
  const sent: string[] = [];
  const socket: FakeSocket = {
    id: `c-${heroId}`,
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

let alepha: ReturnType<typeof createTestApp>;
let hostname: string;
let userCount = 0;

beforeEach(async () => {
  alepha = createTestApp();
  await alepha.start();
  hostname = alepha.inject(ServerProvider).hostname;
});

afterEach(async () => {
  await alepha.stop();
});

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

function authedFetch(token: string) {
  return (path: string, body?: unknown) =>
    fetch(`${hostname}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

interface Fixture {
  userId: string;
  roomId: string;
  partyId: string;
  heroId: string;
}

async function newPlayableHero(prefix: string, heroClass = "warrior"): Promise<Fixture> {
  const { token, userId } = await registerAndLogin(prefix);
  const authed = authedFetch(token);
  const adventureResponse = await authed("/api/adventures", { title: "Donjon", maxPlayers: 4 });
  expect(adventureResponse.status).toBe(201);
  const adventure = (await adventureResponse.json()) as { id: string; defaultMap: { id: string } };
  const partyResponse = await authed("/api/parties", { adventureId: adventure.id });
  expect(partyResponse.status).toBe(201);
  const partyId = ((await partyResponse.json()) as { id: string }).id;
  const heroResponse = await authed(`/api/parties/${partyId}/heroes`, {
    name: "Mira",
    class: heroClass,
  });
  expect(heroResponse.status).toBe(201);
  const heroId = ((await heroResponse.json()) as { id: string }).id;
  // A map with no heightfield produces no zone at all, so every join of this room would be refused
  // 4007 before a single combat invariant could be observed. `POST /api/adventures` seeds a tile
  // map and nothing else, so the room's collision has to be stored here.
  await alepha.inject(MapService).saveHeightfield(adventure.defaultMap.id, heightfield());
  return { userId, roomId: `${partyId}:${adventure.defaultMap.id}`, partyId, heroId };
}

/** A second account joins the host's party and creates its own hero — two heroes, one room. */
async function joinAsSecondHero(
  host: Fixture,
  prefix: string,
): Promise<{ userId: string; heroId: string }> {
  const { token, userId } = await registerAndLogin(prefix);
  const authed = authedFetch(token);
  const joinResponse = await authed(`/api/parties/${host.partyId}/join`);
  expect(joinResponse.status).toBe(204);
  const heroResponse = await authed(`/api/parties/${host.partyId}/heroes`, {
    name: "Liin",
    class: "warrior",
  });
  expect(heroResponse.status).toBe(201);
  const heroId = ((await heroResponse.json()) as { id: string }).id;
  return { userId, heroId };
}

async function seedPartyMaterials(
  partyId: string,
  heroId: string,
  reward: { wood?: number; stone?: number; iron?: number; meat?: number },
): Promise<void> {
  const partyRoom = alepha.inject(PartyRoom);
  partyRoom.now = () => Date.now();
  const eventId = crypto.randomUUID();
  const reservation = (await partyRoom.room.call(partyId, "reserveHarvestNode", {
    heroId,
    sessionEpoch: 0,
    eventId,
    generation: 0,
    requiredHits: 1,
    reward,
    respawnDelayMs: null,
  })) as { ok: boolean; reservationId?: string };
  if (!reservation.ok || !reservation.reservationId)
    throw new Error("material seed reservation rejected");
  const hit = (await partyRoom.room.call(partyId, "hitHarvestNode", {
    heroId,
    eventId,
    reservationId: reservation.reservationId,
  })) as { ok: boolean };
  if (!hit.ok) throw new Error("material seed hit rejected");
}

async function partyMaterials(partyId: string) {
  const partyRoom = alepha.inject(PartyRoom);
  const state = (await partyRoom.room.call(partyId, "getAdventureState")) as {
    state: { materials: { wood: number; stone: number; iron: number; meat: number } };
  };
  return state.state.materials;
}

/** Hosts the real WorldRoom options in a bare engine driven by the fake clock. */
function createEngine(roomId: string, clock: FakeClock) {
  const worldRoom = alepha.inject(WorldRoom);
  return new RoomEngine({
    roomId,
    clock,
    options: worldRoom.roomOptions,
    validate: () => {},
  });
}

function evictPartyCoordinator(partyId: string): void {
  const provider = alepha.inject(WebSocketServerProvider) as unknown as {
    roomEngines: Map<string, { dispose(): void }>;
    roomEngineTouched: Map<string, number>;
  };
  const key = `/ws/party:${partyId}`;
  provider.roomEngines.get(key)?.dispose();
  provider.roomEngines.delete(key);
  provider.roomEngineTouched.delete(key);
}

/** `RoomEngine.state` is protected only at compile time; the invariants below assert on the real
 *  room state (players, monsters, loot) the way the legacy workerd suite asserts on the real DO. */
function roomState(engine: object): WorldRoomState {
  return (engine as unknown as { state: WorldRoomState }).state;
}

function playerOf(state: WorldRoomState, heroId: string): PlayerRuntime {
  const connectionId = state.connectionIdByHeroId.get(heroId);
  const player = connectionId === undefined ? undefined : state.players.get(connectionId);
  if (!player) throw new Error(`hero ${heroId} is not in the room`);
  return player;
}

/**
 * A recording `WorldGlue` over the engine's real state, with a test-controlled clock — every
 * cross-boundary seam is inert, exactly the Task 6/7/8 stub shape `WorldRoom.glue()` wires.
 */
function testGlue(
  state: WorldRoomState,
  now: () => number,
): { w: WorldGlue; sent: Map<string, ServerMessage[]> } {
  const sent = new Map<string, ServerMessage[]>();
  const deps: WorldTickDeps = {
    now,
    send: (connectionId, message) => {
      const list = sent.get(connectionId);
      if (list) list.push(message);
      else sent.set(connectionId, [message]);
    },
    waitUntil: () => {},
    renewPresence: async () => {},
    savePlayer: async () => true,
    presenceHeartbeatMs: 10_000,
    navigationDebugAvailable: false,
    markPermanentMonsterDefeated: () => {},
    recordQuestEvent: () => {},
    broadcastToParty: () => {},
    applyStateChanges: async () => {},
    acceptAuthoredQuest: async () => ({ ok: false, reason: "party" }),
    abandonAuthoredQuest: async () => ({ ok: false, reason: "party" }),
    completeAuthoredQuest: async () => ({ ok: false, reason: "party" }),
    completeAdventure: async () => {},
    cheatsEnabled: false,
    transitionAdventureExit: () => {},
    teleportCrossMap: () => {},
    claimQuestReward: async () => false,
    reserveHarvestNode: async () => ({ ok: false, reason: "party" }),
    hitHarvestNode: async () => ({ ok: false, reason: "party" }),
    cancelHarvestNode: async () => false,
    consumePotion: async () => null,
  };
  return { w: { state, deps }, sent };
}

function sentTo(sent: Map<string, ServerMessage[]>, heroId: string): ServerMessage[] {
  return sent.get(`c-${heroId}`) ?? [];
}

/** `x`/`z` are the two GROUND axes; a seeded body always starts on the flat grid's level-0 ground. */
function seedMonster(
  state: WorldRoomState,
  id: string,
  x: number,
  z: number,
  overrides: Partial<Pick<MonsterSpawn, "maxHp" | "species" | "kind" | "attackProfile">> = {},
) {
  const [monster] = createMonsters([
    {
      id,
      kind: "goblin",
      species: "torch_goblin",
      zone: "route",
      x,
      y: 0,
      z,
      patrolRadius: 0,
      ...overrides,
    },
  ]);
  if (!monster) throw new Error("seed produced no monster");
  state.monsters.push(monster);
  state.monsterGrid.insert(monster);
  return monster;
}

function seedGuard(state: WorldRoomState, id: string, x: number, z: number) {
  const [guard] = createGuards([{ id, x, y: 0, z, patrolRadius: 120 / TILE_SIZE }]);
  if (!guard) throw new Error("seed produced no guard");
  state.guards.push(guard);
  return guard;
}

describe("world room combat (FakeClock)", () => {
  test("disconnect removes a Peasant harvest channel from the real room", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("harvleave", "peasant");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    const socket = fakeSocket(userId, heroId);
    await engine.join(socket);
    const state = roomState(engine);
    state.harvestJobs.set(heroId, {
      id: crypto.randomUUID(),
      heroId,
      connectionId: socket.id,
      slot: 1,
      tool: "axe",
      direction: { x: 1, z: 0 },
      areaCenter: { x: 96 / TILE_SIZE, z: 32 / TILE_SIZE },
      areaRadius: 0,
      targets: [
        {
          primary: true,
          targetKind: "map_event",
          targetRuntimeId: "11111111-1111-4111-8111-111111111111",
          nodeId: "11111111-1111-4111-8111-111111111111",
          generation: 0,
          plan: {
            resource: "wood",
            tool: "axe",
            yieldAmount: 1,
            goldValue: 0,
            primaryMaterialReward: { wood: 1 },
            bonusMaterialReward: {},
            materialReward: { wood: 1 },
            hitsRequired: 1,
            harvestDurationMs: 1_000,
            areaRadius: 0,
            maximumTargets: 1,
          },
        },
      ],
      startedAt: 1_000,
      completesAt: 2_000,
      committing: false,
    });

    await engine.leave(socket.id);

    expect(state.harvestJobs.size).toBe(0);
    expect(state.connectionIdByHeroId.has(heroId)).toBe(false);
    engine.dispose();
  });

  test("support rejection never spends materials or cooldown for stock, placement or cap", async () => {
    const host = await newPlayableHero("psupportdeny", "peasant");
    const clock = new FakeClock();
    const engine = createEngine(host.roomId, clock);
    const socket = fakeSocket(host.userId, host.heroId);
    await engine.join(socket);
    const state = roomState(engine);
    const peasant = playerOf(state, host.heroId);
    peasant.level = 20;

    await engine.message(socket.id, { t: "skill", slot: 4 });
    expect(peasant.action).toBeNull();
    expect(peasant.skillCooldowns[3]).toBe(0);
    expect(await partyMaterials(host.partyId)).toEqual({ wood: 0, stone: 0, iron: 0, meat: 0 });

    await seedPartyMaterials(host.partyId, host.heroId, {
      wood: 4,
      stone: 4,
      iron: 2,
      meat: 2,
    });
    const stocked = await partyMaterials(host.partyId);
    const previous = { x: peasant.x, z: peasant.z };
    // Hard against the grid's western edge, facing off it: whatever the camp's placement distance,
    // its centre lands where `heightAt` answers `null` and `canStand` refuses it. The pixel fixture
    // said the same thing by standing on the map's left border — a rectangle anchored at zero the
    // centred grid no longer has.
    peasant.x = -GRID_HALF + 0.1;
    peasant.z = 0;
    peasant.facing = { x: -1, z: 0 };
    state.playerGrid.update(peasant, previous);

    await engine.message(socket.id, { t: "skill", slot: 4 });
    expect(peasant.action).toBeNull();
    expect(peasant.skillCooldowns[3]).toBe(0);
    expect(await partyMaterials(host.partyId)).toEqual(stocked);

    peasant.x = 0;
    peasant.facing = { x: 1, z: 0 };
    for (let index = 0; index < MAX_PROJECTILES_PER_PLAYER; index++) {
      const projectile = spawnProjectile(state.projectiles, {
        actionId: crypto.randomUUID(),
        owner: peasant,
        roomKey: peasant.roomKey,
        origin: projectileOrigin(peasant, peasant.facing, 2 / TILE_SIZE),
        direction: peasant.facing,
        definition: {
          kind: "arrow",
          speed: 1 / TILE_SIZE,
          radius: 2 / TILE_SIZE,
          pierce: 0,
        },
        range: 100 / TILE_SIZE,
        power: 1,
        targetFilter: "monsters",
        sourceSkillId: "test_cap",
        basic: false,
        now: 1_000,
      });
      if (!projectile) throw new Error("projectile cap fixture rejected too early");
    }

    await engine.message(socket.id, { t: "skill", slot: 5 });
    expect(peasant.action).toBeNull();
    expect(peasant.skillCooldowns[4]).toBe(0);
    expect(await partyMaterials(host.partyId)).toEqual(stocked);
    engine.dispose();
  });

  test("an activated support spend survives a lost settlement acknowledgement and coordinator eviction", async () => {
    const host = await newPlayableHero("psupack", "peasant");
    await seedPartyMaterials(host.partyId, host.heroId, { wood: 4, stone: 2, meat: 2 });
    const clock = new FakeClock();
    const engine = createEngine(host.roomId, clock);
    const socket = fakeSocket(host.userId, host.heroId);
    await engine.join(socket);
    const state = roomState(engine);
    const peasant = playerOf(state, host.heroId);
    peasant.level = 20;
    peasant.facing = { x: 1, z: 0 };

    const partyRoom = alepha.inject(PartyRoom);
    const service = partyRoom.adventureStateService;
    const save = service.saveWithSupportSpends.bind(service);
    let writes = 0;
    const persistedThenLost = vi
      .spyOn(service, "saveWithSupportSpends")
      .mockImplementation(async (...args) => {
        await save(...args);
        writes += 1;
        if (writes === 2) throw new Error("settlement acknowledgement lost");
      });

    await engine.message(socket.id, { t: "skill", slot: 4 });
    persistedThenLost.mockRestore();
    const action = peasant.action;
    if (!action) throw new Error("camp action was not activated");
    expect(state.activatedSupportSpendIds.size).toBe(1);
    const [reservationId] = state.activatedSupportSpendIds;
    if (!reservationId) throw new Error("activated support spend was not tracked");

    evictPartyCoordinator(host.partyId);
    const worldRoom = alepha.inject(WorldRoom) as unknown as {
      reconcilePartyMaterialSpends(state: WorldRoomState): Promise<void>;
    };
    await worldRoom.reconcilePartyMaterialSpends(state);
    expect(state.activatedSupportSpendIds.size).toBe(0);
    const recovered = await service.loadCoordinatorState(host.partyId);
    expect(recovered.supportSpends[reservationId]?.status).toBe("settled");
    expect(recovered.state.materials).toMatchObject({ wood: 0, stone: 0, meat: 0 });
    engine.dispose();
  });

  test("talented Peasant camp spends its resolved cost and replays through reconnect", async () => {
    const host = await newPlayableHero("pcamp", "peasant");
    const guest = await joinAsSecondHero(host, "pcguest");
    await seedPartyMaterials(host.partyId, host.heroId, {
      wood: 4,
      stone: 2,
      meat: 2,
    });
    const clock = new FakeClock();
    const engine = createEngine(host.roomId, clock);
    const hostSocket = fakeSocket(host.userId, host.heroId);
    await engine.join(hostSocket);
    const state = roomState(engine);
    const peasant = playerOf(state, host.heroId);
    peasant.level = 20;
    peasant.facing = { x: 1, z: 0 };
    peasant.talents = [
      "peasant.butchers_cut.grand_feast",
      "peasant.makeshift_camp.complete_encampment",
    ];
    const slowed = seedMonster(state, "camp-slowed", peasant.x + 80 / TILE_SIZE, peasant.z);

    await engine.message(hostSocket.id, { t: "skill", slot: 4 });
    const action = peasant.action;
    if (!action) throw new Error("camp action was not accepted");
    expect(action.skillId).toBe("makeshift_camp");
    expect(state.adventureState.state.materials).toMatchObject({ wood: 2, stone: 1, meat: 1 });

    let now = action.impactAt;
    const { w, sent } = testGlue(state, () => now);
    advanceWorldTick(w);
    expect(state.peasantSupport.camps).toHaveLength(1);
    const camp = state.peasantSupport.camps[0];
    if (!camp) throw new Error("camp did not resolve");
    // Both radii are the exact quotients of the pixel table's 144 and 180 by `TILE_SIZE`: the same
    // ground covered, measured with the tile ruler the whole world now uses.
    expect(camp).toMatchObject({
      radius: 144 / TILE_SIZE,
      protectionRatio: 0.22,
      slowRatio: 0.2,
      rationHealing: 21,
      rationPortionsRemaining: 3,
      rationRadius: 180 / TILE_SIZE,
      rationBuffDurationMs: 10_000,
      rationPowerBonusRatio: 0.15,
      expiresAt: camp.startedAt + 80_000,
    });
    expect(slowed.slowMultiplier).toBeCloseTo(0.8);
    expect(sentTo(sent, host.heroId)).toContainEqual(
      expect.objectContaining({ t: "peasant.camp", id: camp.id }),
    );

    const guestSocket = fakeSocket(guest.userId, guest.heroId);
    await engine.join(guestSocket);
    expect(guestSocket.sent.some((raw) => raw.includes('"t":"peasant.camp"'))).toBe(true);

    await engine.leave(guestSocket.id);
    const reconnectedGuestSocket = fakeSocket(guest.userId, guest.heroId);
    await engine.join(reconnectedGuestSocket);
    expect(
      reconnectedGuestSocket.sent.some(
        (raw) => raw.includes('"t":"peasant.camp"') && raw.includes(camp.id),
      ),
    ).toBe(true);

    const guestPlayer = playerOf(state, guest.heroId);
    guestPlayer.hp = 10;
    guestPlayer.resource = { kind: "mana", current: 10, max: 100 };
    now += 2_000;
    advanceWorldTick(w);
    expect(guestPlayer.hp).toBe(34);
    expect(guestPlayer.resource.current).toBeGreaterThan(10);
    expect(guestPlayer.rallyPowerMultiplier).toBe(0.15);
    expect(guestPlayer.rallyPowerUntil).toBe(now + 10_000);

    sent.clear();
    state.tick = 19;
    now += TICK_MS;
    advanceWorldTick(w);
    expect(sentTo(sent, guest.heroId)).toContainEqual(
      expect.objectContaining({ t: "peasant.camp", id: camp.id }),
    );

    await engine.leave(hostSocket.id);
    expect(state.peasantSupport.camps).toEqual([]);
    expect(
      reconnectedGuestSocket.sent.some(
        (raw) => raw.includes('"t":"peasant.camp_removed"') && raw.includes(camp.id),
      ),
    ).toBe(true);
    engine.dispose();
  });

  test("Powder Keg applies exact fragments and crowd control once while respecting LOS", async () => {
    const host = await newPlayableHero("pbomb", "peasant");
    await seedPartyMaterials(host.partyId, host.heroId, { stone: 2, iron: 2 });
    const clock = new FakeClock();
    const engine = createEngine(host.roomId, clock);
    const socket = fakeSocket(host.userId, host.heroId);
    await engine.join(socket);
    const state = roomState(engine);
    const peasant = playerOf(state, host.heroId);
    peasant.level = 20;
    const previous = { x: peasant.x, z: peasant.z };
    peasant.x = -2.5;
    peasant.z = 0;
    peasant.facing = { x: 1, z: 0 };
    peasant.talents = ["peasant.homemade_bomb.powder_keg"];
    state.playerGrid.update(peasant, previous);
    const location = state.location;
    if (!location) throw new Error("room terrain missing");
    // One raised column of cells covering `x ∈ [-1, 0)` and `z ∈ [-2, 3)` in world tiles — cell `i`
    // covers `[i - GRID_HALF, i - GRID_HALF + 1)`. The bomb flies east into its west face and the
    // troll waits on the far side of it.
    location.definition.terrain = terrainWithWall({
      minCol: GRID_HALF - 1,
      maxCol: GRID_HALF - 1,
      minRow: GRID_HALF - 2,
      maxRow: GRID_HALF + 2,
    });
    // Both goblins stand well off the bomb's flight line (0.7 tiles, against a projectile radius
    // plus a body radius of ~0.4) so the blast is the wall's face rather than a body it clipped,
    // and both are comfortably inside the Powder Keg radius of `110 * 1.35 / TILE_SIZE`.
    const target = seedMonster(state, "bomb-target", -1.5, 0.7, { maxHp: 500 });
    const sideTarget = seedMonster(state, "bomb-side", -1.5, -0.7, { maxHp: 500 });
    // Inside the blast radius, and behind the wall: only the sight line can spare it.
    const hidden = seedMonster(state, "bomb-hidden", 0.5, 0, {
      maxHp: 500,
      kind: "troll",
      species: "gate_troll",
    });
    for (const monster of [target, sideTarget, hidden]) monster.weakness = "warrior";
    const sidePosition = { x: sideTarget.x, z: sideTarget.z };

    await engine.message(socket.id, { t: "skill", slot: 5 });
    const action = peasant.action;
    if (!action) throw new Error("bomb action was not accepted");
    expect(action.skillId).toBe("homemade_bomb");
    expect(state.adventureState.state.materials).toMatchObject({ stone: 1, iron: 1 });

    let now = action.impactAt;
    const { w, sent } = testGlue(state, () => now);
    const hpBefore = target.hp;
    const sideHpBefore = sideTarget.hp;
    const hiddenHpBefore = hidden.hp;
    for (let tick = 0; tick < 8 && target.hp === hpBefore; tick++) {
      advanceWorldTick(w);
      now += TICK_MS;
    }
    expect(target.hp).toBe(hpBefore - 150);
    expect(sideTarget.hp).toBe(sideHpBefore - 150);
    expect(hidden.hp).toBe(hiddenHpBefore);
    expect(sideTarget.slowMultiplier).toBe(0.75);
    expect(sideTarget.slowUntil).toBe(action.impactAt + 3_000);
    expect({ x: sideTarget.x, z: sideTarget.z }).not.toEqual(sidePosition);
    expect(state.projectiles).toEqual([]);
    expect(state.peasantSupport.bombs.size).toBe(0);
    expect(
      sentTo(sent, host.heroId).filter((message) => message.t === "peasant.bomb_impact"),
    ).toHaveLength(1);
    engine.dispose();
  });

  test("Vanish creates a Rogue-shaped priority decoy that absorbs attacks", async () => {
    const host = await newPlayableHero("rdecoy", "rogue");
    const clock = new FakeClock();
    const engine = createEngine(host.roomId, clock);
    const socket = fakeSocket(host.userId, host.heroId);
    await engine.join(socket);
    const state = roomState(engine);
    const rogue = playerOf(state, host.heroId);
    rogue.level = 20;
    rogue.talents = ["rogue.vanish.left_silhouette"];
    const monster = seedMonster(state, "decoy-hunter", rogue.x + 60 / TILE_SIZE, rogue.z);
    monster.threat.set("another-hero", {
      playerId: "another-hero",
      amount: 500,
      updatedAt: 900,
    });
    let now = 1_000;
    const { w } = testGlue(state, () => now);

    expect(startPlayerAction(w, rogue.connectionId, rogue, 3)).toBe(true);
    const vanish = rogue.action;
    if (!vanish) throw new Error("Vanish action missing");
    now = vanish.impactAt;
    resolvePlayerAction(w, rogue, vanish, now);
    const decoy = rogue.rogueSilhouette;
    if (!decoy) throw new Error("Vanish decoy missing");
    expect(monster.threat.get(rogue.id)?.amount).toBeGreaterThan(500);

    const beforeHp = rogue.hp;
    decoy.hp = 1;
    const previousMonsterPosition = { x: monster.x, z: monster.z };
    monster.x = decoy.x - 18 / TILE_SIZE;
    monster.z = decoy.z;
    monster.y = decoy.y;
    state.monsterGrid.update(monster, previousMonsterPosition);
    rogue.x += 180 / TILE_SIZE;
    startMonsterAttack(w, monster, { ...rogue, x: decoy.x, y: decoy.y, z: decoy.z }, now);
    const strike = monster.action;
    if (!strike) throw new Error("decoy strike missing");
    resolveMonsterAction(w, monster, strike, strike.impactAt);

    expect(rogue.rogueSilhouette).toBeNull();
    expect(rogue.hp).toBe(beforeHp);
    expect(rogue.rogueStealthUntil).toBeGreaterThan(strike.impactAt);
    expect(monster.threat.has(rogue.id)).toBe(false);
    engine.dispose();
  });

  test("map-authored ability locks are enforced by the room authority", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("abilitylock");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const player = playerOf(state, heroId);
    const settings = state.location?.definition.heroSettings;
    if (!settings) throw new Error("authored map did not carry hero settings");
    settings.classes.warrior.disabledSkills = [1, 3];
    const { w, sent } = testGlue(state, () => Date.now() + 1_000);

    expect(startPlayerAction(w, `c-${heroId}`, player, 1)).toBe(false);
    expect(player.lastAttackAt).toBe(0);
    expect(sentTo(sent, heroId)).toContainEqual({
      t: "event",
      code: "skill.disabled",
      params: { skill: "cleave" },
      tone: "info",
    });
    engine.dispose();
  });

  test("Dance Master opens its free reactivation only after the dance sequence ends", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("dancemaster", "rogue");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const player = playerOf(state, heroId);
    player.level = 10;
    player.talents = [
      "rogue.shadow_dance.force",
      "rogue.shadow_dance.reach",
      "rogue.shadow_dance.readiness",
      "rogue.shadow_dance.dark_harvest",
      "rogue.shadow_dance.dance_master",
    ];
    player.facing = { x: 1, z: 0 };
    seedMonster(state, "dance-mark", player.x + 120 / TILE_SIZE, player.z, { maxHp: 5_000 });
    let t = Date.now() + 1_000;
    const { w } = testGlue(state, () => t);
    expect(startPlayerAction(w, `c-${heroId}`, player, 5)).toBe(true);
    const impactAt = player.action?.impactAt;
    if (impactAt === undefined) throw new Error("missing Shadow Dance impact");
    const cooldownUntil = player.skillCooldowns[4];
    t = impactAt;
    advanceWorldTick(w);
    const mark = player.rogueDanceMarks[0];
    if (!mark) throw new Error("missing Dance Master mark");
    expect(mark.availableAt).toBe(player.rogueShadowDanceInvulnerableUntil);
    expect(mark.expiresAt).toBe(mark.availableAt + 2_000);

    const danceLanding = { x: player.x, z: player.z };
    player.x -= 100 / TILE_SIZE;
    state.playerGrid.update(player, danceLanding);
    const repositionOrigin = { x: player.x, z: player.z };

    expect(startPlayerAction(w, `c-${heroId}`, player, 5)).toBe(false);
    expect(player).toMatchObject(repositionOrigin);
    expect(player.rogueDanceMarks).toEqual([mark]);

    t = mark.availableAt;
    expect(startPlayerAction(w, `c-${heroId}`, player, 5)).toBe(true);
    expect(groundDistance(player, repositionOrigin)).toBeGreaterThan(20 / TILE_SIZE);
    expect(player.rogueDanceMarks).toEqual([]);
    expect(player.skillCooldowns[4]).toBe(cooldownUntil);
    engine.dispose();
  });

  test("Polarity Orb preserves Mercy's nearest-corpse resurrection", async () => {
    const host = await newPlayableHero("orbmercy", "priest");
    const ally = await joinAsSecondHero(host, "orbmercyally");
    const clock = new FakeClock();
    const engine = createEngine(host.roomId, clock);
    await engine.join(fakeSocket(host.userId, host.heroId));
    await engine.join(fakeSocket(ally.userId, ally.heroId));
    const state = roomState(engine);
    const priest = playerOf(state, host.heroId);
    priest.level = 10;
    const corpse = playerOf(state, ally.heroId);
    priest.talents = ["priest.divine_nova.mercy", "priest.divine_nova.polarity_orb"];
    corpse.life = "corpse";
    corpse.hp = 0;
    corpse.x = priest.x + 20 / TILE_SIZE;
    corpse.z = priest.z;
    corpse.corpse = { x: corpse.x, y: corpse.y, z: corpse.z };

    let t = Date.now() + 1_000;
    const { w } = testGlue(state, () => t);
    expect(startPlayerAction(w, `c-${host.heroId}`, priest, 5)).toBe(true);
    const impactAt = priest.action?.impactAt;
    if (impactAt === undefined) throw new Error("missing Divine Nova impact");
    t = impactAt;
    advanceWorldTick(w);

    expect(state.polarityOrbs).toHaveLength(1);
    expect(corpse.life).toBe("alive");
    expect(corpse.corpse).toBeNull();
    expect(corpse.hp).toBeGreaterThan(0);
    engine.dispose();
  });

  test("Lumen Step phases through bodies and rematerialises beside an occupied destination", async () => {
    const host = await newPlayableHero("lumenphase", "priest");
    const clock = new FakeClock();
    const engine = createEngine(host.roomId, clock);
    await engine.join(fakeSocket(host.userId, host.heroId));
    const state = roomState(engine);
    const priest = playerOf(state, host.heroId);
    priest.level = 10;
    const terrain = state.location?.definition.terrain;
    if (!terrain) throw new Error("missing test terrain");
    const connectionId = `c-${host.heroId}`;
    const origin = { x: priest.x, z: priest.z };
    // Grounded on where the PRIEST is, never on the candidate itself: `canStand(dest,
    // groundUnder(dest))` is self-satisfying and would accept a destination on top of a cliff.
    const originGround = groundUnder(terrain, origin.x, origin.z);
    const destination = [1, 2, 3, 4]
      .map((offset) => ({ x: origin.x + offset, z: origin.z }))
      .find((candidate) => canStand(terrain, candidate.x, candidate.z, BODY_RADIUS, originGround));
    if (!destination) throw new Error("missing open Lumen destination");
    const blocker = seedMonster(state, "lumen-blocker", destination.x, destination.z, {
      species: "mire_troll",
      kind: "troll",
    });

    let now = Date.now() + 1_000;
    const { w } = testGlue(state, () => now);
    expect(startPlayerAction(w, connectionId, priest, 3)).toBe(true);
    const beforePhase = { x: priest.x, z: priest.z };
    priest.x = destination.x;
    priest.z = destination.z;
    state.playerGrid.update(priest, beforePhase);
    now += 250;
    expect(finishHeldPlayerAction(w, connectionId, priest, now, 3)).toBe(true);

    expect(canStand(terrain, priest.x, priest.z, BODY_RADIUS, originGround)).toBe(true);
    const blockerHitbox = monsterBodyHitbox(blocker.species, blocker);
    // A tile-unit position IS the body's centre, so the pixel version's `+ PLAYER_SIZE / 2` shift
    // from a top-left corner is gone; the clearance itself is the same half-body plus the hitbox.
    expect(groundDistance(priest, blockerHitbox.center)).toBeGreaterThanOrEqual(
      BODY_RADIUS + blockerHitbox.radius,
    );
    expect(priest).not.toMatchObject(destination);
    engine.dispose();
  });

  test("attack consumes its cooldown even on a miss", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("attackmiss");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    const socket = fakeSocket(userId, heroId);
    await engine.join(socket);
    const state = roomState(engine);
    const player = playerOf(state, heroId);
    expect(state.monsters).toHaveLength(0); // nothing to hit: the swing below MUST miss

    let t = Date.now() + 1_000;
    const { w, sent } = testGlue(state, () => t);
    const connectionId = `c-${heroId}`;

    expect(startPlayerAction(w, connectionId, player, 1)).toBe(true);
    const castAt = t;
    // The cooldown is spent the moment the action is ACCEPTED, before anything resolves.
    expect(player.lastAttackAt).toBe(castAt);

    // Resolve the active frame with no target in range: a miss is valid and refunds nothing.
    t = castAt + MONSTER_ACTIONS.torch_goblin.anticipationMs + 400; // well past impact + recovery
    advanceWorldTick(w);
    expect(player.lastAttackAt).toBe(castAt);
    const hits = sentTo(sent, heroId).filter(
      (message) => message.t === "event" && message.code === "combat.hit",
    );
    expect(hits).toHaveLength(0);

    // Inside the cooldown window (action long recovered) a second attack is refused...
    t = castAt + ATTACK_COOLDOWN_MS - 1;
    expect(startPlayerAction(w, connectionId, player, 1)).toBe(false);
    expect(player.lastAttackAt).toBe(castAt);
    // ...and accepted again once the cooldown lapses.
    t = castAt + ATTACK_COOLDOWN_MS + 400;
    expect(startPlayerAction(w, connectionId, player, 1)).toBe(true);
    expect(player.lastAttackAt).toBe(t);
    engine.dispose();
  });

  test("a monster's strike direction freezes at wind-up and damages only actors in the capsule at the active frame", async () => {
    const host = await newPlayableHero("windup");
    const guest = await joinAsSecondHero(host, "windupguest");
    const clock = new FakeClock();
    const engine = createEngine(host.roomId, clock);
    await engine.join(fakeSocket(host.userId, host.heroId));
    await engine.join(fakeSocket(guest.userId, guest.heroId));
    const state = roomState(engine);
    const target = playerOf(state, host.heroId); // the wind-up's chosen target
    const bystander = playerOf(state, guest.heroId);

    let t = Date.now() + 1_000;
    const { w, sent } = testGlue(state, () => t);

    // The monster winds up eastward at the target standing inside its reach.
    const monster = seedMonster(state, "freeze-1", target.x - 40 / TILE_SIZE, target.z);
    bystander.x = monster.x;
    bystander.z = monster.z - 400 / TILE_SIZE; // far north: outside the capsule at wind-up
    startMonsterAttack(w, monster, target, t);
    const action = monster.action;
    if (!action) throw new Error("wind-up did not start an action");
    const frozenDirection = { ...action.direction };
    expect(frozenDirection.x).toBeCloseTo(1);
    expect(frozenDirection.z).toBeCloseTo(0);

    // During anticipation the TARGET escapes and the BYSTANDER walks into the frozen capsule.
    target.x = monster.x + 500 / TILE_SIZE;
    bystander.x = monster.x + 40 / TILE_SIZE;
    bystander.z = monster.z;
    const maxHp = maxHpForLevel(1);
    expect(target.hp).toBe(maxHp);
    expect(bystander.hp).toBe(maxHp);

    t += MONSTER_ACTIONS.torch_goblin.anticipationMs;
    expect(t).toBeGreaterThanOrEqual(action.impactAt);
    resolveMonsterAction(w, monster, action, t);

    // Direction stayed frozen: it never re-aimed at where the target went.
    expect(action.direction).toEqual(frozenDirection);
    expect(monster.facing).toEqual(frozenDirection);
    // Only the actor inside the capsule at the active frame is damaged.
    expect(bystander.hp).toBeLessThan(maxHp);
    expect(target.hp).toBe(maxHp);
    const hurt = sentTo(sent, guest.heroId).filter(
      (message) => message.t === "event" && message.code === "combat.hurt",
    );
    expect(hurt).toHaveLength(1);
    expect(sentTo(sent, host.heroId).some((m) => m.t === "event" && m.code === "combat.hurt")).toBe(
      false,
    );
    engine.dispose();
  });

  test("a shaman resolves its attack as a server-authored magic projectile", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("shamanbolt");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const target = playerOf(state, heroId);
    const t = Date.now() + 1_000;
    const { w } = testGlue(state, () => t);
    const monster = seedMonster(state, "shaman-ranged", target.x - 180 / TILE_SIZE, target.z, {
      species: "hex_shaman",
      kind: "shaman",
    });

    startMonsterAttack(w, monster, target, t);
    const action = monster.action;
    if (!action) throw new Error("shaman attack did not start");

    expect(target.hp).toBe(maxHpForLevel(1));
    expect(state.projectiles).toEqual([
      expect.objectContaining({
        ownerId: monster.id,
        kind: "hex_orb",
        targetFilter: "players_and_guards",
        power: monster.damage,
      }),
    ]);
    engine.dispose();
  });

  test("an explicit arrow profile fires once on acceptance regardless of appearance", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("profilearrow");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const target = playerOf(state, heroId);
    const now = Date.now() + 1_000;
    const { w, sent } = testGlue(state, () => now);
    const monster = seedMonster(state, "explicit-archer", target.x - 180 / TILE_SIZE, target.z, {
      species: "spear_goblin",
      attackProfile: "arrow",
    });
    monster.graphicAssetId = null;

    startMonsterAttack(w, monster, target, now);
    const action = monster.action;
    if (!action) throw new Error("archer attack did not start");
    expect(action.impactAt).toBe(now);
    expect(state.projectiles).toEqual([
      expect.objectContaining({
        actionId: action.id,
        ownerId: monster.id,
        kind: "arrow",
        targetFilter: "players_and_guards",
      }),
    ]);
    expect(
      sentTo(sent, heroId).filter(
        (message) => message.t === "animation" && message.actionId === action.id,
      ),
    ).toEqual([
      expect.objectContaining({
        t: "animation",
        startedAt: now,
        impactAt: now,
        recoveryEndsAt: now + 620,
      }),
    ]);

    // The action's resolved flag, not a timer-specific workaround, owns the single spawn.
    advanceCombatActions([monster], now, (actor, action) =>
      resolveMonsterAction(w, actor, action, now),
    );
    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles[0]?.actionId).toBe(action.id);
    engine.dispose();
  });

  test("a ranged monster accepted during guard combat launches in the same tick", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("guardarrow");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const observer = playerOf(state, heroId);
    const now = Date.now() + 1_000;
    const { w } = testGlue(state, () => now);
    const guard = seedGuard(state, "ranged-target-guard", observer.x + 120 / TILE_SIZE, observer.z);
    const monster = seedMonster(state, "guard-archer", guard.x - 180 / TILE_SIZE, guard.z, {
      species: "spear_goblin",
      attackProfile: "arrow",
    });

    startMonsterAttack(w, monster, guard, now);

    expect(monster.action).toMatchObject({ impactAt: now, resolved: true });
    expect(state.projectiles).toEqual([
      expect.objectContaining({
        actionId: monster.action?.id,
        ownerId: monster.id,
        kind: "arrow",
        targetFilter: "players_and_guards",
      }),
    ]);
    advanceCombatActions([monster], now, (actor, action) =>
      resolveMonsterAction(w, actor, action, now),
    );
    expect(state.projectiles).toHaveLength(1);
    engine.dispose();
  });

  test("enemy projectiles use the shared guard damage rule exactly once", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("guardproj");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const player = playerOf(state, heroId);
    const combatOrigin = { x: player.x, z: player.z };
    player.x += 600 / TILE_SIZE;
    const monster = seedMonster(state, "guard-projectile-owner", combatOrigin.x, combatOrigin.z);
    const guard = seedGuard(
      state,
      "projectile-target-guard",
      combatOrigin.x + 40 / TILE_SIZE,
      combatOrigin.z,
    );
    let now = Date.now() + 1_000;
    const { w } = testGlue(state, () => now);

    const launchAtGuard = (power: number) => {
      const projectile = spawnProjectile(state.projectiles, {
        actionId: crypto.randomUUID(),
        owner: monster,
        roomKey: state.roomKey,
        origin: projectileOrigin(monster, { x: 1, z: 0 }, 5 / TILE_SIZE),
        direction: { x: 1, z: 0 },
        definition: {
          kind: "arrow",
          speed: 540 / TILE_SIZE,
          radius: 5 / TILE_SIZE,
          pierce: 0,
        },
        range: 300 / TILE_SIZE,
        power,
        targetFilter: "players_and_guards",
        sourceSkillId: "monster_ranged_attack",
        basic: true,
        now,
      });
      if (!projectile) throw new Error("enemy projectile fixture rejected");
      monster.deadUntil = Number.POSITIVE_INFINITY;
      now += TICK_MS;
      advanceWorldTick(w);
    };

    guard.hp = 30;
    launchAtGuard(17);
    expect(guard.hp).toBe(13);
    now += TICK_MS;
    advanceWorldTick(w);
    expect(guard.hp).toBe(13);

    launchAtGuard(99);
    expect(guard.hp).toBe(1);
    expect(state.guards).toContain(guard);

    guard.hp = 5;
    monster.deadUntil = 0;
    monster.action = null;
    monster.attackProfile = "melee";
    startMonsterAttack(w, monster, guard, now);
    const action = monster.action as CombatActionRuntime | null;
    if (!action) throw new Error("melee guard attack did not start");
    resolveMonsterAction(w, monster, action, action.impactAt);
    expect(guard.hp).toBe(1);
    expect(state.guards).toContain(guard);
    engine.dispose();
  });

  test("elite and boss special wind-ups remain valid on the client wire", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("bosswire");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const target = playerOf(state, heroId);
    const monsters = createMonsters([
      {
        id: "elite-wire-1",
        name: "ELITE",
        kind: "troll",
        species: "gate_troll",
        zone: "gate",
        x: target.x - 40 / TILE_SIZE,
        y: 0,
        z: target.z,
        patrolRadius: 10 / TILE_SIZE,
        rank: "elite",
        maxHp: 900,
        damage: 45,
        speed: 120 / TILE_SIZE,
        xp: 900,
        weakness: "none",
        weaknessPercent: 150,
        specialTechnique: "troll_quake",
      },
      {
        id: "boss-wire-1",
        name: "BOSS",
        kind: "troll",
        species: "gate_troll",
        zone: "gate",
        x: target.x - 40 / TILE_SIZE,
        y: 0,
        z: target.z,
        patrolRadius: 10 / TILE_SIZE,
        rank: "boss",
        maxHp: 2_000,
        damage: 70,
        speed: 150 / TILE_SIZE,
        xp: 2_000,
        weakness: "none",
        weaknessPercent: 150,
        specialTechnique: "troll_quake",
      },
    ]);
    expect(monsters).toHaveLength(2);
    for (const monster of monsters) {
      state.monsters.push(monster);
      state.monsterGrid.insert(monster);
    }

    const t = Date.now() + 1_000;
    const { w, sent } = testGlue(state, () => t);
    for (const monster of monsters) startMonsterAttack(w, monster, target, t);

    expect(monsters.map((monster) => monster.action)).toEqual([
      expect.objectContaining({ kind: "monster_attack", skillId: "troll_quake" }),
      expect.objectContaining({ kind: "monster_attack", skillId: "troll_quake" }),
    ]);
    const animations = sentTo(sent, heroId).filter(
      (message) => message.t === "animation" && message.skillId === "troll_quake",
    );
    expect(animations).toHaveLength(2);
    for (const animation of animations) {
      expect(animation).toMatchObject({
        t: "animation",
        actorKind: "monster",
        action: "skill",
        skillId: "troll_quake",
      });
      expect(parseServerMessage(encodeServerMessage(animation))).toMatchObject({
        t: "animation",
        actorKind: "monster",
        skillId: "troll_quake",
      });
    }
    engine.dispose();
  });

  test("a heavy special emits one typed impact on its unchanged authoritative damage tick", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("quakeimpact");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const target = playerOf(state, heroId);
    const monster = seedMonster(state, "quake-impact-1", target.x - 40 / TILE_SIZE, target.z, {
      species: "gate_troll",
      kind: "troll",
    });
    monster.specialTechnique = "troll_quake";
    monster.damage = 20;
    monster.nextSpecialAt = 0;
    let now = Date.now() + 1_000;
    const { w, sent } = testGlue(state, () => now);
    const hpBefore = target.hp;

    startMonsterAttack(w, monster, target, now);
    const action = monster.action;
    if (!action) throw new Error("troll quake did not start");
    expect(action.skillId).toBe("troll_quake");
    expect(action.impactAt).toBe(now + MONSTER_SPECIAL_ACTIONS.troll_quake.anticipationMs);
    expect(
      sentTo(sent, heroId).filter((message) => message.t === "monster.special_impact"),
    ).toHaveLength(0);

    now = action.impactAt;
    advanceWorldTick(w);

    expect(target.hp).toBe(
      hpBefore - Math.round(monster.damage * MONSTER_SPECIAL_ACTIONS.troll_quake.damageMultiplier),
    );
    const impacts = sentTo(sent, heroId).filter(
      (message) => message.t === "monster.special_impact" && message.actionId === action.id,
    );
    expect(impacts).toEqual([
      {
        t: "monster.special_impact",
        actionId: action.id,
        actorId: monster.id,
        technique: "troll_quake",
        // A tile-unit position IS the body's centre, so the pixel path's half-body recentring is
        // gone: the quake's origin is the monster's own ground point.
        x: monster.x,
        z: monster.z,
        direction: action.direction,
        impactAt: now,
      },
    ]);
    expect(parseServerMessage(encodeServerMessage(impacts[0] as ServerMessage))).toEqual(
      impacts[0],
    );
    expect(
      sentTo(sent, heroId).filter(
        (message) => message.t === "event" && message.code === "combat.hurt",
      ),
    ).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ technique: "troll_quake" }),
      }),
    ]);

    advanceWorldTick(w);
    expect(
      sentTo(sent, heroId).filter(
        (message) => message.t === "monster.special_impact" && message.actionId === action.id,
      ),
    ).toHaveLength(1);
    expect(target.hp).toBe(
      hpBefore - Math.round(monster.damage * MONSTER_SPECIAL_ACTIONS.troll_quake.damageMultiplier),
    );
    engine.dispose();
  });

  test("a guard kill grants no player XP or loot and sets the respawn state directly", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("guardkill");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const player = playerOf(state, heroId);
    const xpBefore = player.xp;

    // Monster and guard together, the hero far outside aggro range: only the guard can kill.
    const monster = seedMonster(state, "guarded-1", player.x - 600 / TILE_SIZE, player.z);
    monster.respawnDelayMs = 42_000;
    seedGuard(state, "guard-1", monster.x, monster.z + 40 / TILE_SIZE);
    expect(groundDistance(monster, player)).toBeGreaterThan(MONSTER_AGGRO_RANGE);

    const t = Date.now() + 1_000;
    const { w, sent } = testGlue(state, () => t);
    advanceWorldTick(w);

    // Killed by GUARD_DAMAGE, respawn state set directly — never the reward path.
    expect(monster.hp).toBe(0);
    expect(monster.deadUntil).toBe(t + 42_000);
    expect(monster.rewardsGranted).toBe(false);
    expect(state.loot).toHaveLength(0);
    expect(player.xp).toBe(xpBefore);
    const rewardMessages = sentTo(sent, heroId).filter(
      (message) =>
        message.t === "event" &&
        (message.code === "monster.defeated" || message.code === "level_up"),
    );
    expect(rewardMessages).toHaveLength(0);
    engine.dispose();
  });

  test("monsters skip players who are not alive", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("corpserun");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const player = playerOf(state, heroId);

    // A monster parked right on top of a corpse: close enough to strike anything alive.
    const monster = seedMonster(state, "camper-1", player.x + 30 / TILE_SIZE, player.z);
    player.life = "corpse";
    player.corpse = { x: player.x, y: player.y, z: player.z };
    const hpBefore = player.hp;

    let t = Date.now() + 1_000;
    const { w } = testGlue(state, () => t);
    for (let tick = 0; tick < 5; tick += 1) {
      t += TICK_MS;
      advanceWorldTick(w);
    }
    // No threat, no wind-up, no damage: the corpse run stays winnable.
    expect(monster.threat.size).toBe(0);
    expect(monster.action).toBeNull();
    expect(player.hp).toBe(hpBefore);

    // Positive control: the same setup with a LIVING player is attacked on the very next tick.
    player.life = "alive";
    player.corpse = null;
    t += TICK_MS;
    advanceWorldTick(w);
    expect(monster.threat.has(heroId)).toBe(true);
    expect(monster.action).not.toBeNull();
    engine.dispose();
  });

  test("personal loot is omitted from another player's delta", async () => {
    const host = await newPlayableHero("lootowner");
    const guest = await joinAsSecondHero(host, "lootpeer");
    const clock = new FakeClock();
    const engine = createEngine(host.roomId, clock);
    const hostSocket = fakeSocket(host.userId, host.heroId);
    const guestSocket = fakeSocket(guest.userId, guest.heroId);
    await engine.join(hostSocket);
    await engine.join(guestSocket);
    const state = roomState(engine);
    const owner = playerOf(state, host.heroId);

    // Personal loot inside BOTH players' loot AOI (`LOOT_VISIBILITY_RADIUS`, 650 px worth of
    // ground) but outside pickup range (`LOOT_PICKUP_RANGE`, 46 px worth) — both tile units now.
    const lootId = "personal-loot-1";
    const item = {
      id: lootId,
      kind: "gold" as const,
      amount: 4,
      x: owner.x + 200 / TILE_SIZE,
      y: owner.y,
      z: owner.z,
      expiresAt: Date.now() + 60_000,
      ownerId: owner.id,
    };
    state.loot.push(item);
    state.lootGrid.insert(item);

    for (let tick = 0; tick < 4; tick += 1) clock.advance(TICK_MS);

    const hostDeltas = hostSocket.sent.filter((raw) => raw.includes('"world.delta"'));
    const guestFrames = guestSocket.sent;
    expect(hostDeltas.some((raw) => raw.includes(lootId))).toBe(true);
    expect(guestFrames.some((raw) => raw.includes(lootId))).toBe(false);
    engine.dispose();
  });

  test("local chat reaches only in-AOI players and oversized chat is dropped", async () => {
    const host = await newPlayableHero("chatnear");
    const guest = await joinAsSecondHero(host, "chatfar");
    const clock = new FakeClock();
    const engine = createEngine(host.roomId, clock);
    const hostSocket = fakeSocket(host.userId, host.heroId);
    const guestSocket = fakeSocket(guest.userId, guest.heroId);
    await engine.join(hostSocket);
    await engine.join(guestSocket);
    const state = roomState(engine);
    const speaker = playerOf(state, host.heroId);
    const listener = playerOf(state, guest.heroId);

    // Same spot first: local chat reaches both sides.
    await engine.message(hostSocket.id, { t: "chat", channel: "local", text: "par ici" });
    expect(hostSocket.sent.some((raw) => raw.includes("par ici"))).toBe(true);
    expect(guestSocket.sent.some((raw) => raw.includes("par ici"))).toBe(true);

    // Move the listener beyond `LOCAL_CHAT_RADIUS` (700 px worth of ground, in tile units now):
    // the next line no longer reaches them.
    const previous = { x: listener.x, z: listener.z };
    listener.x = speaker.x - 2_000 / TILE_SIZE;
    state.playerGrid.update(listener, previous);
    await engine.message(hostSocket.id, { t: "chat", channel: "local", text: "trop loin" });
    expect(hostSocket.sent.some((raw) => raw.includes("trop loin"))).toBe(true);
    expect(guestSocket.sent.some((raw) => raw.includes("trop loin"))).toBe(false);

    // Oversized chat is rejected outright — nobody receives it, not even the sender.
    const oversized = "x".repeat(CHAT_MAX_LENGTH + 1);
    await engine.message(hostSocket.id, { t: "chat", channel: "local", text: oversized });
    expect(hostSocket.sent.some((raw) => raw.includes(oversized))).toBe(false);
    engine.dispose();
  });

  test("one tick advances monsters before guards, over the position the hero reported", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("tickorder");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const player = playerOf(state, heroId);

    // Probe A (a reported position → monsters): the hero starts just OUTSIDE M1's aggro radius and
    // reports one step east, landing INSIDE it. The tick no longer moves anyone — the client owns
    // its hero's position — so this is what the monster pass must read on the very next tick.
    const moved = CLASS_STATS.warrior.movementSpeed * TICK_DT;
    const m1 = seedMonster(
      state,
      "order-aggro",
      player.x + MONSTER_AGGRO_RANGE + moved / 2,
      player.z,
    );
    expect(groundDistance(m1, player)).toBeGreaterThan(MONSTER_AGGRO_RANGE);

    // Probe B (monsters → guards): M2 stands at strike range of the hero with a guard beside it.
    // The monster pass starts M2's wind-up (an `animation` broadcast); the guard pass then kills
    // M2 in the same tick, cancelling the action. Had guards run first, M2 would already be dead
    // when the monster pass ran and no wind-up could ever have been observed.
    const m2 = seedMonster(state, "order-victim", player.x - 30 / TILE_SIZE, player.z);
    seedGuard(state, "order-guard", m2.x, m2.z + 40 / TILE_SIZE);

    const t = Date.now() + 1_000;
    const { w, sent } = testGlue(state, () => t);
    const connectionId = state.connectionIdByHeroId.get(heroId);
    if (connectionId === undefined) throw new Error("hero has no connection");
    applyReportedMove(w, connectionId, player, {
      t: "move",
      x: player.x + moved,
      y: player.y,
      z: player.z,
      facing: { x: 1, z: 0 },
      airborne: false,
      swimming: false,
      gliding: false,
      displacement: player.displacement,
    });
    expect(m1.threat.has(heroId)).toBe(false);
    advanceWorldTick(w);

    // The reported position is what put the hero inside M1's aggro ring, and the monster pass read
    // it rather than a position of the room's own devising.
    expect(groundDistance(m1, player)).toBeLessThan(MONSTER_AGGRO_RANGE);
    expect(m1.threat.has(heroId)).toBe(true);

    // Monsters before guards: the wind-up happened (broadcast while M2 was alive), THEN the guard
    // kill landed and cancelled it — all inside one tick.
    const windUps = sentTo(sent, heroId).filter(
      (message) => message.t === "animation" && message.actorId === m2.id,
    );
    expect(windUps).toHaveLength(1);
    expect(m2.deadUntil).toBe(t + MONSTER_RESPAWN_MS);
    expect(m2.action).toBeNull();
    engine.dispose();
  });
});
