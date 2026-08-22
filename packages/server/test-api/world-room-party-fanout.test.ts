/**
 * The party-wide fan-out safety property: a `WorldRoom`'s `broadcastToAdmitted` room method —
 * what `PartyRoom.sendToRoom` now calls instead of the generic `room.broadcast()` — must reach
 * only players `handleJoin` has actually admitted into `state.players`, never a socket the raw
 * `RoomEngine.sockets` registry still holds because `RoomEngine.join()` adds a socket to it
 * BEFORE `onJoin` (admission) resolves, and nothing removes it again until the socket's own
 * transport-level close event fires `leave()` — a real window even for a socket `onJoin` goes on
 * to REFUSE.
 *
 * Regression coverage for the bug where `WorldRoom`'s `wirePartySeams` routed party chat/victory
 * through `this.room.broadcast(roomKey, message)`, which fans out to that same raw registry and
 * so could deliver party-wide messages to a socket the app never decided to admit.
 *
 * Uses the `RoomEngine.spec`/FakeClock idiom (`world-room-movement.test.ts`): the REAL `WorldRoom`
 * option bag hosted in a bare engine, against real D1 rows created through the ordinary HTTP flow.
 * The deterministic repro for "a socket the engine still holds but `handleJoin` refused" is a
 * second hero, belonging to a wholly different account and party, addressed at the FIRST party's
 * room — `AdmissionService.resolveAdmission` refuses it (`forbidden`, since it is not a member of
 * that party), `handleJoin` closes it, but the bare `RoomSocket` mock's `close()` — exactly like
 * the real transport's asynchronous close event — does not itself remove the socket from
 * `RoomEngine.sockets`.
 */

import type { ServerMessage } from "@lindocara/engine/protocol.js";
import { UserController } from "alepha/api/users";
import { ServerProvider } from "alepha/server";
import { type RoomClock, RoomEngine, type RoomSocket } from "alepha/websocket";
import { afterEach, beforeEach, expect, test } from "vitest";

import { WorldRoom } from "../src/api/realtime/WorldRoom.ts";
import { MapService } from "../src/api/services/MapService.ts";
import { createTestApp, provingHeightfield } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";

/** The RoomEngine.spec FakeClock: intervals fire once per `advance` of their period. Unused here
 *  (no tick-dependent assertion), kept only because `RoomEngine`'s constructor requires a clock. */
class FakeClock implements RoomClock {
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
    return 0;
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

function messagesOf(socket: FakeSocket): ServerMessage[] {
  return socket.sent.map((raw) => JSON.parse(raw) as ServerMessage);
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

/**
 * One fresh account, one fresh adventure/party/hero, end-to-end over HTTP.
 *
 * The heightfield is what makes the room joinable at all: `POST /api/adventures` seeds a tile map
 * and no heightfield, and a map without one produces no zone (`zoneFromMapPayload` throws,
 * `createState` keeps `location: null`), so even the LEGITIMATE socket below would be refused and
 * the test would compare two refusals instead of an admission against a refusal.
 */
async function newPlayableHero(prefix: string): Promise<{
  userId: string;
  roomId: string;
  heroId: string;
}> {
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

/** Hosts the real WorldRoom options in a bare engine driven by the fake clock — the exact object
 *  `$room` runs in production. */
function createEngine(roomId: string, clock: FakeClock) {
  const worldRoom = alepha.inject(WorldRoom);
  return new RoomEngine({
    roomId,
    clock,
    options: worldRoom.roomOptions,
    validate: () => {},
  });
}

test("broadcastToAdmitted reaches the admitted player but not a socket the room refused to admit", async () => {
  const host = await newPlayableHero("fanouthost");
  // A wholly different account/party/hero — connecting it at the HOST's room is refused
  // ("forbidden": it is not a member of that party), exactly like the real admission check would
  // refuse any socket that never becomes an admitted player.
  const outsider = await newPlayableHero("fanoutoutsider");

  const clock = new FakeClock();
  const engine = createEngine(host.roomId, clock);

  const admitted = fakeSocket(host.userId, host.heroId, "c-admitted");
  await engine.join(admitted);
  expect(messagesOf(admitted).some((message) => message.t === "welcome")).toBe(true);

  const refused = fakeSocket(outsider.userId, outsider.heroId, "c-refused");
  await engine.join(refused);
  // Refused, not welcomed — but still present in the engine's raw socket registry: the bare
  // `RoomSocket.close()` mock (like the real transport's asynchronous close event) does not
  // itself unregister the socket. That gap is exactly what the buggy `room.broadcast()` call
  // used to leak party-wide messages through.
  expect(refused.closed).toBeDefined();
  expect(messagesOf(refused).some((message) => message.t === "welcome")).toBe(false);

  const partyMessage: ServerMessage = {
    t: "chat",
    channel: "party",
    from: "Warband",
    text: "à l'attaque !",
  };
  await engine.call("broadcastToAdmitted", [partyMessage]);

  expect(messagesOf(admitted)).toContainEqual(partyMessage);
  expect(messagesOf(refused)).not.toContainEqual(partyMessage);

  engine.dispose();
});
