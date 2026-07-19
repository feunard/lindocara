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
  MAX_EVENTS_PER_MAP,
  MAX_PAGES_PER_EVENT,
  type MapEvent,
  type MapEventPage,
} from "../../shared/map-events.js";
import {
  eraseRect,
  eraseTile,
  floodFill,
  paintElevation,
  paintRectAutotile,
  paintStairs,
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
  /**
   * Authored events, ordered by creation. They are a plane of their own — above elements and
   * markers, addressed by a client-minted uuid, one per cell — and nothing here executes this
   * tranche. Serialized as-is by `serializedMap`, so dirty tracking sees an event change for free.
   */
  events: readonly MapEvent[];
  /**
   * The rect tool's drag anchor: optional and set only while a rect stroke is in flight. It carries
   * the first cell of the stroke and both the layers and the elements exactly as they stood before
   * the stroke touched them, so every subsequent cell of the same drag repaints the whole rectangle,
   * and re-derives which elements it invalidates, from that pristine copy rather than from the live
   * preview. Painting terrain from the live preview instead would leave stray cells behind whenever a
   * drag shrinks back after growing — `fillRect` only ever writes into the rectangle it is given, it
   * never clears cells a *previous*, larger rectangle touched. Dropping elements from the live preview
   * has the mirror problem: an element the drag passed over once (a tree a growing-then-shrinking
   * water rectangle briefly covered) would stay dropped even after the final rectangle no longer
   * covers its cell, because each frame's drop was folded into the live map instead of re-derived from
   * this pristine snapshot. Markers and spawn need no anchor of their own: `commitTerrain` never
   * drops them, it only refuses a rectangle outright when it would leave one on solid ground, and that
   * refusal already reads the untouched, stroke-invariant `markers`/`spawn` off the live map.
   *
   * Deliberately excluded from `serializedMap`: it is stroke-local plumbing, not map content, and
   * must never make the map read as dirty or unsaved on its own.
   */
  strokeAnchor?: { col: number; row: number; layers: TileLayer[]; elements: MapElement[] };
}

/** Terrain strokes write the ground; only `paintElevation` reaches past it, and it owns the reach. */
const GROUND_LAYER = 0;

/**
 * What a rect or fill stroke paints. Deliberately the same vocabulary the single-cell `block` and
 * `elevation` tools already use — rect/fill are shape modifiers over an existing terrain selection,
 * not a new kind of content. Both are always ground-layer content (the spec's targeting rule: a
 * terrain selection always targets the ground layer and its wall upkeep, whatever `activeLayer`
 * says), so unlike the eraser, `activeLayer` never routes them elsewhere.
 */
export type RectFillContent =
  | { kind: "block"; block: "grass" | "water" }
  | { kind: "elevation"; level: 0 | 1 | 2 };

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
  | { kind: "marker-monster"; species: MonsterSpecies; patrolRadius: number }
  | { kind: "rect"; content: RectFillContent }
  | { kind: "fill"; content: RectFillContent }
  | { kind: "stairs" }
  | { kind: "event" };

export type EditorSelection =
  | { kind: "element"; col: number; row: number }
  | { kind: "entry"; id: string }
  | { kind: "exit"; id: string }
  | { kind: "monster"; col: number; row: number }
  | { kind: "event"; id: string }
  | { kind: "spawn" };

export interface EditorHistory {
  past: EditorMap[];
  present: EditorMap;
  future: EditorMap[];
  saved: string;
  /**
   * Which layer paint-adjacent tools (the eraser; rect/fill when a future selection is layer-free)
   * target. Lives here, not on `EditorMap`, because it must survive undo/redo unchanged — undo
   * reverts *content*, never which layer the author happens to be looking at — and because history
   * snapshots already flow through every `commitEditorHistory`/`undoEditorHistory`/`redoEditorHistory`
   * call via `{ ...history, ... }`, so it rides along for free without a bespoke carve-out in any of
   * them.
   */
  activeLayer: 0 | 1 | 2;
}

/**
 * The identity a history snapshot and the dirty flag compare on.
 *
 * Layers are run-length encoded rather than stringified cell by cell: `isEditorHistoryDirty` runs on
 * every stroke, and a 100x100 map is 30 000 ids. Runs collapse a mostly-uniform map to a few dozen
 * characters, and they are exactly what gets saved, so two maps compare equal here precisely when
 * they would be stored identically.
 *
 * `strokeAnchor` is deliberately dropped before stringifying: it is in-flight rect-drag plumbing,
 * not map content, and must never make a merely-in-progress stroke read as a content change, nor
 * leak a stale pristine-layers copy into what "saved" or "present" are compared against.
 */
function serializedMap(map: EditorMap): string {
  const { strokeAnchor: _strokeAnchor, ...rest } = map;
  return JSON.stringify({ ...rest, layers: rest.layers.map(encodeTileLayer) });
}

export function createEditorHistory(map: EditorMap): EditorHistory {
  return { past: [], present: map, future: [], saved: serializedMap(map), activeLayer: 0 };
}

/** The one setter `activeLayer` needs: a plain field swap, no undo entry — switching which layer an
 *  author is looking at is not an edit. */
export function setActiveLayer(history: EditorHistory, layer: 0 | 1 | 2): EditorHistory {
  return { ...history, activeLayer: layer };
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
  // Events are the topmost plane, so they answer a click before any element or marker on the same
  // cell — the same precedence the eraser follows.
  const event = map.events.find((candidate) => candidate.col === col && candidate.row === row);
  if (event) return { kind: "event", id: event.id };
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
    case "event":
      return { ...map, events: map.events.filter((event) => event.id !== selection.id) };
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
    case "event": {
      const event = map.events.find((candidate) => candidate.id === selection.id);
      if (!event) return null;
      const { cols, rows } = editorMapSize(map);
      if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
      // One event per cell: a move onto a cell another event already holds is a no-op, matching
      // the placement rule. Events float above collision, so no terrain or marker check applies.
      if (
        map.events.some((other) => other.id !== event.id && other.col === col && other.row === row)
      )
        return null;
      const events = map.events.map((candidate) =>
        candidate.id === selection.id ? { ...candidate, col, row } : candidate,
      );
      return { ...map, events };
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

/**
 * The event dialog edits a detached DRAFT, never the live map: `beginEventDraft` hands back a deep
 * copy of one event, the pure mutators below fold changes into that copy, and only `commitEventDraft`
 * writes it back as a single history entry. Because the draft is a value the caller holds — not a
 * mutation of `EditorHistory` — every keystroke in the dialog is free of the undo stack until save,
 * and cancelling is simply dropping the draft (history is untouched by construction, so no discard
 * function is needed).
 */
export function beginEventDraft(map: EditorMap, id: string): MapEvent | null {
  const event = map.events.find((candidate) => candidate.id === id);
  if (!event) return null;
  return { ...event, pages: event.pages.map((page) => ({ ...page })) };
}

/** Draft mutator: set the event name. Left untrimmed — the dialog validates on commit, and an empty
 *  name is legal (the ordinal chip is the real label). */
export function setEventDraftName(draft: MapEvent, name: string): MapEvent {
  return { ...draft, name };
}

/** Draft mutator: merge a patch into one page. Everything on a page is per-page (XP semantics), so
 *  a field edit routes through the page index the dialog has open. Out-of-range index is a no-op. */
export function updateEventDraftPage(
  draft: MapEvent,
  index: number,
  patch: Partial<MapEventPage>,
): MapEvent {
  if (index < 0 || index >= draft.pages.length) return draft;
  return {
    ...draft,
    pages: draft.pages.map((page, i) => (i === index ? { ...page, ...patch } : page)),
  };
}

/** Draft mutator: append a fresh page, up to the shared cap. Refused (`null`) at the cap so the
 *  dialog can disable its add-page control rather than silently no-op. */
export function addEventDraftPage(draft: MapEvent): MapEvent | null {
  if (draft.pages.length >= MAX_PAGES_PER_EVENT) return null;
  return { ...draft, pages: [...draft.pages, defaultEventPage()] };
}

/** Draft mutator: drop the page at `index`. Page 1 is mandatory, so the last page is never
 *  removable and an out-of-range index is a no-op. */
export function deleteEventDraftPage(draft: MapEvent, index: number): MapEvent | null {
  if (draft.pages.length <= 1 || index < 0 || index >= draft.pages.length) return null;
  return { ...draft, pages: draft.pages.filter((_page, i) => i !== index) };
}

/** Commit a draft back onto its event as ONE history entry. Committing after each mutator instead of
 *  once is what would split a single dialog save into several undo steps — the caller commits once,
 *  on the dialog's Save. A draft whose id no longer names a live event writes nothing. */
export function commitEventDraft(history: EditorHistory, draft: MapEvent): EditorHistory {
  const present = history.present;
  const events = present.events.map((event) => (event.id === draft.id ? draft : event));
  return commitEditorHistory(history, { ...present, events });
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
    events: [],
  };
}

/**
 * A fresh event page, matching the wireframe's `defPage` (`wireframes/RPG Editor.dc.html`): no
 * graphic, all conditions cleared, movement Fixed at speed 4 / frequency 3, only Move-Anim on, and
 * the Action trigger. These are the wireframe's literal defaults — speed 4 (not 3) and Stop-Anim
 * off — not a rounder guess.
 */
export function defaultEventPage(): MapEventPage {
  return {
    condSwitchId: null,
    condVariableId: null,
    condVariableMin: null,
    condSelfSwitch: null,
    graphicAssetId: null,
    moveType: "fixed",
    moveSpeed: 4,
    moveFreq: 3,
    optMoveAnim: true,
    optStopAnim: false,
    optDirFix: false,
    optThrough: false,
    optOnTop: false,
    trigger: "action",
  };
}

/** The next display ordinal for a new event: one past the largest in use, so the first event on a
 *  blank map is `EV001`. Never reused after a delete — ordinals are display order, not identity. */
function nextEventOrdinal(events: readonly MapEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.ordinal), 0) + 1;
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
  events: readonly MapEvent[];
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
    // The `MapEvent` shape carries every condition field as an explicit `null`, so `JSON.stringify`
    // emits `"condSwitchId":null` rather than dropping the key. The wire parser rejects a page with
    // an ABSENT condition field, so this fullness is load-bearing, not cosmetic.
    events: map.events,
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
 *
 * `sourceElements` defaults to the live map's elements, which is exactly right for the single-cell
 * tools: each of their strokes is one independent mutation, so folding one frame's drop into the next
 * frame's input is the intended behaviour. The rect tool instead passes its anchor's pristine
 * elements, because its frames are not independent — they are repeated redraws of one in-flight
 * rectangle — so every frame must re-derive its drops from the same pristine set the anchor recorded,
 * never from what an earlier, larger or differently-shaped frame of the *same* drag already dropped.
 */
function commitTerrain(
  map: EditorMap,
  layers: TileLayer[],
  cells: readonly { col: number; row: number }[],
  sourceElements: readonly MapElement[] = map.elements,
): EditorMap | null {
  if (sameLayers(map.layers, layers)) return map;
  const candidate: EditorMap = { ...map, layers };
  const elements = sourceElements.filter(
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

/** The same idea as `terrainStrokeCells`, widened to a rectangle: every cell the region can change,
 *  plus the wall row one below its bottom edge. */
function terrainRectCells(
  c0: number,
  r0: number,
  c1: number,
  r1: number,
): readonly { col: number; row: number }[] {
  const cells: { col: number; row: number }[] = [];
  for (let row = r0; row <= r1 + 1; row += 1) {
    for (let col = c0; col <= c1; col += 1) cells.push({ col, row });
  }
  return cells;
}

/** `syncElevationWalls` for one cell, widened to a rectangle: every column in range, at every row
 *  the region touched. `syncElevationWalls(_, _, col, row)` already checks both `row` and `row + 1`
 *  per call, so looping `row` from `r0` to `r1` alone covers wall rows `r0` through `r1 + 1` — the
 *  same span `terrainRectCells` accounts for. */
function syncElevationWallsForRect(
  layers: readonly TileLayer[],
  c0: number,
  r0: number,
  c1: number,
  r1: number,
): TileLayer[] {
  let next = [...layers];
  for (let col = c0; col <= c1; col += 1) {
    for (let row = r0; row <= r1; row += 1) {
      next = syncElevationWalls(next, TINY_SWORDS_TILESET, col, row);
    }
  }
  return next;
}

/** Corners accepted in either order, clamped to the map. Null when nothing survives clamping —
 *  `clampRect` in `tile-brush.ts` does the identical job but is not exported, and both corners are
 *  already bounds-checked by `applyTool`'s own guard before this ever runs, so this is a second,
 *  cheap pass rather than the map's only defence. */
function clampToMap(
  map: EditorMap,
  colA: number,
  rowA: number,
  colB: number,
  rowB: number,
): { c0: number; r0: number; c1: number; r1: number } | null {
  const { cols, rows } = editorMapSize(map);
  const c0 = Math.max(0, Math.min(colA, colB));
  const c1 = Math.min(cols - 1, Math.max(colA, colB));
  const r0 = Math.max(0, Math.min(rowA, rowB));
  const r1 = Math.min(rows - 1, Math.max(rowA, rowB));
  return c0 > c1 || r0 > r1 ? null : { c0, r0, c1, r1 };
}

/** The tightest rectangle bounding every cell where two same-shaped layers differ, or null when they
 *  are identical. `floodFill`'s region is internal to it — this is how a caller who only gets the
 *  painted layer back learns which wall rows might need to catch up. */
function changedBounds(
  before: TileLayer,
  after: TileLayer,
): { c0: number; r0: number; c1: number; r1: number } | null {
  let c0 = Number.POSITIVE_INFINITY;
  let r0 = Number.POSITIVE_INFINITY;
  let c1 = Number.NEGATIVE_INFINITY;
  let r1 = Number.NEGATIVE_INFINITY;
  for (let row = 0; row < before.rows; row += 1) {
    for (let col = 0; col < before.cols; col += 1) {
      const index = row * before.cols + col;
      if (before.ids[index] === after.ids[index]) continue;
      if (col < c0) c0 = col;
      if (col > c1) c1 = col;
      if (row < r0) r0 = row;
      if (row > r1) r1 = row;
    }
  }
  return c1 < c0 ? null : { c0, r0, c1, r1 };
}

/** The autotile slot a terrain selection paints with, or null for water — water has no slot, it
 *  erases instead, the same "empty ground is the sea" rule the single-cell block tool uses. */
function contentSlot(content: RectFillContent): number | null {
  if (content.kind === "elevation") return GRASS_SLOTS[content.level];
  return content.block === "grass" ? GRASS_SLOTS[0] : null;
}

/** A rectangle of `content` on the ground layer: `paintRectAutotile` for grass/elevation,
 *  `eraseRect` for water. */
function paintRectContent(
  ground: TileLayer,
  content: RectFillContent,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
): TileLayer {
  const slot = contentSlot(content);
  return slot === null
    ? eraseRect(ground, TINY_SWORDS_TILESET, c0, r0, c1, r1)
    : paintRectAutotile(ground, TINY_SWORDS_TILESET, slot, c0, r0, c1, r1);
}

/** A flood fill of `content` on the ground layer, or null when the content has no fill primitive —
 *  `floodFill` (`tile-brush.ts`) only ever fills toward a slot, so water (fill-to-empty) has no
 *  expression here without a new shared brush, which is out of this task's scope. */
function fillContent(
  ground: TileLayer,
  content: RectFillContent,
  col: number,
  row: number,
): TileLayer | null {
  const slot = contentSlot(content);
  if (slot === null) return null;
  return floodFill(ground, TINY_SWORDS_TILESET, slot, col, row);
}

/**
 * Erase one cell of layer 1 or layer 2 directly — no wall upkeep, because only the ground's own
 * elevation drives `syncElevationWalls`; a layer 1/2 cell holds no elevation of its own to react to.
 * This is also why clearing a hand-placed ramp does not bring an ambient wall back on its own,
 * matching `syncWall`'s "wall upkeep never overwrites a fixed tile" rule: an author who wants the
 * wall back repaints the ground elevation, the same as the single-cell eraser already requires.
 *
 * Guarded the same way every other terrain write is, even though an erase can only ever remove a
 * collider, never add one: consistency over cleverness.
 */
function eraseOnLayer(map: EditorMap, layer: 1 | 2, col: number, row: number): EditorMap | null {
  const target = map.layers[layer];
  if (!target) return null;
  const erased = eraseTile(target, TINY_SWORDS_TILESET, col, row);
  const layers = map.layers.map((existing, index) => (index === layer ? erased : existing));
  if (sameLayers(map.layers, layers)) return map;
  const next = { ...map, layers };
  return keepsSpawnClear(next) && keepsMarkersValid(next) ? next : null;
}

export function applyTool(
  map: EditorMap,
  tool: EditorTool,
  col: number,
  row: number,
  isStrokeStart = true,
  activeLayer: 0 | 1 | 2 = 0,
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
    /**
     * Anchors on stroke start, then every later cell of the same drag repaints the whole rectangle
     * from that anchor's pristine layers — never from the live preview — so a drag that grows then
     * shrinks leaves nothing behind outside the final rectangle. The stage commits history from its
     * own pre-stroke snapshot to whatever this returns on the drag's last cell, so there is nothing
     * further to do "on release": the last call already *is* the release.
     *
     * Always ground + wall upkeep, regardless of `activeLayer` — a terrain selection targets the
     * ground layer whatever layer is active, the same rule the single-cell `block`/`elevation` tools
     * already follow.
     */
    case "rect": {
      if (isStrokeStart) {
        return { ...map, strokeAnchor: { col, row, layers: map.layers, elements: map.elements } };
      }
      const anchor = map.strokeAnchor;
      if (!anchor) return null;
      const bounds = clampToMap(map, anchor.col, anchor.row, col, row);
      if (!bounds) return null;
      const ground = anchor.layers[GROUND_LAYER];
      if (!ground) return null;
      const painted = paintRectContent(
        ground,
        tool.content,
        bounds.c0,
        bounds.r0,
        bounds.c1,
        bounds.r1,
      );
      const layers = syncElevationWallsForRect(
        [painted, ...anchor.layers.slice(1)],
        bounds.c0,
        bounds.r0,
        bounds.c1,
        bounds.r1,
      );
      return commitTerrain(
        map,
        layers,
        terrainRectCells(bounds.c0, bounds.r0, bounds.c1, bounds.r1),
        anchor.elements,
      );
    }
    /** One click, one flood region. Same ground + wall-upkeep targeting as `rect`; `activeLayer`
     *  never applies since the content is always terrain. */
    case "fill": {
      const ground = map.layers[GROUND_LAYER];
      if (!ground) return null;
      const painted = fillContent(ground, tool.content, col, row);
      if (!painted) return null;
      const bounds = changedBounds(ground, painted);
      if (!bounds) return map;
      const layers = syncElevationWallsForRect(
        [painted, ...map.layers.slice(1)],
        bounds.c0,
        bounds.r0,
        bounds.c1,
        bounds.r1,
      );
      return commitTerrain(
        map,
        layers,
        terrainRectCells(bounds.c0, bounds.r0, bounds.c1, bounds.r1),
      );
    }
    /** Layer 1 by its own fixed rule, never `activeLayer` — a ramp is a wall-layer fixture no matter
     *  which layer the author is looking at. `paintStairs` itself refuses (same-reference) an
     *  out-of-bounds stamp; that refusal is passed straight through. */
    case "stairs": {
      const layers = paintStairs(map.layers, TINY_SWORDS_TILESET, col, row);
      if (layers === map.layers) return null;
      return { ...map, layers };
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
     *
     * The terrain fall-through is "layer-free": it has no terrain selection of its own, so it is the
     * one case the spec's targeting rule routes by `activeLayer` — ground (with wall upkeep) when
     * `activeLayer` is 0, a plain single-layer clear on layer 1 or 2 otherwise.
     */
    case "eraser": {
      // Topmost plane first, exactly one plane per stroke: an event outranks an element, an element
      // outranks a marker, and a marker outranks the bare terrain underneath. Events, elements and
      // markers occupy independent planes, so a cell may hold all three at once; successive strokes
      // then peel them off in that order. (The old eraser cleared the element and marker planes in
      // one stroke; strict precedence is what lets an event sit above them without swallowing them.)
      const eventIndex = map.events.findIndex((event) => event.col === col && event.row === row);
      if (eventIndex !== -1) {
        return { ...map, events: map.events.filter((_event, index) => index !== eventIndex) };
      }
      const elements = withoutElementAt(map.elements, col, row);
      if (elements.length !== map.elements.length) {
        return { ...map, elements };
      }
      const markers = map.markers;
      const entries = markers.entries.filter((m) => m.col !== col || m.row !== row);
      const exits = markers.exits.filter((m) => m.col !== col || m.row !== row);
      const monsterSpawns = markers.monsterSpawns.filter((m) => m.col !== col || m.row !== row);
      if (
        entries.length !== markers.entries.length ||
        exits.length !== markers.exits.length ||
        monsterSpawns.length !== markers.monsterSpawns.length
      ) {
        return { ...map, markers: { entries, exits, monsterSpawns } };
      }
      if (!isStrokeStart) return null;
      if (activeLayer !== 0) return eraseOnLayer(map, activeLayer, col, row);
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
    /**
     * Place a new event on an empty cell. One event per cell: a click on a cell that already holds
     * an event is refused here (`null`) — the pointer path reads that as "select the event on this
     * cell instead", keeping placement and selection cleanly separate. Events float above collision,
     * so unlike elements and markers there is no terrain, spawn or marker rule to satisfy; the id is
     * a client-minted uuid (stable across edits) and the ordinal is the next free display number.
     */
    case "event": {
      if (map.events.some((event) => event.col === col && event.row === row)) return null;
      if (map.events.length >= MAX_EVENTS_PER_MAP) return null;
      const event: MapEvent = {
        id: crypto.randomUUID(),
        col,
        row,
        name: "",
        ordinal: nextEventOrdinal(map.events),
        pages: [defaultEventPage()],
      };
      return { ...map, events: [...map.events, event] };
    }
    case "pan":
      return map;
    default:
      throw new Error(`unknown editor tool: ${JSON.stringify(tool)}`);
  }
}
