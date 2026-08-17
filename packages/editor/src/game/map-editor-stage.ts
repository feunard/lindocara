/**
 * The creator's WYSIWYG HD-2D surface.
 *
 * React owns controls and dialogs; this module owns the shared `#stage` canvas. Every mutation is
 * still delegated to `editor-state.ts`, while terrain and scenery are compiled and drawn through
 * the exact engine/renderer path used by a running room.
 */

import { acquireStageCanvas, releaseStageCanvas } from "@lindocara/client/game/stage-canvas.js";
import type { MapAudioConfig } from "@lindocara/engine/audio-catalog.js";
import type { BuildingSettings } from "@lindocara/engine/buildings.js";
import type { ElementOrientation } from "@lindocara/engine/element-orientation.js";
import {
  authoredElementGroundPoint,
  authoredStairsRamp,
  compileAuthoredMap,
} from "@lindocara/engine/hd2d/authored-map.js";
import type { ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import type { MapData as CompiledMapData } from "@lindocara/engine/hd2d/map-data.js";
import { derivedMapRect, type MapRect } from "@lindocara/engine/map-canvas.js";
import { ELEMENT_OFFSET_STEPS } from "@lindocara/engine/map-data.js";
import type { MapEvent } from "@lindocara/engine/map-events.js";
import type { MapHeroSettings } from "@lindocara/engine/map-hero-settings.js";
import type { MapFixedLighting } from "@lindocara/engine/map-lighting.js";
import { nativeHarvestEvents } from "@lindocara/engine/native-harvest.js";
import {
  type EditorAssetId,
  editorAsset,
  LINDOCARA_CHEST_CLOSED_ASSET_ID,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { fixedLightingOverride } from "@lindocara/renderer/hd2d/day-cycle.js";
import { Hd2dRenderer } from "@lindocara/renderer/hd2d/game-renderer.js";
import { authoredSkyAltitude } from "@lindocara/renderer/hd2d/static-content.js";
import type { RenderContext } from "@lindocara/renderer/renderer-api.js";
import type { SceneSample } from "@lindocara/renderer/scene-sample.js";
import type {
  EditorMap,
  EditorMode,
  EditorSelection,
  EditorTool,
  ElementEventBinding,
} from "./editor-state.js";
import {
  applyTool,
  beginEventDraft,
  commitEditorHistory,
  commitEventDraft,
  convertElementToEvent,
  createEditorHistory,
  deleteSelection,
  editorMapSize,
  isEditorHistoryDirty,
  markEditorHistorySaved,
  moveSelection,
  placementLegalAt,
  redoEditorHistory,
  selectionAtMode,
  setActiveMode,
  toMapData,
  undoEditorHistory,
  updateSelectedBuildingSettings,
  updateSelectedElementAsset,
  updateSelectedElementOffset,
  updateSelectedElementOrientation,
} from "./editor-state.js";
import {
  authoredEventPreviewSnapshots,
  authoredSeaGuardianPreviewSnapshots,
} from "./event-preview.js";

export interface MapEditorStageHandle {
  setTool(tool: EditorTool): void;
  setActiveMode(mode: EditorMode): void;
  setDim(dim: boolean): void;
  setGrid(show: boolean): void;
  setCollisions(show: boolean): void;
  setZoom(percent: number): void;
  /** A quarter turn left (-1) or right (+1), snapped to the nearest quarter first. */
  rotateQuarter(direction: 1 | -1): void;
  current(): EditorMap;
  /** Replace the authored content as one undoable operation (procedural generation/import). */
  replaceMap(map: EditorMap): void;
  setName(name: string): void;
  setAudio(audio: MapAudioConfig): void;
  setHeroSettings(settings: MapHeroSettings): void;
  setLighting(dayNightCycle: boolean, fixedLighting: MapFixedLighting): void;
  undo(): void;
  redo(): void;
  markSaved(saved?: EditorMap): void;
  selected(): EditorSelection | null;
  clearSelection(): void;
  moveSelected(col: number, row: number): boolean;
  setSelectedElementAsset(assetId: EditorAssetId): boolean;
  setSelectedElementOffset(offsetX: number, offsetY: number): boolean;
  setSelectedElementOrientation(orientation: ElementOrientation): boolean;
  setSelectedBuildingSettings(settings: BuildingSettings): boolean;
  deleteSelected(): boolean;
  beginEventDraft(id: string): MapEvent | null;
  commitEventDraft(draft: MapEvent): void;
  deleteEvent(id: string): void;
  bindSelectedElement(binding: ElementEventBinding): string | null;
  highlightEvent(id: string | null): void;
  selectEvent(id: string): void;
  dispose(): void;
}

export interface MapEditorStageState {
  /** Monotone rendered document revision; lets React inspectors refresh even when summary flags stay equal. */
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  selection: EditorSelection | null;
  placementRejectedAt: number | null;
}

export function defaultDimForMode(mode: EditorMode): boolean {
  return mode !== "field";
}

export function editorToolPreviewAssetId(tool: EditorTool): EditorAssetId | null {
  if (tool.kind === "element") return tool.assetId;
  if (tool.kind === "event") {
    if (tool.graphic) return tool.graphic;
    if (tool.eventKind === "normal" && tool.preset === "chest") {
      return LINDOCARA_CHEST_CLOSED_ASSET_ID;
    }
  }
  return null;
}

const EMPTY_SAMPLE: SceneSample = {
  players: [],
  seaGuardians: [],
  monsters: [],
  guards: [],
  loot: [],
  projectiles: [],
  corpses: [],
  events: [],
};

function selectionPoint(map: EditorMap, selection: EditorSelection | null) {
  if (!selection) return null;
  const { cols, rows } = editorMapSize(map);
  const size = Math.max(cols, rows);
  if (selection.kind === "event") {
    const event = map.events.find((candidate) => candidate.id === selection.id);
    return event ? { x: event.col + 0.5 - size / 2, z: event.row + 0.5 - size / 2 } : null;
  }
  if (selection.kind === "spawn") {
    return { x: map.spawn.col + 0.5 - size / 2, z: map.spawn.row + 0.5 - size / 2 };
  }
  return authoredElementGroundPoint(selection, size);
}

/** Every blocked cell inside `rect` — deliberately NOT the whole canvas: a 256×256 document is
 *  mostly ocean outside the derived save rect, and marking all of it as red collision would be
 *  noise rather than signal. */
function blockedCells(
  map: EditorMap,
  levels: readonly (number | null)[],
  rect: MapRect,
  platforms: readonly ColliderRect[],
): ColliderRect[] {
  const { cols, rows } = editorMapSize(map);
  const size = Math.max(cols, rows);
  const cells: ColliderRect[] = [];
  for (let row = rect.row; row < rect.row + rect.rows; row += 1) {
    for (let col = rect.col; col < rect.col + rect.cols; col += 1) {
      if (levels[row * size + col] !== null) continue;
      const x = col - size / 2;
      const z = row - size / 2;
      // A bridge leaves water in the terrain layer and replaces it with a collider top. Showing
      // the water cell as solid red over that top made a working bridge look blocked in the editor.
      const coveredByPlatform = platforms.some(
        (platform) =>
          platform.top !== undefined &&
          platform.x <= x &&
          platform.z <= z &&
          platform.x + platform.w >= x + 1 &&
          platform.z + platform.h >= z + 1,
      );
      if (!coveredByPlatform) cells.push({ x, z, w: 1, h: 1 });
    }
  }
  return cells;
}

let activeStage: MapEditorStageHandle | null = null;
let openQueue: Promise<void> = Promise.resolve();

/** How far a right-drag turns the camera per pixel of horizontal travel. A shade under a quarter
 *  turn across a 900px canvas: enough to swing round to a cliff's far face in one gesture, gentle
 *  enough to nudge a few degrees. */
const ORBIT_RADIANS_PER_PIXEL = 0.005;

/** Mid-stroke floor between two world rebuilds. Low enough that sprayed tiles keep appearing
 *  while the drag is in flight, high enough that a fast spray costs a handful of rebuilds a
 *  second instead of one per painted cell. */
const STROKE_REBUILD_MS = 200;

/** Yaw as a 0..359 heading for the status bar. Rounded, because the readout is for orientation,
 *  not measurement, and a free orbit would otherwise jitter its last digit every frame. */
export function yawDegrees(yaw: number): number {
  return ((Math.round((yaw * 180) / Math.PI) % 360) + 360) % 360;
}

export function openMapEditorStage(
  initial: EditorMap,
  onChange: (map: EditorMap, state: MapEditorStageState) => void,
  onCursorCell?: (col: number | null, row: number | null) => void,
  onOpenSelection?: (selection: EditorSelection) => void,
  onZoomChange?: (percent: number) => void,
  onYawChange?: (degrees: number) => void,
): Promise<MapEditorStageHandle> {
  const opening = openQueue.then(async () => {
    activeStage?.dispose();
    // The canvas belongs to whoever renders into it (`@lindocara/client`'s `stage-canvas`), so the
    // painting stage takes a hold here and drops it in `dispose` below. Reference counted, because
    // entering the playable preview builds ITS renderer while this one is still tearing down.
    const canvas = acquireStageCanvas();

    const renderer = await Hd2dRenderer.create(canvas);
    renderer.setTiltShiftEnabled(false);
    // Distance fog is tuned for play, where pulling the camera back deliberately tightens the band
    // so the map dissolves at its edges (`fog.far *= zoom ** CAMERA.fogFar`, scene.ts). That is the
    // opposite of what authoring needs: zooming out is how an author inspects the whole map, and it
    // was hiding exactly the detail they pulled back to see. Off for the whole session.
    renderer.setFogEnabled(false);
    let history = createEditorHistory(initial);
    let map = initial;
    let tool: EditorTool = { kind: "select" };
    let selected: EditorSelection | null = null;
    let highlightedEventId: string | null = null;
    let dim = defaultDimForMode(history.activeMode);
    let gridVisible = true;
    let collisionsVisible = false;
    let zoom = 100;
    let revision = 0;
    let placementRejections = 0;
    let hover: { col: number; row: number; offsetX: number; offsetY: number } | null = null;
    let painting = false;
    let panning = false;
    let spaceHeld = false;
    let strokeStart: EditorMap | null = null;
    let dragSelection: EditorSelection | null = null;
    let lastPaintedKey = "";
    // Spray throttle: a painted cell costs a full world rebuild (`configureMapTerrain` tears the
    // scene down and rebuilds it — 12-45ms measured on a light canvas), so a fast drag rebuilding
    // per cell saturates the main thread. Mid-stroke the rebuild runs at most once per interval;
    // the edits themselves always land, and `stopStroke` flushes the last pending rebuild so the
    // released stroke is never stale.
    let strokeRebuiltAt = 0;
    let strokeRebuildPending = false;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let cameraX = 0;
    let cameraZ = 0;
    // The camera's heading, mirrored here because the pan below has to un-rotate its screen-space
    // drag by it. `Hd2dRenderer` owns the authoritative yaw; this copy only ever changes through
    // `applyYaw`, which is what keeps the two in step.
    let yaw = 0;
    let orbiting = false;
    let disposed = false;
    let lastCursorKey = "";
    const visualEvents = (): MapEvent[] => [
      ...map.events,
      ...nativeHarvestEvents(map.elements, map.events.length + 1),
    ];
    let renderedEvents = authoredEventPreviewSnapshots(visualEvents(), "map-editor");
    let renderedSeaGuardians: SceneSample["seaGuardians"] = [];

    const dimensions = () => editorMapSize(map);
    // The rect a save would store, memoized per document identity: the map is immutable per edit
    // (every mutator returns a fresh object), so recomputing `derivedMapRect` — a full scan of every
    // layer, element, event and marker — on each hover would repeat the same O(cells) walk for free.
    let rectCache: { map: EditorMap; rect: MapRect } | null = null;
    const derivedRect = (): MapRect => {
      if (!rectCache || rectCache.map !== map) rectCache = { map, rect: derivedMapRect(map) };
      return rectCache.rect;
    };
    const sameRect = (left: MapRect, right: MapRect): boolean =>
      left.col === right.col &&
      left.row === right.row &&
      left.cols === right.cols &&
      left.rows === right.rows;
    const centreCamera = (): void => {
      const { cols, rows } = dimensions();
      const size = Math.max(cols, rows);
      // Content-centered, not canvas-centered: the canvas is a fixed 256×256 ocean document and an
      // author should open on what they authored, not on the middle of the ocean around it.
      const rect = derivedRect();
      cameraX = rect.col + rect.cols / 2 - size / 2;
      cameraZ = rect.row + rect.rows / 2 - size / 2;
      renderer.setCameraFocus(cameraX, cameraZ);
    };

    // The heightfield a save would compile, memoized per document identity exactly like
    // `derivedRect` above: `drawOverlay`'s default argument calls this on every pointer move, and
    // without the cache that reran a full-canvas `compileAuthoredMap` on each one.
    let compiledCache: { map: EditorMap; heightfield: CompiledMapData } | null = null;
    const compiled = (): CompiledMapData => {
      if (!compiledCache || compiledCache.map !== map) {
        compiledCache = { map, heightfield: compileAuthoredMap(toMapData(map), map.events) };
      }
      return compiledCache.heightfield;
    };

    const drawOverlay = (heightfield = compiled()): void => {
      const { cols, rows } = dimensions();
      const focusSelection = highlightedEventId
        ? selectionPoint(map, { kind: "event", id: highlightedEventId })
        : selectionPoint(map, selected);
      const size = Math.max(cols, rows);
      const hoverPoint = hover
        ? history.activeMode === "element"
          ? authoredElementGroundPoint(hover, size)
          : { x: hover.col + 0.5 - size / 2, z: hover.row + 0.5 - size / 2 }
        : null;
      const previewAssetId = editorToolPreviewAssetId(tool);
      const previewAsset = previewAssetId ? editorAsset(previewAssetId) : null;
      const rect = derivedRect();
      renderer.setEditorOverlay({
        cols,
        rows,
        showGrid: gridVisible,
        showCollisions: collisionsVisible,
        dim,
        // Bounded to the derived rect: a 256×256 canvas is mostly ocean, and flooding it all with
        // red collision would swamp the actually-useful signal near the authored content.
        colliders: [
          ...heightfield.colliders,
          ...blockedCells(map, heightfield.levels, rect, heightfield.colliders),
        ],
        saveRect: {
          x: rect.col - size / 2,
          z: rect.row - size / 2,
          cols: rect.cols,
          rows: rect.rows,
        },
        spawn: {
          x: map.spawn.col + 0.5 - size / 2,
          z: map.spawn.row + 0.5 - size / 2,
        },
        hover: hoverPoint,
        selection: focusSelection,
        // The cursor outlines the unit the active mode actually places on: a whole cell for field
        // and event work, one of the 4x4 sub-cell slots in element mode (`hoverPoint` is already a
        // quarter-cell centre there).
        cursorCells: history.activeMode === "element" ? 1 / ELEMENT_OFFSET_STEPS : 1,
        stairsPreview:
          hover && tool.kind === "stairs"
            ? {
                ramp: authoredStairsRamp(hover.col, hover.row, size, tool.direction, tool.lowLevel),
                valid: placementLegalAt(tool, map, hover.col, hover.row, history.activeMode),
                levelHeight: heightfield.levelHeight,
              }
            : null,
        assetPreview:
          hover && hoverPoint && previewAsset
            ? {
                point: hoverPoint,
                footprint: previewAsset.editor.visualFootprint.map((cell) => ({
                  x: hoverPoint.x + cell.col,
                  z: hoverPoint.z + cell.row,
                })),
                valid: placementLegalAt(tool, map, hover.col, hover.row, history.activeMode),
                ...(previewAsset.editor.renderLayer === "sky"
                  ? { skyAltitude: authoredSkyAltitude(heightfield) }
                  : {}),
              }
            : null,
      });
    };

    const redraw = (): void => {
      const heightfield = compiled();
      renderedEvents = authoredEventPreviewSnapshots(visualEvents(), "map-editor");
      renderedSeaGuardians = authoredSeaGuardianPreviewSnapshots(
        map.events,
        heightfield.size,
        heightfield.waterLevel,
      );
      // The authoring stage reflects the stored map policy, including every fixed night degree.
      renderer.setDayCycleOverride(
        map.dayNightCycle ? null : fixedLightingOverride(map.fixedLighting),
      );
      renderer.configureMapTerrain("editor", [], ++revision, heightfield);
      renderer.preloadWorldEventAssets(renderedEvents);
      renderer.setCameraFocus(cameraX, cameraZ);
      renderer.setCameraZoom(zoom);
      drawOverlay(heightfield);
    };

    const notify = (): void => {
      onChange(map, {
        revision,
        canUndo: history.past.length > 0,
        canRedo: history.future.length > 0,
        dirty: isEditorHistoryDirty(history, map),
        selection: selected,
        placementRejectedAt: placementRejections > 0 ? placementRejections : null,
      });
    };

    /** Rebuild the world now if the spray throttle allows, otherwise keep the stroke visually
     *  honest with the cheap overlay pass and leave the rebuild pending for `stopStroke`. */
    const strokeRedraw = (): void => {
      const now = performance.now();
      if (now - strokeRebuiltAt >= STROKE_REBUILD_MS) {
        strokeRebuiltAt = now;
        strokeRebuildPending = false;
        redraw();
        return;
      }
      strokeRebuildPending = true;
      drawOverlay();
    };

    const reportCursor = (col: number | null, row: number | null): void => {
      const key = col === null || row === null ? "none" : `${col},${row}`;
      if (key === lastCursorKey) return;
      lastCursorKey = key;
      onCursorCell?.(col, row);
    };

    const placementAt = (
      clientX: number,
      clientY: number,
    ): { col: number; row: number; offsetX: number; offsetY: number } | null => {
      const point = renderer.screenToWorld(clientX, clientY);
      if (!point) return null;
      const { cols, rows } = dimensions();
      const size = Math.max(cols, rows);
      const localX = point.x + size / 2;
      const localZ = point.z + size / 2;
      const col = Math.floor(localX);
      const row = Math.floor(localZ);
      if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
      if (history.activeMode !== "element") return { col, row, offsetX: 0, offsetY: 0 };
      return {
        col,
        row,
        offsetX: Math.min(
          ELEMENT_OFFSET_STEPS - 1,
          Math.floor((localX - col) * ELEMENT_OFFSET_STEPS),
        ),
        offsetY: Math.min(
          ELEMENT_OFFSET_STEPS - 1,
          Math.floor((localZ - row) * ELEMENT_OFFSET_STEPS),
        ),
      };
    };

    const commitInspectorChange = (
      next: EditorMap | null,
      nextSelection: EditorSelection | null = selected,
    ): boolean => {
      if (!next || next === map) return false;
      history = commitEditorHistory({ ...history, present: map }, next);
      map = next;
      selected = nextSelection;
      redraw();
      notify();
      return true;
    };

    const paintAt = (clientX: number, clientY: number, isStrokeStart: boolean): void => {
      const placement = placementAt(clientX, clientY);
      if (!placement) return;
      const { col, row, offsetX, offsetY } = placement;
      const key = `${col},${row},${offsetX},${offsetY}`;
      if (key === lastPaintedKey) return;
      lastPaintedKey = key;

      if (tool.kind === "select") {
        if (isStrokeStart) {
          dragSelection = selectionAtMode(map, col, row, history.activeMode, offsetX, offsetY);
          selected = dragSelection;
          drawOverlay();
          notify();
          return;
        }
        if (!dragSelection) return;
        const previous = dragSelection;
        const next = moveSelection(map, previous, col, row, offsetX, offsetY);
        if (!next || next === map) return;
        const nextSelection: EditorSelection =
          previous.kind === "element" ? { ...previous, col, row, offsetX, offsetY } : previous;
        map = next;
        dragSelection = nextSelection;
        selected = nextSelection;
        redraw();
        notify();
        return;
      }

      if (isStrokeStart && tool.kind === "element") {
        const exists = map.elements.some(
          (candidate) =>
            candidate.col === col &&
            candidate.row === row &&
            candidate.offsetX === offsetX &&
            candidate.offsetY === offsetY,
        );
        if (exists) {
          selected = { kind: "element", col, row, offsetX, offsetY };
          drawOverlay();
          notify();
          return;
        }
      }
      if (tool.kind === "event") {
        const exists = map.events.find((event) => event.col === col && event.row === row);
        if (exists) {
          selected = { kind: "event", id: exists.id };
          drawOverlay();
          notify();
          return;
        }
      }

      const next = applyTool(
        map,
        tool,
        col,
        row,
        isStrokeStart,
        history.activeMode,
        offsetX,
        offsetY,
      );
      if (next === null) {
        if (tool.kind === "element" || tool.kind === "event") {
          placementRejections += 1;
          notify();
        }
        return;
      }
      if (next === map) return;
      map = next;
      if (tool.kind === "event") {
        const placed = map.events.find((event) => event.col === col && event.row === row);
        if (placed) selected = { kind: "event", id: placed.id };
      }
      strokeRedraw();
      notify();
    };

    const panTrigger = (event: PointerEvent): boolean =>
      event.button === 1 || (event.button === 0 && (spaceHeld || tool.kind === "pan"));

    const onPointerDown = (event: PointerEvent): void => {
      canvas.focus();
      // Right-drag orbits, middle-drag pans — the split every 3D editor uses. Right USED to be a
      // second pan trigger beside middle, which left the camera's two movements sharing one button
      // and rotation with none. Checked before the paint branch so an orbit never lays down tiles
      // on the way round; the canvas already suppresses the context menu (`preventContext`).
      if (event.button === 2) {
        orbiting = true;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        canvas.dataset.cursor = "move";
        return;
      }
      if (panTrigger(event)) {
        panning = true;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        canvas.dataset.cursor = "move";
        return;
      }
      if (event.button !== 0) return;
      painting = true;
      strokeStart = map;
      lastPaintedKey = "";
      paintAt(event.clientX, event.clientY, true);
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (orbiting) {
        applyYaw((event.clientX - lastPointerX) * ORBIT_RADIANS_PER_PIXEL);
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        return;
      }
      if (panning) {
        const scale = (100 / zoom) * 0.035;
        const dx = (event.clientX - lastPointerX) * scale;
        const dy = (event.clientY - lastPointerY) * scale;
        // The drag is in SCREEN space; the focus point is in world space. While the camera looked
        // down one fixed axis those were interchangeable, and this used to subtract dx/dy straight
        // from cameraX/cameraZ. Once the camera can turn, that sends the map sideways: a quarter
        // turn makes a rightward drag walk the focus along world Z. Rotate the delta into world
        // space by the current yaw first.
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        cameraX -= dx * cos + dy * sin;
        cameraZ -= dy * cos - dx * sin;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        renderer.setCameraFocus(cameraX, cameraZ);
        return;
      }
      const placement = placementAt(event.clientX, event.clientY);
      hover = placement;
      reportCursor(placement?.col ?? null, placement?.row ?? null);
      drawOverlay();
      if (painting) paintAt(event.clientX, event.clientY, false);
    };

    const stopStroke = (): void => {
      if (strokeRebuildPending) {
        strokeRebuildPending = false;
        strokeRebuiltAt = 0;
        redraw();
      }
      if (strokeStart && strokeStart !== map) {
        history = commitEditorHistory({ ...history, present: strokeStart }, map);
        notify();
      }
      strokeStart = null;
      dragSelection = null;
      painting = false;
      panning = false;
      // Deliberately no snap-back: an orbit stays where it was left, and the quarter-turn keys are
      // the one-press way back to an axis. Springing back would make a free look useless for any
      // work done from that angle.
      orbiting = false;
      canvas.dataset.cursor =
        tool.kind === "pan" ? "move" : tool.kind === "select" ? "select" : "paint";
    };

    const onPointerLeave = (): void => {
      hover = null;
      reportCursor(null, null);
      drawOverlay();
    };

    /** Turn the camera by `delta` radians and keep the local mirror + the readout in step. */
    const applyYaw = (delta: number): void => {
      if (!Number.isFinite(delta) || delta === 0) return;
      renderer.rotateCamera(delta);
      yaw = Math.atan2(Math.sin(yaw + delta), Math.cos(yaw + delta));
      onYawChange?.(yawDegrees(yaw));
    };

    /**
     * A quarter turn, from wherever the camera is now.
     *
     * It snaps to the nearest quarter FIRST, so the same two keys that step between the four sides
     * also straighten a freely-orbited camera back onto an axis — otherwise an author who dragged
     * to 37° would be stuck stepping 37°, 127°, 217° and never get the grid square on screen again.
     */
    const rotateQuarter = (direction: 1 | -1): void => {
      const quarter = Math.PI / 2;
      const target = (Math.round(yaw / quarter) + direction) * quarter;
      applyYaw(target - yaw);
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoom = Math.max(2, Math.min(250, zoom * factor));
      renderer.setCameraZoom(zoom);
      onZoomChange?.(Math.round(zoom));
    };

    const onDoubleClick = (event: MouseEvent): void => {
      const placement = placementAt(event.clientX, event.clientY);
      if (!placement) return;
      const eventAtCell = map.events.find(
        (candidate) => candidate.col === placement.col && candidate.row === placement.row,
      );
      const nextSelection = eventAtCell
        ? ({ kind: "event", id: eventAtCell.id } satisfies EditorSelection)
        : selectionAtMode(
            map,
            placement.col,
            placement.row,
            history.activeMode,
            placement.offsetX,
            placement.offsetY,
          );
      if (!nextSelection) return;
      selected = nextSelection;
      drawOverlay();
      notify();
      onOpenSelection?.(nextSelection);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === "Space") spaceHeld = true;
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === "Space") spaceHeld = false;
    };
    const preventContext = (event: Event): void => event.preventDefault();

    canvas.tabIndex = 0;
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("contextmenu", preventContext);
    window.addEventListener("pointerup", stopStroke);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    renderer.onFrame((now) => {
      renderer.render(
        { ...EMPTY_SAMPLE, seaGuardians: renderedSeaGuardians, events: renderedEvents },
        { now } as RenderContext,
      );
    });
    centreCamera();
    redraw();
    notify();

    const handle: MapEditorStageHandle = {
      setTool(next) {
        tool = next;
        renderer.setEditorPreviewAsset(editorToolPreviewAssetId(tool));
        canvas.dataset.cursor =
          tool.kind === "pan" ? "move" : tool.kind === "select" ? "select" : "paint";
        drawOverlay();
      },
      setActiveMode(mode) {
        history = setActiveMode(history, mode);
        const matches =
          (mode === "field" && selected?.kind === "spawn") ||
          (mode === "element" && selected?.kind === "element") ||
          (mode === "event" && selected?.kind === "event");
        if (selected && !matches) selected = null;
        drawOverlay();
        notify();
      },
      setDim(next) {
        dim = next;
        drawOverlay();
      },
      setGrid(next) {
        gridVisible = next;
        drawOverlay();
      },
      setCollisions(next) {
        collisionsVisible = next;
        drawOverlay();
      },
      setZoom(percent) {
        zoom = Math.max(2, Math.min(250, percent));
        renderer.setCameraZoom(zoom);
      },
      rotateQuarter(direction) {
        rotateQuarter(direction);
      },
      current: () => map,
      replaceMap(next) {
        stopStroke();
        const currentHistory = { ...history, present: map };
        const nextHistory = commitEditorHistory(currentHistory, next);
        if (nextHistory === currentHistory) return;
        history = nextHistory;
        map = next;
        selected = null;
        highlightedEventId = null;
        hover = null;
        reportCursor(null, null);
        // A whole generated map is a new composition even though both documents use the same
        // 256x256 working canvas. Open on its authored content immediately.
        centreCamera();
        redraw();
        notify();
      },
      setName(name) {
        if (name === map.name) return;
        map = { ...map, name };
        notify();
      },
      setAudio(audio) {
        if (JSON.stringify(audio) === JSON.stringify(map.audio)) return;
        const next = { ...map, audio };
        history = commitEditorHistory({ ...history, present: map }, next);
        map = next;
        notify();
      },
      setHeroSettings(heroSettings) {
        if (JSON.stringify(heroSettings) === JSON.stringify(map.heroSettings)) return;
        const next = { ...map, heroSettings };
        history = commitEditorHistory({ ...history, present: map }, next);
        map = next;
        notify();
      },
      setLighting(dayNightCycle, fixedLighting) {
        if (dayNightCycle === map.dayNightCycle && fixedLighting === map.fixedLighting) return;
        const next = { ...map, dayNightCycle, fixedLighting };
        history = commitEditorHistory({ ...history, present: map }, next);
        map = next;
        renderer.setDayCycleOverride(dayNightCycle ? null : fixedLightingOverride(fixedLighting));
        notify();
      },
      undo() {
        stopStroke();
        const previousRect = derivedRect();
        const next = undoEditorHistory(history);
        if (next === history) return;
        history = next;
        map = { ...history.present, name: map.name };
        history = { ...history, present: map };
        selected = null;
        if (!sameRect(previousRect, derivedRect())) centreCamera();
        redraw();
        notify();
      },
      redo() {
        stopStroke();
        const previousRect = derivedRect();
        const next = redoEditorHistory(history);
        if (next === history) return;
        history = next;
        map = { ...history.present, name: map.name };
        history = { ...history, present: map };
        selected = null;
        if (!sameRect(previousRect, derivedRect())) centreCamera();
        redraw();
        notify();
      },
      markSaved(saved = map) {
        history = markEditorHistorySaved(history, saved);
        notify();
      },
      selected: () => selected,
      clearSelection() {
        if (!selected) return;
        selected = null;
        drawOverlay();
        notify();
      },
      moveSelected(col, row) {
        if (!selected) return false;
        const previous = selected;
        const nextSelection: EditorSelection =
          previous.kind === "element" ? { ...previous, col, row } : previous;
        return commitInspectorChange(moveSelection(map, previous, col, row), nextSelection);
      },
      setSelectedElementAsset(assetId) {
        if (selected?.kind !== "element") return false;
        return commitInspectorChange(updateSelectedElementAsset(map, selected, assetId));
      },
      setSelectedElementOffset(offsetX, offsetY) {
        if (selected?.kind !== "element") return false;
        const clamp = (value: number): number =>
          Math.max(0, Math.min(ELEMENT_OFFSET_STEPS - 1, Math.trunc(value)));
        const nextSelection: EditorSelection = {
          ...selected,
          offsetX: clamp(offsetX),
          offsetY: clamp(offsetY),
        };
        return commitInspectorChange(
          updateSelectedElementOffset(map, selected, offsetX, offsetY),
          nextSelection,
        );
      },
      setSelectedElementOrientation(orientation) {
        if (selected?.kind !== "element") return false;
        return commitInspectorChange(updateSelectedElementOrientation(map, selected, orientation));
      },
      setSelectedBuildingSettings(settings) {
        if (selected?.kind !== "element") return false;
        return commitInspectorChange(updateSelectedBuildingSettings(map, selected, settings));
      },
      deleteSelected() {
        if (!selected || selected.kind === "spawn") return false;
        return commitInspectorChange(deleteSelection(map, selected), null);
      },
      beginEventDraft(id) {
        return beginEventDraft(map, id);
      },
      commitEventDraft(draft) {
        history = commitEventDraft({ ...history, present: map }, draft);
        map = history.present;
        selected = { kind: "event", id: draft.id };
        redraw();
        notify();
      },
      deleteEvent(id) {
        commitInspectorChange(deleteSelection(map, { kind: "event", id }), null);
      },
      bindSelectedElement(binding) {
        if (selected?.kind !== "element") return null;
        const converted = convertElementToEvent(map, selected, binding);
        if (!converted) return null;
        commitInspectorChange(converted.map, { kind: "event", id: converted.eventId });
        return converted.eventId;
      },
      highlightEvent(id) {
        if (id === highlightedEventId) return;
        highlightedEventId = id;
        drawOverlay();
      },
      selectEvent(id) {
        if (!map.events.some((event) => event.id === id)) return;
        selected = { kind: "event", id };
        drawOverlay();
        notify();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerleave", onPointerLeave);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("dblclick", onDoubleClick);
        canvas.removeEventListener("contextmenu", preventContext);
        window.removeEventListener("pointerup", stopStroke);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        onCursorCell?.(null, null);
        renderer.destroy();
        releaseStageCanvas();
        if (activeStage === handle) activeStage = null;
      },
    };
    activeStage = handle;
    return handle;
  });

  openQueue = opening.then(
    () => undefined,
    () => undefined,
  );
  return opening;
}
