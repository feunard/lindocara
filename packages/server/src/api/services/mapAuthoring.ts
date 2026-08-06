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
import { type MapEvent, parseMapEvents } from "@lindocara/engine/map-events.js";
import {
  defaultMapHeroSettings,
  type MapHeroSettings,
  parseMapHeroSettings,
} from "@lindocara/engine/map-hero-settings.js";
import {
  MAP_MAX_COLS,
  MAP_MAX_ROWS,
  MAP_MIN_COLS,
  MAP_MIN_ROWS,
} from "@lindocara/engine/map-limits.js";
import { layersFromBlocks } from "@lindocara/engine/map-migrate.js";
import {
  emptyLayer,
  encodeTileLayer,
  parseTileLayer,
  type TileLayer,
} from "@lindocara/engine/tile-layer-codec.js";
import { isSolidKind, kindAt } from "@lindocara/engine/tilemap.js";
import { tileIdInTileset } from "@lindocara/engine/tileset.js";
import { TINY_SWORDS_TILESET_ID, tilesetById } from "@lindocara/engine/tilesets/tiny-swords.js";
import { isEditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import { HttpError } from "alepha/server";

export { MAP_MAX_COLS, MAP_MAX_ROWS, MAP_MIN_COLS, MAP_MIN_ROWS, MAX_ADVENTURE_MAPS };
export const MAP_NAME_MAX = 48;
export const DEFAULT_FIRST_MAP_NAME = "Map1";

export interface MapInput {
  name: string;
  tilesetId: string;
  cols: number;
  rows: number;
  layers: readonly TileLayer[];
  elements: readonly MapElement[];
  spawn: { col: number; row: number };
  markers?: MapMarkers | undefined;
  events?: readonly MapEvent[] | undefined;
  audio?: MapAudioConfig | undefined;
  heroSettings?: MapHeroSettings | undefined;
}

/**
 * The one template a new map is ever created from — ported verbatim from `maps.ts`. Bounded field of
 * flat grass, walkable everywhere, spawn dead centre, no elements, no events.
 */
export function defaultMapInput(name: string, cols = MAP_MIN_COLS, rows = MAP_MIN_ROWS): MapInput {
  if (
    !Number.isSafeInteger(cols) ||
    !Number.isSafeInteger(rows) ||
    cols < MAP_MIN_COLS ||
    cols > MAP_MAX_COLS ||
    rows < MAP_MIN_ROWS ||
    rows > MAP_MAX_ROWS
  ) {
    throw new Error("size: map dimensions are out of bounds");
  }
  const { layers } = layersFromBlocks(Array.from({ length: rows }, () => ".".repeat(cols)));
  const spawn = { col: Math.floor(cols / 2), row: Math.floor(rows / 2) };
  return {
    name,
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols,
    rows,
    layers,
    elements: [],
    spawn,
    markers: EMPTY_MARKERS,
    events: [],
    audio: EMPTY_MAP_AUDIO,
    heroSettings: defaultMapHeroSettings(),
  };
}

/** Rejects a map nobody could play before it reaches the database. Ported verbatim from `maps.ts`. */
export function validateMapInput(input: MapInput): MapData & {
  name: string;
  events: MapEvent[];
  audio: MapAudioConfig;
  heroSettings: MapHeroSettings;
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
  const data: MapData = {
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
  const walkable = (col: number, row: number) => !isSolidKind(kindAt(baked, col, row));
  for (const event of events) {
    if (event.kind === "normal") continue;
    if (!walkable(event.col, event.row)) {
      throw new Error(`events: ${event.kind} event must stand on walkable ground`);
    }
    if (event.kind === "exit" && event.col === input.spawn.col && event.row === input.spawn.row) {
      throw new Error("events: an exit may not share the spawn cell");
    }
  }
  const audio = input.audio === undefined ? EMPTY_MAP_AUDIO : parseMapAudioConfig(input.audio);
  if (!audio) throw new Error("audio: malformed map audio configuration");
  const heroSettings = parseMapHeroSettings(input.heroSettings);
  if (!heroSettings) throw new Error("hero_settings: malformed hero configuration");
  return { ...data, markers, name, events, audio, heroSettings };
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
  return {
    name,
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
  };
}

/**
 * The `{ heightfield }` body of a heightfield write (`PUT /api/maps/:id/heightfield`): the encoded
 * `MapData` string `encodeMap` produces, returned VERBATIM when it decodes and `null` when it does
 * not. Pure, like everything else in this file — the route's own `HttpError` mapping stays in the
 * controller.
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
export function parseHeightfieldBody(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { heightfield } = body as Record<string, unknown>;
  if (typeof heightfield !== "string") return null;
  return decodeMap(heightfield) ? heightfield : null;
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
  col: number;
  row: number;
  offsetX: number;
  offsetY: number;
  kind: string;
  variant: number;
}): MapElement | null {
  if (isEditorAssetId(row.kind)) {
    return {
      col: row.col,
      row: row.row,
      offsetX: row.offsetX,
      offsetY: row.offsetY,
      assetId: row.kind,
    };
  }
  if (isElementKind(row.kind)) {
    return {
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
  if (code === "tileset" || code === "layers") {
    throw new HttpError({ status: 400, error: "map_invalid", message });
  }
  throw error;
}
