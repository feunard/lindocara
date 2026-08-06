/**
 * A server-authored displacement survives the client frames that were already in flight when it
 * happened.
 *
 * Since S3 moved movement to the client, the room stores the position its client REPORTS. A
 * displacement the SERVER decides — a ghost release, a Pas de Lumen landing, an authored teleport —
 * therefore races the report stream: for one round trip the client is still computing positions from
 * where it used to be, and a room that stored those unconditionally would let the last stale frame
 * undo the displacement, silently and with nothing anywhere saying so.
 *
 * The same `RoomEngine` + `FakeClock` harness as `world-room-movement.test.ts`: the real `WorldRoom`
 * option bag against real database rows, with virtual time.
 */

import {
  type DisplacementStamp,
  type PlayerSnapshot,
  parseServerMessage,
} from "@lindocara/engine/protocol.js";
import { UserController } from "alepha/api/users";
import { ServerProvider } from "alepha/server";
import { type RoomClock, RoomEngine, type RoomSocket } from "alepha/websocket";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { WorldRoom } from "../src/api/realtime/WorldRoom.ts";
import type { WorldRoomState } from "../src/api/realtime/worldState.ts";
import { MapService } from "../src/api/services/MapService.ts";
import { displacePlayer } from "../src/world/world-runtime.ts";
import { createTestApp, provingHeightfield } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";
const TICK_MS = 50;

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
  await alepha.inject(MapService).saveHeightfield(adventure.defaultMap.id, provingHeightfield());
  return { userId, roomId: `${partyId}:${adventure.defaultMap.id}`, heroId };
}

function createEngine(roomId: string, clock: FakeClock) {
  const worldRoom = alepha.inject(WorldRoom);
  return new RoomEngine({
    roomId,
    clock,
    options: worldRoom.roomOptions,
    validate: () => {},
  });
}

function lastSelfSnapshot(socket: FakeSocket, heroId: string): PlayerSnapshot | undefined {
  let last: PlayerSnapshot | undefined;
  for (const raw of socket.sent) {
    const message = parseServerMessage(raw);
    if (message === null) throw new Error("the wire refused a frame");
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

/** A well-formed `move` frame, echoing the displacement stamp the client claims to have adopted. */
function move(x: number, y: number, z: number, displacement: number) {
  return {
    t: "move" as const,
    x,
    y,
    z,
    facing: { x: 1, z: 0 },
    airborne: false,
    swimming: false,
    gliding: false,
    displacement,
  };
}

/** The newest `SelfState.displacement` this socket has been sent — what a real client would be
 *  echoing by now. */
function currentStamp(socket: FakeSocket): DisplacementStamp {
  let last: DisplacementStamp | undefined;
  for (const raw of socket.sent) {
    const message = parseServerMessage(raw);
    if (message === null) throw new Error("the wire refused a frame");
    if (message.t === "welcome" || message.t === "state") last = message.self.displacement;
  }
  if (!last) throw new Error("no self state was ever sent");
  return last;
}

/**
 * Drives one hero to the corpse state and then releases it, which is the cheapest server-authored
 * displacement the real app has: two client messages, no class, no cooldown, no monster, no talent.
 * Returns where the hero was, where the room put it, and the stamp that says so.
 */
async function releaseGhost(
  engine: ReturnType<typeof createEngine>,
  socket: FakeSocket,
  heroId: string,
) {
  const start = lastSelfSnapshot(socket, heroId);
  expect(start?.life).toBe("alive");
  const spawn = { x: start?.x ?? 0, y: start?.y ?? 0, z: start?.z ?? 0 };

  // Drown where the room seated us: the corpse stays where the hero went under.
  await engine.message(socket.id, {
    ...move(spawn.x, spawn.y, spawn.z, currentStamp(socket).seq),
    swimming: true,
  });
  await engine.message(socket.id, { t: "drowned" });
  clock().advance(TICK_MS);
  clock().advance(TICK_MS);
  expect(lastSelfSnapshot(socket, heroId)?.life).toBe("corpse");

  // Releasing is a SERVER-authored displacement: the ghost materialises at the map's spirit anchor,
  // far enough from the body that it does not reclaim it on the very next tick.
  await engine.message(socket.id, { t: "release" });
  clock().advance(TICK_MS);
  clock().advance(TICK_MS);
  const released = lastSelfSnapshot(socket, heroId);
  expect(released?.life).toBe("ghost");
  const landing = { x: released?.x ?? 0, y: released?.y ?? 0, z: released?.z ?? 0 };
  expect(Math.hypot(landing.x - spawn.x, landing.z - spawn.z)).toBeGreaterThan(0);
  return { spawn, landing, stamp: currentStamp(socket) };
}

/** The clock the current test installed — set by each test before it calls the helper above. */
let activeClock: FakeClock | null = null;
function clock(): FakeClock {
  if (!activeClock) throw new Error("no clock installed");
  return activeClock;
}

describe("server displacement vs. in-flight client reports", () => {
  test("a ghost release is not undone by a move frame that predates it", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("release");
    activeClock = new FakeClock();
    const engine = createEngine(roomId, activeClock);
    const socket = fakeSocket(userId, heroId);
    await engine.join(socket);
    const { spawn, landing, stamp } = await releaseGhost(engine, socket, heroId);

    // The frame that was already on its way when the room decided: computed from where the hero used
    // to be, and stamped with the displacement count from before the release.
    await engine.message(socket.id, move(spawn.x, spawn.y, spawn.z, stamp.seq - 1));
    activeClock.advance(TICK_MS);
    activeClock.advance(TICK_MS);

    const after = lastSelfSnapshot(socket, heroId);
    expect(after?.x).toBeCloseTo(landing.x, 6);
    expect(after?.z).toBeCloseTo(landing.z, 6);
    // Dropped, not fatal: a stale frame goes the way every other invalid one goes.
    expect(socket.closed).toBeUndefined();
    engine.dispose();
  });

  test("the room tells the hero where it put it, and moving resumes from there", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("resume");
    activeClock = new FakeClock();
    const engine = createEngine(roomId, activeClock);
    const socket = fakeSocket(userId, heroId);
    await engine.join(socket);
    const { landing, stamp } = await releaseGhost(engine, socket, heroId);

    // The stamp carries the landing itself, not just a number: that pairing is what lets a client
    // adopt the position and raise its echo in one step, with no window in between where it could
    // report an old position under a new stamp.
    expect(stamp.seq).toBeGreaterThan(0);
    expect(stamp.x).toBeCloseTo(landing.x, 6);
    expect(stamp.y).toBeCloseTo(landing.y, 6);
    expect(stamp.z).toBeCloseTo(landing.z, 6);

    // Having adopted it, the ghost moves again — the drop is per-frame staleness, never a lock.
    await engine.message(socket.id, move(landing.x + 1, landing.y, landing.z, stamp.seq));
    activeClock.advance(TICK_MS);
    activeClock.advance(TICK_MS);
    expect(lastSelfSnapshot(socket, heroId)?.x).toBeCloseTo(landing.x + 1, 2);
    engine.dispose();
  });

  test("a displacement that announced nothing of its own is announced by the tick, before the snapshot", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("announce");
    activeClock = new FakeClock();
    const engine = createEngine(roomId, activeClock);
    const socket = fakeSocket(userId, heroId);
    await engine.join(socket);
    const state = (engine as unknown as { state: WorldRoomState }).state;
    const connectionId = state.connectionIdByHeroId.get(heroId);
    if (connectionId === undefined) throw new Error("hero has no connection");
    const player = state.players.get(connectionId);
    if (!player) throw new Error("hero has no runtime");
    const before = currentStamp(socket).seq;
    const sentBefore = socket.sent.length;

    // `displacePlayer` is the one helper every server-authored write goes through, and several of
    // its callers send no state frame of their own — a ranger's swap, a shadow dance, an authored
    // teleport. Called bare, it stands for all of them: nothing here announces anything.
    displacePlayer(player, { x: 3, y: player.y, z: -2 });
    activeClock.advance(TICK_MS);
    activeClock.advance(TICK_MS);

    // The tick owes the announcement, and owes it BEFORE the snapshot: a client that met the
    // displaced position first would have adopted it with no stamp to echo, and every frame it sent
    // afterwards would have been dropped.
    const frames = socket.sent.slice(sentBefore).map((raw) => {
      const message = parseServerMessage(raw);
      if (message === null) throw new Error("the wire refused a frame");
      return message;
    });
    const announced = frames.findIndex(
      (message) => message.t === "state" && message.self.displacement.seq > before,
    );
    const relayed = frames.findIndex(
      (message) =>
        message.t === "world.delta" &&
        message.players.upsert.some((entry) => entry.id === heroId && entry.x === 3),
    );
    expect(announced).toBeGreaterThanOrEqual(0);
    expect(relayed).toBeGreaterThanOrEqual(0);
    expect(announced).toBeLessThan(relayed);
    engine.dispose();
  });

  test("a stamp the room never issued is refused, exactly like a stale one", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("forged");
    activeClock = new FakeClock();
    const engine = createEngine(roomId, activeClock);
    const socket = fakeSocket(userId, heroId);
    await engine.join(socket);
    const start = lastSelfSnapshot(socket, heroId);
    const spawn = { x: start?.x ?? 0, y: start?.y ?? 0, z: start?.z ?? 0 };
    const stamp = currentStamp(socket);

    // Echoing ahead of the room buys nothing: the check is equality with a counter only the room
    // raises, so a forged stamp matches nothing and the frame is dropped like any other.
    await engine.message(socket.id, move(spawn.x + 3, spawn.y, spawn.z, stamp.seq + 7));
    activeClock.advance(TICK_MS);
    activeClock.advance(TICK_MS);

    const after = lastSelfSnapshot(socket, heroId);
    expect(after?.x).toBeCloseTo(spawn.x, 6);
    expect(after?.z).toBeCloseTo(spawn.z, 6);
    expect(socket.closed).toBeUndefined();
    engine.dispose();
  });
});
