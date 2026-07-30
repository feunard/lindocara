/**
 * Deterministic world-room simulation: the REAL `WorldRoom` option bag (admission, movement,
 * snapshots — the exact object `$room` runs) hosted in a bare `RoomEngine` on a `FakeClock`, the
 * `RoomEngine.spec.ts` idiom, against real D1 rows created through the ordinary HTTP flow. Every
 * timing assertion advances virtual time; nothing sleeps for tick counts.
 *
 * Pinned here: one command per tick with `ack` echoing the applied seq, the
 * `MAX_STARVED_TICKS` repeat-then-stop rule, the every-2nd-tick snapshot cadence, the 35/s rate
 * window (close 1008) and the 2 KiB frame cap (close 1009).
 */

import type { PlayerSnapshot, ServerMessage } from "@lindocara/engine/protocol.js";
import type { Input } from "@lindocara/engine/simulation.js";
import { MAX_STARVED_TICKS, RATE_MAX_MESSAGES } from "@lindocara/server/world/world-runtime.js";
import { UserController } from "alepha/api/users";
import { ServerProvider } from "alepha/server";
import { type RoomClock, RoomEngine, type RoomSocket } from "alepha/websocket";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { WorldRoom } from "../src/api/realtime/WorldRoom.ts";
import { createTestApp } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";
const TICK_MS = 50;

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
    class: "priest",
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

function parsedMessages(socket: FakeSocket): ServerMessage[] {
  return socket.sent.map((raw) => JSON.parse(raw) as ServerMessage);
}

function lastSelfSnapshot(socket: FakeSocket, heroId: string): PlayerSnapshot | undefined {
  let last: PlayerSnapshot | undefined;
  for (const message of parsedMessages(socket)) {
    if (message.t === "welcome" || message.t === "world.resync") {
      const self = message.players.find((player) => player.id === heroId);
      if (self) last = self;
    }
    if (message.t === "world.delta") {
      const self = message.players.upsert.find((player) => player.id === heroId);
      if (self) last = self;
    }
  }
  return last;
}

function input(
  seq: number,
  partial: Partial<Input> = {},
): { t: "input"; seq: number; input: Input } {
  return {
    t: "input",
    seq,
    input: { up: false, down: false, left: false, right: true, ...partial },
  };
}

describe("world room movement (FakeClock)", () => {
  test("applies exactly one queued command per tick, acking the applied seq", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("onepertick");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    const socket = fakeSocket(userId, heroId);
    await engine.join(socket);
    const welcome = lastSelfSnapshot(socket, heroId);
    expect(welcome).toBeDefined();
    const startX = welcome?.x ?? 0;

    // Flood five commands before any tick runs. The tick rate, not the send rate, is the speed
    // limit: after two ticks exactly two commands are consumed, so the snapshot acks seq 2.
    for (let seq = 1; seq <= 5; seq += 1) {
      await engine.message(socket.id, input(seq));
    }
    clock.advance(TICK_MS);
    clock.advance(TICK_MS);
    const afterTwo = lastSelfSnapshot(socket, heroId);
    expect(afterTwo?.ack).toBe(2);
    expect(afterTwo?.x ?? 0).toBeGreaterThan(startX);

    // Two more ticks consume two more; the queue (5 commands) drains at tick 5, never earlier.
    clock.advance(TICK_MS);
    clock.advance(TICK_MS);
    expect(lastSelfSnapshot(socket, heroId)?.ack).toBe(4);
    clock.advance(TICK_MS);
    clock.advance(TICK_MS);
    expect(lastSelfSnapshot(socket, heroId)?.ack).toBe(5);
    engine.dispose();
  });

  test("a replayed or out-of-order seq is dropped", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("replayseq");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    const socket = fakeSocket(userId, heroId);
    await engine.join(socket);

    await engine.message(socket.id, input(3));
    await engine.message(socket.id, input(3));
    await engine.message(socket.id, input(2));
    clock.advance(TICK_MS);
    clock.advance(TICK_MS);
    // Only the first seq-3 command entered the queue; both stale frames were dropped.
    expect(lastSelfSnapshot(socket, heroId)?.ack).toBe(3);
    engine.dispose();
  });

  test("a starved player repeats the last intent for MAX_STARVED_TICKS, then stops", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("starved");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    const socket = fakeSocket(userId, heroId);
    await engine.join(socket);

    await engine.message(socket.id, input(1));
    // Tick 1 applies the command; ticks 2..(1+MAX_STARVED_TICKS) repeat its intent.
    const movingTicks = 1 + MAX_STARVED_TICKS;
    const positions: number[] = [];
    for (let tick = 1; tick <= movingTicks; tick += 1) {
      clock.advance(TICK_MS);
      if (tick % 2 === 0) {
        positions.push(lastSelfSnapshot(socket, heroId)?.x ?? Number.NaN);
      }
    }
    // Strictly increasing x across the starved window: the square keeps sprinting.
    for (let index = 1; index < positions.length; index += 1) {
      const previous = positions[index - 1] ?? Number.NaN;
      const current = positions[index] ?? Number.NaN;
      expect(current).toBeGreaterThan(previous);
    }

    // Past the starvation budget the intent resets to NO_INPUT: the position freezes.
    clock.advance(TICK_MS);
    clock.advance(TICK_MS);
    const stoppedAt = lastSelfSnapshot(socket, heroId)?.x;
    clock.advance(TICK_MS);
    clock.advance(TICK_MS);
    clock.advance(TICK_MS);
    clock.advance(TICK_MS);
    expect(lastSelfSnapshot(socket, heroId)?.x).toBe(stoppedAt);
    engine.dispose();
  });

  test("world.delta is emitted every 2nd tick", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("cadence");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    const socket = fakeSocket(userId, heroId);
    await engine.join(socket);

    const deltasBefore = parsedMessages(socket).filter((m) => m.t === "world.delta").length;
    for (let tick = 1; tick <= 8; tick += 1) clock.advance(TICK_MS);
    const deltas = parsedMessages(socket).filter((m) => m.t === "world.delta").length;
    expect(deltas - deltasBefore).toBe(4);

    const ticks = parsedMessages(socket)
      .filter((m): m is Extract<ServerMessage, { t: "world.delta" }> => m.t === "world.delta")
      .map((m) => m.tick);
    for (const tick of ticks) expect(tick % 2).toBe(0);
    engine.dispose();
  });

  test("exceeding the 35 msg/s window closes 1008", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("ratelimit");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    const socket = fakeSocket(userId, heroId);
    await engine.join(socket);

    for (let seq = 1; seq <= RATE_MAX_MESSAGES + 1; seq += 1) {
      await engine.message(socket.id, input(seq));
    }
    expect(socket.closed?.code).toBe(1008);
    engine.dispose();
  });

  test("an oversized frame closes 1009", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("oversize");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    const socket = fakeSocket(userId, heroId);
    await engine.join(socket);

    await engine.message(socket.id, { t: "junk", pad: "x".repeat(2_500) });
    expect(socket.closed?.code).toBe(1009);
    engine.dispose();
  });
});
