/**
 * `WorldRoom` admission over a REAL server: register+login over HTTP, create adventure/party/hero
 * through the ordinary flow, `GET /api/join` for the roomId hint, then open a raw `ws` WebSocket
 * against `/ws/world` (Bearer token on the upgrade — the same `resolveUserId` path the browser's
 * session cookie takes) and assert the legacy admission outcomes: a `welcome` carrying self + the
 * baked world geometry, `INVALID_LOCATION` (4007) for a roomId naming a map the hero is not on,
 * `SESSION_EXPIRED` (4004) for an unauthenticated socket, and `CHARACTER_REPLACED` (4001) for the
 * first socket when the same hero joins the same room twice.
 */

import type { ServerMessage } from "@lindocara/engine/protocol.js";
import { UserController } from "alepha/api/users";
import { ServerProvider } from "alepha/server";
import { type RoomClock, RoomEngine, type RoomSocket } from "alepha/websocket";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { WorldRoom } from "../src/api/realtime/WorldRoom.ts";
import { createTestApp } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";

let alepha: ReturnType<typeof createTestApp>;
let hostname: string;
let userCount = 0;
let openSockets: WebSocket[];

class FakeClock implements RoomClock {
  setInterval(): unknown {
    return 1;
  }

  clearInterval(): void {}

  now(): number {
    return 0;
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
    sendRaw: (data: string) => sent.push(data),
    close: (code?: number, reason?: string) => {
      socket.closed = { code, reason };
    },
  };
  return socket;
}

function messagesOf(socket: FakeSocket): ServerMessage[] {
  return socket.sent.map((raw) => JSON.parse(raw) as ServerMessage);
}

function createEngine(roomId: string) {
  const worldRoom = alepha.inject(WorldRoom);
  return new RoomEngine({
    roomId,
    clock: new FakeClock(),
    options: worldRoom.roomOptions,
    validate: () => {},
  });
}

beforeEach(async () => {
  alepha = createTestApp();
  openSockets = [];
  await alepha.start();
  hostname = alepha.inject(ServerProvider).hostname;
});

afterEach(async () => {
  for (const socket of openSockets) {
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  }
  await alepha.stop();
});

async function registerAndLogin(
  prefix: string,
): Promise<{ token: string; cookie: string; userId: string }> {
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
  // The browser's credential for the very same session: the encrypted `tokens` cookie the login
  // response sets. Joined into a `Cookie` request header for the cookie-auth admission test.
  const cookie = login.headers
    .getSetCookie()
    .map((header) => header.split(";", 1)[0])
    .join("; ");
  const tokens = (await login.json()) as { access_token: string };
  const whoami = await fetch(`${hostname}/api/whoami`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const user = (await whoami.json()) as { id: string };
  return { token: tokens.access_token, cookie, userId: user.id };
}

function authedFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${hostname}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

interface Playable {
  token: string;
  cookie: string;
  userId: string;
  adventureId: string;
  mapId: string;
  partyId: string;
  heroId: string;
}

/** One fresh account with an adventure, a party on it and one hero, end-to-end over HTTP. */
async function newPlayableHero(prefix: string): Promise<Playable> {
  const { token, cookie, userId } = await registerAndLogin(prefix);
  const adventureResponse = await authedFetch("/api/adventures", token, {
    method: "POST",
    body: JSON.stringify({ title: "Donjon", maxPlayers: 4 }),
  });
  expect(adventureResponse.status).toBe(201);
  const adventure = (await adventureResponse.json()) as { id: string; defaultMap: { id: string } };
  const partyResponse = await authedFetch("/api/parties", token, {
    method: "POST",
    body: JSON.stringify({ adventureId: adventure.id }),
  });
  expect(partyResponse.status).toBe(201);
  const partyId = ((await partyResponse.json()) as { id: string }).id;
  const heroResponse = await authedFetch(`/api/parties/${partyId}/heroes`, token, {
    method: "POST",
    body: JSON.stringify({ name: "Mira", class: "priest" }),
  });
  expect(heroResponse.status).toBe(201);
  const heroId = ((await heroResponse.json()) as { id: string }).id;
  return {
    token,
    cookie,
    userId,
    adventureId: adventure.id,
    mapId: adventure.defaultMap.id,
    partyId,
    heroId,
  };
}

interface SocketProbe {
  socket: WebSocket;
  messages: ServerMessage[];
  /** Resolves with the first message whose `t` matches. */
  waitFor(type: ServerMessage["t"], timeoutMs?: number): Promise<ServerMessage>;
  /** Resolves with the close code once the server closes the socket. */
  closed: Promise<number>;
}

function openWorldSocket(
  roomId: string,
  heroId: string | null,
  token: string | null,
  headers?: Record<string, string>,
): SocketProbe {
  const wsHost = hostname.replace(/^http/, "ws");
  const heroQuery = heroId === null ? "" : `&hero=${heroId}`;
  const socket = new WebSocket(`${wsHost}/ws/world?roomId=${roomId}${heroQuery}`, {
    headers: headers ?? (token === null ? {} : { authorization: `Bearer ${token}` }),
  });
  openSockets.push(socket);
  const messages: ServerMessage[] = [];
  const waiters: { type: string; resolve: (message: ServerMessage) => void }[] = [];
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter && waiter.type === message.t) {
        waiters.splice(index, 1);
        waiter.resolve(message);
      }
    }
  });
  const closed = new Promise<number>((resolve) => {
    socket.on("close", (code) => resolve(code));
  });
  return {
    socket,
    messages,
    closed,
    waitFor: (type, timeoutMs = 5_000) =>
      new Promise<ServerMessage>((resolve, reject) => {
        const existing = messages.find((message) => message.t === type);
        if (existing) return resolve(existing);
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                `timed out waiting for '${type}' (saw: ${messages.map((m) => m.t).join(", ") || "nothing"})`,
              ),
            ),
          timeoutMs,
        );
        waiters.push({
          type,
          resolve: (message) => {
            clearTimeout(timer);
            resolve(message);
          },
        });
      }),
  };
}

describe("GET /api/join", () => {
  test("returns the partyId:mapId roomId and the world channel path", async () => {
    const { token, partyId, mapId, heroId } = await newPlayableHero("joinok");
    const response = await authedFetch(`/api/join?party=${partyId}&hero=${heroId}`, token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      roomId: `${partyId}:${mapId}`,
      channelPath: "/ws/world",
    });
  });

  test("maps the legacy error codes: missing_hero, invalid_hero, forbidden", async () => {
    const { token, partyId, heroId } = await newPlayableHero("joinerr");

    const missing = await authedFetch("/api/join", token);
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toBe("missing_hero");

    const invalid = await authedFetch(`/api/join?party=${partyId}&hero=not-a-uuid`, token);
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: string }).error).toBe("invalid_hero");

    // A second account is not a member of the first account's party.
    const outsider = await registerAndLogin("joinout");
    const forbidden = await authedFetch(
      `/api/join?party=${partyId}&hero=${heroId}`,
      outsider.token,
    );
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as { error: string }).error).toBe("forbidden");
  });
});

describe("world room admission", () => {
  test("a valid WebSocket join receives the authoritative welcome", async () => {
    const { token, partyId, mapId, heroId } = await newPlayableHero("admit");
    const probe = openWorldSocket(`${partyId}:${mapId}`, heroId, token);

    const welcome = await probe.waitFor("welcome");
    if (welcome.t !== "welcome") throw new Error("unreachable");
    expect(welcome.selfId).toBe(heroId);
    expect(welcome.world.zoneId).toBe(mapId);
    // Baked collision truth travels in the welcome: the tile grid rows and the authored layers.
    expect(welcome.world.tiles.length).toBeGreaterThan(0);
    expect(welcome.world.layers.length).toBe(3);
    expect(welcome.players.some((player) => player.id === heroId)).toBe(true);
    expect(welcome.self.cooldowns).toBeDefined();
  });

  test("a completed admission emits exactly welcome and no narrative event", async () => {
    const { userId, partyId, mapId, heroId } = await newPlayableHero("adcycle");
    const engine = createEngine(`${partyId}:${mapId}`);
    const socket = fakeSocket(userId, heroId);

    await engine.join(socket);
    const messages = messagesOf(socket);
    const welcome = messages.find((message) => message.t === "welcome");
    if (welcome?.t !== "welcome") throw new Error("missing welcome");

    expect(welcome.selfId).toBe(heroId);
    expect(messages.map((message) => message.t)).toEqual(["welcome"]);
    engine.dispose();
  });

  test("a roomId naming a map the hero is not on closes 4007", async () => {
    const { token, adventureId, partyId, heroId } = await newPlayableHero("wrongmap");
    const created = await authedFetch("/api/maps", token, {
      method: "POST",
      body: JSON.stringify({ adventureId, name: "Annexe" }),
    });
    expect(created.status).toBe(201);
    const otherMapId = ((await created.json()) as { id: string }).id;

    const probe = openWorldSocket(`${partyId}:${otherMapId}`, heroId, token);
    await expect(probe.closed).resolves.toBe(4007);
  });

  test("a browser-style socket authenticated by the session cookie alone is admitted", async () => {
    // Browsers cannot attach an Authorization header to a WebSocket handshake — the encrypted
    // `tokens` cookie set by `/_auth/token` is their only credential. This is the exact path the
    // real client takes and is served by the vendored `resolveUserId` cookie fallback
    // (WebSocketServerProvider → ServerAuthProvider.accessTokenFromCookieHeader); without it every
    // browser session closed 4004 while bearer-authenticated sockets (the other tests) passed.
    const { cookie, partyId, mapId, heroId } = await newPlayableHero("cookieauth");
    const probe = openWorldSocket(`${partyId}:${mapId}`, heroId, null, { cookie });
    const welcome = await probe.waitFor("welcome");
    if (welcome.t !== "welcome") throw new Error("unreachable");
    expect(welcome.selfId).toBe(heroId);
  });

  test("an unauthenticated socket closes 4004", async () => {
    const { partyId, mapId, heroId } = await newPlayableHero("noauth");
    const probe = openWorldSocket(`${partyId}:${mapId}`, heroId, null);
    await expect(probe.closed).resolves.toBe(4004);
  });

  test("a second join of the same hero replaces the first socket (4001)", async () => {
    const { token, partyId, mapId, heroId } = await newPlayableHero("replace");
    const roomId = `${partyId}:${mapId}`;

    const first = openWorldSocket(roomId, heroId, token);
    await first.waitFor("welcome");

    const second = openWorldSocket(roomId, heroId, token);
    await second.waitFor("welcome");

    await expect(first.closed).resolves.toBe(4001);
  });
});
