/**
 * Server-boundary proof for dynamic map size: an editor-shaped save that GROWS a map round-trips
 * into a joinable room, and a hero legitimately standing on ground a later editor save erases
 * snaps to the new map's own entry on rejoin.
 *
 * No production code changes here. `restoreStandablePosition` (`AdmissionService.ts:290`) already
 * snaps a non-standable persisted position to the map entry — this suite PROVES that mechanism
 * holds for the re-crop scenario the dynamic-map-size design leans on: an author's map genuinely
 * GROWS (new content painted well outside the original bounds), a hero is saved standing on that
 * new ground, the author's next save erases it and the map's own dims genuinely SHRINK back, and
 * the hero's now-stranded position is snapped to the map's entry on the next join.
 *
 * The fixture's default map (`defaultMapInput`) is entirely grass, so every cell already counts as
 * authored content and its content bounds are the WHOLE document. Padding that map to the full
 * canvas and cropping it straight back can only ever GROW the saved size (content +
 * `MAP_OCEAN_MARGIN` on every side) — it can never shrink one. That is why both legs below
 * explicitly PAINT an outlier cell well outside the original content before the first save (a real
 * growth, asserted against the map's own original dims, not merely against the 256-cell canvas
 * ceiling every crop trivially satisfies) and explicitly OMIT that outlier before the second save
 * (a real shrink, asserted against the grown dims) — never relying on pad+crop alone to produce a
 * smaller map.
 *
 * The server test cannot import editor code (`@lindocara/editor` depends on `server`'s siblings,
 * not the other way around), so the helpers below re-apply the same engine primitives the editor's
 * own `toSaveInput` (`packages/editor/src/game/editor-state.ts`) composes: `padMapToCanvas` +
 * `derivedMapRect` + `cropMapToRect` (`@lindocara/engine/map-canvas.js`), `encodeTileLayer`
 * (`@lindocara/engine/tile-layer-codec.js`) and `compileAuthoredMap`/`encodeMap`
 * (`@lindocara/engine/hd2d/authored-map.js`, `@lindocara/engine/hd2d/map-data.js`).
 *
 * Fixture, socket and wire-reading patterns (`FakeClock`, `fakeSocket`, `messages`, `welcome`,
 * `createEngine`) are copied from `peasant-persistence.test.ts` rather than shared — file-local by
 * this suite's own convention (see that file's docblock).
 */
import type { MapAudioConfig } from "@lindocara/engine/audio-catalog.js";
import { compileAuthoredMap } from "@lindocara/engine/hd2d/authored-map.js";
import {
  decodeMap,
  encodeMap,
  type MapData as HeightfieldMapData,
} from "@lindocara/engine/hd2d/map-data.js";
import {
  cropMapToRect,
  derivedMapRect,
  type MapCanvasContent,
  type MapRect,
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
import { EMPTY_TILE } from "@lindocara/engine/tileset.js";
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

/** The `GET`/`PUT /api/maps/:id` wire shape this suite cares about — the fields the save-body
 *  builders below read off a GET and re-send on the following PUT. */
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

interface SaveBody {
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

interface CanvasSaveResult {
  body: SaveBody;
  /** The derived content rect the body was cropped to — needed to translate a padded-canvas cell
   *  into THIS save's own world coordinates (`worldPointOfCanvasCell`). */
  rect: MapRect;
  /** The compiled heightfield `compileAuthoredMap` produced for this body, undecoded: building the
   *  room's terrain from this directly (rather than round-tripping through `decodeMap(encodeMap(...))`)
   *  is what lets a test check standability BEFORE the body is ever PUT. */
  heightfield: HeightfieldMapData;
}

/** Decode a GET payload's RLE layers into the shape every `map-canvas.js` primitive reads. */
function decodeContent(payload: MapWirePayload): MapCanvasContent {
  const decodedLayers: TileLayer[] = payload.layers.map((raw) => {
    const layer = parseTileLayer(raw, payload.cols, payload.rows);
    if (!layer) throw new Error("fixture map layer failed to decode");
    return layer;
  });
  return {
    layers: decodedLayers,
    elements: payload.elements,
    spawn: payload.spawn,
    markers: payload.markers,
    events: payload.events,
  };
}

/**
 * Paints one grass ground cell `offsetCols` columns east of the canvas's own spawn — an outlier
 * far outside the fixture's original content, on the SAME padded canvas `padMapToCanvas` produced.
 * Copies an existing grass tile id from the spawn cell rather than minting a new one: the id
 * already belongs to the map's tileset (it is reused, not invented), so nothing about
 * `validateMapInput`'s tileset check can be different for it than for any other painted cell.
 */
function paintGrassOutlier(
  canvas: MapCanvasContent,
  offsetCols: number,
): { canvas: MapCanvasContent; col: number; row: number } {
  const ground = canvas.layers[0];
  if (!ground) throw new Error("canvas has no ground layer");
  const sourceCol = canvas.spawn.col;
  const sourceRow = canvas.spawn.row;
  const sourceId = ground.ids[sourceRow * ground.cols + sourceCol];
  if (sourceId === undefined || sourceId === EMPTY_TILE) {
    throw new Error("fixture spawn cell is not painted ground");
  }
  const outlierCol = sourceCol + offsetCols;
  const outlierRow = sourceRow;
  if (outlierCol < 0 || outlierCol >= ground.cols) {
    throw new Error("outlier column falls outside the canvas");
  }
  const ids = [...ground.ids];
  ids[outlierRow * ground.cols + outlierCol] = sourceId;
  const paintedGround: TileLayer = { cols: ground.cols, rows: ground.rows, ids };
  return {
    canvas: { ...canvas, layers: [paintedGround, ...canvas.layers.slice(1)] },
    col: outlierCol,
    row: outlierRow,
  };
}

/**
 * Derives the content rect out of a (possibly outlier-painted) canvas, crops it and builds the PUT
 * body the editor's `toSaveInput` builds — cropped layers/elements/spawn/events plus the cropped
 * document's OWN compiled heightfield, exactly as `toSaveInput` computes
 * `encodeMap(compileAuthoredMap(data, cropped.events))`.
 */
function saveBodyFromCanvas(meta: MapWirePayload, canvas: MapCanvasContent): CanvasSaveResult {
  const rect = derivedMapRect(canvas);
  const cropped = cropMapToRect(canvas, rect);
  const authored: AuthoredMapData = {
    tilesetId: meta.tilesetId,
    cols: rect.cols,
    rows: rect.rows,
    layers: cropped.layers,
    elements: cropped.elements,
    spawn: cropped.spawn,
  };
  const heightfield = compileAuthoredMap(authored, cropped.events);
  const body: SaveBody = {
    name: meta.name,
    tilesetId: meta.tilesetId,
    cols: rect.cols,
    rows: rect.rows,
    layers: cropped.layers.map(encodeTileLayer),
    elements: cropped.elements,
    spawn: cropped.spawn,
    markers: cropped.markers,
    events: cropped.events,
    audio: meta.audio,
    heroSettings: meta.heroSettings,
    dayNightCycle: meta.dayNightCycle,
    fixedLighting: meta.fixedLighting,
    heightfield: encodeMap(heightfield),
  };
  return { body, rect, heightfield };
}

/** The world ground coordinates of a padded-canvas cell, under a save whose content was cropped to
 *  `rect` — the same `col + 0.5 - size / 2` cell-centre formula `compileAuthoredMap` uses for the
 *  authored spawn, applied to an arbitrary cell instead. */
function worldPointOfCanvasCell(rect: MapRect, col: number, row: number): { x: number; z: number } {
  const size = Math.max(rect.cols, rect.rows);
  return { x: col - rect.col + 0.5 - size / 2, z: row - rect.row + 0.5 - size / 2 };
}

interface GrownFixture {
  original: MapWirePayload;
  /** The pristine, un-painted full canvas — reused untouched for the shrink leg below, so
   *  "shrinking" means literally re-deriving from the content as it stood BEFORE the outlier, not
   *  re-fetching a row that already has the outlier baked into its stored ground layer. */
  canvas: MapCanvasContent;
  grown: CanvasSaveResult;
  outlierCol: number;
  outlierRow: number;
}

/** GETs the fixture's freshly-created default map, pads it to the canvas, paints a grass outlier
 *  well outside the original content and PUTs the result. Growth is asserted against the map's own
 *  ORIGINAL dims (not the 256-cell canvas ceiling every crop trivially satisfies), because that is
 *  the claim both tests below depend on. */
async function growFixtureMapWithOutlier(
  fixture: ResizeFixture,
  offsetCols = 30,
): Promise<GrownFixture> {
  const getResponse = await authedFetch(`/api/maps/${fixture.mapId}`, fixture.token);
  expect(getResponse.status).toBe(200);
  const original = (await getResponse.json()) as MapWirePayload;
  const canvas = padMapToCanvas(decodeContent(original));
  const painted = paintGrassOutlier(canvas, offsetCols);
  const grown = saveBodyFromCanvas(original, painted.canvas);

  // Genuinely LARGER than the map's own original dims — an outlier this far outside the original
  // content cannot be absorbed by the ocean margin alone.
  expect(grown.body.cols).toBeGreaterThan(original.cols);

  const putResponse = await authedFetch(`/api/maps/${fixture.mapId}`, fixture.token, {
    method: "PUT",
    body: JSON.stringify(grown.body),
  });
  expect(putResponse.status).toBe(200);
  const updated = (await putResponse.json()) as { revision: number; cols: number; rows: number };
  expect(updated.revision).toBe(original.revision + 1);
  expect(updated.cols).toBe(grown.body.cols);
  expect(updated.rows).toBe(grown.body.rows);

  return { original, canvas, grown, outlierCol: painted.col, outlierRow: painted.row };
}

describe("dynamic map size at the server boundary", () => {
  test("an editor-grown save round-trips: PUT larger dims, join, bounds agree", async () => {
    const fixture = await newResizeFixture("resizeputjoin");
    const { grown } = await growFixtureMapWithOutlier(fixture);

    const engine = createEngine(fixture.roomId);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "resize-join");
    await engine.join(socket);
    const admitted = welcome(socket);

    const decoded = decodeMap(admitted.world.heightfield);
    if (!decoded) throw new Error("welcome heightfield failed to decode");
    // The room's own extent agrees with the grown body, in cells: `compileAuthoredMap` derives its
    // square heightfield side from `Math.max(cols, rows)` of the authoring document it compiles.
    const grownSize = Math.max(grown.body.cols, grown.body.rows);
    expect(decoded.size).toBe(grownSize);
    expect(admitted.world.size).toBe(grownSize);

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
    const { original, canvas, grown, outlierCol, outlierRow } =
      await growFixtureMapWithOutlier(fixture);

    // The outlier is real, standable ground on the GROWN terrain — "the hero legitimately stood
    // there", not an arbitrary doctored point. Built straight from `compileAuthoredMap`'s own
    // output, so this holds before the body is ever sent over the wire.
    const grownTerrain = zoneTerrainFromHeightfield(grown.heightfield);
    const outlierPoint = worldPointOfCanvasCell(grown.rect, outlierCol, outlierRow);
    expect(
      canStand(
        grownTerrain,
        outlierPoint.x,
        outlierPoint.z,
        BODY_RADIUS,
        groundUnder(grownTerrain, outlierPoint.x, outlierPoint.z),
      ),
    ).toBe(true);

    // Persist the hero exactly there — a real position on the grown map, not a doctored one.
    await probe.heroes.updateById(fixture.heroId, {
      x: outlierPoint.x,
      y: groundUnder(grownTerrain, outlierPoint.x, outlierPoint.z),
      z: outlierPoint.z,
    });

    // Shrink: re-derive from the content exactly as it stood BEFORE the outlier was painted (the
    // pristine `canvas` captured before `growFixtureMapWithOutlier` painted it) and save. The
    // outlier is erased from the stored document, not merely left unpainted on a fresh read.
    const shrunk = saveBodyFromCanvas(original, canvas);
    expect(shrunk.body.cols).toBeLessThan(grown.body.cols);
    const shrinkResponse = await authedFetch(`/api/maps/${fixture.mapId}`, fixture.token, {
      method: "PUT",
      body: JSON.stringify(shrunk.body),
    });
    expect(shrinkResponse.status).toBe(200);
    const shrunkUpdate = (await shrinkResponse.json()) as {
      revision: number;
      cols: number;
      rows: number;
    };
    expect(shrunkUpdate.cols).toBe(shrunk.body.cols);
    expect(shrunkUpdate.rows).toBe(shrunk.body.rows);

    // The hero's persisted position is no longer standable ground on the new, shrunken terrain —
    // it is genuinely stranded, not merely re-labelled.
    const shrunkTerrain = zoneTerrainFromHeightfield(shrunk.heightfield);
    expect(
      canStand(
        shrunkTerrain,
        outlierPoint.x,
        outlierPoint.z,
        BODY_RADIUS,
        groundUnder(shrunkTerrain, outlierPoint.x, outlierPoint.z),
      ),
    ).toBe(false);

    // Re-join. welcome(socket) must place the hero at the NEW map's own entry cell
    // (`mapEntryPosition` of the stored terrain), not at the stranded coordinates.
    const engine = createEngine(fixture.roomId);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "resize-snap");
    await engine.join(socket);
    const admitted = welcome(socket);

    const decoded = decodeMap(admitted.world.heightfield);
    if (!decoded) throw new Error("welcome heightfield failed to decode");
    const terrain = zoneTerrainFromHeightfield(decoded);

    const self = admitted.players.find((player) => player.id === fixture.heroId);
    if (!self) throw new Error("welcome carried no self player");
    expect(
      canStand(terrain, self.x, self.z, BODY_RADIUS, groundUnder(terrain, self.x, self.z)),
    ).toBe(true);
    expect({ x: self.x, z: self.z }).not.toEqual({ x: outlierPoint.x, z: outlierPoint.z });

    // Not merely SOME standable cell — THE map's own entry, exactly as admission computes it.
    const entry = mapEntryPosition(terrain, decoded.spawns[0]);
    expect({ x: self.x, z: self.z }).toEqual({ x: entry.x, z: entry.z });

    await engine.leave(socket.id);
    engine.dispose();
  });
});
