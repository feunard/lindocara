/**
 * Pure/ported map-authoring rules — the Alepha-side twin of `packages/server/src/maps.ts` and the
 * map-body parsing helpers `packages/server/src/index.ts` keeps beside its route handlers.
 *
 * Nothing here touches a database. `MapService` (`./MapService.ts`) is the only caller and is where
 * every repository read/write lives; keeping the validation/parsing/encoding pure here mirrors the
 * legacy split (`maps.ts`'s `validateMapInput` never touches `Db` either) and makes every rule in
 * this file unit-testable without booting an Alepha app.
 *
 * The legacy `"prefix: message"` `Error` convention is preserved on purpose: `rethrowAsMapError`
 * below is the direct port of `packages/server/src/index.ts`'s `mapErrorResponse`, so every message
 * a ported validator throws is still routed to the exact same machine code.
 */
import {
  type AdventureGraph,
  MAX_ADVENTURE_MAPS,
  parseAdventureGraph,
} from "@lindocara/engine/adventure.js";
import {
  EMPTY_MAP_AUDIO,
  type MapAudioConfig,
  parseMapAudioConfig,
} from "@lindocara/engine/audio-catalog.js";
import { bridgeOrientation, decodeBridgeDimensions } from "@lindocara/engine/bridges.js";
import {
  decodeBuildingTransform,
  defaultBuildingSettings,
  isStandingBuildingAsset,
  parseBuildingSettings,
} from "@lindocara/engine/buildings.js";
import {
  decodeElementTransform,
  isElementOrientation,
} from "@lindocara/engine/element-orientation.js";
import { isAuthoredWaterCell } from "@lindocara/engine/hd2d/authored-map.js";
import { decodeMap } from "@lindocara/engine/hd2d/map-data.js";
import { isUuid } from "@lindocara/engine/identifiers.js";
import {
  bakeCollision,
  EMPTY_MARKERS,
  elementCoversCell,
  elementFitsMap,
  isElementKind,
  legacyElementAssetId,
  MAP_LAYERS,
  MAX_MAP_ELEMENTS,
  type MapData,
  type MapElement,
  type MapMarkers,
  parseMapData,
  parseMapMarkers,
  sameElementSlot,
} from "@lindocara/engine/map-data.js";
import { DEFAULT_MAP_ENVIRONMENT, parseMapEnvironment } from "@lindocara/engine/map-environment.js";
import { MAX_EVENTS_PER_MAP, type MapEvent, parseMapEvents } from "@lindocara/engine/map-events.js";
import {
  defaultMapHeroSettings,
  type MapHeroSettings,
  parseMapHeroSettings,
} from "@lindocara/engine/map-hero-settings.js";
import {
  DEFAULT_MAP_FIXED_LIGHTING,
  type MapFixedLighting,
  parseMapFixedLighting,
} from "@lindocara/engine/map-lighting.js";
import {
  MAP_MAX_COLS,
  MAP_MAX_ROWS,
  MAP_MIN_COLS,
  MAP_MIN_ROWS,
} from "@lindocara/engine/map-limits.js";
import {
  DEFAULT_FIRST_MAP_NAME,
  defaultMapInput,
  type MapInput,
} from "@lindocara/engine/map-template.js";
import {
  emptyLayer,
  encodeTileLayer,
  parseTileLayer,
  type TileLayer,
} from "@lindocara/engine/tile-layer-codec.js";
import { isSolidKind, kindAt } from "@lindocara/engine/tilemap.js";
import { tileIdInTileset } from "@lindocara/engine/tileset.js";
import { tilesetById } from "@lindocara/engine/tilesets/tiny-swords.js";
import { isEditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import { HttpError } from "alepha/server";

export { MAP_MAX_COLS, MAP_MAX_ROWS, MAP_MIN_COLS, MAP_MIN_ROWS, MAX_ADVENTURE_MAPS };
export const MAP_NAME_MAX = 48;

// The authoring shape and the blank template live in the engine (`map-template.ts`), because the
// editor mints the same blank map for an unsaved sandbox — one template, or the sandbox is born on
// terrain the server would never have produced. Re-exported here so every server call site keeps
// importing its map vocabulary from this one module.
export { DEFAULT_FIRST_MAP_NAME, defaultMapInput, type MapInput };

/** Rejects a map nobody could play before it reaches the database. Ported verbatim from `maps.ts`. */
export function validateMapInput(input: MapInput): MapData & {
  name: string;
  events: MapEvent[];
  audio: MapAudioConfig;
  heroSettings: MapHeroSettings;
  dayNightCycle: boolean;
  fixedLighting: MapFixedLighting;
} {
  const name = input.name.trim();
  if (name.length === 0 || name.length > MAP_NAME_MAX) {
    throw new Error("name: 1-48 characters");
  }
  const { cols, rows } = input;
  if (cols < MAP_MIN_COLS || cols > MAP_MAX_COLS || rows < MAP_MIN_ROWS || rows > MAP_MAX_ROWS) {
    throw new Error(`size: ${MAP_MIN_COLS}x${MAP_MIN_ROWS} to ${MAP_MAX_COLS}x${MAP_MAX_ROWS}`);
  }
  if (input.layers.length !== MAP_LAYERS) {
    throw new Error(`layers: exactly ${MAP_LAYERS} required`);
  }
  for (const layer of input.layers) {
    if (layer.cols !== cols || layer.rows !== rows) {
      throw new Error("layers: every layer must match the map size");
    }
    if (layer.ids.length !== cols * rows) {
      throw new Error("layers: every layer's ids must match cols x rows");
    }
  }
  const tileset = tilesetById(input.tilesetId);
  if (!tileset) {
    throw new Error(`tileset: unknown tileset ${input.tilesetId}`);
  }
  for (const layer of input.layers) {
    if (layer.ids.some((id) => !tileIdInTileset(tileset, id))) {
      throw new Error(`layers: contains an id unknown to tileset ${input.tilesetId}`);
    }
  }
  if (input.elements.length > MAX_MAP_ELEMENTS) {
    throw new Error(`elements: at most ${MAX_MAP_ELEMENTS}`);
  }
  const environment = parseMapEnvironment(input.environment ?? DEFAULT_MAP_ENVIRONMENT);
  if (!environment) throw new Error("environment: must be exterior or interior");
  const data: MapData = {
    environment,
    tilesetId: input.tilesetId,
    cols,
    rows,
    layers: input.layers,
    elements: input.elements,
    spawn: input.spawn,
  };
  for (const [index, element] of input.elements.entries()) {
    if (!isEditorAssetId(element.assetId)) {
      throw new Error(`placement: unknown asset ${String(element.assetId)}`);
    }
    if (!elementFitsMap(element, cols, rows)) {
      throw new Error(`placement: ${element.assetId} exceeds map bounds`);
    }
    if (elementCoversCell(element, input.spawn.col, input.spawn.row)) {
      throw new Error("spawn: cannot be covered by scenery");
    }
    if (input.elements.slice(0, index).some((other) => sameElementSlot(other, element))) {
      throw new Error(`placement: ${element.assetId} duplicates another element's slot`);
    }
  }
  const baked = bakeCollision(data);
  if (isSolidKind(kindAt(baked, input.spawn.col, input.spawn.row))) {
    throw new Error("spawn: must be a cell a hero can stand on");
  }
  const markers = parseMapMarkers(input.markers, baked.cols, baked.rows);
  if (!markers) throw new Error("markers: malformed marker payload");
  const events = parseMapEvents(input.events ?? [], cols, rows);
  if (!events) {
    throw new Error("events: malformed, out of bounds, or too many events");
  }
  for (const event of events) {
    if (event.kind === "exit" && event.col === input.spawn.col && event.row === input.spawn.row) {
      throw new Error("events: an exit may not share the spawn cell");
    }
    if (event.kind === "sea-guardian" && !isAuthoredWaterCell(data, event.col, event.row)) {
      throw new Error("events: a sea guardian must be placed on water");
    }
  }
  const audio = input.audio === undefined ? EMPTY_MAP_AUDIO : parseMapAudioConfig(input.audio);
  if (!audio) throw new Error("audio: malformed map audio configuration");
  const heroSettings = parseMapHeroSettings(input.heroSettings);
  if (!heroSettings) throw new Error("hero_settings: malformed hero configuration");
  const dayNightCycle = input.dayNightCycle ?? true;
  if (typeof dayNightCycle !== "boolean") {
    throw new Error("day_night_cycle: must be a boolean");
  }
  const fixedLighting = parseMapFixedLighting(input.fixedLighting ?? DEFAULT_MAP_FIXED_LIGHTING);
  if (!fixedLighting) {
    throw new Error("fixed_lighting: must be day, night-start, night-middle, or night-full");
  }
  return { ...data, markers, name, events, audio, heroSettings, dayNightCycle, fixedLighting };
}

/**
 * Shape only — `parseMapData` already validates the tileset, the three run-length encoded layers,
 * element bounds and the spawn defensively; `validateMapInput` remains the one semantic gate. Ported
 * from `parseMapBody` in `packages/server/src/index.ts`.
 */
export function parseMapBody(body: unknown): MapInput | null {
  const name = (body as { name?: unknown } | null)?.name;
  if (typeof name !== "string") return null;
  const data = parseMapData(body);
  if (!data) return null;
  const rawEvents = (body as { events?: unknown } | null)?.events;
  const events = rawEvents === undefined ? [] : parseMapEvents(rawEvents, data.cols, data.rows);
  if (events === null) return null;
  const rawAudio = (body as { audio?: unknown } | null)?.audio;
  let audio: MapAudioConfig | undefined;
  if (rawAudio !== undefined) {
    const parsed = parseMapAudioConfig(rawAudio);
    if (parsed === null) return null;
    audio = parsed;
  }
  const rawHeroSettings = (body as { heroSettings?: unknown } | null)?.heroSettings;
  let heroSettings: MapHeroSettings | undefined;
  if (rawHeroSettings !== undefined) {
    const parsed = parseMapHeroSettings(rawHeroSettings);
    if (parsed === null) return null;
    heroSettings = parsed;
  }
  const rawDayNightCycle = (body as { dayNightCycle?: unknown } | null)?.dayNightCycle;
  if (rawDayNightCycle !== undefined && typeof rawDayNightCycle !== "boolean") return null;
  const rawFixedLighting = (body as { fixedLighting?: unknown } | null)?.fixedLighting;
  const fixedLighting =
    rawFixedLighting === undefined ? undefined : parseMapFixedLighting(rawFixedLighting);
  if (fixedLighting === null) return null;
  const environment = parseMapEnvironment(
    (body as { environment?: unknown } | null)?.environment ?? DEFAULT_MAP_ENVIRONMENT,
  );
  if (!environment) return null;
  return {
    name,
    environment,
    tilesetId: data.tilesetId,
    cols: data.cols,
    rows: data.rows,
    layers: data.layers,
    elements: data.elements,
    spawn: data.spawn,
    markers: data.markers,
    events,
    ...(audio ? { audio } : {}),
    ...(heroSettings ? { heroSettings } : {}),
    ...(rawDayNightCycle === undefined ? {} : { dayNightCycle: rawDayNightCycle }),
    ...(fixedLighting === undefined ? {} : { fixedLighting }),
  };
}

/**
 * The `{ heightfield }` body of a heightfield write (`PUT /api/maps/:id/heightfield`): the encoded
 * `MapData` string `encodeMap` produces, returned VERBATIM when it passes and carrying the machine
 * code to answer with when it does not. Pure, like everything else in this file — building the
 * `HttpError` around that code stays in the controller.
 *
 * **The decode is the gate, not a formality.** A heightfield the server cannot parse does not
 * degrade a map, it makes the room UNJOINABLE — `zoneFromMapPayload` throws, `WorldRoom.createState`
 * keeps `location: null` and admission answers 4007 (`map-heightfield.test.ts`, "a corrupt stored
 * heightfield is refused"). Stored, that failure is silent and durable: nothing else on the write
 * path would ever look at the string again. So the same `decodeMap` a joining room runs is run
 * here, first — which is also what enforces `MAX_HEIGHTFIELD_SIZE`, and with it the honesty of
 * `MOVE_COORDINATE_LIMIT` (see `MAX_HEIGHTFIELD_SIZE`'s own docblock).
 *
 * The accepted string is stored byte for byte rather than re-encoded from the decoded value: the
 * column is the wire format, `welcome` ships it unchanged, and a re-encode here would make the
 * stored terrain differ from the terrain the author verified locally for no gain — `decodeMap`
 * has already proven it parses.
 */
export type HeightfieldBodyResult =
  | { ok: true; heightfield: string }
  | {
      ok: false;
      status: 400 | 413;
      error: "map_invalid" | "map_size" | "request_too_large";
      message: string;
    };

/**
 * 1.5 MiB — the largest heightfield STRING this app will store, measured in UTF-8 bytes on the
 * value itself.
 *
 * **Measured here, on the string, because every wire-level measure is bypassable.**
 * `enforceBodySizeCap` reads `content-length`, which describes the COMPRESSED request:
 * `bodyParserOptions.inflate` is on, so a 8 KB gzip body inflating to 8 MiB satisfies every header
 * check and lands in the column anyway (the framework's only remaining ceiling is
 * `decompressBuffer`'s `limit * 10`, 40 MiB). Bounding the decoded string closes gzip, deflate and
 * br in one place, and needs nothing from the framework.
 *
 * **The value is derived from the honest worst case, not picked round.** `MAX_HEIGHTFIELD_SIZE`
 * caps a grid at 256² = 65 536 cells, so the largest legitimate encoding is every level `null`
 * (`"null,"`, 5 B → 327 680) plus every material the longest name — still the retired
 * `"glace-fine",` (13 B → 851 968), since stored maps carrying it are still accepted and read as
 * ice — about **1.18 MB** of unavoidable grid. Lowering it to the live materials' 8 B would start
 * rejecting maps this app has already written. 1.5 MiB leaves ~390 KB over it — room for some
 * 5 500 decoration entries at ~70 B each, roughly nine times the density of the proving map
 * (48 elements over 5 184 cells), on a grid twelve times its size. Real terrain is nowhere near:
 * the 72² proving heightfield is 67 816 B.
 *
 * **It is the bound that actually binds**, and the count bound below cannot replace it: a single
 * cell may carry one element whose `assetId` is two megabytes of text, because `decodeMap` bounds
 * no string it reads (`assetId`, `spawns[].name`, an event's `id`/`graphicAssetId`). Counts bound
 * how MANY entries; only this bounds how BIG.
 *
 * What is stored is re-sent verbatim in every `welcome`, and `isWorldInfo` asks only that it
 * decodes — so this number is also the ceiling on what one authored map costs every client that
 * ever joins it.
 */
export const MAX_HEIGHTFIELD_BYTES = 1_572_864;

export function parseHeightfieldBody(body: unknown): HeightfieldBodyResult {
  const refuse = (message: string): HeightfieldBodyResult => ({
    ok: false,
    status: 400,
    error: "map_invalid",
    message,
  });
  if (typeof body !== "object" || body === null) return refuse("invalid heightfield body");
  const { heightfield } = body as Record<string, unknown>;
  if (typeof heightfield !== "string") return refuse("invalid heightfield");

  // Before `decodeMap`, deliberately: this is the only bound a compressed request cannot walk
  // past, so it has to run before anything expensive touches the string. UTF-8 bytes rather than
  // `.length` — the column and the `welcome` frame carry bytes, and a code-unit count is up to
  // three times short of them.
  if (new TextEncoder().encode(heightfield).length > MAX_HEIGHTFIELD_BYTES) {
    // 413 and `request_too_large`, the same answer `enforceBodySizeCap` gives an uncompressed body
    // of the same size: whether a caller gzipped the request must not change what it is told.
    return {
      ok: false,
      status: 413,
      error: "request_too_large",
      message: "heightfield size limit exceeded",
    };
  }

  const decoded = decodeMap(heightfield);
  if (!decoded) return refuse("invalid heightfield");

  // Collection counts are the OTHER half of the bound, and not a substitute for the byte check
  // above. They follow the accepted producers rather than `cells`: editor elements have sixteen
  // quarter-cell slots, so a valid 20x20 authoring document may legitimately exceed 400 elements.
  // One element contributes at most one collider; events use their own authoring cap; named spawns
  // remain cell-addressed. `decodeMap` intentionally stays a shape decoder, so this write boundary
  // is where those resource limits belong.
  const cells = decoded.size * decoded.size;
  const overflow =
    decoded.colliders.length > MAX_MAP_ELEMENTS ||
    decoded.spawns.length > cells ||
    decoded.elements.length > MAX_MAP_ELEMENTS ||
    decoded.events.length > MAX_EVENTS_PER_MAP;
  if (overflow) {
    // `map_size`, not `map_invalid`: the payload is well formed and the refusal is a function of
    // the `size` it declared, so the family's own "this map is too big" code (`editor.error.size`,
    // `packages/client/src/api.ts`) is the honest one — and a seeding CLI printing `map_size`
    // rather than `map_invalid` tells its author which of the two things went wrong.
    return {
      ok: false,
      status: 400,
      error: "map_size",
      message: "heightfield collection limit exceeded",
    };
  }
  return { ok: true, heightfield };
}

/**
 * The optional `id` the map carried by a create body may name: the editor's SANDBOX map id.
 *
 * An unsaved sandbox authors against its own local uuid (the Teleporter preset bakes it into a
 * `teleport` command's `mapId`, the door-link tool mints two of them), so the first save has to
 * keep that id rather than mint a new one, or every reference authored before it names a map that
 * never existed.
 *
 * Three answers, not two: `undefined` is "no id carried" (mint one), `null` is "carried, but not a
 * uuid" (400 `map_invalid`). Collapsing the second into the first would silently mint an id for a
 * client that asked for a specific one, which is the very failure this exists to stop.
 *
 * Deliberately NOT part of `parseMapBody`: that shape is shared with `PUT /api/maps/:id`, where the
 * URL owns identity and a body id must stay ignored.
 */
export function parseCarriedMapId(body: unknown): string | null | undefined {
  const id = (body as { id?: unknown } | null)?.id;
  if (id === undefined) return undefined;
  return isUuid(id) ? id : null;
}

/** The `{ adventureId, name, cols, rows }` body of a new-map request. Ported from
 *  `parseCreateMapBody` in `packages/server/src/index.ts`. */
export function parseCreateMapBody(
  body: unknown,
): { adventureId: string; name: string; cols?: number; rows?: number } | null {
  if (typeof body !== "object" || body === null) return null;
  const { adventureId, name, cols, rows } = body as Record<string, unknown>;
  if (typeof adventureId !== "string" || !isUuid(adventureId)) return null;
  if (typeof name !== "string") return null;
  if (cols === undefined && rows === undefined) return { adventureId, name };
  if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows)) return null;
  return { adventureId, name, cols: cols as number, rows: rows as number };
}

/** Stored as a JSON array of run-length encoded layer strings. */
export function encodeLayers(layers: readonly TileLayer[]): string {
  return JSON.stringify(layers.map(encodeTileLayer));
}

function blankLayers(cols: number, rows: number): TileLayer[] {
  return [emptyLayer(cols, rows), emptyLayer(cols, rows), emptyLayer(cols, rows)];
}

/** Never throws — degrades to a blank grid, matching `decodeLayers` in `maps.ts`. */
export function decodeLayers(mapId: string, text: string, cols: number, rows: number): TileLayer[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    console.warn(JSON.stringify({ event: "map_layers_corrupt", mapId, reason: "invalid_json" }));
    return blankLayers(cols, rows);
  }
  if (!Array.isArray(raw) || raw.length !== MAP_LAYERS) {
    console.warn(
      JSON.stringify({ event: "map_layers_corrupt", mapId, reason: "wrong_layer_count" }),
    );
    return blankLayers(cols, rows);
  }
  return raw.map((entry, index) => {
    const layer = parseTileLayer(entry, cols, rows);
    if (!layer) {
      console.warn(
        JSON.stringify({ event: "map_layers_corrupt", mapId, reason: `layer_${index}_malformed` }),
      );
      return emptyLayer(cols, rows);
    }
    return layer;
  });
}

/** NULL sentinel for an empty marker set — matches `markersJson` in `maps.ts`. */
export function markersJson(markers: MapMarkers | undefined): string | undefined {
  if (
    !markers ||
    (markers.entries.length === 0 &&
      markers.exits.length === 0 &&
      markers.monsterSpawns.length === 0)
  ) {
    return undefined;
  }
  return JSON.stringify(markers);
}

/** Corrupt or unknown JSON degrades to `EMPTY_MARKERS` — matches `markersOfRow` in `maps.ts`. */
export function markersOfRow(row: {
  markers: string | null | undefined;
  cols: number;
  rows: number;
}): MapMarkers {
  if (!row.markers) return EMPTY_MARKERS;
  try {
    return parseMapMarkers(JSON.parse(row.markers), row.cols, row.rows) ?? EMPTY_MARKERS;
  } catch {
    return EMPTY_MARKERS;
  }
}

export function decodeMapAudio(text: string): MapAudioConfig {
  if (text === "") return EMPTY_MAP_AUDIO;
  try {
    return parseMapAudioConfig(JSON.parse(text)) ?? EMPTY_MAP_AUDIO;
  } catch {
    return EMPTY_MAP_AUDIO;
  }
}

export function decodeMapHeroSettings(text: string): MapHeroSettings {
  if (text === "") return defaultMapHeroSettings();
  try {
    return parseMapHeroSettings(JSON.parse(text)) ?? defaultMapHeroSettings();
  } catch {
    return defaultMapHeroSettings();
  }
}

/** Whether an adventure's stored graph names `mapId` anywhere. Ported from `graphReferencesMap`. */
export function graphReferencesMap(graphJson: string, mapId: string): boolean {
  let graph: AdventureGraph | null = null;
  try {
    graph = parseAdventureGraph(JSON.parse(graphJson));
  } catch {
    graph = null;
  }
  if (!graph) return false;
  if (graph.start?.mapId === mapId) return true;
  for (const link of graph.links) {
    if (link.mapId === mapId) return true;
    if (link.dest !== "end" && link.dest.mapId === mapId) return true;
  }
  return false;
}

/** Ported from `graphWithoutMap`. */
export function graphWithoutMap(graphJson: string, mapId: string): string {
  let graph: AdventureGraph | null = null;
  try {
    graph = parseAdventureGraph(JSON.parse(graphJson));
  } catch {
    return graphJson;
  }
  if (!graph) return graphJson;
  return JSON.stringify({
    start: graph.start?.mapId === mapId ? null : graph.start,
    links: graph.links.filter(
      (link) => link.mapId !== mapId && (link.dest === "end" || link.dest.mapId !== mapId),
    ),
  } satisfies AdventureGraph);
}

/** Ported from `legacyElementAssetId`/`isElementKind` dual read in `elementsOf` (`maps.ts`): a
 *  modern editor asset id round-trips as-is, a legacy tree/bush/stone kind+variant pair is
 *  normalized, and anything this build cannot draw is dropped rather than failing the whole map. */
export function elementToWire(row: {
  id: string;
  col: number;
  row: number;
  offsetX: number;
  offsetY: number;
  kind: string;
  variant: number;
  buildingDestructible?: boolean | null;
  buildingMaxHp?: number | null;
  buildingInteriorMapId?: string | null;
}): MapElement | null {
  if (isEditorAssetId(row.kind)) {
    const stored = decodeElementTransform(row.variant);
    if (!stored) return null;
    const bridgeAsset = bridgeOrientation(row.kind);
    if (bridgeAsset) {
      const bridge = decodeBridgeDimensions(stored.baseCode);
      if (bridge === null) return null;
      return {
        id: row.id,
        col: row.col,
        row: row.row,
        offsetX: row.offsetX,
        offsetY: row.offsetY,
        assetId: row.kind,
        ...(stored.rotation === undefined ? {} : { rotation: stored.rotation }),
        ...(bridge ? { bridge } : {}),
      };
    }
    if (isStandingBuildingAsset(row.kind)) {
      const transform = decodeBuildingTransform(stored.baseCode);
      if (!transform) return null;
      const building =
        parseBuildingSettings({
          destructible: row.buildingDestructible,
          maxHp: row.buildingMaxHp,
          ...(row.buildingInteriorMapId ? { interiorMapId: row.buildingInteriorMapId } : {}),
          ...(transform.dimensions ? { dimensions: transform.dimensions } : {}),
        }) ?? defaultBuildingSettings(row.kind);
      if (!building) return null;
      return {
        id: row.id,
        col: row.col,
        row: row.row,
        offsetX: row.offsetX,
        offsetY: row.offsetY,
        assetId: row.kind,
        ...(transform.orientation === 0 ? {} : { orientation: transform.orientation }),
        ...(stored.rotation === undefined ? {} : { rotation: stored.rotation }),
        building,
      };
    }
    if (!isElementOrientation(stored.baseCode) || stored.rotation !== undefined) return null;
    return {
      id: row.id,
      col: row.col,
      row: row.row,
      offsetX: row.offsetX,
      offsetY: row.offsetY,
      assetId: row.kind,
      ...(stored.baseCode === 0 ? {} : { orientation: stored.baseCode }),
    };
  }
  if (isElementKind(row.kind)) {
    return {
      id: row.id,
      col: row.col,
      row: row.row,
      offsetX: row.offsetX,
      offsetY: row.offsetY,
      assetId: legacyElementAssetId(row.kind, row.variant),
    };
  }
  return null;
}

/**
 * `maps.ts` throws `"prefix: message"`; the prefix is the machine code. Ported verbatim from
 * `mapErrorResponse` in `packages/server/src/index.ts`, but throws `HttpError` instead of building a
 * `Response` — this is the Worker-route boundary re-expressed for `$action` handlers. An unrecognized
 * prefix is rethrown as-is (matching legacy), which surfaces as an unhandled 500 rather than a
 * business error, since it was never meant to be reachable from a validated body.
 */
export function rethrowAsMapError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  const code = message.split(":")[0];
  if (code === "not_found") throw new HttpError({ status: 404, error: "map_not_found", message });
  if (code === "last_map") throw new HttpError({ status: 409, error: "last_map", message });
  if (code === "limit") throw new HttpError({ status: 409, error: "map_limit", message });
  if (code === "conflict") throw new HttpError({ status: 409, error: "map_conflict", message });
  if (code === "in_use") throw new HttpError({ status: 409, error: "map_in_use", message });
  if (code === "referenced") throw new HttpError({ status: 409, error: "map_referenced", message });
  if (
    code === "placement" ||
    code === "spawn" ||
    code === "size" ||
    code === "name" ||
    code === "elements" ||
    code === "markers" ||
    code === "events" ||
    code === "audio"
  ) {
    throw new HttpError({ status: 400, error: `map_${code}`, message });
  }
  if (code === "hero_settings") {
    throw new HttpError({ status: 400, error: "map_invalid", message });
  }
  if (code === "tileset" || code === "layers") {
    throw new HttpError({ status: 400, error: "map_invalid", message });
  }
  throw error;
}
