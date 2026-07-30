/**
 * Epoch-fenced hero persistence for the Alepha world room (Task 6): the REAL `WorldRoom` option bag
 * (the exact object `$room` runs) hosted in a bare `RoomEngine` on a `FakeClock` — the same
 * `RoomEngine.spec.ts` idiom `world-room-movement.test.ts`/`world-room-combat.test.ts` already use —
 * against real D1 rows created through the ordinary HTTP flow. Every save-cadence assertion advances
 * virtual tick time; nothing sleeps for `D1_SAVE_EVERY_TICKS`.
 *
 * Pinned here:
 * 1. a moved player's position lands in D1 within one save beat (`D1_SAVE_EVERY_TICKS`, 100 ticks);
 * 2. a stale epoch (a competing `PresenceRoom.acquire` wins the race) changes ZERO rows anywhere —
 *    core AND a mutated child table — and closes the socket `PRESENCE_LOST` (4003);
 * 3. a disconnect (`onLeave`) saves immediately, without waiting for the periodic beat;
 * 4. a checkpointed combat cooldown survives a disconnect+reconnect BOTH via `PresenceRoom`'s
 *    in-memory promotion (the `welcome.self.cooldowns`) AND via the hero row's persisted
 *    `combatCooldowns` column;
 * 5. a child-table mutation (consumable quantity) lands on the same save beat as the core row.
 *
 * The periodic save (`D1_SAVE_EVERY_TICKS`) is fired through `deps.waitUntil` — fire-and-forget
 * from the synchronous tick's point of view, exactly like production. `clock.advanceTicks(...)`
 * only drives the SYNCHRONOUS tick loop; it does not wait for that detached save promise to
 * settle. Assertions that depend on it use `vi.waitFor` (a bounded poll, not a sleep) rather than
 * assuming the write has already landed the instant `advanceTicks` returns. The forced
 * `onLeave`/disconnect save has no such gap — `engine.leave()` awaits `onLeave` directly — so those
 * assertions read D1 immediately.
 */

import { WS_CLOSE } from "@lindocara/engine/close-codes.js";
import { normalizeConsumables } from "@lindocara/engine/consumables.js";
import type { PlayerSnapshot, ServerMessage } from "@lindocara/engine/protocol.js";
import { D1_SAVE_EVERY_TICKS, type PlayerRuntime } from "@lindocara/server/world/world-runtime.js";
import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { type RoomClock, RoomEngine, type RoomSocket } from "alepha/websocket";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { heroes } from "../src/api/entities/heroes.ts";
import { heroItems } from "../src/api/entities/heroItems.ts";
import { PresenceRoom } from "../src/api/realtime/PresenceRoom.ts";
import { WorldRoom } from "../src/api/realtime/WorldRoom.ts";
import type { WorldRoomState } from "../src/api/realtime/worldState.ts";
import { createTestApp } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";
const TICK_MS = 50;

/** The RoomEngine.spec FakeClock: intervals fire once per `advance` call, regardless of the `ms`
 *  argument (`RoomEngine` still tracks its own `1000/tickHz` period internally). */
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

class Probe {
  heroes = $repository(heroes);
  heroItems = $repository(heroItems);
}

let alepha: ReturnType<typeof createTestApp>;
let probe: Probe;
let presenceRoom: PresenceRoom;
let hostname: string;
let userCount = 0;

beforeEach(async () => {
  alepha = createTestApp();
  probe = alepha.inject(Probe);
  presenceRoom = alepha.inject(PresenceRoom);
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

interface Fixture {
  userId: string;
  roomId: string;
  heroId: string;
}

async function newPlayableHero(prefix: string): Promise<Fixture> {
  const { token, userId } = await registerAndLogin(prefix);
  const authed = (path: string, body: unknown) =>
    fetch(`${hostname}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  const adventureResponse = await authed("/api/adventures", { title: "Donjon", maxPlayers: 4 });
  expect(adventureResponse.status).toBe(201);
  const adventure = (await adventureResponse.json()) as { id: string; defaultMap: { id: string } };
  const partyResponse = await authed("/api/parties", { adventureId: adventure.id });
  expect(partyResponse.status).toBe(201);
  const partyId = ((await partyResponse.json()) as { id: string }).id;
  const heroResponse = await authed(`/api/parties/${partyId}/heroes`, {
    name: "Mira",
    class: "warrior",
  });
  expect(heroResponse.status).toBe(201);
  const heroId = ((await heroResponse.json()) as { id: string }).id;
  return { userId, roomId: `${partyId}:${adventure.defaultMap.id}`, heroId };
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

/** `RoomEngine.state` is protected only at compile time — same escape hatch
 *  `world-room-combat.test.ts` uses to assert on the real room state directly. */
function roomState(engine: object): WorldRoomState {
  return (engine as unknown as { state: WorldRoomState }).state;
}

function playerOf(state: WorldRoomState, heroId: string): PlayerRuntime {
  const connectionId = state.connectionIdByHeroId.get(heroId);
  const player = connectionId === undefined ? undefined : state.players.get(connectionId);
  if (!player) throw new Error(`hero ${heroId} is not in the room`);
  return player;
}

function parsedMessages(socket: FakeSocket): ServerMessage[] {
  return socket.sent.map((raw) => JSON.parse(raw) as ServerMessage);
}

function welcomeSelf(socket: FakeSocket, heroId: string): PlayerSnapshot | undefined {
  for (const message of parsedMessages(socket)) {
    if (message.t === "welcome") {
      const self = message.players.find((player) => player.id === heroId);
      if (self) return self;
    }
  }
  return undefined;
}

function welcomeSelfState(socket: FakeSocket) {
  for (const message of parsedMessages(socket)) {
    if (message.t === "welcome") return message.self;
  }
  return undefined;
}

const rightInput = (seq: number) => ({
  t: "input" as const,
  seq,
  input: { up: false, down: false, left: false, right: true },
});

describe("world room persistence (FakeClock)", () => {
  test("a moved player's position lands in D1 within one save beat", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("savebeat");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    const socket = fakeSocket(userId, heroId, "c-1");
    await engine.join(socket);
    const startX = welcomeSelf(socket, heroId)?.x ?? 0;

    await engine.message(socket.id, rightInput(1));
    clock.advanceTicks(D1_SAVE_EVERY_TICKS);

    await vi.waitFor(async () => {
      const row = await probe.heroes.findById(heroId);
      expect(row?.x).toBeGreaterThan(startX);
    });
    engine.dispose();
  });

  test("a stale epoch changes zero rows anywhere and closes the socket 4003", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("stalesave");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    const socket = fakeSocket(userId, heroId, "c-1");
    await engine.join(socket);

    const state = roomState(engine);
    const player = playerOf(state, heroId);
    player.inventory.consumables = {
      ...normalizeConsumables(player.inventory.consumables, player.inventory.potions),
      mana_potion: 7,
    };
    player.dirty = true;

    await engine.message(socket.id, rightInput(1));

    // A competing acquire (a second session for the SAME hero) bumps the D1 epoch out from under
    // the room's held `player.sessionEpoch`, exactly like a reconnect racing ahead of this room.
    // This itself is a legitimate D1 write (the epoch bump, `updatedAt`), so the "unchanged" baseline
    // is captured AFTER it, not before — the assertion below is about what THIS room's stale save
    // does on top of that, not about the competing acquire's own effect.
    await presenceRoom.room.call(heroId, "acquire", {
      connectionId: "c-elsewhere",
      roomKey: state.roomKey,
      zoneId: state.mapId,
      instanceId: "main",
    });
    const beforeRow = await probe.heroes.findById(heroId);

    clock.advanceTicks(D1_SAVE_EVERY_TICKS);

    // The stale-rejection close is the observable signal that the save attempt actually ran (and
    // was refused) rather than simply not having happened yet.
    await vi.waitFor(() => {
      expect(socket.closed?.code).toBe(WS_CLOSE.PRESENCE_LOST);
    });

    const afterRow = await probe.heroes.findById(heroId);
    expect(afterRow).toEqual(beforeRow);
    const item = await probe.heroItems.findOne({
      where: { heroId: { eq: heroId }, itemDefinitionId: { eq: "mana_potion" } },
    });
    expect(item).toBeUndefined();
    engine.dispose();
  });

  test("a disconnect saves immediately, without waiting for the periodic beat", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("disconnectsave");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    const socket = fakeSocket(userId, heroId, "c-1");
    await engine.join(socket);
    const startX = welcomeSelf(socket, heroId)?.x ?? 0;

    await engine.message(socket.id, rightInput(1));
    // One tick applies the movement; nowhere near the 100-tick save beat.
    clock.advance(TICK_MS);

    await engine.leave(socket.id);

    const row = await probe.heroes.findById(heroId);
    expect(row?.x).toBeGreaterThan(startX);
    engine.dispose();
  });

  test("a checkpointed combat cooldown survives disconnect+reconnect, in memory and in D1", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("cooldownsave");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    const socket = fakeSocket(userId, heroId, "c-1");
    await engine.join(socket);

    await engine.message(socket.id, { t: "attack" });

    await engine.leave(socket.id);

    const row = await probe.heroes.findById(heroId);
    const persistedCooldowns = JSON.parse(row?.combatCooldowns ?? "{}") as { attackUntil?: number };
    expect(persistedCooldowns.attackUntil ?? 0).toBeGreaterThan(Date.now());

    // Reconnect: `onLeave` tore the room down (last socket left), so this brings up a FRESH
    // WorldRoomState and re-runs admission from scratch — exactly the real reconnect path.
    const socket2 = fakeSocket(userId, heroId, "c-2");
    await engine.join(socket2);
    const self = welcomeSelfState(socket2);
    expect(self?.cooldowns?.attackUntil ?? 0).toBeGreaterThan(Date.now());
    engine.dispose();
  });

  test("a child-table mutation (consumable quantity) lands on the same save beat", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("childsave");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    const socket = fakeSocket(userId, heroId, "c-1");
    await engine.join(socket);

    // No in-game path exercises a consumable grant yet (Task 5's wired paths don't cover it) — a
    // direct state mutation plus the dirty flag is the sanctioned fallback (see the task brief).
    const state = roomState(engine);
    const player = playerOf(state, heroId);
    player.inventory.consumables = {
      ...normalizeConsumables(player.inventory.consumables, player.inventory.potions),
      mana_potion: 3,
    };
    player.dirty = true;

    clock.advanceTicks(D1_SAVE_EVERY_TICKS);

    await vi.waitFor(async () => {
      const item = await probe.heroItems.findOne({
        where: { heroId: { eq: heroId }, itemDefinitionId: { eq: "mana_potion" } },
      });
      expect(item?.quantity).toBe(3);
    });
    engine.dispose();
  });
});
