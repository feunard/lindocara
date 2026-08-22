/**
 * Deterministic world-room simulation: the REAL `WorldRoom` option bag (admission, movement,
 * snapshots — the exact object `$room` runs) hosted in a bare `RoomEngine` on a `FakeClock`, the
 * `RoomEngine.spec.ts` idiom, against real D1 rows created through the ordinary HTTP flow. Every
 * timing assertion advances virtual time; nothing sleeps for tick counts.
 *
 * Pinned here: the room stores and relays the position its client REPORTS (`{t:"move"}`) rather
 * than computing one — the one fact a client supplies (S3 spec, decision 4) —, the room's own
 * bounds check on that position, the every-2nd-tick snapshot cadence, the 35/s rate window
 * (close 1008) and the 2 KiB frame cap (close 1009).
 *
 * The retired model's assertions went with it: one command per tick, `ack` echoing the applied seq,
 * the replayed-seq drop and the `MAX_STARVED_TICKS` repeat-then-stop rule. There is no queue, no
 * sequence and nothing to acknowledge; `packages/client/test/hero-controller.test.ts` is where the
 * movement itself is proven now.
 */

import {
  type PlayerSnapshot,
  parseServerMessage,
  type ServerMessage,
} from "@lindocara/engine/protocol.js";
import { RATE_MAX_MESSAGES } from "@lindocara/server/world/world-runtime.js";
import { UserController } from "alepha/api/users";
import { ServerProvider } from "alepha/server";
import { type RoomClock, RoomEngine, type RoomSocket } from "alepha/websocket";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { WorldRoom } from "../src/api/realtime/WorldRoom.ts";
import { MapService } from "../src/api/services/MapService.ts";
import { createTestApp, provingHeightfield } from "./helpers.ts";

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

/**
 * The heightfield is what makes the room joinable: `POST /api/adventures` seeds a tile map and no
 * heightfield, and a map without one produces no zone at all, so every join closes 4007 and the
 * simulation this file measures never runs. It is flat and fully walkable, so nothing about the
 * terrain can stop the square this suite keeps pushing east.
 */
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
  await alepha.inject(MapService).saveHeightfield(adventure.defaultMap.id, provingHeightfield());
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

/** Every frame through `parseServerMessage`, the single wire truth — never a bare `JSON.parse`. A
 *  frame it refuses is a frame the real client drops, so counting it as delivered here would hide
 *  exactly the kind of unjoinable room this harness exists to catch. */
function parsedMessages(socket: FakeSocket): ServerMessage[] {
  return socket.sent.map((raw) => {
    const message = parseServerMessage(raw);
    if (message === null) {
      throw new Error(
        `the wire refused a '${String((JSON.parse(raw) as { t?: unknown }).t)}' frame`,
      );
    }
    return message;
  });
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

/** A well-formed `move` frame. `facing` is unit-length on purpose: `isDirection` refuses anything
 *  else and the whole frame is dropped silently, which is exactly the trap a client must not fall
 *  into. */
function move(x: number, y: number, z: number, vy = 0) {
  return {
    t: "move" as const,
    x,
    y,
    z,
    vy,
    facing: { x: 1, z: 0 },
    airborne: false,
    swimming: false,
    gliding: false,
    // The stamp of a hero the room has never displaced. `world-room-displacement.test.ts` owns the
    // staleness rule; every frame here is current, so none of these assertions rides on it.
    displacement: 0,
  };
}

describe("world room movement (FakeClock)", () => {
  test("stores the position the client reports, and relays it", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("reported");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    const socket = fakeSocket(userId, heroId);
    await engine.join(socket);
    const welcome = lastSelfSnapshot(socket, heroId);
    expect(welcome).toBeDefined();
    const start = { x: welcome?.x ?? 0, y: welcome?.y ?? 0, z: welcome?.z ?? 0 };

    // Two tiles east and one south of where the room seated the hero — a jump's worth of elevation
    // with it, so all three axes have to survive the trip.
    await engine.message(socket.id, {
      ...move(start.x + 2, start.y + 1.35, start.z + 1, 2.25),
      airborne: true,
    });
    clock.advance(TICK_MS);
    clock.advance(TICK_MS);

    const relayed = lastSelfSnapshot(socket, heroId);
    expect(relayed?.x).toBeCloseTo(start.x + 2, 2);
    expect(relayed?.y).toBeCloseTo(start.y + 1.35, 2);
    expect(relayed?.z).toBeCloseTo(start.z + 1, 2);
    expect(relayed?.vy).toBeCloseTo(2.25, 2);
    // The locomotion flags are relayed too: nothing downstream can re-derive a jump from a
    // position stream, and a remote renderer needs them to draw one.
    expect(relayed?.airborne).toBe(true);
    expect(relayed?.swimming).toBe(false);
    expect(relayed?.gliding).toBe(false);
    engine.dispose();
  });

  test("the room refuses a reported position that describes no point on its own map", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("offmap");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    const socket = fakeSocket(userId, heroId);
    await engine.join(socket);
    const start = lastSelfSnapshot(socket, heroId);
    expect(start).toBeDefined();

    // Well inside the wire's own ±128-tile bound, so `parseClientMessage` hands it over: only the
    // room knows how big its grid is, and it is the room that must refuse this.
    await engine.message(socket.id, move(120, 0, 120));
    clock.advance(TICK_MS);
    clock.advance(TICK_MS);

    const after = lastSelfSnapshot(socket, heroId);
    expect(after?.x).toBeCloseTo(start?.x ?? Number.NaN, 6);
    expect(after?.z).toBeCloseTo(start?.z ?? Number.NaN, 6);
    // Refused, not fatal: a frame that could describe no map is dropped like any malformed one.
    expect(socket.closed).toBeUndefined();
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

    // The cap the client's send cadence exists to stay under: a controller reporting once per
    // animation frame (60 Hz) trips this window and has its socket closed, which is why `net.ts`
    // throttles its `move` frames to the 20 Hz the retired command rate already ran at.
    const start = lastSelfSnapshot(socket, heroId);
    for (let frame = 1; frame <= RATE_MAX_MESSAGES + 1; frame += 1) {
      await engine.message(
        socket.id,
        move((start?.x ?? 0) + frame / 100, start?.y ?? 0, start?.z ?? 0),
      );
    }
    expect(socket.closed?.code).toBe(1008);
    engine.dispose();
  });

  test("drowning is decided by the room, and only for a hero the position stream has in water", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("drowned");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    const socket = fakeSocket(userId, heroId);
    await engine.join(socket);
    const start = lastSelfSnapshot(socket, heroId);
    expect(start?.life).toBe("alive");

    // On dry land the claim contradicts the position stream that carried it, and is dropped.
    await engine.message(socket.id, { t: "drowned" });
    clock.advance(TICK_MS);
    clock.advance(TICK_MS);
    expect(lastSelfSnapshot(socket, heroId)?.life).toBe("alive");

    // In the water it is answered — by the room, with the death state machine, leaving the body
    // where the hero went under. The client teleports nobody: it only reported the event.
    await engine.message(socket.id, {
      ...move(start?.x ?? 0, start?.y ?? 0, start?.z ?? 0),
      swimming: true,
    });
    await engine.message(socket.id, { t: "drowned" });
    clock.advance(TICK_MS);
    clock.advance(TICK_MS);

    const drowned = lastSelfSnapshot(socket, heroId);
    expect(drowned?.life).toBe("corpse");
    expect(drowned?.x).toBeCloseTo(start?.x ?? Number.NaN, 6);
    expect(drowned?.z).toBeCloseTo(start?.z ?? Number.NaN, 6);
    for (let tick = 0; tick < 20; tick += 1) clock.advance(TICK_MS);
    expect(lastSelfSnapshot(socket, heroId)?.life).toBe("corpse");
    expect(socket.closed).toBeUndefined();
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
