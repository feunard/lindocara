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
import { WS_CLOSE } from "@lindocara/engine/close-codes.js";
import { decodeMap } from "@lindocara/engine/hd2d/map-data.js";
import { parseServerMessage, type ServerMessage } from "@lindocara/engine/protocol.js";
import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { adventures } from "../src/api/entities/adventures.ts";
import { MapService } from "../src/api/services/MapService.ts";
import { createTestApp, PROVING_SIZE, provingHeightfield } from "./helpers.ts";

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

  test("bumps the map's revision on every write, so the client's cache identity moves", async () => {
    const adventureId = await newAdventure("heightfieldrev");
    const map = await mapService.createMap(adventureId, "Test Map");
    const before = (await mapService.getMap(map.id)).revision;
    const encoded =
      '{"version":1,"size":1,"levelHeight":0.5,"waterLevel":0,"levels":[0],"materials":["herbe"],"colliders":[],"spawns":[],"elements":[],"events":[]}';

    await mapService.saveHeightfield(map.id, encoded);
    const afterFirst = (await mapService.getMap(map.id)).revision;

    // Cache identity is `(mapId, revision)` and the renderer early-returns on an unchanged pair
    // (`configureMapTerrain`), so a second write of DIFFERENT terrain under the same revision would
    // leave a live session drawing the old map. Re-running the proving-map generator is exactly
    // that case, which is why the bump is asserted across two successive writes and not just one.
    await mapService.saveHeightfield(map.id, encoded);
    const afterSecond = (await mapService.getMap(map.id)).revision;

    expect(afterFirst).toBe(before + 1);
    expect(afterSecond).toBe(before + 2);
  });

  test("reports no heightfield as null, not as an empty string", async () => {
    const adventureId = await newAdventure("heightfieldnull");
    const map = await mapService.createMap(adventureId, "Test Map");

    const payload = await mapService.getMap(map.id);
    expect(payload.heightfield).toBeNull();
  });
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

/** A real `/ws/world` socket, registered for teardown. */
function openWorldSocket(roomId: string, heroId: string, token: string): WebSocket {
  const socket = new WebSocket(
    `${hostname.replace(/^http/, "ws")}/ws/world?roomId=${roomId}&hero=${heroId}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  openSockets.push(socket);
  return socket;
}

/**
 * Resolves with the first `welcome` the socket receives — read through `parseServerMessage`, NOT a
 * bare `JSON.parse`.
 *
 * That distinction is the whole point of this harness. `parseServerMessage` is the single wire
 * truth (`realtime-wire.test.ts`, `packages/server/AGENTS.md`), and it is what the real client runs
 * (`packages/client/src/game/net.ts`): a frame it refuses is a frame the client never sees, so a
 * `welcome` whose appearance layers do not decode against its own grid does not merely draw wrong —
 * the room is unjoinable. A `JSON.parse` here would let exactly that pass unnoticed.
 */
function waitForWelcome(roomId: string, heroId: string, token: string): Promise<ServerMessage> {
  const socket = openWorldSocket(roomId, heroId, token);
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

/**
 * Opens the same socket and resolves with the close code instead — the only observable a room with
 * no usable terrain produces, because it never sends a `welcome` at all. A `welcome` arriving here
 * is itself the failure: it would mean a room admitted a hero onto collision it could not bake.
 */
function waitForClose(roomId: string, heroId: string, token: string): Promise<number> {
  const socket = openWorldSocket(roomId, heroId, token);
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for a close")), 5_000);
    socket.on("message", (data) => {
      const message = parseServerMessage(data.toString());
      if (message?.t !== "welcome") return;
      clearTimeout(timer);
      reject(new Error("the room welcomed a hero onto terrain it cannot have baked"));
    });
    socket.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe("the heightfield on the wire", () => {
  test("a joining hero's welcome carries the stored heightfield, decodable", async () => {
    const { token, mapId, partyId, heroId } = await newPlayableHero("hfwire");
    await mapService.saveHeightfield(mapId, provingHeightfield());

    const welcome = await waitForWelcome(`${partyId}:${mapId}`, heroId, token);
    if (welcome.t !== "welcome") throw new Error("unreachable");

    // Decoded, not merely present: what the wire carries has to survive the format's own parser,
    // or the client would receive a string it cannot use.
    const decoded = decodeMap(welcome.world.heightfield);
    expect(decoded?.size).toBe(PROVING_SIZE);
    expect(decoded?.spawns).toEqual([{ name: "default", x: 0, z: 0 }]);
    // And the room's own extent is that same grid — in CELLS now, not pixels. `size` replaced the
    // `width`/`height` pair with the heightfield's side, so the wire cannot describe a world in one
    // unit system and collide in another.
    expect(welcome.world.size).toBe(PROVING_SIZE);
    // The appearance agrees with that grid instead of contradicting it: blank layers sized to the
    // heightfield, and none of the map's tile-space elements. Reaching this line at all already
    // proves it — `parseServerMessage` would have refused the frame otherwise — but assert the
    // shape too, so a future change that keeps the frame legal by some other route still has to
    // say so out loud.
    const blank = `0*${PROVING_SIZE * PROVING_SIZE}`;
    expect(welcome.world.layers).toEqual([blank, blank, blank]);
    expect(welcome.world.elements).toEqual([]);
  });

  test("a map with no heightfield is unjoinable, never welcomed onto empty collision", async () => {
    const { token, mapId, partyId, heroId } = await newPlayableHero("hfnone");

    // `POST /api/adventures` seeds a tile map and no heightfield, so this is the untouched default:
    // `zoneFromMapPayload` throws, `createState` keeps `location: null` and admission refuses. The
    // old behaviour — welcome with a null heightfield and the tile path's terrain — has no terrain
    // left to fall back to, and a room whose collision is silently empty is the failure this
    // replaces.
    expect(await waitForClose(`${partyId}:${mapId}`, heroId, token)).toBe(
      WS_CLOSE.INVALID_LOCATION,
    );
  });

  test("a corrupt stored heightfield is refused, never silently ignored", async () => {
    const { token, mapId, partyId, heroId } = await newPlayableHero("hfbad");
    // Valid JSON, invalid map: `levels` is one cell short of `size * size`.
    await mapService.saveHeightfield(
      mapId,
      '{"version":1,"size":2,"levelHeight":1,"waterLevel":0,"levels":[0,0,0],"materials":["herbe","herbe","herbe","herbe"],"colliders":[],"spawns":[],"elements":[],"events":[]}',
    );

    // Same refusal as the absent case, and that is the point: a heightfield the server cannot parse
    // must never present as a working map on a room whose collision disagrees with what the client
    // was told to render.
    expect(await waitForClose(`${partyId}:${mapId}`, heroId, token)).toBe(
      WS_CLOSE.INVALID_LOCATION,
    );
  });
});
