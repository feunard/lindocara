/**
 * The creator's WYSIWYG HD-2D surface.
 *
 * React owns controls and dialogs; this module owns the shared `#stage` canvas. Every mutation is
 * still delegated to `editor-state.ts`, while terrain and scenery are compiled and drawn through
 * the exact engine/renderer path used by a running room.
 */

import { acquireStageCanvas, releaseStageCanvas } from "@lindocara/client/game/stage-canvas.js";
import type { MapAudioConfig } from "@lindocara/engine/audio-catalog.js";
import {
  type BridgeDimensions,
  bridgeDimensionsOrDefault,
  bridgeOrientation,
  bridgePlacementLayout,
  MAX_BRIDGE_DIMENSION,
  MIN_BRIDGE_DIMENSION,
} from "@lindocara/engine/bridges.js";
import {
  BUILDING_DIMENSION_STEP,
  type BuildingDimensions,
  type BuildingSettings,
  buildingDimensionsOrDefault,
  MAX_BUILDING_DIMENSION,
  MIN_BUILDING_DIMENSION,
  proportionalBuildingDimensions,
} from "@lindocara/engine/buildings.js";
import {
  type ElementOrientation,
  elementRotationDegrees,
} from "@lindocara/engine/element-orientation.js";
import {
  authoredBridgeTop,
  authoredElementGroundPoint,
  authoredStairsRamp,
  compileAuthoredMap,
  compileAuthoredMapContent,
} from "@lindocara/engine/hd2d/authored-map.js";
import type { ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import type { MapData as CompiledMapData } from "@lindocara/engine/hd2d/map-data.js";
import { derivedMapRect, type MapRect } from "@lindocara/engine/map-canvas.js";
import {
  ELEMENT_OFFSET_STEPS,
  element3dRotationDegrees,
  elementWorldColliderGeometry,
  isRotatable3dElementAsset,
  type MapElement,
  sameElementSlot,
} from "@lindocara/engine/map-data.js";
import type { MapEvent } from "@lindocara/engine/map-events.js";
import type { MapHeroSettings } from "@lindocara/engine/map-hero-settings.js";
import type { MapFixedLighting } from "@lindocara/engine/map-lighting.js";
import { nativeHarvestEvents } from "@lindocara/engine/native-harvest.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
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
  updateSelectedBridgeDimensions,
  updateSelectedBuildingSettings,
  updateSelectedElementAsset,
  updateSelectedElementOffset,
  updateSelectedElementOrientation,
  updateSelectedElementRotation,
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
  setSelectedElementRotation(rotation: number): boolean;
  setSelectedBridgeDimensions(dimensions: BridgeDimensions): boolean;
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

export type BuildingResizeAxis = "width" | "depth";
export type BridgeResizeAxis = "length" | "width";
export type BridgeResizeSide = "length-start" | "length-end" | "width-start" | "width-end";

export interface BuildingResizeGuide {
  anchor: { x: number; z: number };
  outline: readonly { x: number; z: number }[];
  widthHandles: readonly [{ x: number; z: number }, { x: number; z: number }];
  depthHandle: { x: number; z: number };
}

export interface BridgeResizeGuide {
  anchor: { x: number; z: number };
  outline: readonly { x: number; z: number }[];
  handles: readonly [
    BridgeResizeHandle,
    BridgeResizeHandle,
    BridgeResizeHandle,
    BridgeResizeHandle,
  ];
}

export interface BridgeResizeHandle {
  side: BridgeResizeSide;
  axis: BridgeResizeAxis;
  point: { x: number; z: number };
  outward: { x: number; z: number };
}

export interface BridgeResizeResult {
  dimensions: BridgeDimensions;
  placement: Pick<MapElement, "col" | "row" | "offsetX" | "offsetY">;
}

export interface ElementRotationGuide {
  anchor: { x: number; z: number };
  handle: { x: number; z: number };
  angle: number;
}

/** World-space footprint and handles for one native building. The front threshold remains fixed:
 * width grows symmetrically from it, while depth grows only behind it. */
export function buildingResizeGuide(
  element: MapElement,
  mapSize: number,
  override?: BuildingDimensions,
): BuildingResizeGuide | null {
  const dimensions = buildingDimensionsOrDefault(
    element.assetId,
    override ?? element.building?.dimensions,
  );
  if (!dimensions) return null;
  const anchor = authoredElementGroundPoint(element, mapSize);
  const radians = (elementRotationDegrees(element) * Math.PI) / 180;
  const point = (localX: number, localZ: number): { x: number; z: number } => {
    const rawCos = Math.cos(radians);
    const rawSin = Math.sin(radians);
    const cos = Math.abs(rawCos) < 1e-12 ? 0 : rawCos;
    const sin = Math.abs(rawSin) < 1e-12 ? 0 : rawSin;
    return {
      x: anchor.x + localX * cos - localZ * sin,
      z: anchor.z + localX * sin + localZ * cos,
    };
  };
  return {
    anchor,
    outline: [
      point(-dimensions.width / 2, 0),
      point(dimensions.width / 2, 0),
      point(dimensions.width / 2, -dimensions.depth),
      point(-dimensions.width / 2, -dimensions.depth),
    ],
    widthHandles: [
      point(-dimensions.width / 2, -dimensions.depth / 2),
      point(dimensions.width / 2, -dimensions.depth / 2),
    ],
    depthHandle: point(0, -dimensions.depth),
  };
}

/** Convert a dragged world point back into the building's unrotated local axes and snap it to the
 * same eighth-cell contract used by the inspector and persistence layer. */
export function buildingDimensionsAtPoint(
  element: MapElement,
  mapSize: number,
  axis: BuildingResizeAxis,
  world: { x: number; z: number },
): BuildingDimensions | null {
  const current = buildingDimensionsOrDefault(element.assetId, element.building?.dimensions);
  if (!current) return null;
  const anchor = authoredElementGroundPoint(element, mapSize);
  let x = world.x - anchor.x;
  let z = world.z - anchor.z;
  const radians = (elementRotationDegrees(element) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  [x, z] = [x * cos + z * sin, -x * sin + z * cos];
  const raw = axis === "width" ? Math.abs(x) * 2 : -z;
  const snapped = Math.max(
    MIN_BUILDING_DIMENSION,
    Math.min(
      MAX_BUILDING_DIMENSION,
      Math.round(raw / BUILDING_DIMENSION_STEP) * BUILDING_DIMENSION_STEP,
    ),
  );
  return proportionalBuildingDimensions(element.assetId, axis, snapped);
}

/** Exact compiled bridge footprint plus one independent handle on each of its four edges. */
export function bridgeResizeGuide(
  element: MapElement,
  mapSize: number,
  override?: BridgeDimensions,
): BridgeResizeGuide | null {
  const orientation = bridgeOrientation(element.assetId);
  if (!orientation) return null;
  const layout = bridgePlacementLayout({
    ...element,
    bridge: override ?? bridgeDimensionsOrDefault(element.bridge),
  });
  if (!layout) return null;
  const offsetX = element.offsetX / ELEMENT_OFFSET_STEPS;
  const offsetZ = element.offsetY / ELEMENT_OFFSET_STEPS;
  const left = layout.startCol + offsetX - mapSize / 2;
  const top = layout.startRow + offsetZ - mapSize / 2;
  const right = left + layout.cols;
  const bottom = top + layout.rows;
  const centreX = (left + right) / 2;
  const centreZ = (top + bottom) / 2;
  const outline = [
    { x: left, z: top },
    { x: right, z: top },
    { x: right, z: bottom },
    { x: left, z: bottom },
  ];
  const baseAngle = orientation === "horizontal" ? 0 : 90;
  const deltaRadians = (((element.rotation ?? baseAngle) - baseAngle) * Math.PI) / 180;
  const rotate = (point: { x: number; z: number }): { x: number; z: number } => {
    const dx = point.x - centreX;
    const dz = point.z - centreZ;
    const cos = Math.cos(deltaRadians);
    const sin = Math.sin(deltaRadians);
    return { x: centreX + dx * cos - dz * sin, z: centreZ + dx * sin + dz * cos };
  };
  const rotateVector = (vector: { x: number; z: number }): { x: number; z: number } => {
    const cos = Math.cos(deltaRadians);
    const sin = Math.sin(deltaRadians);
    return { x: vector.x * cos - vector.z * sin, z: vector.x * sin + vector.z * cos };
  };
  const handle = (
    side: BridgeResizeSide,
    axis: BridgeResizeAxis,
    point: { x: number; z: number },
    outward: { x: number; z: number },
  ): BridgeResizeHandle => ({ side, axis, point: rotate(point), outward: rotateVector(outward) });
  const handles: BridgeResizeGuide["handles"] =
    orientation === "horizontal"
      ? [
          handle("length-start", "length", { x: left, z: centreZ }, { x: -1, z: 0 }),
          handle("length-end", "length", { x: right, z: centreZ }, { x: 1, z: 0 }),
          handle("width-start", "width", { x: centreX, z: top }, { x: 0, z: -1 }),
          handle("width-end", "width", { x: centreX, z: bottom }, { x: 0, z: 1 }),
        ]
      : [
          handle("length-start", "length", { x: centreX, z: top }, { x: 0, z: -1 }),
          handle("length-end", "length", { x: centreX, z: bottom }, { x: 0, z: 1 }),
          handle("width-start", "width", { x: left, z: centreZ }, { x: -1, z: 0 }),
          handle("width-end", "width", { x: right, z: centreZ }, { x: 1, z: 0 }),
        ];
  return {
    anchor: authoredElementGroundPoint(element, mapSize),
    outline: outline.map(rotate),
    handles,
  };
}

export function elementRotationGuide(
  element: MapElement,
  mapSize: number,
): ElementRotationGuide | null {
  if (!isRotatable3dElementAsset(element.assetId)) return null;
  const building = buildingResizeGuide(element, mapSize);
  const bridge = building ? null : bridgeResizeGuide(element, mapSize);
  const outline = building?.outline ?? bridge?.outline;
  const anchor =
    building?.anchor ??
    (bridge
      ? {
          x: bridge.outline.reduce((sum, point) => sum + point.x, 0) / bridge.outline.length,
          z: bridge.outline.reduce((sum, point) => sum + point.z, 0) / bridge.outline.length,
        }
      : undefined);
  if (!outline || !anchor) return null;
  const radius =
    Math.max(...outline.map((point) => Math.hypot(point.x - anchor.x, point.z - anchor.z))) + 0.7;
  const angle = element3dRotationDegrees(element);
  const radians = (angle * Math.PI) / 180;
  return {
    anchor,
    handle: {
      x: anchor.x - Math.sin(radians) * radius,
      z: anchor.z + Math.cos(radians) * radius,
    },
    angle,
  };
}

export function elementRotationAtPoint(
  anchor: { x: number; z: number },
  point: { x: number; z: number },
): number {
  const degrees = (Math.atan2(-(point.x - anchor.x), point.z - anchor.z) * 180) / Math.PI;
  return ((Math.round(degrees) % 360) + 360) % 360;
}

/** Bridges snap to whole cells. Delta is measured from the pointer-down handle, which avoids the
 * historical anchor's half-cell parity shift while the footprint changes between odd/even sizes. */
export function bridgeDimensionsAtDelta(
  element: MapElement,
  axis: BridgeResizeAxis,
  delta: number,
): BridgeDimensions | null {
  if (!bridgeOrientation(element.assetId) || !Number.isFinite(delta)) return null;
  const current = bridgeDimensionsOrDefault(element.bridge);
  const value = Math.max(
    MIN_BRIDGE_DIMENSION,
    Math.min(MAX_BRIDGE_DIMENSION, Math.round(current[axis] + delta)),
  );
  return { ...current, [axis]: value };
}

function placementAtGroundPoint(
  point: { x: number; z: number },
  mapSize: number,
): Pick<MapElement, "col" | "row" | "offsetX" | "offsetY"> {
  const quantizedX = Math.round((point.x + mapSize / 2 - 0.5) * ELEMENT_OFFSET_STEPS);
  const quantizedZ = Math.round((point.z + mapSize / 2 - 1) * ELEMENT_OFFSET_STEPS);
  const col = Math.floor(quantizedX / ELEMENT_OFFSET_STEPS);
  const row = Math.floor(quantizedZ / ELEMENT_OFFSET_STEPS);
  return {
    col,
    row,
    offsetX: quantizedX - col * ELEMENT_OFFSET_STEPS,
    offsetY: quantizedZ - row * ELEMENT_OFFSET_STEPS,
  };
}

/** Resize one bridge edge while holding its opposite edge fixed, including after free rotation. */
export function bridgeResizeAtDelta(
  element: MapElement,
  mapSize: number,
  side: BridgeResizeSide,
  delta: number,
): BridgeResizeResult | null {
  const guide = bridgeResizeGuide(element, mapSize);
  const dragged = guide?.handles.find((candidate) => candidate.side === side);
  if (!dragged) return null;
  const current = bridgeDimensionsOrDefault(element.bridge);
  const dimensions = bridgeDimensionsAtDelta(element, dragged.axis, delta);
  if (!dimensions) return null;
  const change = dimensions[dragged.axis] - current[dragged.axis];
  const before = elementWorldColliderGeometry({ ...element, bridge: current });
  const resizedAtSameAnchor = elementWorldColliderGeometry({ ...element, bridge: dimensions });
  if (!before || !resizedAtSameAnchor) return null;
  const desiredCentre = {
    x: before.x + before.width / 2 + dragged.outward.x * change * TILE_SIZE * 0.5,
    z: before.y + before.height / 2 + dragged.outward.z * change * TILE_SIZE * 0.5,
  };
  const resizedCentre = {
    x: resizedAtSameAnchor.x + resizedAtSameAnchor.width / 2,
    z: resizedAtSameAnchor.y + resizedAtSameAnchor.height / 2,
  };
  const ground = authoredElementGroundPoint(element, mapSize);
  return {
    dimensions,
    placement: placementAtGroundPoint(
      {
        x: ground.x + (desiredCentre.x - resizedCentre.x) / TILE_SIZE,
        z: ground.z + (desiredCentre.z - resizedCentre.z) / TILE_SIZE,
      },
      mapSize,
    ),
  };
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
const BUILDING_RESIZE_HANDLE_HIT_RADIUS = 0.34;

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
    let resizeDrag:
      | {
          kind: "building";
          axis: BuildingResizeAxis;
          selection: Extract<EditorSelection, { kind: "element" }>;
          settings: BuildingSettings;
        }
      | {
          kind: "bridge";
          axis: BridgeResizeAxis;
          side: BridgeResizeSide;
          selection: Extract<EditorSelection, { kind: "element" }>;
          dimensions: BridgeDimensions;
          startPoint: { x: number; z: number };
          outward: { x: number; z: number };
        }
      | null = null;
    let resizePreview:
      | { kind: "building"; dimensions: BuildingDimensions; valid: boolean }
      | { kind: "bridge"; dimensions: BridgeDimensions; valid: boolean }
      | null = null;
    let rotationDrag: {
      selection: Extract<EditorSelection, { kind: "element" }>;
      anchor: { x: number; z: number };
    } | null = null;
    let rotationPreview: { angle: number; valid: boolean } | null = null;
    let hoverRotation = false;
    let hoverResize:
      | { kind: "building"; axis: BuildingResizeAxis }
      | { kind: "bridge"; axis: BridgeResizeAxis; side: BridgeResizeSide }
      | null = null;
    let lastPaintedKey = "";
    // Terrain spray still remeshes the ground (12-45ms measured on a light canvas), so a fast drag
    // is throttled. Scenery and event edits use the incremental path and bypass this delay entirely.
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
    const selectedElement = (): MapElement | null => {
      if (selected?.kind !== "element") return null;
      const selection = selected;
      return map.elements.find((candidate) => sameElementSlot(candidate, selection)) ?? null;
    };
    const selectedBuildingElement = (): MapElement | null => {
      const element = selectedElement();
      return element?.building ? element : null;
    };
    const selectedBridgeElement = (): MapElement | null => {
      const element = selectedElement();
      return element && bridgeOrientation(element.assetId) ? element : null;
    };
    const selectedBuildingGuide = (): BuildingResizeGuide | null => {
      const element = selectedBuildingElement();
      if (!element) return null;
      const { cols, rows } = dimensions();
      return buildingResizeGuide(
        element,
        Math.max(cols, rows),
        resizePreview?.kind === "building" ? resizePreview.dimensions : undefined,
      );
    };
    const selectedBridgeGuide = (): BridgeResizeGuide | null => {
      const element = selectedBridgeElement();
      if (!element) return null;
      const { cols, rows } = dimensions();
      return bridgeResizeGuide(
        element,
        Math.max(cols, rows),
        resizePreview?.kind === "bridge" ? resizePreview.dimensions : undefined,
      );
    };
    const selectedRotationGuide = (): ElementRotationGuide | null => {
      const element = selectedElement();
      if (!element) return null;
      const { cols, rows } = dimensions();
      return elementRotationGuide(element, Math.max(cols, rows));
    };
    const rotationAt = (point: { x: number; z: number }): boolean => {
      const guide = selectedRotationGuide();
      return Boolean(
        guide &&
          Math.hypot(point.x - guide.handle.x, point.z - guide.handle.z) <=
            BUILDING_RESIZE_HANDLE_HIT_RADIUS,
      );
    };
    const resizeAt = (point: {
      x: number;
      z: number;
    }):
      | { kind: "building"; axis: BuildingResizeAxis }
      | {
          kind: "bridge";
          axis: BridgeResizeAxis;
          side: BridgeResizeSide;
          outward: { x: number; z: number };
        }
      | null => {
      const distance = (handle: { x: number; z: number }): number =>
        Math.hypot(point.x - handle.x, point.z - handle.z);
      const building = selectedBuildingGuide();
      if (building) {
        if (Math.min(...building.widthHandles.map(distance)) <= BUILDING_RESIZE_HANDLE_HIT_RADIUS) {
          return { kind: "building", axis: "width" };
        }
        return distance(building.depthHandle) <= BUILDING_RESIZE_HANDLE_HIT_RADIUS
          ? { kind: "building", axis: "depth" }
          : null;
      }
      const bridge = selectedBridgeGuide();
      if (!bridge) return null;
      const closest = [...bridge.handles].sort(
        (left, right) => distance(left.point) - distance(right.point),
      )[0];
      return closest && distance(closest.point) <= BUILDING_RESIZE_HANDLE_HIT_RADIUS
        ? {
            kind: "bridge",
            axis: closest.axis,
            side: closest.side,
            outward: closest.outward,
          }
        : null;
    };
    const refreshCursor = (): void => {
      canvas.dataset.cursor =
        resizeDrag || rotationDrag
          ? "grabbing"
          : hoverRotation
            ? "rotate"
            : hoverResize
              ? `resize-${hoverResize.axis}`
              : tool.kind === "pan"
                ? "move"
                : tool.kind === "select"
                  ? "select"
                  : "paint";
    };
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
      const previewBridgeTop =
        hover && tool.kind === "element" && bridgeOrientation(tool.assetId)
          ? authoredBridgeTop(
              { cols, rows },
              { ...hover, assetId: tool.assetId },
              heightfield.levels,
              size,
            )
          : undefined;
      const buildingResize = selectedBuildingGuide();
      const bridgeResize = selectedBridgeGuide();
      const rotation = selectedRotationGuide();
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
        buildingResize: buildingResize
          ? {
              ...buildingResize,
              hoverAxis: hoverResize?.kind === "building" ? hoverResize.axis : null,
              activeAxis: resizeDrag?.kind === "building" ? resizeDrag.axis : null,
              valid: resizePreview?.kind === "building" ? resizePreview.valid : true,
            }
          : null,
        bridgeResize: bridgeResize
          ? {
              ...bridgeResize,
              hoverSide: hoverResize?.kind === "bridge" ? hoverResize.side : null,
              activeSide: resizeDrag?.kind === "bridge" ? resizeDrag.side : null,
              valid: resizePreview?.kind === "bridge" ? resizePreview.valid : true,
            }
          : null,
        elementRotation: rotation
          ? {
              ...rotation,
              hovered: hoverRotation,
              active: rotationDrag !== null,
              valid: rotationPreview?.valid ?? true,
            }
          : null,
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
                ...(previewBridgeTop === undefined ? {} : { elevation: previewBridgeTop }),
                ...(previewAsset.editor.renderLayer === "sky"
                  ? { skyAltitude: authoredSkyAltitude(heightfield) }
                  : {}),
              }
            : null,
      });
    };

    const redraw = (contentOnly = false): void => {
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
      revision += 1;
      if (contentOnly) renderer.updateEditorContent(revision, heightfield);
      else renderer.configureMapTerrain("editor", [], revision, heightfield);
      renderer.preloadWorldEventAssets(renderedEvents);
      renderer.setCameraFocus(cameraX, cameraZ);
      renderer.setCameraZoom(zoom);
      drawOverlay(heightfield);
    };

    /** Terrain mesh inputs live in the authored layers. Content mutations preserve that array, so
     * they can refresh scenery and collision without paying for a ground/water rebuild. */
    const redrawMapChange = (previous: EditorMap): void => {
      const previousSize = editorMapSize(previous);
      const nextSize = dimensions();
      const contentOnly =
        previous.layers === map.layers &&
        previous.environment === map.environment &&
        previousSize.cols === nextSize.cols &&
        previousSize.rows === nextSize.rows;
      if (contentOnly && compiledCache?.map === previous) {
        compiledCache = {
          map,
          heightfield: compileAuthoredMapContent(
            toMapData(map),
            compiledCache.heightfield,
            map.events,
          ),
        };
      }
      redraw(contentOnly);
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
    const strokeRedraw = (previous: EditorMap): void => {
      if (previous.layers === map.layers) {
        redrawMapChange(previous);
        return;
      }
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
      const previous = map;
      history = commitEditorHistory({ ...history, present: map }, next);
      map = next;
      selected = nextSelection;
      redrawMapChange(previous);
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
          hoverResize = null;
          hoverRotation = false;
          refreshCursor();
          drawOverlay();
          notify();
          return;
        }
        if (!dragSelection) return;
        const previous = dragSelection;
        const next = moveSelection(map, previous, col, row, offsetX, offsetY);
        if (!next || next === map) return;
        const previousMap = map;
        const nextSelection: EditorSelection =
          previous.kind === "element" ? { ...previous, col, row, offsetX, offsetY } : previous;
        map = next;
        dragSelection = nextSelection;
        selected = nextSelection;
        redrawMapChange(previousMap);
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
          hoverResize = null;
          hoverRotation = false;
          refreshCursor();
          drawOverlay();
          notify();
          return;
        }
      }
      if (tool.kind === "event") {
        const exists = map.events.find((event) => event.col === col && event.row === row);
        if (exists) {
          selected = { kind: "event", id: exists.id };
          hoverResize = null;
          hoverRotation = false;
          refreshCursor();
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
      const previous = map;
      map = next;
      if (tool.kind === "event") {
        const placed = map.events.find((event) => event.col === col && event.row === row);
        if (placed) selected = { kind: "event", id: placed.id };
      }
      strokeRedraw(previous);
      notify();
    };

    const resizeSelectedAt = (clientX: number, clientY: number): void => {
      if (!resizeDrag || !strokeStart) return;
      const drag = resizeDrag;
      const point = renderer.screenToWorld(clientX, clientY);
      const sourceElement = strokeStart.elements.find((candidate) =>
        sameElementSlot(candidate, drag.selection),
      );
      if (!point || !sourceElement) return;
      let next: EditorMap | null;
      if (drag.kind === "building") {
        const { cols, rows } = dimensions();
        const nextDimensions = buildingDimensionsAtPoint(
          sourceElement,
          Math.max(cols, rows),
          drag.axis,
          point,
        );
        if (!nextDimensions) return;
        const previousPreview =
          resizePreview?.kind === "building" ? resizePreview.dimensions : null;
        if (
          previousPreview?.width === nextDimensions.width &&
          previousPreview.depth === nextDimensions.depth
        ) {
          return;
        }
        next = updateSelectedBuildingSettings(map, drag.selection, {
          ...drag.settings,
          dimensions: nextDimensions,
        });
        resizePreview = {
          kind: "building",
          dimensions: nextDimensions,
          valid: next !== null,
        };
      } else {
        const worldDx = point.x - drag.startPoint.x;
        const worldDz = point.z - drag.startPoint.z;
        const delta = worldDx * drag.outward.x + worldDz * drag.outward.z;
        const source = { ...sourceElement, bridge: drag.dimensions };
        const { cols, rows } = dimensions();
        const result = bridgeResizeAtDelta(source, Math.max(cols, rows), drag.side, delta);
        if (!result) return;
        const nextDimensions = result.dimensions;
        const previousPreview = resizePreview?.kind === "bridge" ? resizePreview.dimensions : null;
        if (
          previousPreview?.length === nextDimensions.length &&
          previousPreview.width === nextDimensions.width
        ) {
          return;
        }
        next = updateSelectedBridgeDimensions(
          strokeStart,
          drag.selection,
          nextDimensions,
          result.placement,
        );
        resizePreview = { kind: "bridge", dimensions: nextDimensions, valid: next !== null };
        if (next) selected = { kind: "element", ...result.placement };
      }
      if (!next || next === map) {
        drawOverlay();
        return;
      }
      const previous = map;
      map = next;
      strokeRedraw(previous);
      notify();
    };

    const rotateSelectedAt = (clientX: number, clientY: number): void => {
      if (!rotationDrag || !strokeStart) return;
      const point = renderer.screenToWorld(clientX, clientY);
      if (!point) return;
      const angle = elementRotationAtPoint(rotationDrag.anchor, point);
      if (rotationPreview?.angle === angle) return;
      const next = updateSelectedElementRotation(map, rotationDrag.selection, angle);
      rotationPreview = { angle, valid: next !== null };
      if (!next || next === map) {
        drawOverlay();
        return;
      }
      const previous = map;
      map = next;
      strokeRedraw(previous);
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
      const point = renderer.screenToWorld(event.clientX, event.clientY);
      const rotation = point ? rotationAt(point) : false;
      const resize = point ? resizeAt(point) : null;
      const building = selectedBuildingElement();
      const bridge = selectedBridgeElement();
      const currentDimensions = building?.building
        ? buildingDimensionsOrDefault(building.assetId, building.building.dimensions)
        : null;
      const rotationGuide = selectedRotationGuide();
      if (rotation && selected?.kind === "element" && rotationGuide) {
        rotationDrag = { selection: selected, anchor: rotationGuide.anchor };
        rotationPreview = { angle: rotationGuide.angle, valid: true };
        hoverRotation = true;
        strokeStart = map;
        refreshCursor();
        drawOverlay();
        return;
      }
      if (
        resize?.kind === "building" &&
        selected?.kind === "element" &&
        building?.building &&
        currentDimensions
      ) {
        resizeDrag = {
          kind: "building",
          axis: resize.axis,
          selection: selected,
          settings: building.building,
        };
        resizePreview = {
          kind: "building",
          dimensions: currentDimensions,
          valid: true,
        };
        hoverResize = resize;
        strokeStart = map;
        refreshCursor();
        drawOverlay();
        return;
      }
      if (resize?.kind === "bridge" && selected?.kind === "element" && bridge && point) {
        const bridgeDimensions = bridgeDimensionsOrDefault(bridge.bridge);
        resizeDrag = {
          kind: "bridge",
          axis: resize.axis,
          side: resize.side,
          selection: selected,
          dimensions: bridgeDimensions,
          startPoint: point,
          outward: resize.outward,
        };
        resizePreview = { kind: "bridge", dimensions: bridgeDimensions, valid: true };
        hoverResize = resize;
        strokeStart = map;
        refreshCursor();
        drawOverlay();
        return;
      }
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
      if (resizeDrag) {
        resizeSelectedAt(event.clientX, event.clientY);
        return;
      }
      if (rotationDrag) {
        rotateSelectedAt(event.clientX, event.clientY);
        return;
      }
      const world = renderer.screenToWorld(event.clientX, event.clientY);
      hoverRotation = !painting && world ? rotationAt(world) : false;
      hoverResize = !painting && world ? resizeAt(world) : null;
      refreshCursor();
      const placement = placementAt(event.clientX, event.clientY);
      hover = placement;
      reportCursor(placement?.col ?? null, placement?.row ?? null);
      drawOverlay();
      if (painting) paintAt(event.clientX, event.clientY, false);
    };

    const stopStroke = (): void => {
      const stoppedResize = resizeDrag !== null || rotationDrag !== null;
      resizeDrag = null;
      resizePreview = null;
      rotationDrag = null;
      rotationPreview = null;
      hoverRotation = false;
      hoverResize = null;
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
      refreshCursor();
      if (stoppedResize && !strokeRebuildPending) drawOverlay();
    };

    const onPointerLeave = (): void => {
      hover = null;
      hoverResize = null;
      hoverRotation = false;
      refreshCursor();
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
      hoverResize = null;
      hoverRotation = false;
      refreshCursor();
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
        refreshCursor();
        drawOverlay();
      },
      setActiveMode(mode) {
        history = setActiveMode(history, mode);
        const matches =
          (mode === "field" && selected?.kind === "spawn") ||
          (mode === "element" && selected?.kind === "element") ||
          (mode === "event" && selected?.kind === "event");
        if (selected && !matches) selected = null;
        if (!selected) {
          hoverResize = null;
          hoverRotation = false;
        }
        refreshCursor();
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
        const previous = map;
        history = nextHistory;
        map = next;
        selected = null;
        highlightedEventId = null;
        hover = null;
        hoverResize = null;
        hoverRotation = false;
        refreshCursor();
        reportCursor(null, null);
        // A whole generated map is a new composition even though both documents use the same
        // 256x256 working canvas. Open on its authored content immediately.
        centreCamera();
        redrawMapChange(previous);
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
        const previous = map;
        history = next;
        map = { ...history.present, name: map.name };
        history = { ...history, present: map };
        selected = null;
        hoverResize = null;
        hoverRotation = false;
        refreshCursor();
        if (!sameRect(previousRect, derivedRect())) centreCamera();
        redrawMapChange(previous);
        notify();
      },
      redo() {
        stopStroke();
        const previousRect = derivedRect();
        const next = redoEditorHistory(history);
        if (next === history) return;
        const previous = map;
        history = next;
        map = { ...history.present, name: map.name };
        history = { ...history, present: map };
        selected = null;
        hoverResize = null;
        hoverRotation = false;
        refreshCursor();
        if (!sameRect(previousRect, derivedRect())) centreCamera();
        redrawMapChange(previous);
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
        hoverResize = null;
        hoverRotation = false;
        refreshCursor();
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
      setSelectedElementRotation(rotation) {
        if (selected?.kind !== "element") return false;
        return commitInspectorChange(updateSelectedElementRotation(map, selected, rotation));
      },
      setSelectedBridgeDimensions(dimensions) {
        if (selected?.kind !== "element") return false;
        return commitInspectorChange(updateSelectedBridgeDimensions(map, selected, dimensions));
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
        const previous = map;
        history = commitEventDraft({ ...history, present: map }, draft);
        map = history.present;
        selected = { kind: "event", id: draft.id };
        redrawMapChange(previous);
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
