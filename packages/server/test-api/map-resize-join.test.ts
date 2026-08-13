/**
 * Server-boundary proof for dynamic map size: an editor-cropped save round-trips into a joinable
 * room, and a hero position stranded outside a shrunken map's bounds snaps to the map's own entry
 * on join.
 *
 * No production code changes here. `restoreStandablePosition` (`AdmissionService.ts:290`) already
 * snaps a non-standable persisted position to the map entry — this suite PROVES that mechanism
 * holds for the re-crop scenario the dynamic-map-size design leans on, and proves that a save built
 * the way the editor now builds one (pad the stored content to the full canvas, then crop back down
 * to the derived content rect) is accepted by the real `PUT /api/maps/:id` route and produces a
 * heightfield a room can actually admit a hero into.
 *
 * The server test cannot import editor code (`@lindocara/editor` depends on `server`'s siblings,
 * not the other way around), so `croppedSaveBody` below re-applies the same engine primitives the
 * editor's own `toSaveInput` (`packages/editor/src/game/editor-state.ts`) composes: `padMapToCanvas`
 * + `derivedMapRect` + `cropMapToRect` (`@lindocara/engine/map-canvas.js`), `encodeTileLayer`
 * (`@lindocara/engine/tile-layer-codec.js`) and `compileAuthoredMap`/`encodeMap`
 * (`@lindocara/engine/hd2d/authored-map.js`, `@lindocara/engine/hd2d/map-data.js`).
 *
 * Fixture, socket and wire-reading patterns (`FakeClock`, `fakeSocket`, `messages`, `welcome`,
 * `createEngine`) are copied from `peasant-persistence.test.ts` rather than shared — file-local by
 * this suite's own convention (see that file's docblock).
 */

import type { MapAudioConfig } from "@lindocara/engine/audio-catalog.js";
import { compileAuthoredMap } from "@lindocara/engine/hd2d/authored-map.js";
import { decodeMap, encodeMap } from "@lindocara/engine/hd2d/map-data.js";
import {
  cropMapToRect,
  derivedMapRect,
  type MapCanvasContent,
  padMapToCanvas,
} from "@lindocara/engine/map-canvas.js";
import type {
  MapData as AuthoredMapData,
  MapElement,
  MapMarkers,
} from "@lindocara/engine/map-data.js";
import type { MapEvent } from "@lindocara/engine/map-events.js";
import type { MapHeroSettings } from "@lindocara/engine/map-hero-settings.js";
import type { MapFixedLighting } from "@lindocara/engine/map-lighting.js";
import { MAP_MAX_COLS, MAP_MAX_ROWS } from "@lindocara/engine/map-limits.js";
import { parseServerMessage, type ServerMessage } from "@lindocara/engine/protocol.js";
import {
  BODY_RADIUS,
  canStand,
  groundUnder,
  mapEntryPosition,
  zoneTerrainFromHeightfield,
} from "@lindocara/engine/terrain-access.js";
import {
  encodeTileLayer,
  parseTileLayer,
  type TileLayer,
} from "@lindocara/engine/tile-layer-codec.js";
import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { type RoomClock, RoomEngine, type RoomSocket } from "alepha/websocket";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { heroes } from "../src/api/entities/heroes.ts";
import { WorldRoom } from "../src/api/realtime/WorldRoom.ts";
import type { WorldRoomState } from "../src/api/realtime/worldState.ts";
import { createTestApp } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";

class Probe {
  heroes = $repository(heroes);
}

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

/** Every frame through `parseServerMessage`, the single wire truth — never a bare `JSON.parse`, or
 *  a welcome the real client would drop would read here as a delivered admission. */
function messages(socket: FakeSocket, offset = 0): ServerMessage[] {
  return socket.sent.slice(offset).map((raw) => {
    const message = parseServerMessage(raw);
    if (message === null) {
      throw new Error(
        `the wire refused a '${String((JSON.parse(raw) as { t?: unknown }).t)}' frame`,
      );
    }
    return message;
  });
}

function welcome(socket: FakeSocket): Extract<ServerMessage, { t: "welcome" }> {
  const message = messages(socket).find(
    (candidate): candidate is Extract<ServerMessage, { t: "welcome" }> => candidate.t === "welcome",
  );
  if (!message) throw new Error("socket did not receive a welcome");
  return message;
}

function createEngine(roomId: string): RoomEngine<never, never, WorldRoomState> {
  const worldRoom = alepha.inject(WorldRoom);
  return new RoomEngine({
    roomId,
    clock: new FakeClock(),
    options: worldRoom.roomOptions,
    validate: () => {},
  }) as RoomEngine<never, never, WorldRoomState>;
}

let alepha: ReturnType<typeof createTestApp>;
let probe: Probe;
let hostname: string;
let userCount = 0;

beforeEach(async () => {
  alepha = createTestApp();
  probe = alepha.inject(Probe);
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
  const registered = await users.createUserFromIntent.fetch({
    body: { intentId: intent.data.intentId },
  });
  const login = await fetch(`${hostname}/_auth/token?provider=credentials`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const tokens = (await login.json()) as { access_token: string };
  return { token: tokens.access_token, userId: registered.data.id };
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

interface ResizeFixture {
  token: string;
  userId: string;
  partyId: string;
  mapId: string;
  roomId: string;
  heroId: string;
}

/** One account, one adventure and its default map, one party, one hero — the ordinary HTTP flow
 *  `peasant-persistence.test.ts`/`map-heightfield.test.ts` both provision fixtures with. */
async function newResizeFixture(prefix: string): Promise<ResizeFixture> {
  const { token, userId } = await registerAndLogin(prefix);
  const adventureResponse = await authedFetch("/api/adventures", token, {
    method: "POST",
    body: JSON.stringify({ title: "Resize proving", maxPlayers: 4 }),
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
    body: JSON.stringify({ name: "Cartographer", class: "peasant" }),
  });
  expect(heroResponse.status).toBe(201);
  const heroId = ((await heroResponse.json()) as { id: string }).id;
  return {
    token,
    userId,
    partyId,
    mapId: adventure.defaultMap.id,
    roomId: `${partyId}:${adventure.defaultMap.id}`,
    heroId,
  };
}

/** The `GET`/`PUT /api/maps/:id` wire shape this suite cares about — the fields `croppedSaveBody`
 *  reads off a GET and re-sends on the following PUT. */
interface MapWirePayload {
  name: string;
  revision: number;
  tilesetId: string;
  cols: number;
  rows: number;
  layers: string[];
  elements: MapElement[];
  spawn: { col: number; row: number };
  markers?: MapMarkers;
  events: MapEvent[];
  audio: MapAudioConfig;
  heroSettings: MapHeroSettings;
  dayNightCycle: boolean;
  fixedLighting: MapFixedLighting;
}

interface CroppedSaveBody {
  name: string;
  tilesetId: string;
  cols: number;
  rows: number;
  layers: string[];
  elements: MapElement[];
  spawn: { col: number; row: number };
  markers: MapMarkers;
  events: MapEvent[];
  audio: MapAudioConfig;
  heroSettings: MapHeroSettings;
  dayNightCycle: boolean;
  fixedLighting: MapFixedLighting;
  heightfield: string;
}

/**
 * The editor's save body, built the way `toSaveInput` (`packages/editor/src/game/editor-state.ts`)
 * builds it, but out of the engine primitives directly: this package cannot import `@lindocara/editor`.
 * Pad the fetched content to the full canvas, crop it back down to its derived content rect, encode
 * the cropped layers and compile the cropped document's own heightfield.
 */
function croppedSaveBody(payload: MapWirePayload): CroppedSaveBody {
  const decodedLayers: TileLayer[] = payload.layers.map((raw) => {
    const layer = parseTileLayer(raw, payload.cols, payload.rows);
    if (!layer) throw new Error("fixture map layer failed to decode");
    return layer;
  });
  const content: MapCanvasContent = {
    layers: decodedLayers,
    elements: payload.elements,
    spawn: payload.spawn,
    markers: payload.markers,
    events: payload.events,
  };
  const canvas = padMapToCanvas(content);
  const rect = derivedMapRect(canvas);
  const cropped = cropMapToRect(canvas, rect);
  const data: AuthoredMapData = {
    tilesetId: payload.tilesetId,
    cols: rect.cols,
    rows: rect.rows,
    layers: cropped.layers,
    elements: cropped.elements,
    spawn: cropped.spawn,
  };
  return {
    name: payload.name,
    tilesetId: payload.tilesetId,
    cols: rect.cols,
    rows: rect.rows,
    layers: cropped.layers.map(encodeTileLayer),
    elements: cropped.elements,
    spawn: cropped.spawn,
    markers: cropped.markers,
    events: cropped.events,
    audio: payload.audio,
    heroSettings: payload.heroSettings,
    dayNightCycle: payload.dayNightCycle,
    fixedLighting: payload.fixedLighting,
    heightfield: encodeMap(compileAuthoredMap(data, cropped.events)),
  };
}

/** GET the fixture's map, crop it the editor's way and PUT it back — the "an author saves after the
 *  editor pads and crops" half every test below shares. */
async function shrinkFixtureMap(
  fixture: ResizeFixture,
): Promise<{ cols: number; rows: number; size: number }> {
  const getResponse = await authedFetch(`/api/maps/${fixture.mapId}`, fixture.token);
  expect(getResponse.status).toBe(200);
  const payload = (await getResponse.json()) as MapWirePayload;
  const body = croppedSaveBody(payload);

  // Smaller than the theoretical maximum canvas the editor pads onto — the whole point of the
  // crop-on-save pipeline, and the "smaller dims" this suite's first test is named for.
  expect(body.cols).toBeLessThan(MAP_MAX_COLS);
  expect(body.rows).toBeLessThan(MAP_MAX_ROWS);

  const putResponse = await authedFetch(`/api/maps/${fixture.mapId}`, fixture.token, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  expect(putResponse.status).toBe(200);
  const updated = (await putResponse.json()) as { revision: number; cols: number; rows: number };
  expect(updated.revision).toBe(payload.revision + 1);
  expect(updated.cols).toBe(body.cols);
  expect(updated.rows).toBe(body.rows);

  return { cols: body.cols, rows: body.rows, size: Math.max(body.cols, body.rows) };
}

describe("dynamic map size at the server boundary", () => {
  test("an editor-cropped save round-trips: PUT smaller dims, join, bounds agree", async () => {
    const fixture = await newResizeFixture("resizeputjoin");
    const cropped = await shrinkFixtureMap(fixture);

    const engine = createEngine(fixture.roomId);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "resize-join");
    await engine.join(socket);
    const admitted = welcome(socket);

    const decoded = decodeMap(admitted.world.heightfield);
    if (!decoded) throw new Error("welcome heightfield failed to decode");
    // The room's own extent agrees with the cropped body, in cells: `compileAuthoredMap` derives
    // its square heightfield side from `Math.max(cols, rows)` of the authoring document it compiles.
    expect(decoded.size).toBe(cropped.size);
    expect(admitted.world.size).toBe(cropped.size);

    const self = admitted.players.find((player) => player.id === fixture.heroId);
    if (!self) throw new Error("welcome carried no self player");
    const terrain = zoneTerrainFromHeightfield(decoded);
    expect(
      canStand(terrain, self.x, self.z, BODY_RADIUS, groundUnder(terrain, self.x, self.z)),
    ).toBe(true);

    await engine.leave(socket.id);
    engine.dispose();
  });

  test("a persisted position outside the shrunken map snaps to the entry on join", async () => {
    const fixture = await newResizeFixture("resizesnap");
    const cropped = await shrinkFixtureMap(fixture);

    const engine = createEngine(fixture.roomId);
    const firstSocket = fakeSocket(fixture.userId, fixture.heroId, "resize-snap-first");
    await engine.join(firstSocket);
    // Sanity: the hero can be admitted onto the shrunken map before its row is doctored below.
    welcome(firstSocket);
    await engine.leave(firstSocket.id);
    await Promise.resolve();

    // Well beyond `terrain.size / 2` on both ground axes: off the grid entirely, the "open water or
    // out of bounds" case the spec's auto-trim decision leans on `restoreStandablePosition` for.
    const doctored = { x: cropped.size, y: 0, z: cropped.size };
    await probe.heroes.updateById(fixture.heroId, doctored);

    const secondSocket = fakeSocket(fixture.userId, fixture.heroId, "resize-snap-second");
    await engine.join(secondSocket);
    const admitted = welcome(secondSocket);

    const decoded = decodeMap(admitted.world.heightfield);
    if (!decoded) throw new Error("welcome heightfield failed to decode");
    const terrain = zoneTerrainFromHeightfield(decoded);

    const self = admitted.players.find((player) => player.id === fixture.heroId);
    if (!self) throw new Error("welcome carried no self player");
    expect(
      canStand(terrain, self.x, self.z, BODY_RADIUS, groundUnder(terrain, self.x, self.z)),
    ).toBe(true);
    expect({ x: self.x, z: self.z }).not.toEqual({ x: doctored.x, z: doctored.z });

    // Not merely SOME standable cell — THE map's own entry, exactly as admission computes it.
    const entry = mapEntryPosition(terrain, decoded.spawns[0]);
    expect({ x: self.x, z: self.z }).toEqual({ x: entry.x, z: entry.z });

    await engine.leave(secondSocket.id);
    engine.dispose();
  });
});
