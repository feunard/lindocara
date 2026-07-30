/**
 * The transport-level WebSocket frame cap: `websocketTransportCap.ts`'s
 * `WebSocketTransportCapProvider` reads `WEBSOCKET_MAX_PAYLOAD` through `$env` on its
 * `"configure"` hook and writes it into the vendor-patched `websocketOptions` atom
 * (`.vendor/alepha/src/websocket/providers/NodeWebSocketServerProvider.ts`), raising `maxPayload`
 * to this app's 16 KiB default (`DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES`) and threading it into
 * `new WebSocketServer({ maxPayload })`. That is the PRE-PARSE backstop ahead of the app-level
 * 2048-byte `MAX_FRAME_BYTES` cap `WorldRoom.handleMessage` enforces AFTER Alepha's room
 * transport has already `JSON.parse`d the frame — without a transport-level ceiling, `ws`'s own
 * default (~100 MiB) would let a hostile client force the server to `JSON.parse` a payload nearly
 * six orders of magnitude past anything legitimate before the app-level cap ever ran.
 *
 * This proves the transport itself, not app code, refuses the oversized frame: `ws` closes the
 * connection with 1009 automatically once a received frame's declared length exceeds `maxPayload`
 * (`node_modules/ws/lib/receiver.js`'s `haveLength` check, which fires as soon as the frame's
 * length prefix is parsed — before the payload body itself is even buffered, let alone handed to
 * any `onMessage`/`JSON.parse`).
 */

import { UserController } from "alepha/api/users";
import { ServerProvider } from "alepha/server";
import { afterEach, beforeEach, expect, test } from "vitest";
import { WebSocket } from "ws";
import { createTestApp } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";
// Comfortably above the app's seeded 16 KiB `maxPayload`
// (`websocketTransportCap.ts`'s `DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES`).
const OVERSIZED_FRAME_BYTES = 20 * 1024;

let alepha: ReturnType<typeof createTestApp>;
let hostname: string;
let openSockets: WebSocket[];
let userCount = 0;

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

async function registerAndLogin(prefix: string): Promise<{ token: string }> {
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
  return { token: tokens.access_token };
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

/** One fresh account with an adventure, a party on it and one hero, end-to-end over HTTP —
 *  trimmed from `world-room-admission.test.ts`'s fixture to what this file needs. */
async function newPlayableHero(prefix: string): Promise<{
  token: string;
  roomId: string;
  heroId: string;
}> {
  const { token } = await registerAndLogin(prefix);
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
  return { token, roomId: `${partyId}:${adventure.defaultMap.id}`, heroId };
}

test("a frame over the transport maxPayload closes the connection with 1009, before any app-level parsing", async () => {
  const { token, roomId, heroId } = await newPlayableHero("oversized");
  const wsHost = hostname.replace(/^http/, "ws");
  const socket = new WebSocket(`${wsHost}/ws/world?roomId=${roomId}&hero=${heroId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  openSockets.push(socket);

  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });

  const closed = new Promise<number>((resolve) => {
    socket.once("close", (code) => resolve(code));
  });

  // A raw, deliberately non-JSON oversized frame: the point of this test is that `ws` rejects it
  // at the transport, before the app's room code (which would `JSON.parse` it) ever sees it.
  socket.send("x".repeat(OVERSIZED_FRAME_BYTES));

  await expect(closed).resolves.toBe(1009);
});
