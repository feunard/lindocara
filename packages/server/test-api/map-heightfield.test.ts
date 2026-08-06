/**
 * The `maps.heightfield` column, in three halves: stored through `MapService`, written over HTTP by
 * its author, and — the increment's central claim — carried to a joining client in the
 * authoritative `welcome`.
 *
 * The storage half uses `MapService` directly (`alepha.inject`), the same unauthenticated-probe
 * idiom `entities-authoring.test.ts` established: `saveHeightfield` is the unfenced in-process
 * writer the dev scripts and these fixtures use, and it has no HTTP surface of its own.
 *
 * The route half does the opposite, and must: `PUT /api/maps/:id/heightfield` is an authorization
 * boundary, so it is driven over real HTTP with real tokens — a 401 and an owner fence are claims
 * about the running app that no direct service call can make.
 *
 * The wire half is the same shape for the same reason: it registers, creates an adventure/party/hero
 * over real HTTP and opens a real WebSocket against `/ws/world` — the same harness as
 * `world-room-admission.test.ts` — because "the server ships the heightfield" is a claim about the
 * running app, not about a function.
 */
import { WS_CLOSE } from "@lindocara/engine/close-codes.js";
import { decodeMap, MAX_HEIGHTFIELD_SIZE } from "@lindocara/engine/hd2d/map-data.js";
import { parseServerMessage, type ServerMessage } from "@lindocara/engine/protocol.js";
import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { MAX_MAP_JSON_BYTES } from "../src/api/bodySizeCap.ts";
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

/** One account and the default map of one adventure it authored — the smallest thing the
 *  heightfield route can be pointed at, provisioned entirely over real HTTP. */
async function newOwnedMap(prefix: string): Promise<{ token: string; mapId: string }> {
  const token = await registerAndLogin(prefix);
  const response = await authedFetch("/api/adventures", token, {
    method: "POST",
    body: JSON.stringify({ title: "Proving", maxPlayers: 4 }),
  });
  expect(response.status).toBe(201);
  const adventure = (await response.json()) as { defaultMap: { id: string } };
  return { token, mapId: adventure.defaultMap.id };
}

function putHeightfield(mapId: string, token: string, body: unknown): Promise<Response> {
  return authedFetch(`/api/maps/${mapId}/heightfield`, token, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/**
 * `PUT /api/maps/:id/heightfield` — the route that lets a heightfield reach an instance whose
 * database this process cannot open (Bay's, in production).
 *
 * Real HTTP against `ServerProvider.hostname`, not the typed `.fetch()` client, for the reason
 * `maps.test.ts` gives: the controller's schemas are deliberately loose, so only a real round trip
 * proves the hand-written validation answers with the exact machine codes — and only a real round
 * trip can observe the 401 that the loose schema exists to preserve.
 */
describe("the heightfield route", () => {
  test("an author seeds their own map, and the revision moves with it", async () => {
    const { token, mapId } = await newOwnedMap("hfroute");
    const before = (await mapService.getMap(mapId)).revision;
    const encoded = provingHeightfield();

    const response = await putHeightfield(mapId, token, { heightfield: encoded });

    expect(response.status).toBe(204);
    const after = await mapService.getMap(mapId);
    expect(after.heightfield).toBe(encoded);
    // The bump is the point, not a side effect: `(mapId, revision)` is the client's cache identity
    // and `configureMapTerrain` early-returns on an unchanged pair, so terrain re-seeded under a
    // stale revision would leave a live session drawing the map it replaced.
    expect(after.revision).toBe(before + 1);
  });

  test("an unauthenticated caller is refused before anything is parsed", async () => {
    const { mapId } = await newOwnedMap("hfanon");

    // A body no tight schema would accept, sent by nobody. That combination is the whole test:
    // Alepha validates a route's schema BEFORE `$secure({})` runs (see `MapController`'s docblock),
    // so a `body: z.object({ heightfield: z.string() })` here would answer this anonymous caller
    // 400 instead of 401 — a refusal that leaks nothing, but also proves nothing about auth, and a
    // route whose fence had been dropped entirely would answer exactly the same way.
    const response = await fetch(`${hostname}/api/maps/${mapId}/heightfield`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nothing: "useful" }),
    });

    expect(response.status).toBe(401);
    expect((await mapService.getMap(mapId)).heightfield).toBeNull();
  });

  test("a non-owner is refused and the map keeps the terrain its author gave it", async () => {
    const { token: owner, mapId } = await newOwnedMap("hfowner");
    const authored = provingHeightfield();
    expect((await putHeightfield(mapId, owner, { heightfield: authored })).status).toBe(204);
    const sealed = await mapService.getMap(mapId);

    const intruder = await registerAndLogin("hfintruder");
    const response = await putHeightfield(mapId, intruder, {
      heightfield: provingHeightfield(PROVING_SIZE, { x: 3, z: -2 }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "map_not_found" });
    // The status alone would pass against a route that refused AFTER writing. What has to hold is
    // that the row never moved: same terrain, same revision — an account that cannot touch a map
    // cannot cost it its cache identity either.
    const after = await mapService.getMap(mapId);
    expect(after.heightfield).toBe(authored);
    expect(after.revision).toBe(sealed.revision);
  });

  test("a payload `decodeMap` refuses is rejected, and stores nothing", async () => {
    const { token, mapId } = await newOwnedMap("hfbadbody");
    // Valid JSON, invalid map: `levels` is one cell short of `size * size` — the same corruption
    // `map-heightfield.test.ts`'s wire half proves makes a room unjoinable. Stored, that failure is
    // silent and permanent, which is why it is refused at the boundary rather than on join.
    const corrupt =
      '{"version":1,"size":2,"levelHeight":1,"waterLevel":0,"levels":[0,0,0],"materials":["herbe","herbe","herbe","herbe"],"colliders":[],"spawns":[],"elements":[],"events":[]}';

    const response = await putHeightfield(mapId, token, { heightfield: corrupt });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "map_invalid" });
    expect((await mapService.getMap(mapId)).heightfield).toBeNull();
  });

  test("a grid wider than `MAX_HEIGHTFIELD_SIZE` is refused with everything else `decodeMap` bounds", async () => {
    const { token, mapId } = await newOwnedMap("hfoversize");
    const side = MAX_HEIGHTFIELD_SIZE + 1;
    // Declared, not materialised: `decodeMap` bounds `size` before it ever looks at the cell
    // arrays, and that bound is what keeps `MOVE_COORDINATE_LIMIT`'s refusal honest — a hero on a
    // grid wider than this would have every movement frame silently dropped past ±128 tiles.
    const oversize = JSON.stringify({
      version: 1,
      size: side,
      levelHeight: 1,
      waterLevel: 0,
      levels: [0],
      materials: ["herbe"],
      colliders: [],
      spawns: [],
      elements: [],
      events: [],
    });

    const response = await putHeightfield(mapId, token, { heightfield: oversize });

    expect(response.status).toBe(400);
    expect((await mapService.getMap(mapId)).heightfield).toBeNull();
  });

  test("an oversize body is refused by the cap, not buffered into the column", async () => {
    const { token, mapId } = await newOwnedMap("hfbig");

    const response = await putHeightfield(mapId, token, {
      heightfield: "x".repeat(MAX_MAP_JSON_BYTES + 1_024),
    });

    // 413 either way: over the 4 MiB ceiling Alepha's own body parser answers first with its
    // generic code, and `enforceBodySizeCap` catches everything between a narrower cap and that
    // ceiling (see `bodySizeCap.ts`'s docblock — the map routes are its documented degenerate
    // case). What matters here is that nothing that large ever reaches the column.
    expect(response.status).toBe(413);
    expect((await mapService.getMap(mapId)).heightfield).toBeNull();
  });
});

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
