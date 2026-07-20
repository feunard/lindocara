/**
 * Maps as stored things: load, create, delete, and the rules that keep the world enterable.
 *
 * Two of those rules exist only to make sure a hero always has somewhere to stand:
 *
 * - you cannot delete the last map, so nobody can empty the world by clicking delete enough times;
 * - the `is_first` flag names where a hero lands when their own map is gone, and deleting the
 *   flagged map hands the flag to a survivor rather than leaving the world without a front door.
 *
 * Placement and spawn validation live here rather than in the browser because the editor is open to
 * any logged-in player. The API is the only place these can actually be enforced.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  type AdventureGraph,
  type MapMarkerIds,
  parseAdventureGraph,
  validateAdventure,
} from "../shared/adventure.js";
import { parseEventCommands } from "../shared/event-commands.js";
import {
  bakeCollision,
  canPlaceElement,
  EMPTY_MARKERS,
  elementCoversCell,
  elementFitsMap,
  elementPlacementCells,
  elementsOverlap,
  isElementKind,
  legacyElementAssetId,
  MAP_LAYERS,
  MAX_MAP_ELEMENTS,
  type MapData,
  type MapElement,
  type MapMarkers,
  parseMapMarkers,
} from "../shared/map-data.js";
import {
  entryEvents,
  exitEvents,
  functionalEvent,
  MAX_EVENTS_PER_MAP,
  type MapEvent,
  parseMapEvents,
} from "../shared/map-events.js";
import { layersFromBlocks } from "../shared/map-migrate.js";
import {
  emptyLayer,
  encodeTileLayer,
  parseTileLayer,
  type TileLayer,
} from "../shared/tile-layer-codec.js";
import { isSolidKind, kindAt } from "../shared/tilemap.js";
import { tileIdInTileset } from "../shared/tileset.js";
import { TINY_SWORDS_TILESET_ID, tilesetById } from "../shared/tilesets/tiny-swords.js";
import { isEditorAssetId } from "../shared/tiny-swords-catalog.js";
import { adventure, type Db, map, mapElement, mapEvent, mapEventPage } from "./db/index.js";

export const BUILTIN_MAP_ID = "builtin";

export interface StoredMap extends MapData {
  id: string;
  accountId: string | null;
  /** The one adventure that owns this map. The built-in floor has no adventure. */
  adventureId: string | null;
  name: string;
  revision: number;
  /** Authored events, ordered by ordinal; pages ordered by position. Empty for maps saved before
   *  events existed and for the built-in floor. Nothing here executes this tranche. */
  events: readonly MapEvent[];
}

/**
 * The floor. Not a map you can list, edit or delete — the thing that exists so the world can always
 * start.
 *
 * Reachable only on an empty database: `deleteMap` refuses the last map, so nobody can delete their
 * way down to zero. This is the fresh-install case, not a delete outcome.
 */
const BUILTIN_BLOCKS = [
  "################",
  "#..............#",
  "#..............#",
  "#....######....#",
  "#....######....#",
  "#..............#",
  "#..............#",
  "################",
];

const BUILTIN_LAYERS = layersFromBlocks(BUILTIN_BLOCKS);

/** Deliberately 16x8 — below `MAP_MIN_*`, so it could never pass `validateMapInput`. It is the
 *  fallback room, not authored content. */
export const BUILTIN_MAP: StoredMap = {
  id: BUILTIN_MAP_ID,
  accountId: null,
  adventureId: null,
  name: "Nowhere",
  revision: 1,
  tilesetId: TINY_SWORDS_TILESET_ID,
  cols: BUILTIN_LAYERS.cols,
  rows: BUILTIN_LAYERS.rows,
  layers: BUILTIN_LAYERS.layers,
  elements: [],
  spawn: { col: 2, row: 2 },
  markers: EMPTY_MARKERS,
  events: [],
};

export interface MapInput {
  name: string;
  tilesetId: string;
  cols: number;
  rows: number;
  layers: readonly TileLayer[];
  elements: readonly MapElement[];
  spawn: { col: number; row: number };
  // `| undefined` (not just `?:`) so forwarding an already-optional `MapData.markers` read, or a
  // test's explicit `markers: undefined`, type-checks under `exactOptionalPropertyTypes`.
  markers?: MapMarkers | undefined;
  // Absent from an old client is an empty event set, not a malformed body — see `parseMapBody`.
  events?: readonly MapEvent[] | undefined;
}

/** A map small enough to fit on screen is also small enough to be a maze of one-tile corridors;
 *  a map large enough to blow up storage and network payloads is not a design choice worth
 *  allowing. Both ends are enforced on write, not in the editor. */
export const MAP_MIN_COLS = 20;
export const MAP_MAX_COLS = 100;
export const MAP_MIN_ROWS = 15;
export const MAP_MAX_ROWS = 100;
export const MAP_NAME_MAX = 48;

/** UX wave #7: every new map is a 5x5 block of grass, spawn dead centre, water everywhere else. */
export const DEFAULT_MAP_LAND = 5;

/** UX wave #16: the name the atomic adventure-create gives its born map. A fresh adventure owns zero
 *  maps, so the lowest free `MapN` is unconditionally `Map1` — a constant, not a list to consult, so
 *  the server stays dumb. Every subsequent map's `MapN` is computed client-side (`nextMapName`) and
 *  sent as the name, exactly as the new-map dialog already sends a name today. */
export const DEFAULT_FIRST_MAP_NAME = "Map1";

/**
 * The one shape a new map is ever created in (#7): a `MAP_MIN_COLS x MAP_MIN_ROWS` field of water
 * with a centred `DEFAULT_MAP_LAND x DEFAULT_MAP_LAND` block of grass, spawn on that block's centre.
 * The edges are autotile-resolved by the same brush the editor paints with (`layersFromBlocks`), so
 * the block is indistinguishable from one drawn by hand. Sizing is a later resize tool's job — map
 * create ignores any client-supplied dimensions and always builds this.
 */
export function defaultMapInput(name: string): MapInput {
  const cols = MAP_MIN_COLS;
  const rows = MAP_MIN_ROWS;
  const colStart = Math.floor((cols - DEFAULT_MAP_LAND) / 2);
  const rowStart = Math.floor((rows - DEFAULT_MAP_LAND) / 2);
  const blocks: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    let line = "";
    for (let col = 0; col < cols; col += 1) {
      const land =
        col >= colStart &&
        col < colStart + DEFAULT_MAP_LAND &&
        row >= rowStart &&
        row < rowStart + DEFAULT_MAP_LAND;
      line += land ? "." : "#";
    }
    blocks.push(line);
  }
  const { layers } = layersFromBlocks(blocks);
  const spawn = {
    col: colStart + Math.floor(DEFAULT_MAP_LAND / 2),
    row: rowStart + Math.floor(DEFAULT_MAP_LAND / 2),
  };
  // UX wave #12: the default map is born with a start-ENTRY event on the spawn cell and an end-EXIT
  // event on a corner of the land block (walkable, and not the spawn cell). A freshly created
  // adventure's graph binds these events' uuids — start -> the entry, the exit -> "end" — so the born
  // graph is playable and passes `validateAdventure` on the very first save.
  const events: MapEvent[] = [
    functionalEvent({
      id: crypto.randomUUID(),
      col: spawn.col,
      row: spawn.row,
      ordinal: 1,
      kind: "entry",
    }),
    functionalEvent({
      id: crypto.randomUUID(),
      col: colStart,
      row: rowStart,
      ordinal: 2,
      kind: "exit",
    }),
  ];
  return {
    name,
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols,
    rows,
    layers,
    elements: [],
    spawn,
    markers: EMPTY_MARKERS,
    events,
  };
}

/**
 * The map an adventure is born with (UX wave #2/#3): the 5x5 template plus the start-entry and
 * end-exit EVENTS (UX wave #12) so the adventure's graph validates immediately. Returns the drizzle
 * INSERTs to compose into the adventure's create batch (one transaction) — the map row and its event
 * rows/pages — the entry/exit event uuids the born graph binds, and the `StoredMap` the caller hands
 * back to the client. The `is_first` flag is decided by the database at insert time exactly as
 * `createMap` does.
 */
export function prepareDefaultMap(
  db: Db,
  accountId: string,
  adventureId: string,
  name: string,
): {
  id: string;
  inserts: BatchItem<"sqlite">[];
  entryEventId: string;
  exitEventId: string;
  stored: StoredMap;
} {
  const input = defaultMapInput(name);
  const data = validateMapInput(input);
  const id = crypto.randomUUID();
  const mapInsert = db.insert(map).values({
    id,
    accountId,
    adventureId,
    name: data.name,
    cols: input.cols,
    rows: input.rows,
    tilesetId: input.tilesetId,
    layers: encodeLayers(input.layers),
    spawnCol: input.spawn.col,
    spawnRow: input.spawn.row,
    markers: markersJson(data.markers),
    isFirst: sql`CASE WHEN (SELECT count(*) FROM ${map} WHERE ${map.accountId} = ${accountId}) = 0 THEN 1 ELSE 0 END`,
  });
  const entryEventId = entryEvents(data.events)[0]?.id;
  const exitEventId = exitEvents(data.events)[0]?.id;
  if (!entryEventId || !exitEventId) {
    throw new Error("default map lost its start entry or end exit event");
  }
  return {
    id,
    inserts: [mapInsert, ...insertEventStatements(db, id, data.events)],
    entryEventId,
    exitEventId,
    stored: { id, accountId, adventureId, revision: 1, ...data },
  };
}

/** Stored as a JSON array of run-length encoded layer strings — one column, three layers, and no
 *  second encoding for `tile-layer-codec.ts` to keep in step with. */
function encodeLayers(layers: readonly TileLayer[]): string {
  return JSON.stringify(layers.map(encodeTileLayer));
}

function blankLayers(cols: number, rows: number): TileLayer[] {
  return [emptyLayer(cols, rows), emptyLayer(cols, rows), emptyLayer(cols, rows)];
}

function warnCorruptLayers(mapId: string, reason: string): void {
  console.warn(JSON.stringify({ event: "map_layers_corrupt", mapId, reason }));
}

/** Never throws: a row written by an older build, or corrupted, degrades rather than failing
 *  every map the account owns. The degrade is NOT a blank *playable* map — an all-`EMPTY_TILE`
 *  ground layer bakes to all-`"water"` (`bakeCollision` in `shared/map-data.ts`), `isSolidKind`
 *  calls water solid, and `terrainFromMap` hands `World` a room whose spawn point sits on solid
 *  terrain. A hero routed there arrives stuck, with nothing in the protocol to explain why. The
 *  `console.warn` naming the map id is the only diagnostic signal that exists for this today. */
function decodeLayers(mapId: string, text: string, cols: number, rows: number): TileLayer[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    warnCorruptLayers(mapId, "invalid_json");
    return blankLayers(cols, rows);
  }
  if (!Array.isArray(raw) || raw.length !== MAP_LAYERS) {
    warnCorruptLayers(mapId, "wrong_layer_count");
    return blankLayers(cols, rows);
  }
  return raw.map((entry, index) => {
    const layer = parseTileLayer(entry, cols, rows);
    if (!layer) {
      warnCorruptLayers(mapId, `layer_${index}_malformed`);
      return emptyLayer(cols, rows);
    }
    return layer;
  });
}

/** NULL rather than an empty-array JSON string: legacy rows and freshly-emptied ones both read
 *  back as EMPTY_MARKERS via `markersOfRow`, so the column stays NULL until a map actually has
 *  markers worth persisting. */
function markersJson(markers: MapMarkers | undefined): string | null {
  if (
    !markers ||
    (markers.entries.length === 0 &&
      markers.exits.length === 0 &&
      markers.monsterSpawns.length === 0)
  ) {
    return null;
  }
  return JSON.stringify(markers);
}

/**
 * Rejects a map nobody could play before it reaches the database.
 *
 * A tree in the sea and a spawn inside a tree are the same class of bug: a map that loads fine and
 * is simply wrong. Both are cheap to check here and impossible to notice later.
 */
export function validateMapInput(input: MapInput): MapData & { name: string; events: MapEvent[] } {
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
    // Mirrors the wire-side check in `parseMapData` (shared/map-data.ts): an id no autotile slot or
    // fixed-tile index in this tileset can answer for must be refused here, not baked as solid
    // terrain by `bakeCollision` below with no diagnostic anyone could see.
    if (layer.ids.some((id) => !tileIdInTileset(tileset, id))) {
      throw new Error(`layers: contains an id unknown to tileset ${input.tilesetId}`);
    }
  }
  if (input.elements.length > MAX_MAP_ELEMENTS) {
    // Caught here, before the body would silently blow past the 32 KiB `/api/maps` cap and 413.
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
  const ground = bakeCollision({ ...data, elements: [] });
  for (const [index, element] of input.elements.entries()) {
    if (!isEditorAssetId(element.assetId)) {
      throw new Error(`placement: unknown asset ${String(element.assetId)}`);
    }
    if (!elementFitsMap(element, ground.cols, ground.rows)) {
      throw new Error(`placement: ${element.assetId} exceeds map bounds`);
    }
    for (const cell of elementPlacementCells(element)) {
      const under = kindAt(ground, cell.col, cell.row);
      if (!canPlaceElement(element.assetId, under)) {
        throw new Error(`placement: ${element.assetId} cannot stand on ${under}`);
      }
    }
    if (elementCoversCell(element, input.spawn.col, input.spawn.row)) {
      throw new Error("spawn: cannot be covered by scenery");
    }
    if (input.elements.slice(0, index).some((other) => elementsOverlap(other, element))) {
      throw new Error(`placement: ${element.assetId} overlaps another element`);
    }
  }
  const baked = bakeCollision(data);
  if (isSolidKind(kindAt(baked, input.spawn.col, input.spawn.row))) {
    throw new Error("spawn: must be a cell a hero can stand on");
  }
  // Markers are QUARANTINED (UX wave #12): the column still round-trips, so the payload is still
  // shape-checked, but nothing functional is validated against it — entries/exits/monster spawns are
  // events now. `parseMapEvents` re-runs the full defensive shape check against THIS map's
  // dimensions, so count (<= MAX_EVENTS_PER_MAP), in-bounds cells, unique cells, unique ids and the
  // per-kind discriminant are all re-validated here rather than trusting a pre-parsed `input.events`.
  const markers = parseMapMarkers(input.markers, baked.cols, baked.rows);
  if (!markers) throw new Error("markers: malformed marker payload");
  const events = parseMapEvents(input.events ?? [], cols, rows);
  if (!events) {
    throw new Error(`events: malformed, out of bounds, or more than ${MAX_EVENTS_PER_MAP} events`);
  }
  // A `normal` event floats above collision (it may sit on the spawn, on an element, on water — a
  // different plane). A functional event is load-bearing: an entry/exit/monster on solid ground is a
  // map nobody could play, so the old marker-walkability rules move here, keyed by kind. An exit may
  // not share the spawn cell (a revolving-door on arrival); entry/exit share no cell by construction
  // (one event per cell).
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
  // Trimmed, not raw: the name that passed validation is the name that gets stored.
  return { ...data, markers, name, events };
}

/** Corrupt or unknown JSON degrades the whole blob to empty, unlike `elementsOf`, which drops only
 *  the individual bad rows and keeps the rest of the map. */
export function markersOfRow(row: {
  markers: string | null;
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

function toStoredMap(
  row: typeof map.$inferSelect,
  elements: MapElement[],
  events: MapEvent[],
): StoredMap {
  return {
    id: row.id,
    accountId: row.accountId,
    adventureId: row.adventureId,
    name: row.name,
    revision: row.revision,
    tilesetId: row.tilesetId,
    cols: row.cols,
    rows: row.rows,
    layers: decodeLayers(row.id, row.layers, row.cols, row.rows),
    elements,
    spawn: { col: row.spawnCol, row: row.spawnRow },
    markers: markersOfRow(row),
    events,
  };
}

async function elementsOf(db: Db, mapId: string): Promise<MapElement[]> {
  const rows = await db.select().from(mapElement).where(eq(mapElement.mapId, mapId));
  // The `map_element` table has no offset columns yet (a later tranche), so every row read back is
  // aligned to its cell origin — the same "absent is 0" default `parseOffsetStep` applies on the wire.
  return rows.flatMap((row): MapElement[] =>
    isEditorAssetId(row.kind)
      ? [{ col: row.col, row: row.row, offsetX: 0, offsetY: 0, assetId: row.kind }]
      : isElementKind(row.kind)
        ? [
            {
              col: row.col,
              row: row.row,
              offsetX: 0,
              offsetY: 0,
              assetId: legacyElementAssetId(row.kind, row.variant),
            },
          ]
        : // A kind this build does not know is scenery it cannot draw. Drop the element rather than
          // fail the whole map: one bad row must not make a world unenterable.
          [],
  );
}

/** A page's `commands` TEXT blob back into a program. Corrupt or unknown JSON degrades to the empty
 *  program rather than failing — a stored page always yields a playable (if inert) page, the same
 *  degrade `decodeLayers`/`elementsOf` use for a row an older or broken build wrote. */
function parseCommandsColumn(text: string): MapEvent["pages"][number]["commands"] {
  try {
    return parseEventCommands(JSON.parse(text)) ?? [];
  } catch {
    return [];
  }
}

/** Events ordered by ordinal, each carrying its pages ordered by position. An event whose pages
 *  row set is somehow empty is dropped rather than surfaced as an invalid zero-page event — the
 *  same "one bad row must not break the map" degrade as `elementsOf`. The typed enum/`$type`
 *  columns mean rows already carry the `MapEventPage` field types, so no cast is needed. */
async function eventsOf(db: Db, mapId: string): Promise<MapEvent[]> {
  const eventRowsForMap = await db
    .select()
    .from(mapEvent)
    .where(eq(mapEvent.mapId, mapId))
    .orderBy(asc(mapEvent.ordinal));
  if (eventRowsForMap.length === 0) return [];
  const pageRowsForMap = await db
    .select()
    .from(mapEventPage)
    .where(
      inArray(
        mapEventPage.eventId,
        eventRowsForMap.map((row) => row.id),
      ),
    )
    .orderBy(asc(mapEventPage.position));
  const pagesByEvent = new Map<string, MapEvent["pages"][number][]>();
  for (const page of pageRowsForMap) {
    const list = pagesByEvent.get(page.eventId) ?? [];
    list.push({
      condSwitchId: page.condSwitchId,
      condVariableId: page.condVariableId,
      condVariableMin: page.condVariableMin,
      condSelfSwitch: page.condSelfSwitch,
      graphicAssetId: page.graphicAssetId,
      moveType: page.moveType,
      moveSpeed: page.moveSpeed,
      moveFreq: page.moveFreq,
      optMoveAnim: page.optMoveAnim,
      optStopAnim: page.optStopAnim,
      optDirFix: page.optDirFix,
      optThrough: page.optThrough,
      optOnTop: page.optOnTop,
      trigger: page.trigger,
      // The column is JSON we wrote through `parseEventCommands`, so it parses back cleanly; a row
      // corrupted by a hand-edit or an older build degrades to the empty program (a no-op page)
      // rather than dropping the whole event — the "one bad row must not break the map" degrade.
      commands: parseCommandsColumn(page.commands),
    });
    pagesByEvent.set(page.eventId, list);
  }
  return eventRowsForMap.flatMap((row): MapEvent[] => {
    const pages = pagesByEvent.get(row.id);
    if (!pages || pages.length === 0) return [];
    // A monster row missing its species/radius is a corrupt half-row: drop it rather than surface a
    // monster event the parser would reject, the same "one bad row must not break the map" degrade.
    const isMonster = row.kind === "monster";
    if (isMonster && (row.species === null || row.patrolRadius === null)) return [];
    return [
      {
        id: row.id,
        col: row.col,
        row: row.row,
        name: row.name,
        ordinal: row.ordinal,
        kind: row.kind,
        species: isMonster ? row.species : null,
        patrolRadius: isMonster ? row.patrolRadius : null,
        pages,
      },
    ];
  });
}

export async function loadMap(db: Db, id: string): Promise<StoredMap | null> {
  const [row] = await db.select().from(map).where(eq(map.id, id)).limit(1);
  if (!row) return null;
  return toStoredMap(row, await elementsOf(db, id), await eventsOf(db, id));
}

export async function loadOwnedMap(
  db: Db,
  accountId: string,
  id: string,
): Promise<StoredMap | null> {
  const [row] = await db
    .select()
    .from(map)
    .where(and(eq(map.id, id), eq(map.accountId, accountId)))
    .limit(1);
  if (!row) return null;
  return toStoredMap(row, await elementsOf(db, id), await eventsOf(db, id));
}

/**
 * The maps of one adventure the caller owns (UX wave #5: a map belongs to exactly one adventure, so
 * the library is listed per-adventure, not per-account). The `accountId` gate is redundant with the
 * `adventureId` scope — a map's account always equals its adventure's — but keeps a foreign caller
 * from listing another owner's adventure's maps by id.
 */
export async function listMapsForAdventure(
  db: Db,
  accountId: string,
  adventureId: string,
): Promise<
  { id: string; name: string; revision: number; cols: number; rows: number; isFirst: boolean }[]
> {
  const rows = await db
    .select()
    .from(map)
    .where(and(eq(map.accountId, accountId), eq(map.adventureId, adventureId)))
    .orderBy(asc(map.createdAt));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    revision: row.revision,
    cols: row.cols,
    rows: row.rows,
    isFirst: row.isFirst === 1,
  }));
}

export async function firstMap(db: Db, accountId: string): Promise<StoredMap | null> {
  const [row] = await db
    .select()
    .from(map)
    .where(and(eq(map.accountId, accountId), eq(map.isFirst, 1)))
    .limit(1);
  if (!row) return null;
  return toStoredMap(row, await elementsOf(db, row.id), await eventsOf(db, row.id));
}

function elementRows(mapId: string, elements: readonly MapElement[]) {
  return elements.map((element) => ({
    mapId,
    col: element.col,
    row: element.row,
    kind: element.assetId,
    variant: 0,
  }));
}

/**
 * D1 refuses any single query bound to more than 100 parameters. A multi-row `INSERT` binds one
 * parameter per column of `elementRows` above — mapId, col, row, kind, variant, five today — so one
 * unchunked statement tops out around `100 / 5` = 20 rows, well under `MAX_MAP_ELEMENTS` (400): a
 * map decorated with more than about twenty elements failed to save entirely, with nothing in
 * `validateMapInput` to catch it first. The chunk size is derived from the real column count rather
 * than a literal row number, so it keeps working if `mapElement` gains a column later, and it
 * targets 60% of the cap rather than sitting on it, so that future growth doesn't immediately
 * regress the headroom back onto the line.
 */
const D1_MAX_BOUND_PARAMETERS = 100;
const MAP_ELEMENT_PARAMS_PER_ROW = 5; // mapId, col, row, kind, variant — mirrors `mapElement` in db/schema.ts
const MAP_ELEMENT_CHUNK_ROWS = Math.floor(
  (D1_MAX_BOUND_PARAMETERS * 0.6) / MAP_ELEMENT_PARAMS_PER_ROW,
);

function chunkRows<T>(rows: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

/** One `INSERT` per chunk so no single statement can cross D1's bound-parameter cap. Every chunk
 *  still rides in the same `db.batch()` call as the rest of the write (see the callers), and D1
 *  treats one `batch()` call as one transaction, so splitting the INSERT here does not create a
 *  window where a map could persist with only some of its elements written. */
function insertElementStatements(db: Db, mapId: string, elements: readonly MapElement[]) {
  return chunkRows(elementRows(mapId, elements), MAP_ELEMENT_CHUNK_ROWS).map((rows) =>
    db.insert(mapElement).values(rows),
  );
}

/**
 * Events and their pages ride the same batch as elements and hit the same D1 100-bound-parameter
 * cap. An event INSERT binds 9 parameters per row (id, map_id, col, row, name, ordinal, kind,
 * species, patrol_radius — created_at defaults), so an unchunked write of the 64-event maximum would
 * bind 576 and D1 would refuse the whole batch. A page INSERT binds 18 (id, event_id,
 * position, four condition columns, graphic_asset_id, three move columns, five opt columns,
 * trigger, and tranche 5's `commands` blob — the whole program is ONE bound parameter, a JSON
 * string, so a page's command volume never grows its parameter count), and the 64x8 = 512-page
 * maximum would bind 9,216. Both chunk sizes derive from the real column count and target 60% of the
 * cap, matching the element rule above so a later column keeps headroom instead of regressing onto
 * the line.
 */
const MAP_EVENT_PARAMS_PER_ROW = 9; // id, mapId, col, row, name, ordinal, kind, species, patrol_radius — mirrors `mapEvent` (created_at defaults)
const MAP_EVENT_CHUNK_ROWS = Math.floor((D1_MAX_BOUND_PARAMETERS * 0.6) / MAP_EVENT_PARAMS_PER_ROW);
const MAP_EVENT_PAGE_PARAMS_PER_ROW = 18; // id, eventId, position, 4 cond, graphic, 3 move, 5 opt, trigger, commands — mirrors `mapEventPage`
const MAP_EVENT_PAGE_CHUNK_ROWS = Math.floor(
  (D1_MAX_BOUND_PARAMETERS * 0.6) / MAP_EVENT_PAGE_PARAMS_PER_ROW,
);

function eventRows(mapId: string, events: readonly MapEvent[]) {
  return events.map((event) => ({
    id: event.id,
    mapId,
    col: event.col,
    row: event.row,
    name: event.name,
    ordinal: event.ordinal,
    kind: event.kind,
    species: event.species,
    patrolRadius: event.patrolRadius,
  }));
}

/** A page's durable identity is `(event_id, position)`, so the pk uuid is minted fresh here on every
 *  rewrite — the client never supplies a page id (it is not on the wire). Only EVENT ids come from
 *  the client. `position` is the page's index within its event. */
function eventPageRows(events: readonly MapEvent[]) {
  return events.flatMap((event) =>
    event.pages.map((page, position) => ({
      id: crypto.randomUUID(),
      eventId: event.id,
      position,
      condSwitchId: page.condSwitchId,
      condVariableId: page.condVariableId,
      condVariableMin: page.condVariableMin,
      condSelfSwitch: page.condSelfSwitch,
      graphicAssetId: page.graphicAssetId,
      moveType: page.moveType,
      moveSpeed: page.moveSpeed,
      moveFreq: page.moveFreq,
      optMoveAnim: page.optMoveAnim,
      optStopAnim: page.optStopAnim,
      optDirFix: page.optDirFix,
      optThrough: page.optThrough,
      optOnTop: page.optOnTop,
      trigger: page.trigger,
      // Stored as one JSON blob, the shape `parseCommandsColumn` reads back. Empty programs persist
      // as `'[]'`, matching the column default so a never-authored page round-trips identically.
      commands: JSON.stringify(page.commands),
    })),
  );
}

/** Chunked event and page inserts — event parents first so a page FK always resolves within the
 *  batch. Every chunk rides in the caller's `db.batch()` (one transaction), so an event never
 *  persists with only some of its pages, and a chunked write is exactly as atomic as a single
 *  statement would be. */
export function insertEventStatements(db: Db, mapId: string, events: readonly MapEvent[]) {
  const parents = chunkRows(eventRows(mapId, events), MAP_EVENT_CHUNK_ROWS).map((rows) =>
    db.insert(mapEvent).values(rows),
  );
  const pages = chunkRows(eventPageRows(events), MAP_EVENT_PAGE_CHUNK_ROWS).map((rows) =>
    db.insert(mapEventPage).values(rows),
  );
  return [...parents, ...pages];
}

/** The adventure `adventureId` that `accountId` owns, or null. Map operations that require an
 *  adventure resolve ownership through it (the map's owner is the adventure's owner). */
async function ownedAdventure(db: Db, accountId: string, adventureId: string) {
  const [row] = await db
    .select({ id: adventure.id, accountId: adventure.accountId })
    .from(adventure)
    .where(eq(adventure.id, adventureId))
    .limit(1);
  if (!row || row.accountId !== accountId) return null;
  return row;
}

/**
 * Create a map inside an adventure (UX wave #5 + #7). Ownership is checked through the adventure —
 * a map created under an adventure the caller does not own is refused with `not_found`. The map is
 * ALWAYS the 5x5 template (`defaultMapInput`); any client-supplied terrain/size is ignored, so the
 * new-map dialog only sends a name.
 */
export async function createMap(
  db: Db,
  accountId: string,
  adventureId: string,
  name: string,
): Promise<StoredMap> {
  const owner = await ownedAdventure(db, accountId, adventureId);
  if (!owner) throw new Error("not_found: no such adventure");
  const input = defaultMapInput(name);
  const data = validateMapInput(input);
  const id = crypto.randomUUID();
  const insertMap = db.insert(map).values({
    id,
    accountId,
    adventureId,
    name: data.name,
    cols: input.cols,
    rows: input.rows,
    tilesetId: input.tilesetId,
    layers: encodeLayers(input.layers),
    spawnCol: input.spawn.col,
    spawnRow: input.spawn.row,
    markers: markersJson(data.markers),
    // The front door is decided by the database at insert time, never by a read-then-write: the very
    // first row to exist wins. Two concurrent creates on an empty table cannot both flag themselves,
    // because SQLite serializes the writes and the second's CASE sees the first's committed row.
    isFirst: sql`CASE WHEN (SELECT count(*) FROM ${map} WHERE ${map.accountId} = ${accountId}) = 0 THEN 1 ELSE 0 END`,
  });
  const elementStatements = insertElementStatements(db, id, input.elements);
  const eventStatements = insertEventStatements(db, id, data.events);
  const attachments = [...elementStatements, ...eventStatements];
  if (attachments.length > 0) {
    // One transaction: the map, its scenery and its events arrive together, never a map with no
    // elements or events yet that a room could load mid-create. Every chunk rides in this same
    // batch, and events (parents) always precede their pages inside `insertEventStatements`.
    await db.batch([insertMap, ...attachments]);
  } else {
    await insertMap;
  }
  return { id, accountId, adventureId, revision: 1, ...data };
}

export async function updateMap(
  db: Db,
  accountId: string,
  id: string,
  input: MapInput,
): Promise<StoredMap> {
  const data = validateMapInput(input);
  const existing = await loadOwnedMap(db, accountId, id);
  if (!existing) throw new Error("not_found: no such map");
  // A map belongs to exactly one adventure (UX wave #5), so revalidation is against THAT adventure's
  // graph alone — the cross-account loop is gone, ownership is guaranteed by the fk. Editing this
  // map's markers must not break its owning adventure's saved graph (a bound exit removed, a start
  // entry gone). A draft graph (`start === null`) protects nothing, so the edit passes freely.
  if (existing.adventureId) {
    const [owner] = await db
      .select({
        title: adventure.title,
        maxPlayers: adventure.maxPlayers,
        graph: adventure.graph,
      })
      .from(adventure)
      .where(eq(adventure.id, existing.adventureId))
      .limit(1);
    if (owner) {
      let graph: AdventureGraph | null = null;
      try {
        graph = parseAdventureGraph(JSON.parse(owner.graph));
      } catch {
        graph = null;
      }
      if (!graph) throw new Error(`referenced: adventure "${owner.title}" has a corrupt graph`);
      // The graph binds entry/exit EVENT uuids now (UX wave #12). This map's anchors come from the
      // events being saved (`data.events`); every OTHER member map's from its stored `map_event` rows.
      const memberRows = await db
        .select({ id: map.id })
        .from(map)
        .where(eq(map.adventureId, existing.adventureId));
      const markersByMap = new Map<string, MapMarkerIds>();
      for (const memberRow of memberRows) {
        markersByMap.set(memberRow.id, { entryIds: [], exitIds: [] });
      }
      const otherIds = memberRows.map((row) => row.id).filter((memberId) => memberId !== id);
      if (otherIds.length > 0) {
        const eventRows = await db
          .select({ mapId: mapEvent.mapId, id: mapEvent.id, kind: mapEvent.kind })
          .from(mapEvent)
          .where(inArray(mapEvent.mapId, otherIds));
        for (const event of eventRows) {
          const anchors = markersByMap.get(event.mapId);
          if (!anchors) continue;
          if (event.kind === "entry") (anchors.entryIds as string[]).push(event.id);
          else if (event.kind === "exit") (anchors.exitIds as string[]).push(event.id);
        }
      }
      markersByMap.set(id, {
        entryIds: entryEvents(data.events).map((event) => event.id),
        exitIds: exitEvents(data.events).map((event) => event.id),
      });
      try {
        validateAdventure(
          { title: owner.title, maxPlayers: owner.maxPlayers, graph },
          markersByMap,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : "invalid graph";
        throw new Error(`referenced: adventure "${owner.title}" would become invalid (${reason})`);
      }
    }
  }
  const updateRow = db
    .update(map)
    .set({
      name: data.name,
      cols: input.cols,
      rows: input.rows,
      tilesetId: input.tilesetId,
      layers: encodeLayers(input.layers),
      spawnCol: input.spawn.col,
      spawnRow: input.spawn.row,
      markers: markersJson(data.markers),
      revision: sql`${map.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(map.id, id), eq(map.accountId, accountId)))
    .returning({ revision: map.revision });
  // Replace wholesale (diffing would only be a slower way to reach the same rows), but as ONE
  // transaction: the new layers, elements and events land together, so a room admitted mid-update
  // can never load the new terrain paired with the old — or zero — elements or events. Clearing
  // `mapEvent` cascades to `map_event_page`, so a stale page can never outlive its event.
  const clearElements = db.delete(mapElement).where(eq(mapElement.mapId, id));
  const clearEvents = db.delete(mapEvent).where(eq(mapEvent.mapId, id));
  const elementStatements = insertElementStatements(db, id, input.elements);
  const eventStatements = insertEventStatements(db, id, data.events);
  // updateRow stays first so its `.returning({ revision })` is `batchResults[0]`. Deletes run before
  // inserts, and events (parents) before pages within `insertEventStatements`.
  const batchResults = await db.batch([
    updateRow,
    clearElements,
    clearEvents,
    ...elementStatements,
    ...eventStatements,
  ]);
  const updatedRows = batchResults[0] as { revision: number }[];
  const updated = updatedRows[0];
  if (!updated) throw new Error("not_found: map ownership changed mid-update");
  return { id, accountId, adventureId: existing.adventureId, revision: updated.revision, ...data };
}

/**
 * Hand the front-door flag to a chosen map. Exactly one map carries it, before and after — the
 * clear and the set are one `db.batch`, so a crash between them cannot leave zero maps flagged.
 */
export async function setFirstMap(db: Db, accountId: string, id: string): Promise<void> {
  const [row] = await db
    .select()
    .from(map)
    .where(and(eq(map.id, id), eq(map.accountId, accountId)))
    .limit(1);
  if (!row) throw new Error("not_found: no such map");
  await db.batch([
    db
      .update(map)
      .set({ isFirst: 0 })
      .where(and(eq(map.accountId, accountId), eq(map.isFirst, 1))),
    db
      .update(map)
      .set({ isFirst: 1 })
      .where(and(eq(map.accountId, accountId), eq(map.id, id))),
  ]);
}

/** Whether an adventure's stored graph names `mapId` anywhere — its start, a link's source, or a
 *  link's destination. A corrupt graph is treated as referencing nothing (delete is not the place
 *  to fail on it). */
function graphReferencesMap(graphJson: string, mapId: string): boolean {
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

/**
 * Deleting the last map is refused, and deleting the front door moves the flag rather than removing
 * it. Between them, there is always exactly one map flagged and at least one map to flag.
 *
 * Every write is one transaction, each guarded by the same live `count(*)`, so two concurrent deletes
 * of the last two maps cannot both win: SQLite serializes the batches, the second sees the first's
 * committed delete, and `count(*) > 1` refuses it. The heir handover rides in the same transaction,
 * so there is never an instant with the flagged map gone and nothing carrying the flag.
 */
export async function deleteMap(db: Db, accountId: string, id: string): Promise<void> {
  const [row] = await db
    .select()
    .from(map)
    .where(and(eq(map.id, id), eq(map.accountId, accountId)))
    .limit(1);
  if (!row) throw new Error("not_found: no such map");

  // The owning adventure's graph may name this map (its start, a link's source or destination).
  // Deleting it would corrupt the saved graph, so it is refused while the graph references it —
  // an unlinked map (or a draft adventure) deletes freely.
  const [owner] = await db
    .select({ graph: adventure.graph })
    .from(adventure)
    .where(eq(adventure.id, row.adventureId))
    .limit(1);
  if (owner && graphReferencesMap(owner.graph, id)) {
    throw new Error("referenced: an adventure still uses this map");
  }

  const results = await db.$client.batch([
    db.$client
      .prepare(
        `DELETE FROM map_element WHERE map_id = ? AND (SELECT count(*) FROM map WHERE account_id = ?) > 1`,
      )
      .bind(id, accountId),
    db.$client
      .prepare(
        `DELETE FROM map WHERE id = ? AND account_id = ? AND (SELECT count(*) FROM map WHERE account_id = ?) > 1`,
      )
      .bind(id, accountId, accountId),
    // The old first row is gone before its successor is flagged, so the partial UNIQUE index never
    // observes two first maps. A non-first delete leaves the existing flag alone via NOT EXISTS.
    db.$client
      .prepare(
        `UPDATE map SET is_first = 1
           WHERE id = (
             SELECT id FROM map WHERE account_id = ? ORDER BY created_at ASC, id ASC LIMIT 1
           )
             AND NOT EXISTS (
               SELECT 1 FROM map WHERE account_id = ? AND is_first = 1
             )`,
      )
      .bind(accountId, accountId),
  ]);
  // The guarded DELETE refused it: this was the last owned map, and nothing in the batch changed.
  if ((results[1]?.meta.changes ?? 0) === 0) {
    throw new Error("last_map: the world needs somewhere to be");
  }
}

/**
 * Where this character actually goes. Never throws: a hero with a broken location still has to be
 * able to log in.
 *
 * Their own map, or the front door, or — only on an empty database — the built-in floor.
 */
export async function resolveMapFor(db: Db, accountId: string, zoneId: string): Promise<StoredMap> {
  const own = await loadOwnedMap(db, accountId, zoneId);
  if (own) return own;
  const first = await firstMap(db, accountId);
  if (first) return first;
  return BUILTIN_MAP;
}
