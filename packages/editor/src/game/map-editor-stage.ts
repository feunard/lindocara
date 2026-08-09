/**
 * The creator's WYSIWYG HD-2D surface.
 *
 * React owns controls and dialogs; this module owns the shared `#stage` canvas. Every mutation is
 * still delegated to `editor-state.ts`, while terrain and scenery are compiled and drawn through
 * the exact engine/renderer path used by a running room.
 */

import type { MapAudioConfig } from "@lindocara/engine/audio-catalog.js";
import { authoredStairsRamp, compileAuthoredMap } from "@lindocara/engine/hd2d/authored-map.js";
import type { ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import { ELEMENT_OFFSET_STEPS } from "@lindocara/engine/map-data.js";
import type { MapEvent } from "@lindocara/engine/map-events.js";
import type { MapHeroSettings } from "@lindocara/engine/map-hero-settings.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import { Hd2dRenderer } from "@lindocara/renderer/hd2d/game-renderer.js";
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
  updateSelectedElementAsset,
  updateSelectedElementOffset,
} from "./editor-state.js";

export interface MapEditorStageHandle {
  setTool(tool: EditorTool): void;
  setActiveMode(mode: EditorMode): void;
  setDim(dim: boolean): void;
  setGrid(show: boolean): void;
  setCollisions(show: boolean): void;
  setZoom(percent: number): void;
  current(): EditorMap;
  setName(name: string): void;
  setAudio(audio: MapAudioConfig): void;
  setHeroSettings(settings: MapHeroSettings): void;
  undo(): void;
  redo(): void;
  markSaved(saved?: EditorMap): void;
  selected(): EditorSelection | null;
  clearSelection(): void;
  moveSelected(col: number, row: number): boolean;
  setSelectedElementAsset(assetId: EditorAssetId): boolean;
  setSelectedElementOffset(offsetX: number, offsetY: number): boolean;
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
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  selection: EditorSelection | null;
  placementRejectedAt: number | null;
}

export function defaultDimForMode(mode: EditorMode): boolean {
  return mode !== "field";
}

const EMPTY_SAMPLE: SceneSample = {
  players: [],
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
  return {
    x: selection.col + (selection.offsetX + 0.5) / ELEMENT_OFFSET_STEPS - size / 2,
    z: selection.row + (selection.offsetY + 0.5) / ELEMENT_OFFSET_STEPS - size / 2,
  };
}

function blockedCells(map: EditorMap, levels: readonly (number | null)[]): ColliderRect[] {
  const { cols, rows } = editorMapSize(map);
  const size = Math.max(cols, rows);
  const cells: ColliderRect[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (levels[row * size + col] !== null) continue;
      cells.push({ x: col - size / 2, z: row - size / 2, w: 1, h: 1 });
    }
  }
  return cells;
}

let activeStage: MapEditorStageHandle | null = null;
let openQueue: Promise<void> = Promise.resolve();

export function openMapEditorStage(
  initial: EditorMap,
  onChange: (map: EditorMap, state: MapEditorStageState) => void,
  onCursorCell?: (col: number | null, row: number | null) => void,
  onOpenSelection?: (selection: EditorSelection) => void,
  onZoomChange?: (percent: number) => void,
): Promise<MapEditorStageHandle> {
  const opening = openQueue.then(async () => {
    activeStage?.dispose();
    const canvas = document.querySelector<HTMLCanvasElement>("#stage");
    if (!canvas) throw new Error("The HD-2D editor requires the #stage canvas");

    const renderer = await Hd2dRenderer.create(canvas);
    renderer.setTiltShiftEnabled(false);
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
    let lastPointerX = 0;
    let lastPointerY = 0;
    let cameraX = 0;
    let cameraZ = 0;
    let disposed = false;
    let lastCursorKey = "";

    const dimensions = () => editorMapSize(map);
    const centreCamera = (): void => {
      const { cols, rows } = dimensions();
      const size = Math.max(cols, rows);
      cameraX = cols / 2 - size / 2;
      cameraZ = rows / 2 - size / 2;
      renderer.setCameraFocus(cameraX, cameraZ);
    };

    const compiled = () => compileAuthoredMap(toMapData(map), map.events);

    const drawOverlay = (heightfield = compiled()): void => {
      const { cols, rows } = dimensions();
      const focusSelection = highlightedEventId
        ? selectionPoint(map, { kind: "event", id: highlightedEventId })
        : selectionPoint(map, selected);
      const size = Math.max(cols, rows);
      renderer.setEditorOverlay({
        cols,
        rows,
        showGrid: gridVisible,
        showCollisions: collisionsVisible,
        dim,
        colliders: [...heightfield.colliders, ...blockedCells(map, heightfield.levels)],
        hover: hover
          ? {
              x: hover.col + (hover.offsetX + 0.5) / ELEMENT_OFFSET_STEPS - size / 2,
              z: hover.row + (hover.offsetY + 0.5) / ELEMENT_OFFSET_STEPS - size / 2,
            }
          : null,
        selection: focusSelection,
        stairsPreview:
          hover && tool.kind === "stairs"
            ? {
                ramp: authoredStairsRamp(hover.col, hover.row, size, tool.direction, tool.lowLevel),
                valid: placementLegalAt(tool, map, hover.col, hover.row, history.activeMode),
                levelHeight: heightfield.levelHeight,
              }
            : null,
      });
    };

    const redraw = (): void => {
      const heightfield = compiled();
      renderer.configureMapTerrain("editor", [], ++revision, heightfield);
      renderer.setCameraFocus(cameraX, cameraZ);
      renderer.setCameraZoom(zoom);
      drawOverlay(heightfield);
    };

    const notify = (): void => {
      onChange(map, {
        canUndo: history.past.length > 0,
        canRedo: history.future.length > 0,
        dirty: isEditorHistoryDirty(history, map),
        selection: selected,
        placementRejectedAt: placementRejections > 0 ? placementRejections : null,
      });
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
      redraw();
      notify();
    };

    const panTrigger = (event: PointerEvent): boolean =>
      event.button === 1 ||
      event.button === 2 ||
      (event.button === 0 && (spaceHeld || tool.kind === "pan"));

    const onPointerDown = (event: PointerEvent): void => {
      canvas.focus();
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
      if (panning) {
        const scale = (100 / zoom) * 0.035;
        cameraX -= (event.clientX - lastPointerX) * scale;
        cameraZ -= (event.clientY - lastPointerY) * scale;
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
      if (strokeStart && strokeStart !== map) {
        history = commitEditorHistory({ ...history, present: strokeStart }, map);
        notify();
      }
      strokeStart = null;
      dragSelection = null;
      painting = false;
      panning = false;
      canvas.dataset.cursor =
        tool.kind === "pan" ? "move" : tool.kind === "select" ? "select" : "paint";
    };

    const onPointerLeave = (): void => {
      hover = null;
      reportCursor(null, null);
      drawOverlay();
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
      renderer.render(EMPTY_SAMPLE, { now } as RenderContext);
    });
    centreCamera();
    redraw();
    notify();

    const handle: MapEditorStageHandle = {
      setTool(next) {
        tool = next;
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
      current: () => map,
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
      undo() {
        stopStroke();
        const next = undoEditorHistory(history);
        if (next === history) return;
        history = next;
        map = { ...history.present, name: map.name };
        history = { ...history, present: map };
        selected = null;
        redraw();
        notify();
      },
      redo() {
        stopStroke();
        const next = redoEditorHistory(history);
        if (next === history) return;
        history = next;
        map = { ...history.present, name: map.name };
        history = { ...history, present: map };
        selected = null;
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
