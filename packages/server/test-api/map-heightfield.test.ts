/**
 * The `maps.heightfield` column: stored through `MapService`, and — the increment's central claim —
 * carried to a joining client in the authoritative `welcome`.
 *
 * The storage half uses `MapService` directly (`alepha.inject`), the same unauthenticated-probe
 * idiom `entities-authoring.test.ts` established for entity-level coverage ahead of a controller
 * route: no controller writes a heightfield yet (see `MapService.saveHeightfield`'s docblock), so
 * `MapController`'s HTTP surface has nothing to exercise here.
 *
 * The wire half deliberately does not: it registers, creates an adventure/party/hero over real
 * HTTP and opens a real WebSocket against `/ws/world` — the same harness shape as
 * `world-room-admission.test.ts` — because "the server ships the heightfield" is a claim about the
 * running app, not about a function.
 */
import { decodeMap } from "@lindocara/engine/hd2d/map-data.js";
import { parseServerMessage, type ServerMessage } from "@lindocara/engine/protocol.js";
import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { adventures } from "../src/api/entities/adventures.ts";
import { MapService } from "../src/api/services/MapService.ts";
import { createTestApp } from "./helpers.ts";

// Meets the realm's default password policy — mirrors `auth.test.ts`.
const PASSWORD = "Sup3rSecret";

class SeedProbe {
  adventures = $repository(adventures);
}

let alepha: ReturnType<typeof createTestApp>;
let probe: SeedProbe;
let mapService: MapService;
let hostname: string;
let userCount = 0;
let openSockets: WebSocket[];

beforeEach(async () => {
  alepha = createTestApp();
  probe = alepha.inject(SeedProbe);
  mapService = alepha.inject(MapService);
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

/** Registers a real user (the adventure's owning FK) and seeds one adventure for it — same
 *  two-phase registration idiom `entities-authoring.test.ts`/`maps.test.ts` use. */
async function newAdventure(prefix: string): Promise<string> {
  userCount += 1;
  const username = `${prefix}${userCount}`;
  const users = alepha.inject(UserController);
  const intent = await users.createRegistrationIntent.fetch({
    body: { username, password: PASSWORD },
  });
  const registered = await users.createUserFromIntent.fetch({
    body: { intentId: intent.data.intentId },
  });
  const adventure = await probe.adventures.create({
    userId: registered.data.id,
    title: "Adv",
    graph: JSON.stringify({ start: null, links: [] }),
  });
  return adventure.id;
}

describe("map heightfield storage", () => {
  test("round-trips a stored heightfield through the map payload", async () => {
    const adventureId = await newAdventure("heightfield");
    const encoded =
      '{"version":1,"size":1,"levelHeight":0.5,"waterLevel":0,"levels":[0],"materials":["herbe"],"colliders":[],"spawns":[],"elements":[],"events":[]}';
    const map = await mapService.createMap(adventureId, "Test Map");

    await mapService.saveHeightfield(map.id, encoded);

    const payload = await mapService.getMap(map.id);
    expect(payload.heightfield).toBe(encoded);
  });

  test("reports no heightfield as null, not as an empty string", async () => {
    const adventureId = await newAdventure("heightfieldnull");
    const map = await mapService.createMap(adventureId, "Test Map");

    const payload = await mapService.getMap(map.id);
    expect(payload.heightfield).toBeNull();
  });
});

/** An 8x8 grid of level-0 ground with one spawn — small, entirely walkable, and nothing about it
 *  can make admission fail for a reason unrelated to the heightfield. */
const PROVING_SIZE = 8;
const PROVING_HEIGHTFIELD = JSON.stringify({
  version: 1,
  size: PROVING_SIZE,
  levelHeight: 0.9,
  waterLevel: -0.05,
  levels: new Array(PROVING_SIZE * PROVING_SIZE).fill(0),
  materials: new Array(PROVING_SIZE * PROVING_SIZE).fill("herbe"),
  colliders: [],
  spawns: [{ name: "default", x: 0, z: 0 }],
  elements: [],
  events: [],
});

async function registerAndLogin(prefix: string): Promise<string> {
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
  return ((await login.json()) as { access_token: string }).access_token;
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

/** One account with an adventure, a party on it and one hero — the ordinary HTTP flow, exactly as
 *  `world-room-admission.test.ts` provisions it. */
async function newPlayableHero(
  prefix: string,
): Promise<{ token: string; mapId: string; partyId: string; heroId: string }> {
  const token = await registerAndLogin(prefix);
  const adventureResponse = await authedFetch("/api/adventures", token, {
    method: "POST",
    body: JSON.stringify({ title: "Proving", maxPlayers: 4 }),
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
  return { token, mapId: adventure.defaultMap.id, partyId, heroId };
}

/**
 * Opens a real `/ws/world` socket and resolves with the first `welcome` it receives — read through
 * `parseServerMessage`, NOT a bare `JSON.parse`.
 *
 * That distinction is the whole point of this harness. `parseServerMessage` is the single wire
 * truth (`realtime-wire.test.ts`, `packages/server/AGENTS.md`), and it is what the real client runs
 * (`packages/client/src/game/net.ts`): a frame it refuses is a frame the client never sees, so a
 * `welcome` whose appearance layers do not decode against its own `tiles` grid does not merely draw
 * wrong — the room is unjoinable. A `JSON.parse` here would let exactly that pass unnoticed.
 */
function waitForWelcome(roomId: string, heroId: string, token: string): Promise<ServerMessage> {
  const socket = new WebSocket(
    `${hostname.replace(/^http/, "ws")}/ws/world?roomId=${roomId}&hero=${heroId}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  openSockets.push(socket);
  return new Promise<ServerMessage>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for 'welcome'")), 5_000);
    socket.on("message", (data) => {
      const raw = data.toString();
      const message = parseServerMessage(raw);
      if (message === null) {
        const kind = (JSON.parse(raw) as { t?: unknown }).t;
        clearTimeout(timer);
        reject(new Error(`the wire refused a '${String(kind)}' frame: a client would drop it`));
        return;
      }
      if (message.t !== "welcome") return;
      clearTimeout(timer);
      resolve(message);
    });
    socket.on("close", (code) => {
      clearTimeout(timer);
      reject(new Error(`socket closed before welcome (${code})`));
    });
  });
}

describe("the heightfield on the wire", () => {
  test("a joining hero's welcome carries the stored heightfield, decodable", async () => {
    const { token, mapId, partyId, heroId } = await newPlayableHero("hfwire");
    await mapService.saveHeightfield(mapId, PROVING_HEIGHTFIELD);

    const welcome = await waitForWelcome(`${partyId}:${mapId}`, heroId, token);
    if (welcome.t !== "welcome") throw new Error("unreachable");

    expect(welcome.world.heightfield).not.toBeNull();
    // Decoded, not merely non-null: what the wire carries has to survive the format's own parser,
    // or the client would receive a string it cannot use.
    const decoded =
      welcome.world.heightfield === null ? null : decodeMap(welcome.world.heightfield);
    expect(decoded?.size).toBe(PROVING_SIZE);
    expect(decoded?.spawns).toEqual([{ name: "default", x: 0, z: 0 }]);
    // And the room baked its own collision from that same heightfield: 8 cells of 64px, not the
    // default tile map's dimensions.
    expect(welcome.world.width).toBe(PROVING_SIZE * 64);
    expect(welcome.world.tiles.length).toBe(PROVING_SIZE);
    // The appearance agrees with that grid instead of contradicting it: blank layers sized to the
    // heightfield, and none of the map's tile-space elements. Reaching this line at all already
    // proves it — `parseServerMessage` would have refused the frame otherwise — but assert the
    // shape too, so a future change that keeps the frame legal by some other route still has to
    // say so out loud.
    expect(welcome.world.layers).toEqual(["0*64", "0*64", "0*64"]);
    expect(welcome.world.elements).toEqual([]);
  });

  test("a map with no heightfield still welcomes with null", async () => {
    const { token, mapId, partyId, heroId } = await newPlayableHero("hfnone");

    const welcome = await waitForWelcome(`${partyId}:${mapId}`, heroId, token);
    if (welcome.t !== "welcome") throw new Error("unreachable");

    expect(welcome.world.heightfield).toBeNull();
  });

  test("a corrupt stored heightfield is refused, never silently ignored", async () => {
    const { token, mapId, partyId, heroId } = await newPlayableHero("hfbad");
    // Valid JSON, invalid map: `levels` is one cell short of `size * size`.
    await mapService.saveHeightfield(
      mapId,
      '{"version":1,"size":2,"levelHeight":1,"waterLevel":0,"levels":[0,0,0],"materials":["herbe","herbe","herbe","herbe"],"colliders":[],"spawns":[],"elements":[],"events":[]}',
    );

    const welcome = await waitForWelcome(`${partyId}:${mapId}`, heroId, token);
    if (welcome.t !== "welcome") throw new Error("unreachable");

    // Honestly heightfield-less, and the terrain is the tile path's — never a half-applied map.
    expect(welcome.world.heightfield).toBeNull();
    expect(welcome.world.width).not.toBe(2 * 64);
  });
});
