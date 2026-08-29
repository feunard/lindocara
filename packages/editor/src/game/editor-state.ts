/** Pure map-editor mutations. Placement, footprints and collision all come from the shared
 * catalogue, so the browser and authoritative map API cannot disagree. */

/** Undo depth. Canvas documents make snapshots heavy (one changed 256×256 layer each), so history
 *  is bounded: the oldest snapshot falls off rather than the tab growing without limit. */
export const EDITOR_HISTORY_LIMIT = 100;

import { EMPTY_MAP_AUDIO, type MapAudioConfig } from "@lindocara/engine/audio-catalog.js";
import {
  type BridgeDimensions,
  bridgeAssetIdForCrossing,
  bridgeBaseRotationDegrees,
  bridgeOrientation,
  parseBridgeDimensions,
} from "@lindocara/engine/bridges.js";
import {
  type BuildingDimensions,
  type BuildingSettings,
  defaultBuildingSettings,
  isStandingBuildingAsset,
  parseBuildingSettings,
  parseBuildingDimensions,
} from "@lindocara/engine/buildings.js";
import {
  type ElementOrientation,
  parseElementRotation,
} from "@lindocara/engine/element-orientation.js";
import { type EventPreset, presetEvent } from "@lindocara/engine/event-presets.js";
import {
  defaultMonsterTuning,
  type MonsterAttackProfile,
  type MonsterPursuitMode,
  type MonsterRespawnMode,
  type MonsterSpecies,
  type MonsterTuning,
} from "@lindocara/engine/game.js";
import { isNativeHarvestAsset } from "@lindocara/engine/harvest-presets.js";
import {
  cloneHarvestProfile,
  type HarvestProfile,
  parseHarvestProfile,
} from "@lindocara/engine/harvest.js";
import { compileAuthoredMap, isAuthoredWaterCell } from "@lindocara/engine/hd2d/authored-map.js";
import { encodeMap } from "@lindocara/engine/hd2d/map-data.js";
import type { TerrainMaterial } from "@lindocara/engine/hd2d/terrain-query.js";
import {
  addInteriorShellOpening,
  addInteriorShellInnerWalls,
  filterInteriorShellInnerWalls,
  interiorShellFloorMaterial,
  removeInteriorShellOpening,
} from "@lindocara/engine/interior-shell.js";
import { cropMapToRect, derivedMapRect, padMapToCanvas } from "@lindocara/engine/map-canvas.js";
import {
  bakeCollision,
  ELEMENT_OFFSET_STEPS,
  EMPTY_MARKERS,
  elementCoversCell,
  elementFitsMap,
  elementWorldColliderGeometry,
  isRotatable3dElementAsset,
  MAP_LAYERS,
  MAX_MAP_ELEMENTS,
  MAX_PATROL_RADIUS,
  type MapData,
  type MapElement,
  type MapMarkers,
  type UndergroundMap,
  MIN_PATROL_RADIUS,
  parseMapData,
  sameElementSlot,
} from "@lindocara/engine/map-data.js";
import type {
  InteriorShell,
  InteriorShellOpeningRun,
  MapEnvironment,
} from "@lindocara/engine/map-environment.js";
import {
  EVENT_GRAPHIC_TINT_DEFAULT,
  type EventKind,
  functionalEvent,
  isRuntimeEventKind,
  MAX_EVENTS_PER_MAP,
  MAX_PAGES_PER_EVENT,
  MAX_RUNTIME_EVENTS_PER_MAP,
  type MapEvent,
  type MapEventPage,
  runtimeEventCount,
} from "@lindocara/engine/map-events.js";
import {
  defaultMapHeroSettings,
  type MapHeroSettings,
} from "@lindocara/engine/map-hero-settings.js";
import {
  DEFAULT_MAP_FIXED_LIGHTING,
  type MapFixedLighting,
} from "@lindocara/engine/map-lighting.js";
import type { MapWeather } from "@lindocara/engine/map-weather.js";
import {
  isNativeSceneryAsset,
  nativeSceneryDimensionsOrDefault,
} from "@lindocara/engine/native-scenery.js";
import {
  BODY_RADIUS,
  canStand,
  groundUnder,
  zoneTerrainFromHeightfield,
} from "@lindocara/engine/terrain-access.js";
import {
  type ElevationStep,
  elevationStepTarget,
  eraseStairsAt,
  eraseTile,
  floodFillTerrain,
  floodFillWater,
  groundElevationAt,
  inferStairsRun,
  paintElevation,
  paintStairsRun,
  paintTerrain,
  paintTerrainLayer,
  paintWaterLayer,
  type RampDirection,
  resolveWholeLayer,
  syncElevationWalls,
  terrainFloodRegion,
  waterFloodRegion,
} from "@lindocara/engine/tile-brush.js";
import { emptyLayer, encodeTileLayer, type TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { isSolidKind, kindAt, TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { autotileId, EMPTY_TILE, fixedId } from "@lindocara/engine/tileset.js";
import {
  GRASS_SLOTS,
  isGroundElevation,
  terrainDescriptorOfTileId,
  terrainFixedIndex,
  terrainSlot,
  TINY_SWORDS_TILESET,
  TINY_SWORDS_TILESET_ID,
  waterLevelOfTileId,
} from "@lindocara/engine/tilesets/tiny-swords.js";
import {
  type EditorAssetId,
  LINDOCARA_CHEST_CLOSED_ASSET_ID,
  LINDOCARA_CHEST_OPEN_ASSET_ID,
} from "@lindocara/engine/tiny-swords-catalog.js";
import {
  compactUndergroundCells,
  DEFAULT_UNDERGROUND_STAIR_LENGTH,
  DEFAULT_UNDERGROUND_STAIR_WIDTH,
  MAX_UNDERGROUND_DEPTH,
  undergroundCells,
} from "@lindocara/engine/underground.js";

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
  /** Exterior maps end in water; interior maps end in black void and use the room palette. */
  environment?: MapEnvironment;
  /** World-space room/corridor envelope. Absent preserves legacy open interiors. */
  interiorShell?: InteriorShell;
  /** True multi-storey volumes below the surface. */
  underground?: UndergroundMap;
  /** The authored weather. Missing reads as a clear sky, which is every map written before it. */
  weather?: MapWeather;
  /** Per-channel map overrides. Missing values inherit the adventure defaults. */
  audio: MapAudioConfig;
  /** Authoritative class balance and ability availability for this map. */
  heroSettings?: MapHeroSettings;
  /** Whether the map advances through its independent day/night clock. */
  dayNightCycle: boolean;
  /** Stable ambience used while the day/night clock is disabled. */
  fixedLighting: MapFixedLighting;
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
  strokeAnchor?: {
    col: number;
    row: number;
    layers: TileLayer[];
    interiorShell?: InteriorShell;
  };
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
export type RectFillContent = { kind: "block"; block: "grass" | "water" } | ElevationContent;

/**
 * A terrain-material selection plus what it does to the cell's HEIGHT.
 *
 * Two spellings on purpose, and the difference is who is holding the brush:
 *
 * - `step` is RELATIVE and is what the palette authors. "Ground", "+1" and "-1" read off the cell
 *   under the cursor, so they never enumerate the range and an author never has to know which level
 *   a slope is already at. Picking a material alone carries `keep`: change the ground, leave the
 *   height.
 * - `level` is ABSOLUTE, for a caller that genuinely means one named plateau: procedural generation,
 *   fixtures and the tests that assert what a specific level paints.
 *
 * Both resolve through `elevationTargetLevel` before anything is written, so there is exactly one
 * place that decides which slot a stroke lands on.
 */
export type ElevationContent =
  | { kind: "elevation"; step: ElevationStep; material?: TerrainMaterial }
  | { kind: "elevation"; level: 0 | 1 | 2 | 3; material?: TerrainMaterial };

/** The absolute level a terrain selection reaches on a cell already standing at `current`, or null
 *  when the step has nowhere to go and the stroke must be REFUSED rather than quietly dropped. */
function elevationTargetLevel(content: ElevationContent, current: number): number | null {
  return "level" in content ? content.level : elevationStepTarget(content.step, current);
}

interface EditorEventToolBase {
  kind: "event";
  graphic?: EditorAssetId | null;
  /** Popular scripted-event preset; ignored by functional event kinds. */
  preset?: EventPreset;
  /** Current map uuid used to seed a teleporter preset. */
  selfMapId?: string;
  /** Localized placement label persisted as the fresh event name. */
  presetName?: string;
  species?: MonsterSpecies;
  patrolRadius?: number;
}

export type EditorEventTool =
  | (EditorEventToolBase & {
      /** Legacy-only compatibility for old authored maps; no editor palette creates this tool. */
      eventKind: "harvestable";
      graphic: EditorAssetId;
      harvestProfile: HarvestProfile;
    })
  | (EditorEventToolBase & {
      eventKind: Exclude<EventKind, "harvestable">;
      harvestProfile?: never;
    });

export type EditorTool =
  | { kind: "block"; block: "grass" | "water" }
  | ElevationContent
  | { kind: "element"; assetId: EditorAssetId }
  | { kind: "eraser" }
  | { kind: "spawn" }
  | { kind: "select" }
  | { kind: "pan" }
  | { kind: "rect"; content: RectFillContent }
  | { kind: "fill"; content: RectFillContent }
  /**
   * One stamp, no declarations. The direction and the pair of levels are READ off the cell under
   * the cursor (`inferStairsRun`), including any missing descending support cells.
   * `prefer` is the only hint, and it is not the author's: the stage refreshes it from the camera's
   * yaw so a cell where two ramps genuinely fit climbs the way the author is looking.
   */
  | { kind: "stairs"; prefer?: RampDirection }
  | {
      kind: "underground";
      operation: "dig" | "fill" | "shaft" | "stairs";
      depth: number;
      style: InteriorShell["style"];
      /** Rectangle dimensions; a tunnel is simply a long, narrow rectangle. */
      width: number;
      length: number;
      direction: RampDirection;
    }
  | { kind: "wall-opening"; operation: "open" | "close" }
  /**
   * Two clicks, one round trip: pick a door, pick another door on the same map, and both get a
   * `player-touch` teleporter aimed at the other. It authors nothing the event language could not
   * already express (it mints the `teleporter` preset twice, see `presetEvent`) and exists because
   * the hand path was: place an event, choose the preset, open the dialog, pick a category, pick the
   * destination map, then type the destination column and row as numbers. Twice, with the
   * coordinates read off the map by eye.
   *
   * `from` is the first door, held by the STAGE between the two clicks rather than on the map: the
   * whole link is then one `applyTool` call, so it is one undo step and this module stays a pure
   * function of (map, tool, cell).
   */
  | {
      kind: "link";
      selfMapId: string;
      from?: { col: number; row: number };
      /** The pair's display name, localized by the palette exactly as `presetName` is: an event name
       *  is authored DATA in the author's own language, never a message key. */
      name?: string;
    }
  /**
   * UX wave #12: the one placement tool for every event kind — markers are dead, their meaning is a
   * typed event now. `eventKind` selects what is placed:
   *
   * - `normal`  — the scripted event, placed via a `preset` (D13): `raw` is blank, the others pre-fill
   *   page 1 with one canonical command. Its graphic is chosen in the event dialog, not at placement.
   * - `entry`/`exit` — a spawn/arrival or departure anchor the adventure graph binds by the EVENT's
   *   uuid. Single default page, no graphic.
   * - `monster` — a monster spawn carrying `species` + `patrolRadius`.
   * - `guard` — an allied server combatant carrying a patrol radius; its conditional pages select
   *   whether the reinforcement exists.
   *
   * Functional kinds are load-bearing: they must land on walkable ground, and an exit may not share
   * the spawn cell — the same rules `server/maps.ts` enforces.
   */
  | EditorEventTool;

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
  field: [
    "block",
    "elevation",
    "rect",
    "fill",
    "stairs",
    "underground",
    "wall-opening",
    "spawn",
    "eraser",
    "select",
    "pan",
  ],
  element: ["element", "eraser", "select", "pan"],
  event: ["event", "link", "eraser", "select", "pan"],
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
 * every stroke, and a 256x256 map is 196,608 ids. Runs collapse a mostly-uniform map to a few dozen
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
  const past = [...history.past, history.present].slice(-EDITOR_HISTORY_LIMIT);
  return { ...history, past, present: next, future: [] };
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

/**
 * Resolves the Select tool against the collection named by the active editor mode. Events may be
 * visible while scenery is being authored (and conversely), but a click must never grab a dimmed
 * plane instead of the plane the author is actively editing.
 */
export function selectionAtMode(
  map: EditorMap,
  col: number,
  row: number,
  mode: EditorMode,
  offsetX = 0,
  offsetY = 0,
): EditorSelection | null {
  if (mode === "event") {
    const event = map.events.find((candidate) => candidate.col === col && candidate.row === row);
    return event ? { kind: "event", id: event.id } : null;
  }
  if (mode === "element") {
    // Prefer the exact quarter-cell anchor under the pointer. If the author clicks another visible
    // cell of a multi-cell asset, fall back to the topmost footprint covering that cell.
    const topFirst = [...map.elements].reverse();
    const exact = topFirst.find(
      (candidate) =>
        candidate.col === col &&
        candidate.row === row &&
        candidate.offsetX === offsetX &&
        candidate.offsetY === offsetY,
    );
    const pointerX = (col + (offsetX + 0.5) / ELEMENT_OFFSET_STEPS) * TILE_SIZE;
    const pointerY = (row + (offsetY + 0.5) / ELEMENT_OFFSET_STEPS) * TILE_SIZE;
    const bridgeAtPointer = topFirst.find((candidate) => {
      if (!bridgeOrientation(candidate.assetId)) return false;
      const collider = elementWorldColliderGeometry(candidate);
      if (!collider) return false;
      const centreX = collider.x + collider.width / 2;
      const centreY = collider.y + collider.height / 2;
      const dx = pointerX - centreX;
      const dy = pointerY - centreY;
      const cos = Math.cos(collider.rotation);
      const sin = Math.sin(collider.rotation);
      const localX = dx * cos + dy * sin;
      const localY = -dx * sin + dy * cos;
      // A quarter-cell halo makes thin/rotated decks forgiving to click without stealing distant
      // scenery. The exact quarter-cell anchor above still wins for deliberately stacked props.
      const padding = TILE_SIZE / ELEMENT_OFFSET_STEPS;
      return (
        Math.abs(localX) <= collider.width / 2 + padding &&
        Math.abs(localY) <= collider.height / 2 + padding
      );
    });
    const covering =
      exact ??
      bridgeAtPointer ??
      topFirst.find((candidate) => elementCoversCell(candidate, col, row));
    return covering
      ? {
          kind: "element",
          col: covering.col,
          row: covering.row,
          offsetX: covering.offsetX,
          offsetY: covering.offsetY,
        }
      : null;
  }
  return map.spawn.col === col && map.spawn.row === row ? { kind: "spawn" } : null;
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
    case "event": {
      const selectedEvent = map.events.find((event) => event.id === selection.id);
      const linkedIds = new Set([selection.id]);
      if (selectedEvent?.linkedEventId) linkedIds.add(selectedEvent.linkedEventId);
      for (const event of map.events) {
        if (event.linkedEventId === selection.id) linkedIds.add(event.id);
      }
      return { ...map, events: map.events.filter((event) => !linkedIds.has(event.id)) };
    }
    case "spawn":
      return map;
  }
}

export function moveSelection(
  map: EditorMap,
  selection: EditorSelection,
  col: number,
  row: number,
  offsetX = selection.kind === "element" ? selection.offsetX : 0,
  offsetY = selection.kind === "element" ? selection.offsetY : 0,
): EditorMap | null {
  switch (selection.kind) {
    case "element": {
      const element = map.elements.find((candidate) => sameElementSlot(candidate, selection));
      if (!element) return null;
      const destination = { col, row, offsetX, offsetY };
      if (sameElementSlot(element, destination)) return map;
      // Moving must never silently replace a different decoration already anchored at the target
      // sub-position. Authors can still stack props by dropping onto another quarter-cell.
      if (
        map.elements.some(
          (candidate) =>
            !sameElementSlot(candidate, selection) && sameElementSlot(candidate, destination),
        )
      )
        return null;
      const without = deleteSelection(map, selection);
      // An element move is an Element-mode operation whatever tool is active, so it names its own
      // mode rather than depending on the UI's — otherwise the mode gate would refuse the re-place.
      // Inspector moves preserve the current sub-cell offset through the defaults above; pointer
      // drags provide the quarter-cell under the cursor so the prop follows the hand precisely.
      const moved = applyTool(
        without,
        { kind: "element", assetId: element.assetId },
        col,
        row,
        true,
        "element",
        offsetX,
        offsetY,
      );
      if (!moved) return null;
      return {
        ...moved,
        elements: moved.elements.map((candidate) =>
          sameElementSlot(candidate, destination)
            ? {
                ...candidate,
                ...(element.id ? { id: element.id } : {}),
                ...(element.building ? { building: element.building } : {}),
                ...(element.orientation ? { orientation: element.orientation } : {}),
                ...(element.rotation === undefined ? {} : { rotation: element.rotation }),
                ...(element.bridge ? { bridge: element.bridge } : {}),
                ...(element.dimensions ? { dimensions: element.dimensions } : {}),
              }
            : candidate,
        ),
      };
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
      if (!harvestEventFootprintFitsMap(map, event)) return null;
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
  const updated = applyTool(
    without,
    { kind: "element", assetId },
    selection.col,
    selection.row,
    true,
    "element",
    selection.offsetX,
    selection.offsetY,
  );
  if (!updated) return null;
  const result: EditorMap = {
    ...updated,
    elements: updated.elements.map((candidate) =>
      sameElementSlot(candidate, selection)
        ? {
            ...candidate,
            ...(existing.id ? { id: existing.id } : {}),
            ...(isStandingBuildingAsset(assetId) && existing.orientation
              ? { orientation: existing.orientation }
              : {}),
            ...(isRotatable3dElementAsset(assetId) && existing.rotation
              ? { rotation: existing.rotation }
              : {}),
            ...(isStandingBuildingAsset(assetId) && existing.building
              ? { building: existing.building }
              : {}),
            ...(bridgeOrientation(assetId) && existing.bridge ? { bridge: existing.bridge } : {}),
            ...(isNativeSceneryAsset(assetId) && existing.dimensions
              ? { dimensions: existing.dimensions }
              : {}),
          }
        : candidate,
    ),
  };
  const changed = result.elements.find((candidate) => sameElementSlot(candidate, selection));
  return changed && placementFitsMap(result, changed) && keepsSpawnClear(result) ? result : null;
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
  const destination = {
    col: selection.col,
    row: selection.row,
    offsetX: clamp(offsetX),
    offsetY: clamp(offsetY),
  };
  const updated = applyTool(
    without,
    { kind: "element", assetId: element.assetId },
    selection.col,
    selection.row,
    true,
    "element",
    destination.offsetX,
    destination.offsetY,
  );
  if (!updated) return null;
  return {
    ...updated,
    elements: updated.elements.map((candidate) =>
      sameElementSlot(candidate, destination)
        ? {
            ...candidate,
            ...(element.id ? { id: element.id } : {}),
            ...(element.building ? { building: element.building } : {}),
            ...(element.orientation ? { orientation: element.orientation } : {}),
            ...(element.rotation === undefined ? {} : { rotation: element.rotation }),
            ...(element.bridge ? { bridge: element.bridge } : {}),
            ...(element.dimensions ? { dimensions: element.dimensions } : {}),
          }
        : candidate,
    ),
  };
}

/** Rotate a selected building without moving its authored foot. The same mutation immediately
 * rechecks spawn clearance against the rotated authoritative collider. */
export function updateSelectedElementOrientation(
  map: EditorMap,
  selection: Extract<EditorSelection, { kind: "element" }>,
  orientation: ElementOrientation,
): EditorMap | null {
  const element = map.elements.find((candidate) => sameElementSlot(candidate, selection));
  if (!element || !isStandingBuildingAsset(element.assetId)) return null;
  const next: EditorMap = {
    ...map,
    elements: map.elements.map((candidate) => {
      if (!sameElementSlot(candidate, selection)) return candidate;
      const {
        orientation: _previousOrientation,
        rotation: _previousRotation,
        ...withoutOrientation
      } = candidate;
      return orientation === 0 ? withoutOrientation : { ...withoutOrientation, orientation };
    }),
  };
  const rotated = next.elements.find((candidate) => sameElementSlot(candidate, selection));
  return rotated && placementFitsMap(next, rotated) && keepsSpawnClear(next) ? next : null;
}

/** Freely rotate selected native 3D scenery around its authored anchor. */
export function updateSelectedElementRotation(
  map: EditorMap,
  selection: Extract<EditorSelection, { kind: "element" }>,
  rotation: number,
): EditorMap | null {
  const parsed = parseElementRotation(rotation);
  const element = map.elements.find((candidate) => sameElementSlot(candidate, selection));
  if (parsed === null || !element || !isRotatable3dElementAsset(element.assetId)) return null;
  const next: EditorMap = {
    ...map,
    elements: map.elements.map((candidate) => {
      if (!sameElementSlot(candidate, selection)) return candidate;
      const {
        orientation: _previousOrientation,
        rotation: _previousRotation,
        ...withoutRotation
      } = candidate;
      const defaultRotation = bridgeBaseRotationDegrees(candidate.assetId) ?? 0;
      return parsed === defaultRotation
        ? withoutRotation
        : { ...withoutRotation, rotation: parsed };
    }),
  };
  const rotated = next.elements.find((candidate) => sameElementSlot(candidate, selection));
  return rotated && placementFitsMap(next, rotated) && keepsSpawnClear(next) ? next : null;
}

/** Resize one selected bridge in whole cells while preserving its authored anchor and identity. */
export function updateSelectedBridgeDimensions(
  map: EditorMap,
  selection: Extract<EditorSelection, { kind: "element" }>,
  dimensions: BridgeDimensions,
  placement?: Pick<MapElement, "col" | "row" | "offsetX" | "offsetY">,
): EditorMap | null {
  const element = map.elements.find((candidate) => sameElementSlot(candidate, selection));
  if (!element || !bridgeOrientation(element.assetId)) return null;
  const parsed = parseBridgeDimensions(dimensions);
  if (!parsed) return null;
  const resized = { ...element, ...placement, bridge: parsed };
  if (
    map.elements.some(
      (candidate) => !sameElementSlot(candidate, selection) && sameElementSlot(candidate, resized),
    )
  )
    return null;
  if (!placementFitsMap(map, resized)) return null;
  const next: EditorMap = {
    ...map,
    elements: map.elements.map((candidate) =>
      sameElementSlot(candidate, selection) ? resized : candidate,
    ),
  };
  return keepsSpawnClear(next) ? next : null;
}

/** Update one building's durability and footprint without changing its anchor or appearance. */
export function updateSelectedBuildingSettings(
  map: EditorMap,
  selection: Extract<EditorSelection, { kind: "element" }>,
  settings: BuildingSettings,
): EditorMap | null {
  const element = map.elements.find((candidate) => sameElementSlot(candidate, selection));
  if (!element || !isStandingBuildingAsset(element.assetId)) return null;
  const parsed = parseBuildingSettings(settings);
  if (!parsed) return null;
  const resized = { ...element, building: parsed };
  if (!placementFitsMap(map, resized)) return null;
  const next: EditorMap = {
    ...map,
    elements: map.elements.map((candidate) =>
      sameElementSlot(candidate, selection) ? resized : candidate,
    ),
  };
  return keepsSpawnClear(next) ? next : null;
}

/** Resize a native 3D prop with the same authored-front-edge contract as a building. */
export function updateSelectedNativeSceneryDimensions(
  map: EditorMap,
  selection: Extract<EditorSelection, { kind: "element" }>,
  dimensions: BuildingDimensions,
): EditorMap | null {
  const element = map.elements.find((candidate) => sameElementSlot(candidate, selection));
  if (!element || !isNativeSceneryAsset(element.assetId)) return null;
  const parsed = parseBuildingDimensions(dimensions);
  if (!parsed) return null;
  const resized = { ...element, dimensions: parsed };
  if (!placementFitsMap(map, resized)) return null;
  const next: EditorMap = {
    ...map,
    elements: map.elements.map((candidate) =>
      sameElementSlot(candidate, selection) ? resized : candidate,
    ),
  };
  return keepsSpawnClear(next) ? next : null;
}

export interface ElementEventBinding {
  name: string;
  commands: readonly MapEventPage["commands"][number][];
  /** Guided zone bindings use player touch; every other preset keeps the action trigger. */
  trigger?: MapEventPage["trigger"];
  /** One-shot objects (chests/loot) switch to an empty second page after their first run. */
  once?: boolean;
  /** Editor-only linkage applied to the adventure registry after this event receives its id. */
  questBinding?:
    | { readonly kind: "giver"; readonly questId: string }
    | { readonly kind: "turn-in"; readonly questId: string }
    | {
        readonly kind: "objective";
        readonly questId: string;
        readonly objectiveId: string;
        readonly interaction: "talk" | "interact";
      }
    | { readonly kind: "area"; readonly questId: string; readonly objectiveId: string };
}

/** Promote scenery into a stable scripted event while preserving its cell and catalogue graphic. */
export function convertElementToEvent(
  map: EditorMap,
  selection: Extract<EditorSelection, { kind: "element" }>,
  binding: ElementEventBinding,
): { map: EditorMap; eventId: string } | null {
  if (map.events.length >= MAX_EVENTS_PER_MAP) return null;
  if (runtimeEventCount(map.events) >= MAX_RUNTIME_EVENTS_PER_MAP) return null;
  const element = map.elements.find((candidate) => sameElementSlot(candidate, selection));
  if (!element) return null;
  if (map.events.some((event) => event.col === element.col && event.row === element.row))
    return null;
  const eventId = crypto.randomUUID();
  const firstPage: MapEventPage = {
    ...defaultEventPage(),
    graphicAssetId: element.assetId,
    trigger: binding.trigger ?? "action",
    commands: binding.once
      ? [...binding.commands, { t: "setSelfSwitch", selfSwitch: "A", value: true }]
      : binding.commands,
  };
  const pages: MapEventPage[] = binding.once
    ? [
        firstPage,
        {
          ...defaultEventPage(),
          ...(element.assetId === LINDOCARA_CHEST_CLOSED_ASSET_ID
            ? { graphicAssetId: LINDOCARA_CHEST_OPEN_ASSET_ID }
            : {}),
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
  return {
    ...event,
    ...(event.harvestProfile ? { harvestProfile: cloneHarvestProfile(event.harvestProfile) } : {}),
    pages: event.pages.map((page) => ({ ...page })),
  };
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
  tuningPatch: Partial<MonsterTuning> = {},
): MapEvent {
  if (draft.kind !== "monster") return draft;
  const defaults = defaultMonsterTuning(species);
  const current =
    draft.species === species
      ? {
          rank: draft.monsterRank ?? defaults.rank,
          maxHp: draft.monsterMaxHp ?? defaults.maxHp,
          damage: draft.monsterDamage ?? defaults.damage,
          speed: draft.monsterSpeed ?? defaults.speed,
          xp: draft.monsterXp ?? defaults.xp,
          weakness: draft.monsterWeakness ?? defaults.weakness,
          weaknessPercent: draft.monsterWeaknessPercent ?? defaults.weaknessPercent,
          specialTechnique: draft.monsterSpecialTechnique ?? defaults.specialTechnique,
        }
      : defaults;
  const tuning = { ...current, ...tuningPatch };
  return {
    ...draft,
    species,
    patrolRadius,
    monsterRank: tuning.rank,
    monsterMaxHp: tuning.maxHp,
    monsterDamage: tuning.damage,
    monsterSpeed: tuning.speed,
    monsterMaxSpeed: Math.max(draft.monsterMaxSpeed ?? tuning.speed, tuning.speed),
    monsterXp: tuning.xp,
    monsterWeakness: tuning.weakness,
    monsterWeaknessPercent: tuning.weaknessPercent,
    monsterSpecialTechnique: tuning.specialTechnique,
  };
}

/** Draft mutator for an explicit basic-attack override; `null` restores the species default. */
export function setEventDraftMonsterAttackProfile(
  draft: MapEvent,
  monsterAttackProfile: MonsterAttackProfile | null,
): MapEvent {
  if (draft.kind !== "monster") return draft;
  if (monsterAttackProfile !== null) return { ...draft, monsterAttackProfile };
  const { monsterAttackProfile: _discarded, ...natural } = draft;
  return natural;
}

/** Draft mutator for the encounter's authoritative death lifecycle. */
export function setEventDraftMonsterRespawnMode(
  draft: MapEvent,
  monsterRespawnMode: MonsterRespawnMode,
): MapEvent {
  return draft.kind === "monster" ? { ...draft, monsterRespawnMode } : draft;
}

/** Draft mutator for a timed monster encounter's authoritative respawn delay. */
export function setEventDraftMonsterRespawnDelay(
  draft: MapEvent,
  monsterRespawnDelayMs: number,
): MapEvent {
  return draft.kind === "monster" ? { ...draft, monsterRespawnDelayMs } : draft;
}

/** Draft mutator for runner-style pursuit. All values remain server-validated on save. */
export function setEventDraftMonsterPursuit(
  draft: MapEvent,
  monsterPursuitMode: MonsterPursuitMode,
  monsterAcceleration: number,
  monsterMaxSpeed: number,
  monsterOneHitKill: boolean,
): MapEvent {
  return draft.kind === "monster"
    ? {
        ...draft,
        monsterPursuitMode,
        monsterAcceleration,
        monsterMaxSpeed,
        monsterOneHitKill,
      }
    : draft;
}

/** Draft mutator for an authored allied guard's authoritative movement leash. */
export function setEventDraftGuardRadius(draft: MapEvent, patrolRadius: number): MapEvent {
  return draft.kind === "guard" ? { ...draft, patrolRadius } : draft;
}

/** Draft mutator for a free NPC's editable survivability, power and movement zone. */
export function setEventDraftNpc(
  draft: MapEvent,
  patrolRadius: number,
  tuningPatch: Partial<Pick<MonsterTuning, "maxHp" | "damage">> = {},
): MapEvent {
  if (draft.kind !== "npc") return draft;
  const defaults = defaultMonsterTuning("spear_goblin");
  return {
    ...draft,
    patrolRadius,
    monsterMaxHp: tuningPatch.maxHp ?? draft.monsterMaxHp ?? defaults.maxHp,
    monsterDamage: tuningPatch.damage ?? draft.monsterDamage ?? defaults.damage,
    monsterSpeed: draft.monsterSpeed ?? defaults.speed,
  };
}

/** Draft mutator for the complete explicit resource contract. Appearance remains page data and is
 * intentionally absent from this operation, so swapping a sprite cannot rewrite gameplay. */
export function setEventDraftHarvestProfile(
  draft: MapEvent,
  harvestProfile: HarvestProfile,
): MapEvent {
  return draft.kind === "harvestable"
    ? { ...draft, harvestProfile: cloneHarvestProfile(harvestProfile) }
    : draft;
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
  if (!present.events.some((event) => event.id === draft.id)) return history;
  if (!harvestEventFootprintFitsMap(present, draft)) return history;
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
    environment: "exterior",
    weather: "none",
    audio: EMPTY_MAP_AUDIO,
    heroSettings: defaultMapHeroSettings(),
    // Permanent day, matching the engine's `defaultMapInput` template a stored blank map is minted
    // from — the two describe the same "fresh map" and must not disagree.
    dayNightCycle: false,
    fixedLighting: DEFAULT_MAP_FIXED_LIGHTING,
    layers,
    elements: [],
    spawn: { col: Math.floor(cols / 2), row: Math.floor(rows / 2) },
    markers: EMPTY_MARKERS,
    events: [],
  };
}

/** The whole-canvas working document a session edits: the stored map centered in the maximum
 *  authorable rect. Every cell is paintable; empty cells are ocean. Applied ONCE at session open —
 *  coordinates never shift again for the life of the session. `selfMapId`, when given, is this
 *  session's own map id — the one a same-map `teleport` command carries — so its authored cell
 *  pads in step with the rest of the content instead of staying pinned to the pre-pad frame. */
export function canvasEditorMap(map: EditorMap, selfMapId?: string): EditorMap {
  return { ...map, ...padMapToCanvas(map, selfMapId) };
}

/** What a save stores: the derived content rect (+ ocean margin) cropped out of the canvas. Also
 *  what the playable preview and the member thumbnail read, so they match the runtime exactly.
 *  `selfMapId` is forwarded to `derivedMapRect`/`cropMapToRect` so a same-map `teleport` command's
 *  target both keeps the rect from cropping past it and moves with the crop itself. */
export function croppedForSave(map: EditorMap, selfMapId?: string): EditorMap {
  return { ...map, ...cropMapToRect(map, derivedMapRect(map, selfMapId), selfMapId) };
}

/**
 * Resolve a canvas selection to the element slot the server actually stores after crop. Freshly
 * placed elements have no database id yet, so their cropped slot is the only safe compatibility
 * key for a follow-up request made in the same editor session.
 */
export function elementForSavedMap(
  map: EditorMap,
  selected: MapElement,
  selfMapId?: string,
): MapElement {
  const index = map.elements.findIndex((candidate) => sameElementSlot(candidate, selected));
  if (index < 0) return selected;
  return croppedForSave(map, selfMapId).elements[index] ?? selected;
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
    graphicTint: EVENT_GRAPHIC_TINT_DEFAULT,
    moveType: "fixed",
    moveRoute: [],
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

/**
 * A placed preset's name: its label plus the next number free for THAT label on this map, so a map
 * reads `Téléporteur 1`, `Téléporteur 2`, `Coffre 1` instead of three events all called by their
 * preset. `EV001` is identity and stays identity; this is the name an author reads and renames.
 *
 * Counted from the highest number already used rather than from how many events exist: deleting
 * `Téléporteur 1` must not make the next placement collide with `Téléporteur 2`. A name the author
 * has since rewritten simply stops counting, which is the right answer for a field they own.
 *
 * The label arrives already localized (the palette passes `t(PRESET_LABEL[preset])`) because an
 * event name is authored DATA in the author's own language, never a message key. Labels contain
 * `/` and parentheses, so the match is a prefix test rather than a regular expression nobody would
 * remember to escape.
 */
function numberedPresetName(label: string, events: readonly MapEvent[]): string {
  if (label.length === 0) return label;
  const prefix = `${label} `;
  let highest = 0;
  for (const event of events) {
    if (!event.name.startsWith(prefix)) continue;
    const suffix = event.name.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    highest = Math.max(highest, Number(suffix));
  }
  return `${prefix}${highest + 1}`;
}

/** The editor's layers are the map's layers: no projection, nothing to lose. Markers are QUARANTINED
 *  (UX wave #12) — entries/exits/monster spawns are typed events now — so the editor always emits
 *  `EMPTY_MARKERS` and never a functional marker the server would ignore. */
export function toMapData(map: EditorMap): MapData {
  const { cols, rows } = editorMapSize(map);
  return {
    tilesetId: TINY_SWORDS_TILESET_ID,
    environment: map.environment ?? "exterior",
    ...(map.interiorShell ? { interiorShell: map.interiorShell } : {}),
    ...(map.underground ? { underground: map.underground } : {}),
    weather: map.weather ?? "none",
    cols,
    rows,
    layers: map.layers,
    elements: map.elements,
    spawn: map.spawn,
    markers: EMPTY_MARKERS,
  };
}

/**
 * Apply an interior coating and re-skin the ground that belongs to the envelope.
 *
 * The first coating adopts every existing solid floor so an imported/exterior map immediately has
 * an enclosing wall. A later theme change converts only the previous structural material, keeping
 * pools and decorative terrain authored after the first conversion intact. Heights never change.
 */
export function applyInteriorShellSetting(
  map: EditorMap,
  environment: MapEnvironment,
  requested?: InteriorShell,
): EditorMap {
  if (environment !== "interior" || !requested) {
    const next: EditorMap = { ...map, environment };
    delete next.interiorShell;
    return next;
  }

  const previous = map.interiorShell;
  const interiorShell: InteriorShell = {
    style: requested.style,
    ...(requested.openOuterWalls === false ? { openOuterWalls: false } : {}),
    ...(requested.openInnerWalls === false ? { openInnerWalls: false } : {}),
    ...(previous?.innerWalls && previous.innerWalls.length > 0
      ? { innerWalls: previous.innerWalls }
      : {}),
    ...(previous?.openings && previous.openings.length > 0 ? { openings: previous.openings } : {}),
  };
  if (
    previous?.style === requested.style &&
    (previous.openOuterWalls ?? true) === (requested.openOuterWalls ?? true) &&
    (previous.openInnerWalls ?? true) === (requested.openInnerWalls ?? true) &&
    map.environment === environment
  )
    return map;

  const ground = map.layers[GROUND_LAYER];
  if (!ground) return { ...map, environment, interiorShell };
  const from = previous ? interiorShellFloorMaterial(previous.style) : null;
  const to = interiorShellFloorMaterial(requested.style);
  const ids = [...ground.ids];
  let changed = false;
  for (let row = 0; row < ground.rows; row += 1) {
    for (let col = 0; col < ground.cols; col += 1) {
      const index = row * ground.cols + col;
      const descriptor = terrainDescriptorOfTileId(ground.ids[index] ?? 0);
      if (!descriptor || (from !== null && descriptor.material !== from)) continue;
      if (descriptor.material === to) continue;
      const slot = terrainSlot(to, descriptor.level);
      const fixedIndex = terrainFixedIndex(to, descriptor.level);
      if (slot === null && fixedIndex < 0) continue;
      ids[index] = slot === null ? fixedId(fixedIndex) : autotileId(slot, 0);
      changed = true;
    }
  }
  const layers = !changed
    ? map.layers
    : [resolveWholeLayer({ ...ground, ids }, TINY_SWORDS_TILESET), ...map.layers.slice(1)];
  return { ...map, environment, interiorShell, layers };
}

/** Open or close a real passage while keeping the coating and every unrelated gap intact. */
export function applyInteriorWallOpening(
  map: EditorMap,
  opening: InteriorShellOpeningRun,
  operation: "open" | "close",
): EditorMap | null {
  const shell = map.environment === "interior" ? map.interiorShell : undefined;
  if (!shell) return null;
  const interiorShell =
    operation === "open"
      ? addInteriorShellOpening(shell, opening)
      : removeInteriorShellOpening(shell, opening);
  if (interiorShell === shell) return map;
  return { ...map, interiorShell };
}

/**
 * The editor's save body. Structurally `api.ts`'s `MapSaveInput` — spelled out here rather than
 * imported so `client/game/` keeps depending on nothing above it. `selfMapId`, forwarded to
 * `croppedForSave`, is this session's own map id — the caller passes it whenever it knows one, so
 * a same-map `teleport` command's cell crops in step with the rest of the saved content.
 */
export function toSaveInput(
  map: EditorMap,
  selfMapId?: string,
): {
  name: string;
  environment: MapEnvironment;
  interiorShell?: InteriorShell;
  weather: MapWeather;
  tilesetId: string;
  cols: number;
  rows: number;
  layers: string[];
  elements: MapElement[];
  spawn: { col: number; row: number };
  markers: MapMarkers;
  events: readonly MapEvent[];
  audio: MapAudioConfig;
  heroSettings: MapHeroSettings;
  dayNightCycle: boolean;
  fixedLighting: MapFixedLighting;
  heightfield: string;
} {
  const cropped = croppedForSave(map, selfMapId);
  const data = toMapData(cropped);
  return {
    name: map.name,
    environment: map.environment ?? "exterior",
    ...(cropped.interiorShell ? { interiorShell: cropped.interiorShell } : {}),
    weather: map.weather ?? "none",
    audio: map.audio,
    heroSettings: map.heroSettings ?? defaultMapHeroSettings(),
    dayNightCycle: map.dayNightCycle,
    fixedLighting: map.fixedLighting,
    tilesetId: data.tilesetId,
    cols: data.cols,
    rows: data.rows,
    layers: data.layers.map(encodeTileLayer),
    elements: cropped.elements,
    spawn: cropped.spawn,
    // Markers are QUARANTINED: the editor never authors one, so it always sends `EMPTY_MARKERS`. The
    // functional meaning lives in `events` now.
    markers: EMPTY_MARKERS,
    // The `MapEvent` shape carries every condition field as an explicit `null`, so `JSON.stringify`
    // emits `"condSwitchId":null` rather than dropping the key. The wire parser rejects a page with
    // an ABSENT condition field, so this fullness is load-bearing, not cosmetic.
    events: cropped.events,
    heightfield: encodeMap(compileAuthoredMap(data, cropped.events)),
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
 * may not share the spawn cell. Terrain is intentionally irrelevant: authors may stage actors and
 * triggers in water, on ice or on any future material.
 */
function functionalEventPlacementOk(
  map: EditorMap,
  kind: EventKind,
  col: number,
  row: number,
): boolean {
  if (kind === "normal") return true;
  if (kind === "exit" && col === map.spawn.col && row === map.spawn.row) return false;
  if (kind === "sea-guardian") return isAuthoredWaterCell(toMapData(map), col, row);
  return true;
}

/** A harvest tool still needs a valid profile; its collider may overhang the authored map. */
function harvestEventFootprintFitsMap(
  _map: EditorMap,
  event: Pick<MapEvent, "kind" | "harvestProfile">,
): boolean {
  if (event.kind !== "harvestable") return true;
  const profile = parseHarvestProfile(event.harvestProfile);
  if (!profile) return false;
  return true;
}

function placementFitsMap(map: EditorMap, element: MapElement): boolean {
  const { cols, rows } = editorMapSize(map);
  return elementFitsMap(element, cols, rows);
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

function structuralFloorAt(
  ground: TileLayer,
  shell: InteriorShell,
  col: number,
  row: number,
): boolean {
  const id = ground.ids[row * ground.cols + col];
  if (id === undefined) return false;
  return terrainDescriptorOfTileId(id)?.material === interiorShellFloorMaterial(shell.style);
}

/** A material-only repaint of the selected coating is the gesture that authors an inner room. */
function structuralRepaintCells(
  map: EditorMap,
  content: RectFillContent,
  cells: readonly { col: number; row: number }[],
  ground = map.layers[GROUND_LAYER],
): Array<{ col: number; row: number }> {
  const shell = map.environment === "interior" ? map.interiorShell : undefined;
  if (
    !shell ||
    !ground ||
    content.kind !== "elevation" ||
    !("step" in content) ||
    content.step !== "keep" ||
    content.material !== interiorShellFloorMaterial(shell.style)
  )
    return [];
  return cells.filter((cell) => structuralFloorAt(ground, shell, cell.col, cell.row));
}

function reconciledInteriorShell(
  map: EditorMap,
  layers: readonly TileLayer[],
  addedInnerWalls: readonly { col: number; row: number }[],
): InteriorShell | undefined {
  const shell = map.environment === "interior" ? map.interiorShell : undefined;
  const ground = layers[GROUND_LAYER];
  if (!shell || !ground) return shell;
  const pruned = filterInteriorShellInnerWalls(shell, (col, row) =>
    structuralFloorAt(ground, shell, col, row),
  );
  return addInteriorShellInnerWalls(pruned, addedInnerWalls);
}

/**
 * Adopt a repainted layer stack, or refuse it.
 *
 * Scenery is deliberately independent from terrain: painting water, grass or elevation underneath a
 * prop never deletes it. A stroke that would make the map's technical spawn unwalkable is still
 * refused outright.
 */
function commitTerrain(
  map: EditorMap,
  layers: TileLayer[],
  addedInnerWalls: readonly { col: number; row: number }[] = [],
): EditorMap | null {
  const interiorShell = reconciledInteriorShell(map, layers, addedInnerWalls);
  if (sameLayers(map.layers, layers) && interiorShell === map.interiorShell) return map;
  const next: EditorMap = {
    ...map,
    layers,
    ...(interiorShell ? { interiorShell } : {}),
  };
  if (!interiorShell) delete next.interiorShell;
  return keepsSpawnClear(next) ? next : null;
}

/** Remove a complete staircase first; otherwise clear the ground at one cell and let layer 1 catch
 *  up. Stairs live on layer 1 and replace a cliff face, so erasing only layer 0 left the newer
 *  automatic runs visible and passable while also destroying their terrain support. */
function erasedTerrain(map: EditorMap, col: number, row: number): TileLayer[] | null {
  const withoutStairs = eraseStairsAt(map.layers, TINY_SWORDS_TILESET, col, row);
  if (withoutStairs !== map.layers) return withoutStairs;
  const ground = map.layers[GROUND_LAYER];
  if (!ground) return null;
  const erased = eraseTile(ground, TINY_SWORDS_TILESET, col, row);
  return syncElevationWalls([erased, ...map.layers.slice(1)], TINY_SWORDS_TILESET, col, row);
}

/** Surface tier preserved when ground becomes water. The legacy empty sea has no authored tier,
 * but painting it again starts at zero rather than at negative infinity. */
function surfaceElevationAt(ground: TileLayer, col: number, row: number): number {
  const elevation = groundElevationAt(ground, col, row);
  return isGroundElevation(elevation) ? elevation : 0;
}

function paintedWater(map: EditorMap, col: number, row: number): TileLayer[] | null {
  const ground = map.layers[GROUND_LAYER];
  if (!ground) return null;
  const painted = paintWaterLayer(
    ground,
    TINY_SWORDS_TILESET,
    surfaceElevationAt(ground, col, row),
    col,
    row,
  );
  return syncElevationWalls([painted, ...map.layers.slice(1)], TINY_SWORDS_TILESET, col, row);
}

/**
 * Field-mode eraser: remove the complete staircase at the cell, or clear its ground (with cliff-wall
 * upkeep) when there is no staircase, and keep the spawn on walkable ground. Unlike a paint stroke's
 * `commitTerrain`, it never drops an element standing over the drowned cell. A mode owns exactly one
 * collection, so a Field erase takes ONLY terrain; the decor floating above it is Element mode's to
 * remove. Same reference when the cell was already void, so a repeated click reads as a no-op.
 * Refused (`null`) only when the erase would drown the spawn — the one guard `commitTerrain` provides
 * that Field erase still wants.
 */
function erasedTerrainMap(map: EditorMap, col: number, row: number): EditorMap | null {
  const layers = erasedTerrain(map, col, row);
  if (!layers) return null;
  return commitTerrain(map, layers);
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
  const event = map.events[index];
  return event ? deleteSelection(map, { kind: "event", id: event.id }) : map;
}

/**
 * Place a reciprocal same-map teleporter pair as one document change. The editor stage waits for
 * both clicks before calling this function, so neither history nor persistence can ever observe a
 * half-authored link.
 */
function linkedTeleportEvent(event: MapEvent, linkedEventId: string): MapEvent {
  return {
    ...event,
    linkedEventId,
    pages: event.pages.map((page) => ({
      ...page,
      commands: page.commands.map((command) =>
        command.t === "teleport" ? { ...command, eventId: linkedEventId } : command,
      ),
    })),
  };
}

export function placeLinkedTeleporters(
  map: EditorMap,
  tool: EditorEventTool,
  source: { col: number; row: number },
  destination: { col: number; row: number },
): EditorMap | null {
  if (tool.eventKind !== "normal" || tool.preset !== "teleporter") return null;
  if (source.col === destination.col && source.row === destination.row) return null;
  if (map.events.length > MAX_EVENTS_PER_MAP - 2) return null;
  if (runtimeEventCount(map.events) > MAX_RUNTIME_EVENTS_PER_MAP - 2) return null;
  for (const point of [source, destination]) {
    if (map.events.some((event) => event.col === point.col && event.row === point.row)) return null;
    if (!functionalEventPlacementOk(map, "normal", point.col, point.row)) return null;
  }
  const sourceId = crypto.randomUUID();
  const destinationId = crypto.randomUUID();
  const ordinal = nextEventOrdinal(map.events);
  const name =
    tool.presetName === undefined ? undefined : numberedPresetName(tool.presetName, map.events);
  const sourceEvent = linkedTeleportEvent(
    presetEvent({
      id: sourceId,
      ...source,
      ordinal,
      preset: "teleporter",
      selfMapId: tool.selfMapId ?? "",
      selfSpawn: destination,
      ...(name === undefined ? {} : { name }),
    }),
    destinationId,
  );
  const destinationEvent = linkedTeleportEvent(
    presetEvent({
      id: destinationId,
      ...destination,
      ordinal: ordinal + 1,
      preset: "teleporter",
      selfMapId: tool.selfMapId ?? "",
      selfSpawn: source,
      ...(name === undefined ? {} : { name }),
    }),
    sourceId,
  );
  return { ...map, events: [...map.events, sourceEvent, destinationEvent] };
}

/** `syncElevationWalls` for one cell, widened to a rectangle. Each call already checks the cell and
 * its four neighbours, so visiting the changed ground region covers every directional face. */
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

/**
 * The autotile slot a terrain selection paints on ONE cell, or null when it paints nothing there.
 *
 * Null has two meanings and both are correct: water has no terrain slot (its explicit fixed id is
 * written by `paintWaterLayer`), and a relative elevation step can have nowhere to go on this
 * particular cell. The cell is a parameter precisely because of the second: a relative brush has no
 * answer until it knows what it landed on.
 */
function contentTarget(
  content: RectFillContent,
  ground: TileLayer,
  col: number,
  row: number,
): { material: TerrainMaterial; level: number } | null {
  if (content.kind === "elevation") {
    const target = elevationTargetLevel(content, groundElevationAt(ground, col, row));
    return target === null ? null : { material: content.material ?? "herbe", level: target };
  }
  return content.block === "grass" ? { material: "herbe", level: 0 } : null;
}

/**
 * A rectangle of `content` on the ground layer.
 *
 * Water and terrain are painted CELL BY CELL, because each water surface preserves its source tier
 * and a relative elevation step resolves against each cell's own height. A "+1" rectangle dragged
 * across a slope raises every cell it covers by one rather than flattening them all to whatever the
 * first cell happened to be. Reading each cell's level back off the in-progress layer is safe: a
 * rectangle touches every cell once, and neighbour re-resolution changes variants, never slots.
 */
function paintRectContent(
  ground: TileLayer,
  content: RectFillContent,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
): TileLayer {
  let layer = ground;
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      if (content.kind === "block" && content.block === "water") {
        layer = paintWaterLayer(
          layer,
          TINY_SWORDS_TILESET,
          surfaceElevationAt(layer, col, row),
          col,
          row,
        );
        continue;
      }
      const target = contentTarget(content, layer, col, row);
      if (target === null) continue;
      layer = paintTerrainLayer(
        layer,
        TINY_SWORDS_TILESET,
        target.material,
        target.level,
        col,
        row,
      );
    }
  }
  return layer;
}

/** A flood fill of `content` on the ground layer. Water uses its dedicated height-preserving
 *  flood brush; terrain materials resolve the target slot shared by the origin region. */
function fillContent(
  ground: TileLayer,
  content: RectFillContent,
  col: number,
  row: number,
): TileLayer | null {
  if (content.kind === "block" && content.block === "water") {
    return floodFillWater(
      ground,
      TINY_SWORDS_TILESET,
      surfaceElevationAt(ground, col, row),
      col,
      row,
    );
  }
  // One slot for the whole region, resolved at the CLICKED cell, and that is exact rather than an
  // approximation: a flood region is by definition every cell sharing the origin's slot, so every
  // cell in it stands at the same level and a relative step reaches the same target from all of them.
  const target = contentTarget(content, ground, col, row);
  if (target === null) return null;
  return floodFillTerrain(ground, TINY_SWORDS_TILESET, target.material, target.level, col, row);
}

type WheelTerrainTarget = { kind: "ground"; material: TerrainMaterial } | { kind: "water" };

function wheelTerrainTarget(tool: EditorTool): WheelTerrainTarget | null {
  const content = tool.kind === "rect" || tool.kind === "fill" ? tool.content : tool;
  if (content.kind === "block") {
    return content.block === "grass" ? { kind: "ground", material: "herbe" } : { kind: "water" };
  }
  return content.kind === "elevation"
    ? { kind: "ground", material: content.material ?? "herbe" }
    : null;
}

/** Raise or lower the terrain footprint currently held under the pointer. The source snapshot is
 * load-bearing for flood fill: after a fill changes its material, its new edge can touch an older
 * region of that material, but the wheel must still affect only the region the held click selected. */
export function adjustTerrainToolElevation(
  map: EditorMap,
  tool: EditorTool,
  col: number,
  row: number,
  direction: Exclude<ElevationStep, "keep">,
  source: EditorMap = map,
): EditorMap | null {
  const targetKind = wheelTerrainTarget(tool);
  const ground = map.layers[GROUND_LAYER];
  if (!targetKind || !ground) return null;

  let cells: { col: number; row: number }[];
  if (tool.kind === "rect") {
    const anchor = map.strokeAnchor;
    if (!anchor) return null;
    const bounds = clampToMap(map, anchor.col, anchor.row, col, row);
    if (!bounds) return null;
    cells = [];
    for (let cellRow = bounds.r0; cellRow <= bounds.r1; cellRow += 1) {
      for (let cellCol = bounds.c0; cellCol <= bounds.c1; cellCol += 1) {
        cells.push({ col: cellCol, row: cellRow });
      }
    }
  } else if (tool.kind === "fill") {
    const sourceGround = source.layers[GROUND_LAYER];
    if (!sourceGround) return null;
    cells =
      targetKind.kind === "water"
        ? waterFloodRegion(sourceGround, col, row)
        : terrainFloodRegion(sourceGround, col, row);
  } else if (tool.kind === "block" || tool.kind === "elevation") {
    cells = [{ col, row }];
  } else {
    return null;
  }

  let painted = ground;
  for (const cell of cells) {
    const current =
      targetKind.kind === "water"
        ? surfaceElevationAt(painted, cell.col, cell.row)
        : groundElevationAt(painted, cell.col, cell.row);
    const target = elevationStepTarget(direction, current);
    if (target === null) continue;
    painted =
      targetKind.kind === "water"
        ? paintWaterLayer(painted, TINY_SWORDS_TILESET, target, cell.col, cell.row)
        : paintTerrainLayer(
            painted,
            TINY_SWORDS_TILESET,
            targetKind.material,
            target,
            cell.col,
            cell.row,
          );
  }
  const bounds = changedBounds(ground, painted);
  if (!bounds) return map;
  const layers = syncElevationWallsForRect(
    [painted, ...map.layers.slice(1)],
    bounds.c0,
    bounds.r0,
    bounds.c1,
    bounds.r1,
  );
  return commitTerrain(map, layers);
}

/**
 * Where a hero arriving through a door is put down: a walkable cell touching it, never the door
 * itself.
 *
 * A door teleporter commonly sits on SOLID ground (the gate is part of a building), which is exactly
 * what `detectPlayerTouch` is built for: it tests the body's footprint against the event cell with a
 * movement tolerance, so a hero can touch a door it can never occupy. The arrival is the other half
 * of that: the runtime refuses a teleport onto unwalkable ground, and it only warns into the server
 * log, so an arrival cell chosen carelessly is a door that silently does nothing.
 *
 * South first, because that is the side a Tiny Swords building's threshold faces, then the two sides,
 * then north. `null` means this cell has no reachable front at all and cannot be a door.
 */
function doorLandingCell(
  map: EditorMap,
  col: number,
  row: number,
): { col: number; row: number } | null {
  const { cols, rows } = editorMapSize(map);
  // A visible raised surface is a deliberate destination, not a blocked ground cell inside the
  // building. This is what lets a roof click stay on the roof for both door links and teleporters.
  const heightfield = compileAuthoredMap(toMapData(map), map.events);
  const terrain = zoneTerrainFromHeightfield(heightfield);
  const [x, z] = terrain.query.cellCenter(col, row);
  const base = terrain.query.heightAt(x, z) ?? terrain.waterLevel;
  const landing = groundUnder(terrain, x, z, Number.POSITIVE_INFINITY);
  if (landing > base && canStand(terrain, x, z, BODY_RADIUS, landing)) return { col, row };
  const candidates = [
    { col, row: row + 1 },
    { col: col + 1, row },
    { col: col - 1, row },
    { col, row: row - 1 },
  ];
  for (const candidate of candidates) {
    if (candidate.col < 0 || candidate.row < 0 || candidate.col >= cols || candidate.row >= rows) {
      continue;
    }
    if (isWalkableCell(map, candidate.col, candidate.row)) return candidate;
  }
  return null;
}

/**
 * May this cell be one end of a door link? Shared by the commit and by the stage's hover preview, so
 * the ghost and the click cannot disagree about which cells are refused.
 */
export function canLinkDoorAt(map: EditorMap, col: number, row: number): boolean {
  const { cols, rows } = editorMapSize(map);
  if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
  // One event per cell is the placement rule everywhere else; a link may not quietly break it.
  if (map.events.some((event) => event.col === col && event.row === row)) return false;
  return doorLandingCell(map, col, row) !== null;
}

/** One end of a door link: the `teleporter` preset aimed at the far door's landing cell, and marked
 *  `shortcut` rather than `geographic` — nothing about this crosses the world's geography, it is two
 *  doors on one map. Everything else comes from the preset, so the command program a link writes and
 *  the one the palette's Teleporter writes cannot drift. */
function doorLinkEvent(params: {
  id: string;
  linkedEventId: string;
  col: number;
  row: number;
  ordinal: number;
  selfMapId: string;
  destination: { col: number; row: number };
  name: string;
}): MapEvent {
  const event = presetEvent({
    id: params.id,
    col: params.col,
    row: params.row,
    ordinal: params.ordinal,
    preset: "teleporter",
    selfMapId: params.selfMapId,
    selfSpawn: params.destination,
    name: params.name,
  });
  return {
    ...event,
    linkedEventId: params.linkedEventId,
    pages: event.pages.map((page) => ({
      ...page,
      commands: page.commands.map((command) =>
        command.t === "teleport"
          ? {
              ...command,
              category: "shortcut" as const,
            }
          : command,
      ),
    })),
  };
}

/** Open water in the authoring document: both historical empty sea and explicit authored-water ids
 *  count. Off-map answers false, so a crossing measured against the border stops at the map edge. */
function openWaterAt(map: EditorMap, col: number, row: number): boolean {
  const ground = map.layers[GROUND_LAYER];
  if (!ground) return false;
  if (col < 0 || row < 0 || col >= ground.cols || row >= ground.rows) return false;
  const id = ground.ids[row * ground.cols + col] ?? EMPTY_TILE;
  return id === EMPTY_TILE || waterLevelOfTileId(id) !== null;
}

/** The asset a placement actually writes. Everything places what the palette selected, except a
 *  bridge: one card is offered and the crossing under the cursor decides which of the two decks it
 *  becomes (the inspector switches it afterwards). */
export function placedAssetId(
  map: EditorMap,
  assetId: EditorAssetId,
  col: number,
  row: number,
): EditorAssetId {
  if (!bridgeOrientation(assetId)) return assetId;
  return bridgeAssetIdForCrossing(
    (candidateCol, candidateRow) => openWaterAt(map, candidateCol, candidateRow),
    col,
    row,
  );
}

function applyUndergroundTool(
  map: EditorMap,
  tool: Extract<EditorTool, { kind: "underground" }>,
  col: number,
  row: number,
): EditorMap | null {
  const { cols, rows } = editorMapSize(map);
  const depth = Math.max(1, Math.min(MAX_UNDERGROUND_DEPTH, Math.trunc(tool.depth)));
  const alongX = tool.direction === "east" || tool.direction === "west";
  const footprintCols =
    tool.operation === "stairs" ? (alongX ? tool.length : tool.width) : tool.width;
  const footprintRows =
    tool.operation === "stairs" ? (alongX ? tool.width : tool.length) : tool.length;
  const c0 = Math.max(0, Math.min(cols - 1, col));
  const r0 = Math.max(0, Math.min(rows - 1, row));
  const c1 = Math.min(cols, c0 + Math.max(1, Math.trunc(footprintCols)));
  const r1 = Math.min(rows, r0 + Math.max(1, Math.trunc(footprintRows)));
  if (c1 <= c0 || r1 <= r0) return null;

  const source: UndergroundMap = map.underground ?? { levels: [], stairs: [] };
  const byDepth = new Map(source.levels.map((level) => [level.depth, level]));
  const touchedDepths =
    tool.operation === "shaft"
      ? Array.from({ length: depth }, (_unused, index) => index + 1)
      : tool.operation === "stairs" && depth > 1
        ? [depth - 1, depth]
        : [depth];
  for (const touchedDepth of touchedDepths) {
    const previous = byDepth.get(touchedDepth);
    const cells = undergroundCells(previous, Math.max(cols, rows));
    for (let cellRow = r0; cellRow < r1; cellRow += 1) {
      for (let cellCol = c0; cellCol < c1; cellCol += 1) {
        cells[cellRow * Math.max(cols, rows) + cellCol] = tool.operation === "fill" ? 0 : 1;
      }
    }
    const compact = compactUndergroundCells(cells, Math.max(cols, rows));
    if (compact.length === 0) byDepth.delete(touchedDepth);
    else
      byDepth.set(touchedDepth, {
        depth: touchedDepth,
        style: tool.operation === "fill" ? (previous?.style ?? tool.style) : tool.style,
        cells: compact,
      });
  }
  let stairs = source.stairs.filter((stair) => {
    if (tool.operation !== "fill" || stair.depth !== depth) return true;
    const stairAlongX = stair.direction === "east" || stair.direction === "west";
    const stairCols = stairAlongX ? stair.length : stair.width;
    const stairRows = stairAlongX ? stair.width : stair.length;
    return (
      stair.col + stairCols <= c0 ||
      stair.col >= c1 ||
      stair.row + stairRows <= r0 ||
      stair.row >= r1
    );
  });
  let shafts = (source.shafts ?? []).filter((shaft) => {
    if (tool.operation !== "fill") return true;
    return (
      shaft.col + shaft.width <= c0 ||
      shaft.col >= c1 ||
      shaft.row + shaft.length <= r0 ||
      shaft.row >= r1
    );
  });
  if (tool.operation === "stairs") {
    const requestedLength = Math.max(
      2,
      Math.trunc(tool.length || DEFAULT_UNDERGROUND_STAIR_LENGTH),
    );
    const requestedWidth = Math.max(1, Math.trunc(tool.width || DEFAULT_UNDERGROUND_STAIR_WIDTH));
    const stairLength = Math.min(requestedLength, alongX ? c1 - c0 : r1 - r0);
    const stairWidth = Math.min(requestedWidth, alongX ? r1 - r0 : c1 - c0);
    if (stairLength < 2 || stairWidth < 1) return null;
    stairs = [
      ...stairs.filter((stair) => stair.depth !== depth || stair.col !== c0 || stair.row !== r0),
      {
        depth,
        col: c0,
        row: r0,
        direction: tool.direction,
        length: stairLength,
        width: stairWidth,
      },
    ];
  }
  if (tool.operation === "shaft") {
    shafts = [
      ...shafts.filter(
        (shaft) =>
          shaft.col + shaft.width <= c0 ||
          shaft.col >= c1 ||
          shaft.row + shaft.length <= r0 ||
          shaft.row >= r1,
      ),
      { col: c0, row: r0, width: c1 - c0, length: r1 - r0, depth },
    ];
  }
  const underground: UndergroundMap = {
    levels: [...byDepth.values()].sort((left, right) => left.depth - right.depth),
    stairs,
    ...(shafts.length > 0 ? { shafts } : {}),
  };
  return { ...map, underground };
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
    case "underground":
      return applyUndergroundTool(map, tool, col, row);
    case "block": {
      // Grass goes through `paintElevation` at level 0 rather than a bare `paintAutotile`: painting
      // flat ground under a raised cell must also take away the cliff face that cell was casting.
      // Water is an erased ground cell — on layer 0 an empty cell *is* the sea.
      const layers =
        tool.block === "grass"
          ? paintElevation(map.layers, TINY_SWORDS_TILESET, 0, col, row)
          : paintedWater(map, col, row);
      if (!layers) return null;
      return commitTerrain(map, layers);
    }
    /**
     * One cell, relative to what is already there. A refusal (`null`) reaches the stage as a
     * placement rejection and flashes its hint, so "-1 on the ground" says so instead of looking
     * like a brush that stopped working.
     */
    case "elevation": {
      const ground = map.layers[GROUND_LAYER];
      if (!ground) return null;
      const innerWalls = structuralRepaintCells(map, tool, [{ col, row }], ground);
      const target = elevationTargetLevel(tool, groundElevationAt(ground, col, row));
      if (target === null) return null;
      const layers = paintTerrain(
        map.layers,
        TINY_SWORDS_TILESET,
        tool.material ?? "herbe",
        target,
        col,
        row,
      );
      return commitTerrain(map, layers, innerWalls);
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
        return {
          ...map,
          strokeAnchor: {
            col,
            row,
            layers: map.layers,
            ...(map.interiorShell ? { interiorShell: map.interiorShell } : {}),
          },
        };
      }
      const anchor = map.strokeAnchor;
      if (!anchor) return null;
      const bounds = clampToMap(map, anchor.col, anchor.row, col, row);
      if (!bounds) return null;
      const ground = anchor.layers[GROUND_LAYER];
      if (!ground) return null;
      const cells: Array<{ col: number; row: number }> = [];
      for (let cellRow = bounds.r0; cellRow <= bounds.r1; cellRow += 1) {
        for (let cellCol = bounds.c0; cellCol <= bounds.c1; cellCol += 1) {
          cells.push({ col: cellCol, row: cellRow });
        }
      }
      const anchoredMap: EditorMap = {
        ...map,
        ...(anchor.interiorShell ? { interiorShell: anchor.interiorShell } : {}),
      };
      if (!anchor.interiorShell) delete anchoredMap.interiorShell;
      const innerWalls = structuralRepaintCells(anchoredMap, tool.content, cells, ground);
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
      return commitTerrain(anchoredMap, layers, innerWalls);
    }
    /** One click, one flood region. Same ground + wall-upkeep targeting as `rect`; the active mode
     *  never applies since the content is always terrain. */
    case "fill": {
      const ground = map.layers[GROUND_LAYER];
      if (!ground) return null;
      const innerWalls = structuralRepaintCells(
        map,
        tool.content,
        terrainFloodRegion(ground, col, row),
        ground,
      );
      const painted = fillContent(ground, tool.content, col, row);
      if (!painted) return null;
      const bounds = changedBounds(ground, painted);
      if (!bounds) return commitTerrain(map, map.layers, innerWalls);
      const layers = syncElevationWallsForRect(
        [painted, ...map.layers.slice(1)],
        bounds.c0,
        bounds.r0,
        bounds.c1,
        bounds.r1,
      );
      return commitTerrain(map, layers, innerWalls);
    }
    /** Layer 1 by its own fixed rule — a ramp is a wall-layer fixture no matter the active mode.
     *  `paintStairs` itself refuses (same-reference) an out-of-bounds stamp; that refusal is passed
     *  straight through. */
    case "stairs": {
      const ground = map.layers[GROUND_LAYER];
      if (!ground) return null;
      const plan = inferStairsRun(ground, col, row, tool.prefer);
      if (!plan) return null;
      const layers = paintStairsRun(map.layers, TINY_SWORDS_TILESET, plan);
      if (layers === map.layers) return null;
      return commitTerrain(map, layers);
    }
    // The stage resolves an exact wall edge from the world-space pointer before applying this tool.
    // A cell alone is ambiguous at corners, so the generic cell mutation path must refuse it.
    case "wall-opening":
      return null;
    /**
     * The second click of a door link. The first is the stage's to remember (`tool.from`), so what
     * lands here is the complete round trip: two `player-touch` teleporters, each aimed at the cell
     * in front of the other, minted in ONE map change and therefore one undo step.
     *
     * Both ends are refused together. A half link, one door teleporting into a wall or a return leg
     * silently skipped, is worse than no link at all, because it looks authored.
     *
     * Afterwards each endpoint remains an ordinary editable event, but reciprocal `linkedEventId`
     * fields keep deletion atomic. Door commands retain their safe landing coordinate in front of
     * an ordinary ground-level door; roof destinations deliberately use the clicked roof cell.
     * Authors may still open either endpoint after the pair exists and customize its program.
     */
    case "link": {
      const from = tool.from;
      if (!from) return null;
      // The wire parser `isUuid`-checks a teleport's destination map, so a link authored on a map
      // with no id yet would write a command the server rejects on save. The palette gates the tool
      // the way the Teleporter preset is gated; this is the rule behind that gate.
      if (!tool.selfMapId) return null;
      if (from.col === col && from.row === row) return null;
      if (!canLinkDoorAt(map, from.col, from.row) || !canLinkDoorAt(map, col, row)) return null;
      const fromLanding = doorLandingCell(map, from.col, from.row);
      const toLanding = doorLandingCell(map, col, row);
      if (!fromLanding || !toLanding) return null;
      if (map.events.length + 2 > MAX_EVENTS_PER_MAP) return null;
      const ordinal = nextEventOrdinal(map.events);
      const fromId = crypto.randomUUID();
      const toId = crypto.randomUUID();
      // ONE number for the pair: two doors of the same link are one thing an author names, so
      // `Liaison de portes 1` appears at both ends rather than numbering them 1 and 2.
      const name = numberedPresetName(tool.name ?? "", map.events);
      return {
        ...map,
        events: [
          ...map.events,
          doorLinkEvent({
            id: fromId,
            linkedEventId: toId,
            col: from.col,
            row: from.row,
            ordinal,
            selfMapId: tool.selfMapId,
            destination: toLanding,
            name,
          }),
          doorLinkEvent({
            id: toId,
            linkedEventId: fromId,
            col,
            row,
            ordinal: ordinal + 1,
            selfMapId: tool.selfMapId,
            destination: fromLanding,
            name,
          }),
        ],
      };
    }
    case "element": {
      // Element placement is quarter-cell: the stage resolves the pointer to a cell plus a 0..3
      // sub-step per axis and threads it here. Field/Event callers leave the offsets at 0, so those
      // modes stay grid-forced.
      const assetId = placedAssetId(map, tool.assetId, col, row);
      const nativeResource = isNativeHarvestAsset(assetId);
      const resourceOffset = nativeResource ? 0 : null;
      const slot = {
        col,
        row,
        offsetX: resourceOffset ?? offsetX,
        offsetY: resourceOffset ?? offsetY,
      };
      const replaced = map.elements.find((element) => sameElementSlot(element, slot));
      const building = defaultBuildingSettings(assetId);
      const nativeDimensions = isNativeSceneryAsset(assetId)
        ? nativeSceneryDimensionsOrDefault(assetId)
        : null;
      const placed: MapElement = {
        ...(replaced?.id ? { id: replaced.id } : {}),
        ...slot,
        assetId,
        ...(replaced?.assetId === assetId && replaced.orientation
          ? { orientation: replaced.orientation }
          : {}),
        ...(replaced?.assetId === assetId && replaced.rotation
          ? { rotation: replaced.rotation }
          : {}),
        ...(replaced?.assetId === assetId && replaced.bridge ? { bridge: replaced.bridge } : {}),
        ...(building
          ? {
              building:
                replaced?.assetId === assetId && replaced.building ? replaced.building : building,
            }
          : {}),
        ...(nativeDimensions
          ? {
              dimensions:
                replaced?.assetId === assetId && replaced.dimensions
                  ? replaced.dimensions
                  : nativeDimensions,
            }
          : {}),
      };
      if (!placementFitsMap(map, placed)) return null;
      if (elementCoversCell(placed, map.spawn.col, map.spawn.row)) return null;
      // Identity is the full sub-position now, so a new `(col, row, offsetX, offsetY)` ADDS and only an
      // exact match REPLACES — that is what lets one cell hold a stack of decorations. The
      // visual-footprint overlap rejection is gone on purpose: stacked decor is meant to overlap, and
      // overlapping colliders are harmless (both simply block). Bounds and spawn guards stay.
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
    /**
     * The hero start point, moved. Both guards are the invariant `keepsSpawnClear` enforces from the
     * other side, and both now REFUSE (`null`) loudly: the stage counts the rejection and flashes its
     * hint, because a decorated map refuses most cells an author aims at and a silent click reads as
     * a dead tool.
     *
     * Clicking the cell the spawn already occupies returns the map UNCHANGED rather than a fresh
     * object with identical contents. The author asked for nothing, so nothing should happen: no
     * history entry, and above all no dirty flag inviting them to save a document they did not edit.
     */
    case "spawn": {
      if (map.elements.some((element) => elementCoversCell(element, col, row))) return null;
      if (!isWalkableCell(map, col, row)) return null;
      if (map.spawn.col === col && map.spawn.row === row) return map;
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
     * Every event kind may be staged on every terrain material. Functional events still validate
     * their own payload (species, patrol radius, profile) and the exit/spawn graph invariant.
     */
    case "event": {
      if (tool.eventKind === "normal" && tool.preset === "teleporter") return null;
      if (map.events.some((event) => event.col === col && event.row === row)) return null;
      if (map.events.length >= MAX_EVENTS_PER_MAP) return null;
      if (
        isRuntimeEventKind(tool.eventKind) &&
        runtimeEventCount(map.events) >= MAX_RUNTIME_EVENTS_PER_MAP
      )
        return null;
      if (!functionalEventPlacementOk(map, tool.eventKind, col, row)) return null;
      const ordinal = nextEventOrdinal(map.events);
      if (tool.eventKind === "normal") {
        // D13: a scripted event is placed via a PRESET (default `raw`, the blank event). `raw` yields
        // the historical empty page; `teleporter`/`sign`/`chest` pre-fill page 1 with one canonical
        // command out of the existing model. The graphic is no longer a placement default — it is
        // chosen in the event dialog — so a fresh event opens with the blank placeholder.
        const event = presetEvent({
          id: crypto.randomUUID(),
          col,
          row,
          ordinal,
          preset: tool.preset ?? "raw",
          selfMapId: tool.selfMapId ?? "",
          // The map's own spawn is the walkable placeholder a fresh `teleporter` aims at, and the
          // preset label names the event so five presets do not all list as "Custom event".
          selfSpawn: map.spawn,
          ...(tool.presetName === undefined
            ? {}
            : { name: numberedPresetName(tool.presetName, map.events) }),
        });
        return { ...map, events: [...map.events, event] };
      }
      if (tool.eventKind === "sea-guardian") {
        const event = functionalEvent({
          id: crypto.randomUUID(),
          col,
          row,
          ordinal,
          kind: "sea-guardian",
          name: numberedPresetName(tool.presetName ?? "", map.events),
        });
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
        return {
          ...map,
          events: [
            ...map.events,
            {
              ...event,
              pages: [
                {
                  ...(event.pages[0] ?? defaultEventPage()),
                  graphicAssetId: tool.graphic ?? null,
                },
              ],
            },
          ],
        };
      }
      if (tool.eventKind === "guard") {
        const { patrolRadius } = tool;
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
          kind: "guard",
          patrolRadius,
        });
        return {
          ...map,
          events: [
            ...map.events,
            {
              ...event,
              pages: [
                {
                  ...(event.pages[0] ?? defaultEventPage()),
                  graphicAssetId: tool.graphic ?? null,
                },
              ],
            },
          ],
        };
      }
      if (tool.eventKind === "npc") {
        const { patrolRadius } = tool;
        if (
          patrolRadius === undefined ||
          !Number.isSafeInteger(patrolRadius) ||
          patrolRadius < MIN_PATROL_RADIUS ||
          patrolRadius > MAX_PATROL_RADIUS
        ) {
          return null;
        }
        const page = defaultEventPage();
        const event = functionalEvent({
          id: crypto.randomUUID(),
          col,
          row,
          ordinal,
          kind: "npc",
          name: "",
          patrolRadius,
        });
        return {
          ...map,
          events: [
            ...map.events,
            {
              ...event,
              pages: [
                {
                  ...page,
                  graphicAssetId: tool.graphic ?? null,
                  moveType: "random",
                  moveSpeed: 3,
                  moveFreq: 2,
                },
              ],
            },
          ],
        };
      }
      // Compatibility path for old editor sessions/tests. New resources are placed through the
      // scenery catalogue and the public Event palette never constructs this tool.
      if (tool.eventKind === "harvestable") {
        const profile = parseHarvestProfile(tool.harvestProfile);
        if (!profile) return null;
        const event = functionalEvent({
          id: crypto.randomUUID(),
          col,
          row,
          ordinal,
          kind: "harvestable",
          name: numberedPresetName(tool.presetName ?? "", map.events),
          harvestProfile: profile,
          graphicAssetId: tool.graphic,
        });
        return {
          ...map,
          events: [
            ...map.events,
            {
              ...event,
              harvestProfile: cloneHarvestProfile(profile),
              pages: [
                {
                  ...(event.pages[0] ?? defaultEventPage()),
                  graphicAssetId: tool.graphic,
                },
              ],
            },
          ],
        };
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
 * active, plus a translucent red wash when the placement is illegal there.
 *
 * It DELEGATES to `applyTool` rather than re-deriving the placement rules, so the hover preview can
 * never disagree with what a real click does: map bounds, exact-slot replacement, element caps,
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
  // Material fill legality is position-independent past the content check. Answer it directly
  // instead of flooding the whole ground layer, resyncing walls and cloning a map on every hovered
  // cell just to discard the result. Water is the exception because it may cover the spawn.
  if (tool.kind === "fill") {
    const { cols, rows } = editorMapSize(map);
    if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
    // Filling with water may cover the technical spawn, so unlike a material fill its legality is
    // not position-independent. Run the real mutation path and keep preview/click agreement.
    if (tool.content.kind === "block" && tool.content.block === "water") {
      return applyTool(map, tool, col, row, true, mode) !== null;
    }
    const ground = map.layers[GROUND_LAYER];
    return ground !== undefined && contentTarget(tool.content, ground, col, row) !== null;
  }
  // Before the first door is picked there is no pair to try, so legality is the single-cell rule.
  // Once one IS picked the stage passes it as `tool.from` and the full commit below answers.
  if (tool.kind === "link" && !tool.from) return canLinkDoorAt(map, col, row);
  return applyTool(map, tool, col, row, true, mode) !== null;
}
