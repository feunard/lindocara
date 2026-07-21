/** Pure map-editor mutations. Placement, footprints and collision all come from the shared
 * catalogue, so the browser and authoritative map API cannot disagree. */
import type { MonsterSpecies } from "../../shared/game.js";
import {
  bakeCollision,
  canPlaceElement,
  ELEMENT_OFFSET_STEPS,
  EMPTY_MARKERS,
  elementCoversCell,
  elementFitsMap,
  elementPlacementCells,
  MAP_LAYERS,
  MAX_MAP_ELEMENTS,
  MAX_PATROL_RADIUS,
  type MapData,
  type MapElement,
  type MapMarkers,
  MIN_PATROL_RADIUS,
  parseMapData,
  sameElementSlot,
} from "../../shared/map-data.js";
import {
  type EventKind,
  functionalEvent,
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
 * not a new kind of content. Both are always ground-layer content: a terrain selection always
 * targets the ground layer and its wall upkeep, the same fixed rule the single-cell `block`/
 * `elevation` tools follow — the active mode never routes them elsewhere.
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
  | { kind: "rect"; content: RectFillContent }
  | { kind: "fill"; content: RectFillContent }
  | { kind: "stairs" }
  /**
   * UX wave #12: the one placement tool for every event kind — markers are dead, their meaning is a
   * typed event now. `eventKind` selects what is placed:
   *
   * - `normal`  — the scripted wireframe event; page 1 gets `graphic` as its default appearance (the
   *   palette's Événements picker sets it, "none"/`null` leaves a blank placeholder). The graphic is a
   *   NEW-placement default only — editing an existing event's graphic is the dialog's job.
   * - `entry`/`exit` — a spawn/arrival or departure anchor the adventure graph binds by the EVENT's
   *   uuid. Single default page, no graphic.
   * - `monster` — a monster spawn carrying `species` + `patrolRadius`.
   *
   * Functional kinds (entry/exit/monster) are load-bearing: they must land on walkable ground, and an
   * exit may not share the spawn cell — the same rules `server/maps.ts` enforces, so the editor never
   * authors a map the server would reject.
   */
  | {
      kind: "event";
      eventKind: EventKind;
      graphic?: EditorAssetId | null;
      species?: MonsterSpecies;
      patrolRadius?: number;
    };

/**
 * Which of the three authored collections the editor is working in. This is the selector the old
 * `Layer 1/2/3` control never actually was: painting always wrote layer 0 (plus automatic cliff-wall
 * upkeep on layer 1) and stairs always wrote layer 1, so the layer control only ever routed the
 * ERASER. The three REAL collections — the tile layers, `MapData.elements` and `MapEvent[]` — had no
 * selector at all. `activeMode` names them: `field` owns the terrain layers, `element` the props,
 * `event` the authored events.
 */
export type EditorMode = "field" | "element" | "event";

/**
 * The tools each mode owns. A tool reaching `applyTool` under a mode that does not list it is dropped
 * (see `toolAllowedInMode`): the terrain brushes belong to Field, the prop tool to Element, the event
 * tool to Event, and select/pan/eraser are shared because they act on whatever the active mode owns.
 */
const MODE_TOOLS: Record<EditorMode, readonly EditorTool["kind"][]> = {
  field: ["block", "elevation", "rect", "fill", "stairs", "spawn", "eraser", "select", "pan"],
  element: ["element", "eraser", "select", "pan"],
  event: ["event", "eraser", "select", "pan"],
};

export function toolAllowedInMode(tool: EditorTool, mode: EditorMode): boolean {
  return MODE_TOOLS[mode].includes(tool.kind);
}

export type EditorSelection =
  // The full sub-position, not just `(col, row)`: a cell can hold a stack of decorations at distinct
  // quarter-cell offsets now, so the descriptor must carry the offset to name WHICH element of a
  // stack is selected. Every reader matches on the 4-tuple via `sameElementSlot`.
  | { kind: "element"; col: number; row: number; offsetX: number; offsetY: number }
  | { kind: "event"; id: string }
  | { kind: "spawn" };

export interface EditorHistory {
  past: EditorMap[];
  present: EditorMap;
  future: EditorMap[];
  saved: string;
  /**
   * Which of the three authored collections (terrain / elements / events) the editor is working in —
   * the selector that routes the eraser and gates every other tool. Lives here, not on `EditorMap`,
   * because it must survive undo/redo unchanged — undo reverts *content*, never which collection the
   * author happens to be looking at — and because history snapshots already flow through every
   * `commitEditorHistory`/`undoEditorHistory`/`redoEditorHistory` call via `{ ...history, ... }`, so
   * it rides along for free without a bespoke carve-out in any of them.
   */
  activeMode: EditorMode;
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
  return { past: [], present: map, future: [], saved: serializedMap(map), activeMode: "field" };
}

/** The one setter `activeMode` needs: a plain field swap, no undo entry — switching which collection
 *  an author is looking at is not an edit. */
export function setActiveMode(history: EditorHistory, mode: EditorMode): EditorHistory {
  return { ...history, activeMode: mode };
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
  // Events are the topmost plane (every kind — entry/exit/monster are events now, not markers), so
  // they answer a click before any element on the same cell — the same precedence the eraser follows.
  const event = map.events.find((candidate) => candidate.col === col && candidate.row === row);
  if (event) return { kind: "event", id: event.id };
  // The TOPMOST covering element — the last in array order, which is the last one drawn. A stack of
  // decorations in one cell selects the one on top, matching the eraser's peel-from-the-top rule.
  const covering = map.elements.filter((candidate) => elementCoversCell(candidate, col, row));
  const element = covering[covering.length - 1];
  if (element) {
    return {
      kind: "element",
      col: element.col,
      row: element.row,
      offsetX: element.offsetX,
      offsetY: element.offsetY,
    };
  }
  if (map.spawn.col === col && map.spawn.row === row) return { kind: "spawn" };
  return null;
}

export function deleteSelection(map: EditorMap, selection: EditorSelection): EditorMap {
  switch (selection.kind) {
    case "element":
      // Only the selected slot — a stacked cell keeps its other decorations. Matching on `(col, row)`
      // here would delete the whole stack out from under the one the author picked.
      return {
        ...map,
        elements: map.elements.filter((element) => !sameElementSlot(element, selection)),
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
      const element = map.elements.find((candidate) => sameElementSlot(candidate, selection));
      if (!element) return null;
      const without = deleteSelection(map, selection);
      // An element move is an Element-mode operation whatever tool is active, so it names its own
      // mode rather than depending on the UI's — otherwise the mode gate would refuse the re-place.
      // The sub-cell offset rides along so a drag preserves the quarter-cell alignment.
      return applyTool(
        without,
        { kind: "element", assetId: element.assetId },
        col,
        row,
        true,
        "element",
        element.offsetX,
        element.offsetY,
      );
    }
    case "event": {
      const event = map.events.find((candidate) => candidate.id === selection.id);
      if (!event) return null;
      const { cols, rows } = editorMapSize(map);
      if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
      // One event per cell: a move onto a cell another event already holds is a no-op, matching the
      // placement rule.
      if (
        map.events.some((other) => other.id !== event.id && other.col === col && other.row === row)
      )
        return null;
      // A `normal` event floats above collision, but a functional (entry/exit/monster) event is
      // load-bearing: it must stay on walkable ground, and an exit may not slide onto the spawn — the
      // same rules the server enforces, applied to a drag as well as a fresh placement.
      if (!functionalEventPlacementOk(map, event.kind, col, row)) return null;
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
  const existing = map.elements.find((candidate) => sameElementSlot(candidate, selection));
  if (!existing) return null;
  const without = deleteSelection(map, selection);
  // Swapping an element's asset is an Element-mode operation; it names its own mode so the gate does
  // not refuse the re-place, the same as `moveSelection`. The sub-cell slot is preserved, so the
  // selection descriptor's identity does not change.
  return applyTool(
    without,
    { kind: "element", assetId },
    selection.col,
    selection.row,
    true,
    "element",
    selection.offsetX,
    selection.offsetY,
  );
}

/** Re-place the selected element at its cell with a new quarter-cell offset, clamped to
 *  `0..ELEMENT_OFFSET_STEPS - 1`. Like the asset swap and the move it re-runs `applyTool`, so the same
 *  placement validation (terrain, spawn clearance, overlap) governs the corrected position. */
export function updateSelectedElementOffset(
  map: EditorMap,
  selection: Extract<EditorSelection, { kind: "element" }>,
  offsetX: number,
  offsetY: number,
): EditorMap | null {
  const element = map.elements.find((candidate) => sameElementSlot(candidate, selection));
  if (!element) return null;
  const clamp = (value: number): number =>
    Math.max(0, Math.min(ELEMENT_OFFSET_STEPS - 1, Math.trunc(value)));
  const without = deleteSelection(map, selection);
  return applyTool(
    without,
    { kind: "element", assetId: element.assetId },
    selection.col,
    selection.row,
    true,
    "element",
    clamp(offsetX),
    clamp(offsetY),
  );
}

export interface ElementEventBinding {
  name: string;
  commands: readonly MapEventPage["commands"][number][];
  /** One-shot objects (chests/loot) switch to an empty second page after their first run. */
  once?: boolean;
}

/** Promote scenery into a stable scripted event while preserving its cell and catalogue graphic. */
export function convertElementToEvent(
  map: EditorMap,
  selection: Extract<EditorSelection, { kind: "element" }>,
  binding: ElementEventBinding,
): { map: EditorMap; eventId: string } | null {
  if (map.events.length >= MAX_EVENTS_PER_MAP) return null;
  const element = map.elements.find((candidate) => sameElementSlot(candidate, selection));
  if (!element) return null;
  if (map.events.some((event) => event.col === element.col && event.row === element.row))
    return null;
  const eventId = crypto.randomUUID();
  const firstPage: MapEventPage = {
    ...defaultEventPage(),
    graphicAssetId: element.assetId,
    commands: binding.once
      ? [...binding.commands, { t: "setSelfSwitch", selfSwitch: "A", value: true }]
      : binding.commands,
  };
  const pages: MapEventPage[] = binding.once
    ? [
        firstPage,
        {
          ...defaultEventPage(),
          condSelfSwitch: "A",
          optThrough: true,
        },
      ]
    : [firstPage];
  const event: MapEvent = {
    id: eventId,
    col: element.col,
    row: element.row,
    name: binding.name,
    ordinal: nextEventOrdinal(map.events),
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages,
  };
  return {
    eventId,
    map: {
      ...map,
      elements: map.elements.filter((candidate) => !sameElementSlot(candidate, selection)),
      events: [...map.events, event],
    },
  };
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

/** Draft mutator: set a monster event's species and patrol radius. A no-op on any other kind —
 *  `species`/`patrolRadius` are `null` for entry/exit/normal by construction, and the wire parser
 *  rejects them there, so only a `monster` draft may carry them. The radius is left as typed; the
 *  dialog bounds it on its input and the server re-validates against `[MIN, MAX]_PATROL_RADIUS`. */
export function setEventDraftMonster(
  draft: MapEvent,
  species: MonsterSpecies,
  patrolRadius: number,
): MapEvent {
  if (draft.kind !== "monster") return draft;
  return { ...draft, species, patrolRadius };
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

/** Wire-legal-izes one condition id: digits only, empty pads to `"0001"`, otherwise padded/truncated
 *  to exactly four digits (keeping the last four when an author types more). The parser requires
 *  `/^\d{4}$/` (`shared/map-events.ts`); the switch/variable REGISTRY that would give these ids
 *  meaning is a later tranche, so this only guarantees the authored value stays wire-legal, never
 *  that it names anything real. */
export function normalizeConditionId(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits === "") return "0001";
  return digits.length > 4 ? digits.slice(-4) : digits.padStart(4, "0");
}

/** Clamps a variable-condition threshold to a non-negative integer; `null` passes through unchanged
 *  (the condition is off, and `condVariableId`/`condVariableMin` nullness must stay paired). */
export function normalizeConditionMin(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/** Draft mutator: normalizes every page's condition ids/threshold to what the wire parser accepts.
 *  The dialog also normalizes a single field on blur, but a keyboard-driven Save never blurs the
 *  focused input — this pass over every page is what keeps that path wire-legal too. */
export function normalizeEventDraftConditions(draft: MapEvent): MapEvent {
  return {
    ...draft,
    pages: draft.pages.map((page) => ({
      ...page,
      condSwitchId: page.condSwitchId === null ? null : normalizeConditionId(page.condSwitchId),
      condVariableId:
        page.condVariableId === null ? null : normalizeConditionId(page.condVariableId),
      condVariableMin: normalizeConditionMin(page.condVariableMin),
    })),
  };
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
    commands: [],
  };
}

/** The next display ordinal for a new event: one past the largest in use, so the first event on a
 *  blank map is `EV001`. Never reused after a delete — ordinals are display order, not identity. */
function nextEventOrdinal(events: readonly MapEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.ordinal), 0) + 1;
}

/** The editor's layers are the map's layers: no projection, nothing to lose. Markers are QUARANTINED
 *  (UX wave #12) — entries/exits/monster spawns are typed events now — so the editor always emits
 *  `EMPTY_MARKERS` and never a functional marker the server would ignore. */
export function toMapData(map: EditorMap): MapData {
  const { cols, rows } = editorMapSize(map);
  return {
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols,
    rows,
    layers: map.layers,
    elements: map.elements,
    spawn: map.spawn,
    markers: EMPTY_MARKERS,
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
    // Markers are QUARANTINED: the editor never authors one, so it always sends `EMPTY_MARKERS`. The
    // functional meaning lives in `events` now.
    markers: EMPTY_MARKERS,
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

function keepsSpawnClear(map: EditorMap): boolean {
  return (
    isWalkableCell(map, map.spawn.col, map.spawn.row) &&
    !map.elements.some((element) => elementCoversCell(element, map.spawn.col, map.spawn.row))
  );
}

/**
 * May a functional (entry/exit/monster) event legally occupy `(col, row)` on `map`? A `normal` event
 * floats above collision, so it always may. A functional event is load-bearing — the adventure graph
 * binds entry/exit uuids and a monster spawns here — so it must stand on walkable ground, and an exit
 * may not share the spawn cell. These are exactly the per-kind rules `server/maps.ts` enforces, so the
 * editor never authors a map the server would reject; the entry-on-spawn case is deliberately allowed
 * (the born default map's entry sits on the spawn).
 */
function functionalEventPlacementOk(
  map: EditorMap,
  kind: EventKind,
  col: number,
  row: number,
): boolean {
  if (kind === "normal") return true;
  if (!isWalkableCell(map, col, row)) return false;
  if (kind === "exit" && col === map.spawn.col && row === map.spawn.row) return false;
  return true;
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
  return keepsSpawnClear(next) ? next : null;
}

/** Clear the ground at one cell and let layer 1 catch up: erasing raised ground orphans the cliff
 *  face it was casting, and a stale face is an invisible collider. */
function erasedTerrain(map: EditorMap, col: number, row: number): TileLayer[] | null {
  const ground = map.layers[GROUND_LAYER];
  if (!ground) return null;
  const erased = eraseTile(ground, TINY_SWORDS_TILESET, col, row);
  return syncElevationWalls([erased, ...map.layers.slice(1)], TINY_SWORDS_TILESET, col, row);
}

/**
 * Field-mode eraser: clear the ground at one cell (with cliff-wall upkeep) and keep the spawn on
 * walkable ground, but — unlike a paint stroke's `commitTerrain` — never drop an element standing
 * over the drowned cell. A mode owns exactly one collection, so a Field erase takes ONLY terrain; the
 * decor floating above it is Element mode's to remove. Same reference when the cell was already void,
 * so a repeated click reads as a no-op. Refused (`null`) only when the erase would drown the spawn —
 * the one guard `commitTerrain` provides that Field erase still wants.
 */
function erasedTerrainMap(map: EditorMap, col: number, row: number): EditorMap | null {
  const layers = erasedTerrain(map, col, row);
  if (!layers) return null;
  if (sameLayers(map.layers, layers)) return map;
  const next: EditorMap = { ...map, layers };
  return keepsSpawnClear(next) ? next : null;
}

/** Element-mode eraser: drop the TOPMOST element covering the cell (the last in array/render order),
 *  or the map unchanged (same reference) when none is there. Peeling one at a time is what lets a
 *  stacked cell be cleared one click per decoration rather than wholesale. Never touches events or
 *  terrain. */
function erasedElement(map: EditorMap, col: number, row: number): EditorMap {
  const covering = map.elements.filter((element) => elementCoversCell(element, col, row));
  const target = covering[covering.length - 1];
  if (!target) return map;
  return { ...map, elements: map.elements.filter((element) => element !== target) };
}

/** Event-mode eraser: drop the event on the cell (the topmost plane), or the map unchanged (same
 *  reference) when none is there. Never touches elements or terrain. */
function erasedEvent(map: EditorMap, col: number, row: number): EditorMap {
  const index = map.events.findIndex((event) => event.col === col && event.row === row);
  if (index === -1) return map;
  return { ...map, events: map.events.filter((_event, i) => i !== index) };
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

export function applyTool(
  map: EditorMap,
  tool: EditorTool,
  col: number,
  row: number,
  isStrokeStart = true,
  mode: EditorMode = "field",
  offsetX = 0,
  offsetY = 0,
): EditorMap | null {
  // A tool belongs to exactly one mode. Reaching applyTool with a mismatched pair means the UI let a
  // stale tool survive a mode switch; drop the stroke rather than write to a collection the author is
  // not looking at. The default `mode` is a test-ergonomics convenience only — the stage always
  // passes an explicit mode.
  if (!toolAllowedInMode(tool, mode)) return null;

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
     * Always ground + wall upkeep — a terrain selection targets the ground layer whatever the active
     * mode is, the same fixed rule the single-cell `block`/`elevation` tools already follow.
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
    /** One click, one flood region. Same ground + wall-upkeep targeting as `rect`; the active mode
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
    /** Layer 1 by its own fixed rule — a ramp is a wall-layer fixture no matter the active mode.
     *  `paintStairs` itself refuses (same-reference) an out-of-bounds stamp; that refusal is passed
     *  straight through. */
    case "stairs": {
      const layers = paintStairs(map.layers, TINY_SWORDS_TILESET, col, row);
      if (layers === map.layers) return null;
      return { ...map, layers };
    }
    case "element": {
      // Element placement is quarter-cell: the stage resolves the pointer to a cell plus a 0..3
      // sub-step per axis and threads it here. Field/Event callers leave the offsets at 0, so those
      // modes stay grid-forced.
      const placed: MapElement = { col, row, offsetX, offsetY, assetId: tool.assetId };
      if (!placementTerrainValid(map, placed)) return null;
      if (elementCoversCell(placed, map.spawn.col, map.spawn.row)) return null;
      // Identity is the full sub-position now, so a new `(col, row, offsetX, offsetY)` ADDS and only an
      // exact match REPLACES — that is what lets one cell hold a stack of decorations. The
      // visual-footprint overlap rejection is gone on purpose: stacked decor is meant to overlap, and
      // overlapping colliders are harmless (both simply block). Spawn and terrain guards stay.
      const isReplacement = map.elements.some((element) => sameElementSlot(element, placed));
      const retained = map.elements.filter((element) => !sameElementSlot(element, placed));
      if (!isReplacement && map.elements.length >= MAX_MAP_ELEMENTS) return null;
      const next = { ...map, elements: [...retained, placed] };
      return keepsSpawnClear(next) ? next : null;
    }
    /**
     * Mode-scoped, not cascading. The old order (event, then element, then terrain) meant an eraser
     * stroke aimed at a bush could silently take the ground out from under it once the bush was gone.
     * A mode owns exactly one collection, so the eraser can only take from that: Event mode peels an
     * event, Element mode a prop, Field mode the terrain (leaving any decor above it standing — that
     * is Element mode's to clear).
     *
     * The `!isStrokeStart` guard drops every drag cell for every mode: a click erases one cell, a drag
     * never smears a second. (This deliberately removes the old behaviour where a drag kept peeling
     * elements it passed over — mode-scoping makes one stroke, one cell, one collection.)
     */
    case "eraser": {
      if (!isStrokeStart) return null;
      if (mode === "event") return erasedEvent(map, col, row);
      if (mode === "element") return erasedElement(map, col, row);
      return erasedTerrainMap(map, col, row);
    }
    case "spawn": {
      if (map.elements.some((element) => elementCoversCell(element, col, row))) return null;
      if (!isWalkableCell(map, col, row)) return null;
      return { ...map, spawn: { col, row } };
    }
    case "select":
      return map;
    /**
     * Place a new event on an empty cell. One event per cell: a click on a cell that already holds
     * an event is refused here (`null`) — the pointer path reads that as "select the event on this
     * cell instead", keeping placement and selection cleanly separate. The id is a client-minted uuid
     * (stable across edits) and the ordinal is the next free display number.
     *
     * A `normal` event floats above collision (no terrain rule), adopting the tool's pending graphic
     * on page 1. A functional (entry/exit/monster) event is load-bearing: it must stand on walkable
     * ground (`functionalEventPlacementOk`), and a monster carries a valid species + in-range patrol
     * radius or the placement is refused — exactly what `server/maps.ts` would accept.
     */
    case "event": {
      if (map.events.some((event) => event.col === col && event.row === row)) return null;
      if (map.events.length >= MAX_EVENTS_PER_MAP) return null;
      if (!functionalEventPlacementOk(map, tool.eventKind, col, row)) return null;
      const ordinal = nextEventOrdinal(map.events);
      if (tool.eventKind === "normal") {
        const event: MapEvent = {
          id: crypto.randomUUID(),
          col,
          row,
          name: "",
          ordinal,
          kind: "normal",
          species: null,
          patrolRadius: null,
          // Page 1 adopts the tool's pending graphic (the palette's Événements picker); "none" leaves
          // the default page's null graphic, i.e. the blank placeholder on the overlay.
          pages: [{ ...defaultEventPage(), graphicAssetId: tool.graphic ?? null }],
        };
        return { ...map, events: [...map.events, event] };
      }
      if (tool.eventKind === "monster") {
        const { species, patrolRadius } = tool;
        if (species === undefined) return null;
        if (
          patrolRadius === undefined ||
          !Number.isSafeInteger(patrolRadius) ||
          patrolRadius < MIN_PATROL_RADIUS ||
          patrolRadius > MAX_PATROL_RADIUS
        ) {
          return null;
        }
        const event = functionalEvent({
          id: crypto.randomUUID(),
          col,
          row,
          ordinal,
          kind: "monster",
          species,
          patrolRadius,
        });
        return { ...map, events: [...map.events, event] };
      }
      const event = functionalEvent({
        id: crypto.randomUUID(),
        col,
        row,
        ordinal,
        kind: tool.eventKind,
      });
      return { ...map, events: [...map.events, event] };
    }
    case "pan":
      return map;
    default:
      throw new Error(`unknown editor tool: ${JSON.stringify(tool)}`);
  }
}

/**
 * UX wave #9: may `tool` legally place on cell (col,row) of `map` right now? The pure predicate the
 * editor stage paints its hover feedback from — a thicker preview outline whenever a placement tool is
 * active, plus an OPAQUE RED cell fill on top when the placement is illegal there.
 *
 * It DELEGATES to `applyTool` rather than re-deriving the placement rules, so the hover preview can
 * never disagree with what a real click does: terrain fit (`canPlaceElement`), cell occupancy,
 * one-event-per-cell, marker limits/validity and spawn coverage are all exactly the checks the click
 * would run. `applyTool` returns `null` only when a placement is refused, so "legal" is precisely "not
 * refused". Tools with no per-cell refusal (select/pan, a terrain no-op, the rect anchor) come back
 * non-null and read as legal; an out-of-bounds cell is refused and reads as illegal.
 */
export function placementLegalAt(
  tool: EditorTool,
  map: EditorMap,
  col: number,
  row: number,
  mode: EditorMode = "field",
): boolean {
  // A tool the active mode does not own can never place — the same gate `applyTool` runs, applied
  // here too so the fill short-circuit below respects the mode rather than reading as legal.
  if (!toolAllowedInMode(tool, mode)) return false;
  // Fill's legality is position-independent past the content check. `floodFill` never fails on
  // position — out of bounds or already-filled it returns the layer unchanged — so `applyTool`'s
  // fill branch is null only when the content has no fill slot (water). Answer that directly instead
  // of flooding the whole ground layer, resyncing walls and cloning a map on every hovered cell just
  // to discard the result. `applyTool` itself is unchanged: a real fill click still runs the flood.
  if (tool.kind === "fill") {
    const { cols, rows } = editorMapSize(map);
    if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
    return contentSlot(tool.content) !== null;
  }
  return applyTool(map, tool, col, row, true, mode) !== null;
}
