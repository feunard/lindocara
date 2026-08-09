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
import { gzipSync } from "node:zlib";
import { WS_CLOSE } from "@lindocara/engine/close-codes.js";
import { decodeMap, MAX_HEIGHTFIELD_SIZE } from "@lindocara/engine/hd2d/map-data.js";
import { parseServerMessage, type ServerMessage } from "@lindocara/engine/protocol.js";
import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { MAX_HEIGHTFIELD_JSON_BYTES, MAX_MAP_JSON_BYTES } from "../src/api/bodySizeCap.ts";
import { adventures } from "../src/api/entities/adventures.ts";
import { maps } from "../src/api/entities/maps.ts";
import { MapService } from "../src/api/services/MapService.ts";
import { defaultMapInput, MAX_HEIGHTFIELD_BYTES } from "../src/api/services/mapAuthoring.ts";
import { createTestApp, PROVING_SIZE, provingHeightfield } from "./helpers.ts";

// Meets the realm's default password policy — mirrors `auth.test.ts`.
const PASSWORD = "Sup3rSecret";

class SeedProbe {
  adventures = $repository(adventures);
  maps = $repository(maps);
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

  test("creates every new map with playable HD-2D terrain", async () => {
    const adventureId = await newAdventure("hfdef");
    const map = await mapService.createMap(adventureId, "Test Map");

    const payload = await mapService.getMap(map.id);
    expect(payload.heightfield).not.toBeNull();
    expect(decodeMap(payload.heightfield ?? "")?.size).toBe(20);
  });

  test("backfills legacy rows once without installing a runtime fallback", async () => {
    const adventureId = await newAdventure("hfbackfill");
    const map = await mapService.createMap(adventureId, "Legacy Map");
    await probe.maps.updateById(map.id, { heightfield: "" });
    const before = (await mapService.getMap(map.id)).revision;

    expect(await mapService.backfillMissingHeightfields()).toBe(1);
    const compiled = await mapService.getMap(map.id);
    expect(decodeMap(compiled.heightfield ?? "")?.size).toBe(20);
    expect(compiled.revision).toBe(before + 1);

    expect(await mapService.backfillMissingHeightfields()).toBe(0);
    expect((await mapService.getMap(map.id)).revision).toBe(compiled.revision);
  });

  test("stores authored content and its heightfield under one revision", async () => {
    const adventureId = await newAdventure("hfatomic");
    const map = await mapService.createMap(adventureId, "Test Map");
    const heightfield = provingHeightfield();

    const updated = await mapService.updateMap(
      map.id,
      { ...defaultMapInput("Updated Map"), heightfield },
      map.revision,
    );

    expect(updated.name).toBe("Updated Map");
    expect(updated.heightfield).toBe(heightfield);
    expect(updated.revision).toBe(map.revision + 1);
  });

  test("recompiles authored terrain when a legacy caller omits the heightfield", async () => {
    const adventureId = await newAdventure("hfrecompile");
    const map = await mapService.createMap(adventureId, "Test Map");
    const input = { ...defaultMapInput("Moved Spawn"), spawn: { col: 1, row: 1 } };

    const updated = await mapService.updateMap(map.id, input, map.revision);
    const compiled = decodeMap(updated.heightfield ?? "");

    expect(compiled?.spawns[0]).toMatchObject({ name: "default", x: -8.5, z: -8.5 });
    expect(updated.revision).toBe(map.revision + 1);
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
  // Route validation tests predate automatic terrain compilation and assert that a refused write
  // stores nothing. Keep that exact baseline by emulating one legacy empty row explicitly.
  await probe.maps.updateById(adventure.defaultMap.id, { heightfield: "" });
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

  test("a heightfield may carry no more entries than its grid has cells", async () => {
    const { token, mapId } = await newOwnedMap("hfcrowd");
    const side = 4;
    const cells = side * side;
    const grid = (colliders: number) =>
      JSON.stringify({
        version: 1,
        size: side,
        levelHeight: 1,
        waterLevel: -0.05,
        levels: new Array(cells).fill(0),
        materials: new Array(cells).fill("herbe"),
        colliders: new Array(colliders).fill({ x: 0, z: 0, w: 0.1, h: 0.1 }),
        spawns: [{ name: "default", x: 0, z: 0 }],
        elements: [],
        events: [],
      });

    // One over the grid's own cell count. `decodeMap` accepts this happily — it bounds `size` and
    // the two cell arrays and nothing else — which is how a `size: 1` map padded with 160 000
    // colliders reached 4 MB and decoded in 24 ms. Byte size cannot separate that from a
    // legitimately dense 256² map; the ratio to the grid can.
    const crowded = await putHeightfield(mapId, token, { heightfield: grid(cells + 1) });
    expect(crowded.status).toBe(400);
    expect(await crowded.json()).toMatchObject({ error: "map_size" });
    expect((await mapService.getMap(mapId)).heightfield).toBeNull();

    // And exactly at the bound it passes — otherwise this would pass just as well against a route
    // that refused every collider, or every payload, and prove nothing about where the line is.
    const dense = await putHeightfield(mapId, token, { heightfield: grid(cells) });
    expect(dense.status).toBe(204);
    expect((await mapService.getMap(mapId)).heightfield).toBe(grid(cells));
  });

  test("a body over THIS route's cap is refused by it, below the global parser's ceiling", async () => {
    const { token, mapId } = await newOwnedMap("hfbig");

    // Deliberately BETWEEN the two: over `MAX_HEIGHTFIELD_JSON_BYTES` (2 MiB, this route's own)
    // and under `MAX_MAP_JSON_BYTES` (4 MiB, which equals the global parser ceiling). A payload
    // past the ceiling would be answered 413 by Alepha's body parser before this app ran a line,
    // so it would prove nothing about this route — deleting `enforceBodySizeCap` from the handler
    // left such a test passing, which is why this one sits under the ceiling instead.
    const size = MAX_HEIGHTFIELD_JSON_BYTES + 64 * 1024;
    expect(size).toBeLessThan(MAX_MAP_JSON_BYTES);
    const response = await putHeightfield(mapId, token, { heightfield: "x".repeat(size) });

    expect(response.status).toBe(413);
    // The machine code is the discriminator, not the status: `request_too_large` is this app's
    // (`enforceBodySizeCap`), while the global parser answers its own `PayloadTooLargeError`.
    expect(await response.json()).toMatchObject({ error: "request_too_large" });
    expect((await mapService.getMap(mapId)).heightfield).toBeNull();
  });

  test("a gzipped body cannot smuggle a heightfield past the size bound", async () => {
    const { token, mapId } = await newOwnedMap("hfgzip");
    // A single cell carrying a single element — the count bound is satisfied with room to spare —
    // whose `assetId` is two megabytes of text. `decodeMap` bounds no string it reads, so this
    // decodes perfectly; only its SIZE is wrong.
    const smuggled = JSON.stringify({
      version: 1,
      size: 1,
      levelHeight: 1,
      waterLevel: -0.05,
      levels: [0],
      materials: ["herbe"],
      colliders: [],
      spawns: [{ name: "default", x: 0, z: 0 }],
      elements: [{ assetId: "x".repeat(2 * 1024 * 1024), x: 0, z: 0 }],
      events: [],
    });
    const payload = gzipSync(Buffer.from(JSON.stringify({ heightfield: smuggled })));

    const response = await fetch(`${hostname}/api/maps/${mapId}/heightfield`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
        authorization: `Bearer ${token}`,
      },
      body: payload,
    });

    // The point of the test, asserted rather than assumed: the wire is tiny and every
    // `content-length`-shaped check is therefore satisfied. `bodyParserOptions.inflate` is on, so
    // the framework hands the handler the full 2 MB — which is why the bound has to be measured on
    // the decoded string, and why removing that measurement lets this land in the column.
    expect(payload.byteLength).toBeLessThan(MAX_HEIGHTFIELD_JSON_BYTES);
    expect(smuggled.length).toBeGreaterThan(MAX_HEIGHTFIELD_BYTES);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "request_too_large" });
    expect((await mapService.getMap(mapId)).heightfield).toBeNull();
  });

  test("the largest honest 256² grid is still accepted", async () => {
    const { token, mapId } = await newOwnedMap("hfhonest");
    const side = MAX_HEIGHTFIELD_SIZE;
    const cells = side * side;
    // The worst legitimate encoding, not a typical one: every level `null` (`"null,"`, the longest
    // level token) and every material `"glace-fine"` (the longest name). ~1.18 MB of grid that no
    // author can avoid — if the bound refused this, it would be refusing terrain the format itself
    // permits, and the number would be wrong rather than strict.
    const honest = JSON.stringify({
      version: 1,
      size: side,
      levelHeight: 0.9,
      waterLevel: -0.05,
      levels: new Array(cells).fill(null),
      materials: new Array(cells).fill("glace-fine"),
      colliders: [],
      spawns: [{ name: "default", x: 0, z: 0 }],
      elements: [],
      events: [],
    });

    const response = await putHeightfield(mapId, token, { heightfield: honest });

    expect(honest.length).toBeGreaterThan(1_000_000);
    expect(response.status).toBe(204);
    expect((await mapService.getMap(mapId)).heightfield).toBe(honest);
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

    // Simulate a map row created before automatic authoring compilation existed.
    await probe.maps.updateById(mapId, { heightfield: "" });

    // `zoneFromMapPayload` throws, `createState` keeps `location: null` and admission refuses.
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
