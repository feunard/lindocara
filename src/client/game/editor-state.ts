/** Pure map-editor mutations. Placement, footprints and collision all come from the shared
 * catalogue, so the browser and authoritative map API cannot disagree. */
import type { MonsterSpecies } from "../../shared/game.js";
import {
  bakeCollision,
  canPlaceElement,
  EMPTY_MARKERS,
  elementCoversCell,
  elementFitsMap,
  elementPlacementCells,
  elementsOverlap,
  MAP_LAYERS,
  MARKER_LABEL_MAX,
  MAX_MAP_ELEMENTS,
  MAX_MAP_ENTRIES,
  MAX_MAP_EXITS,
  MAX_MAP_MONSTER_SPAWNS,
  MAX_PATROL_RADIUS,
  type MapData,
  type MapElement,
  type MapMarkers,
  MIN_PATROL_RADIUS,
  parseMapData,
} from "../../shared/map-data.js";
import {
  eraseTile,
  paintElevation,
  resolveWholeLayer,
  syncElevationWalls,
} from "../../shared/tile-brush.js";
import { emptyLayer, encodeTileLayer, type TileLayer } from "../../shared/tile-layer-codec.js";
import { isSolidKind, kindAt } from "../../shared/tilemap.js";
import { autotileId } from "../../shared/tileset.js";
import {
  GRASS_SLOTS,
  TINY_SWORDS_TILESET,
  TINY_SWORDS_TILESET_ID,
} from "../../shared/tilesets/tiny-swords.js";
import type { EditorAssetId } from "../../shared/tiny-swords-catalog.js";

/**
 * A map open in the editor: the three tile layers themselves, exactly as they will be saved.
 *
 * It used to be a `.`/`#` block grid projected onto layers at save time. That projection cannot
 * represent layer 1 at all, so the first elevation stroke would have been flattened back to water by
 * the next open-and-save round trip — silently, with nothing to fail. The editor now owns the same
 * model the server stores, and there is no projection left to lose anything.
 */
export interface EditorMap {
  name: string;
  /** Exactly `MAP_LAYERS`, all the same size. Index 0 is the ground, index 1 the cliff faces. */
  layers: TileLayer[];
  elements: MapElement[];
  spawn: { col: number; row: number };
  markers: MapMarkers;
}

/** Terrain strokes write the ground; only `paintElevation` reaches past it, and it owns the reach. */
const GROUND_LAYER = 0;

export type EditorTool =
  | { kind: "block"; block: "grass" | "water" }
  | { kind: "elevation"; level: 0 | 1 | 2 }
  | { kind: "element"; assetId: EditorAssetId }
  | { kind: "eraser" }
  | { kind: "spawn" }
  | { kind: "select" }
  | { kind: "pan" }
  | { kind: "marker-entry" }
  | { kind: "marker-exit" }
  | { kind: "marker-monster"; species: MonsterSpecies; patrolRadius: number };

export type EditorSelection =
  | { kind: "element"; col: number; row: number }
  | { kind: "entry"; id: string }
  | { kind: "exit"; id: string }
  | { kind: "monster"; col: number; row: number }
  | { kind: "spawn" };

export interface EditorHistory {
  past: EditorMap[];
  present: EditorMap;
  future: EditorMap[];
  saved: string;
}

/**
 * The identity a history snapshot and the dirty flag compare on.
 *
 * Layers are run-length encoded rather than stringified cell by cell: `isEditorHistoryDirty` runs on
 * every stroke, and a 100x100 map is 30 000 ids. Runs collapse a mostly-uniform map to a few dozen
 * characters, and they are exactly what gets saved, so two maps compare equal here precisely when
 * they would be stored identically.
 */
function serializedMap(map: EditorMap): string {
  return JSON.stringify({ ...map, layers: map.layers.map(encodeTileLayer) });
}

export function createEditorHistory(map: EditorMap): EditorHistory {
  return { past: [], present: map, future: [], saved: serializedMap(map) };
}

/** Commit one semantic operation. A caller painting a stroke passes only its final map here. */
export function commitEditorHistory(history: EditorHistory, next: EditorMap): EditorHistory {
  if (next === history.present || serializedMap(next) === serializedMap(history.present)) {
    return history;
  }
  return { ...history, past: [...history.past, history.present], present: next, future: [] };
}

export function undoEditorHistory(history: EditorHistory): EditorHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    ...history,
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoEditorHistory(history: EditorHistory): EditorHistory {
  const next = history.future[0];
  if (!next) return history;
  return {
    ...history,
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}

export function markEditorHistorySaved(
  history: EditorHistory,
  current = history.present,
): EditorHistory {
  return { ...history, saved: serializedMap(current) };
}

export function isEditorHistoryDirty(history: EditorHistory, current = history.present): boolean {
  return history.saved !== serializedMap(current);
}

export function selectionAt(map: EditorMap, col: number, row: number): EditorSelection | null {
  const entry = map.markers.entries.find((marker) => marker.col === col && marker.row === row);
  if (entry) return { kind: "entry", id: entry.id };
  const exit = map.markers.exits.find((marker) => marker.col === col && marker.row === row);
  if (exit) return { kind: "exit", id: exit.id };
  const monster = map.markers.monsterSpawns.find(
    (marker) => marker.col === col && marker.row === row,
  );
  if (monster) return { kind: "monster", col, row };
  const element = map.elements.find((candidate) => elementCoversCell(candidate, col, row));
  if (element) return { kind: "element", col: element.col, row: element.row };
  if (map.spawn.col === col && map.spawn.row === row) return { kind: "spawn" };
  return null;
}

export function setMarkerLabel(
  map: EditorMap,
  selection: Extract<EditorSelection, { kind: "entry" | "exit" }>,
  label: string,
): EditorMap | null {
  const normalized = label.trim();
  if (normalized.length > MARKER_LABEL_MAX) return null;
  const update = (marker: { id: string; label?: string; col: number; row: number }) => {
    if (marker.id !== selection.id) return marker;
    if (normalized.length === 0) {
      return { id: marker.id, col: marker.col, row: marker.row };
    }
    return { ...marker, label: normalized };
  };
  return selection.kind === "entry"
    ? { ...map, markers: { ...map.markers, entries: map.markers.entries.map(update) } }
    : { ...map, markers: { ...map.markers, exits: map.markers.exits.map(update) } };
}

export function deleteSelection(map: EditorMap, selection: EditorSelection): EditorMap {
  switch (selection.kind) {
    case "element":
      return {
        ...map,
        elements: map.elements.filter(
          (element) => element.col !== selection.col || element.row !== selection.row,
        ),
      };
    case "entry":
      return {
        ...map,
        markers: {
          ...map.markers,
          entries: map.markers.entries.filter((marker) => marker.id !== selection.id),
        },
      };
    case "exit":
      return {
        ...map,
        markers: {
          ...map.markers,
          exits: map.markers.exits.filter((marker) => marker.id !== selection.id),
        },
      };
    case "monster":
      return {
        ...map,
        markers: {
          ...map.markers,
          monsterSpawns: map.markers.monsterSpawns.filter(
            (marker) => marker.col !== selection.col || marker.row !== selection.row,
          ),
        },
      };
    case "spawn":
      return map;
  }
}

export function moveSelection(
  map: EditorMap,
  selection: EditorSelection,
  col: number,
  row: number,
): EditorMap | null {
  switch (selection.kind) {
    case "element": {
      const element = map.elements.find(
        (candidate) => candidate.col === selection.col && candidate.row === selection.row,
      );
      if (!element) return null;
      const without = deleteSelection(map, selection);
      return applyTool(without, { kind: "element", assetId: element.assetId }, col, row);
    }
    case "entry": {
      const entries = map.markers.entries.map((marker) =>
        marker.id === selection.id ? { ...marker, col, row } : marker,
      );
      const next = { ...map, markers: { ...map.markers, entries } };
      return keepsMarkersValid(next) ? next : null;
    }
    case "exit": {
      const exits = map.markers.exits.map((marker) =>
        marker.id === selection.id ? { ...marker, col, row } : marker,
      );
      const next = { ...map, markers: { ...map.markers, exits } };
      return keepsMarkersValid(next) ? next : null;
    }
    case "monster": {
      const marker = map.markers.monsterSpawns.find(
        (candidate) => candidate.col === selection.col && candidate.row === selection.row,
      );
      if (!marker) return null;
      return applyTool(
        deleteSelection(map, selection),
        { kind: "marker-monster", ...marker },
        col,
        row,
      );
    }
    case "spawn":
      return applyTool(map, { kind: "spawn" }, col, row);
  }
}

export function updateSelectedElementAsset(
  map: EditorMap,
  selection: Extract<EditorSelection, { kind: "element" }>,
  assetId: EditorAssetId,
): EditorMap | null {
  const without = deleteSelection(map, selection);
  return applyTool(without, { kind: "element", assetId }, selection.col, selection.row);
}

export function updateSelectedMonster(
  map: EditorMap,
  selection: Extract<EditorSelection, { kind: "monster" }>,
  species: MonsterSpecies,
  patrolRadius: number,
): EditorMap | null {
  const without = deleteSelection(map, selection);
  return applyTool(
    without,
    { kind: "marker-monster", species, patrolRadius },
    selection.col,
    selection.row,
  );
}

/** A map's dimensions, read off the ground layer — the layers are the only size there is. */
export function editorMapSize(map: EditorMap): { cols: number; rows: number } {
  const ground = map.layers[GROUND_LAYER];
  return { cols: ground?.cols ?? 0, rows: ground?.rows ?? 0 };
}

/** Flat grass everywhere on the ground, both upper layers empty. */
export function blankMap(name: string, cols: number, rows: number): EditorMap {
  const level0 = GRASS_SLOTS[0];
  // Every cell is the same slot, so every mask is "all four neighbours match" — the interior
  // variant. Filling with variant 0 and letting the brush's own resolver settle the edges keeps the
  // one autotile resolution rule in `tile-brush.ts` rather than growing a second one here.
  const filled: TileLayer = {
    cols,
    rows,
    ids: new Array<number>(cols * rows).fill(autotileId(level0, 0)),
  };
  const ground = resolveWholeLayer(filled, TINY_SWORDS_TILESET);
  const layers = [ground, ...Array.from({ length: MAP_LAYERS - 1 }, () => emptyLayer(cols, rows))];
  return {
    name,
    layers,
    elements: [],
    spawn: { col: Math.floor(cols / 2), row: Math.floor(rows / 2) },
    markers: EMPTY_MARKERS,
  };
}

/** The editor's layers are the map's layers: no projection, nothing to lose. */
export function toMapData(map: EditorMap): MapData {
  const { cols, rows } = editorMapSize(map);
  return {
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols,
    rows,
    layers: map.layers,
    elements: map.elements,
    spawn: map.spawn,
    markers: map.markers,
  };
}

/**
 * The editor's save body. Structurally `api.ts`'s `MapSaveInput` — spelled out here rather than
 * imported so `client/game/` keeps depending on nothing above it.
 */
export function toSaveInput(map: EditorMap): {
  name: string;
  tilesetId: string;
  cols: number;
  rows: number;
  layers: string[];
  elements: MapElement[];
  spawn: { col: number; row: number };
  markers: MapMarkers;
} {
  const data = toMapData(map);
  return {
    name: map.name,
    tilesetId: data.tilesetId,
    cols: data.cols,
    rows: data.rows,
    layers: data.layers.map(encodeTileLayer),
    elements: map.elements,
    spawn: map.spawn,
    markers: map.markers,
  };
}

/**
 * A map payload straight off `/api/maps/:id`, as the editor's own layers — used as-is, because they
 * are already exactly what the editor edits and what the API stores.
 *
 * A payload this build cannot parse yields no layers rather than a throw on first paint; the screen
 * then shows an empty map, the same degradation the old block projection had.
 */
export function editorLayersFromPayload(payload: unknown): TileLayer[] {
  return parseMapData(payload)?.layers.map((layer) => ({ ...layer })) ?? [];
}

/**
 * A solid/walkable mask of a stored map, one `#`/`.` character per cell.
 *
 * Display only — the AdventureEditor's SVG thumbnail — and deliberately not a round trip: it is
 * derived on load and never written back, so its lossiness (a cliff face and deep water both read
 * `#`) costs nothing. `EditorMap` itself no longer has any such projection.
 */
export function solidMaskFromMapPayload(payload: unknown): string[] {
  const data = parseMapData(payload);
  if (!data) return [];
  const tiles = bakeCollision({ ...data, elements: [] });
  return Array.from({ length: data.rows }, (_unused, row) =>
    Array.from({ length: data.cols }, (_cell, col) =>
      isSolidKind(kindAt(tiles, col, row)) ? "#" : ".",
    ).join(""),
  );
}

function isWalkableCell(map: EditorMap, col: number, row: number): boolean {
  return !isSolidKind(kindAt(bakeCollision(toMapData(map)), col, row));
}

function withoutElementAt(elements: MapElement[], col: number, row: number): MapElement[] {
  return elements.filter((element) => !elementCoversCell(element, col, row));
}

function keepsSpawnClear(map: EditorMap): boolean {
  return (
    isWalkableCell(map, map.spawn.col, map.spawn.row) &&
    !map.elements.some((element) => elementCoversCell(element, map.spawn.col, map.spawn.row))
  );
}

export function mintMarkerId(prefix: "entry" | "exit", taken: readonly string[]): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

function cellTaken(
  list: readonly { col: number; row: number }[],
  col: number,
  row: number,
): boolean {
  return list.some((item) => item.col === col && item.row === row);
}

/**
 * Markers are load-bearing (adventure graphs bind their ids), so unlike decorative elements they
 * are never silently dropped: any result that would leave a marker on solid ground, or an exit on
 * the spawn or an entry cell, is refused outright. Mirrors the server's validateMapInput rules.
 */
function keepsMarkersValid(map: EditorMap): boolean {
  const tiles = bakeCollision(toMapData(map));
  const markers = map.markers;
  const all = [...markers.entries, ...markers.exits, ...markers.monsterSpawns];
  if (all.some((marker) => isSolidKind(kindAt(tiles, marker.col, marker.row)))) return false;
  const blocked = new Set(markers.entries.map((entry) => `${entry.col},${entry.row}`));
  blocked.add(`${map.spawn.col},${map.spawn.row}`);
  return markers.exits.every((exit) => !blocked.has(`${exit.col},${exit.row}`));
}

function placementTerrainValid(map: EditorMap, element: MapElement): boolean {
  const ground = bakeCollision({ ...toMapData(map), elements: [] });
  if (!elementFitsMap(element, ground.cols, ground.rows)) return false;
  // Every occupied visual cell must satisfy the asset's catalogue terrain rule. This also validates
  // multi-cell buildings and both bridge orientations, rather than checking only their anchor.
  return elementPlacementCells(element).every((cell) =>
    canPlaceElement(element.assetId, kindAt(ground, cell.col, cell.row)),
  );
}

/** Two layer stacks hold the same ids. Compared cell by cell, not by reference: the brush returns
 *  fresh arrays even when it changed nothing, and a stroke must not turn that into an edit. */
function sameLayers(a: readonly TileLayer[], b: readonly TileLayer[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((layer, index) => {
    const other = b[index];
    if (!other || other.ids.length !== layer.ids.length) return false;
    return layer.ids.every((id, cell) => other.ids[cell] === id);
  });
}

/**
 * Adopt a repainted layer stack, or refuse it.
 *
 * `cells` are the cells the stroke touched: an element standing on one of them is dropped when the
 * new terrain no longer accepts it (a tree in fresh water), the same narrow rule the block tool had.
 * A stroke that would drown the spawn or a marker is refused outright, because adventure graphs bind
 * marker ids.
 */
function commitTerrain(
  map: EditorMap,
  layers: TileLayer[],
  cells: readonly { col: number; row: number }[],
): EditorMap | null {
  if (sameLayers(map.layers, layers)) return map;
  const candidate: EditorMap = { ...map, layers };
  const elements = candidate.elements.filter(
    (element) =>
      !cells.some((cell) => elementCoversCell(element, cell.col, cell.row)) ||
      placementTerrainValid(candidate, element),
  );
  const next = { ...candidate, elements };
  return keepsSpawnClear(next) && keepsMarkersValid(next) ? next : null;
}

/** Clear the ground at one cell and let layer 1 catch up: erasing raised ground orphans the cliff
 *  face it was casting, and a stale face is an invisible collider. */
function erasedTerrain(map: EditorMap, col: number, row: number): TileLayer[] | null {
  const ground = map.layers[GROUND_LAYER];
  if (!ground) return null;
  const erased = eraseTile(ground, TINY_SWORDS_TILESET, col, row);
  return syncElevationWalls([erased, ...map.layers.slice(1)], TINY_SWORDS_TILESET, col, row);
}

/** The cells one elevation-aware stroke can change: the cell itself and the wall row beneath it. */
function terrainStrokeCells(col: number, row: number): readonly { col: number; row: number }[] {
  return [
    { col, row },
    { col, row: row + 1 },
  ];
}

export function applyTool(
  map: EditorMap,
  tool: EditorTool,
  col: number,
  row: number,
  isStrokeStart = true,
): EditorMap | null {
  const { cols, rows } = editorMapSize(map);
  if (col < 0 || row < 0 || col >= cols || row >= rows) return null;

  switch (tool.kind) {
    case "block": {
      // Grass goes through `paintElevation` at level 0 rather than a bare `paintAutotile`: painting
      // flat ground under a raised cell must also take away the cliff face that cell was casting.
      // Water is an erased ground cell — on layer 0 an empty cell *is* the sea.
      const layers =
        tool.block === "grass"
          ? paintElevation(map.layers, TINY_SWORDS_TILESET, 0, col, row)
          : erasedTerrain(map, col, row);
      if (!layers) return null;
      return commitTerrain(map, layers, terrainStrokeCells(col, row));
    }
    case "elevation": {
      const layers = paintElevation(map.layers, TINY_SWORDS_TILESET, tool.level, col, row);
      return commitTerrain(map, layers, terrainStrokeCells(col, row));
    }
    case "element": {
      const placed: MapElement = { col, row, assetId: tool.assetId };
      if (!placementTerrainValid(map, placed)) return null;
      if (elementCoversCell(placed, map.spawn.col, map.spawn.row)) return null;
      const sameAnchor = map.elements.filter(
        (element) => element.col === col && element.row === row,
      );
      const retained = map.elements.filter((element) => element.col !== col || element.row !== row);
      if (retained.some((element) => elementsOverlap(element, placed))) return null;
      if (sameAnchor.length === 0 && map.elements.length >= MAX_MAP_ELEMENTS) return null;
      const next = { ...map, elements: [...retained, placed] };
      return keepsSpawnClear(next) && keepsMarkersValid(next) ? next : null;
    }
    /**
     * Erase whatever is on the cell, topmost first: an element or marker if there is one, otherwise
     * the terrain. That last step is the same operation as the water tool — on the ground layer an
     * empty cell *is* water — so a single click on a bare cell never does nothing.
     *
     * The terrain fall-through only fires on `isStrokeStart`: a drag must keep clearing elements and
     * markers it passes over, but must not also carve the ground underneath them. Without this, an
     * eraser stroke dragged across a clearing full of trees would leave behind a continuous water
     * trail nobody asked for — the same result as the water tool, but as a surprising side effect of
     * clearing decor. A deliberate single click on bare ground still erases it, same as before.
     */
    case "eraser": {
      const elements = withoutElementAt(map.elements, col, row);
      const markers = map.markers;
      const entries = markers.entries.filter((m) => m.col !== col || m.row !== row);
      const exits = markers.exits.filter((m) => m.col !== col || m.row !== row);
      const monsterSpawns = markers.monsterSpawns.filter((m) => m.col !== col || m.row !== row);
      const untouched =
        elements.length === map.elements.length &&
        entries.length === markers.entries.length &&
        exits.length === markers.exits.length &&
        monsterSpawns.length === markers.monsterSpawns.length;
      if (!untouched) {
        return { ...map, elements, markers: { entries, exits, monsterSpawns } };
      }
      if (!isStrokeStart) return null;
      const layers = erasedTerrain(map, col, row);
      if (!layers) return null;
      return commitTerrain(map, layers, terrainStrokeCells(col, row));
    }
    case "spawn": {
      if (map.elements.some((element) => elementCoversCell(element, col, row))) return null;
      if (!isWalkableCell(map, col, row)) return null;
      const next = { ...map, spawn: { col, row } };
      return keepsMarkersValid(next) ? next : null;
    }
    case "select":
      return map;
    case "marker-entry": {
      const markers = map.markers;
      if (cellTaken(markers.entries, col, row)) return null;
      if (markers.entries.length >= MAX_MAP_ENTRIES) return null;
      const entry = {
        id: mintMarkerId(
          "entry",
          markers.entries.map((m) => m.id),
        ),
        col,
        row,
      };
      const next = { ...map, markers: { ...markers, entries: [...markers.entries, entry] } };
      return keepsMarkersValid(next) ? next : null;
    }
    case "marker-exit": {
      const markers = map.markers;
      if (cellTaken(markers.exits, col, row)) return null;
      if (markers.exits.length >= MAX_MAP_EXITS) return null;
      const exit = {
        id: mintMarkerId(
          "exit",
          markers.exits.map((m) => m.id),
        ),
        col,
        row,
      };
      const next = { ...map, markers: { ...markers, exits: [...markers.exits, exit] } };
      return keepsMarkersValid(next) ? next : null;
    }
    case "marker-monster": {
      if (
        !Number.isSafeInteger(tool.patrolRadius) ||
        tool.patrolRadius < MIN_PATROL_RADIUS ||
        tool.patrolRadius > MAX_PATROL_RADIUS
      ) {
        return null;
      }
      const markers = map.markers;
      const retained = markers.monsterSpawns.filter((s) => s.col !== col || s.row !== row);
      if (retained.length >= MAX_MAP_MONSTER_SPAWNS) return null;
      const spawn = { col, row, species: tool.species, patrolRadius: tool.patrolRadius };
      const next = { ...map, markers: { ...markers, monsterSpawns: [...retained, spawn] } };
      return keepsMarkersValid(next) ? next : null;
    }
    case "pan":
      return map;
    default:
      throw new Error(`unknown editor tool: ${JSON.stringify(tool)}`);
  }
}
