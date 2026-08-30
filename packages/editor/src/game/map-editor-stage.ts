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
  MAX_BUILDING_DIMENSION,
  MIN_BUILDING_DIMENSION,
} from "@lindocara/engine/buildings.js";
import {
  type ElementOrientation,
  elementRotationDegrees,
} from "@lindocara/engine/element-orientation.js";
import {
  authoredBridgeTop,
  authoredElementGroundPoint,
  authoredOneCellRamp,
  compileAuthoredMap,
  compileAuthoredMapContent,
} from "@lindocara/engine/hd2d/authored-map.js";
import type { ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import type { MapData as CompiledMapData } from "@lindocara/engine/hd2d/map-data.js";
import {
  interiorShellOpeningBetween,
  interiorShellOpeningEdgeAt,
} from "@lindocara/engine/interior-shell.js";
import { derivedMapRect, type MapRect } from "@lindocara/engine/map-canvas.js";
import {
  ELEMENT_OFFSET_STEPS,
  element3dRotationDegrees,
  elementFootStorage,
  elementWorldColliderGeometry,
  isRotatable3dElementAsset,
  type MapElement,
  sameElementSlot,
} from "@lindocara/engine/map-data.js";
import type {
  InteriorShell,
  InteriorShellOpeningRun,
  MapEnvironment,
} from "@lindocara/engine/map-environment.js";
import {
  MAX_EVENTS_PER_MAP,
  MAX_RUNTIME_EVENTS_PER_MAP,
  type MapEvent,
  runtimeEventCount,
} from "@lindocara/engine/map-events.js";
import type { MapHeroSettings } from "@lindocara/engine/map-hero-settings.js";
import type { MapFixedLighting } from "@lindocara/engine/map-lighting.js";
import type { MapWeather } from "@lindocara/engine/map-weather.js";
import { nativeHarvestEvents } from "@lindocara/engine/native-harvest.js";
import {
  nativeSceneryDimensionsOrDefault,
  proportionalNativeSceneryDimensions,
} from "@lindocara/engine/native-scenery.js";
import { inferStairsRun, type RampDirection } from "@lindocara/engine/tile-brush.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import {
  type CellOffset,
  type EditorAssetDefinition,
  type EditorAssetId,
  editorAsset,
  LINDOCARA_CHEST_CLOSED_ASSET_ID,
} from "@lindocara/engine/tiny-swords-catalog.js";
import {
  undergroundFloorHeight,
  undergroundRamp,
  undergroundStyleMaterial,
} from "@lindocara/engine/underground.js";
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
  adjustTerrainToolElevation,
  applyInteriorWallOpening,
  applyInteriorShellSetting,
  applyTool,
  beginEventDraft,
  canLinkDoorAt,
  commitEditorHistory,
  commitEventDraft,
  convertElementToEvent,
  createEditorHistory,
  deleteSelection,
  editorMapSize,
  eventCellAvailableAtDepth,
  isEditorHistoryDirty,
  markEditorHistorySaved,
  moveSelection,
  placedAssetId,
  placeLinkedTeleporters,
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
  updateSelectedElementScale,
  updateSelectedNativeSceneryDimensions,
  undergroundStairRequiredLength,
  undergroundStairPlacement,
} from "./editor-state.js";
import {
  authoredEventPreviewSnapshots,
  authoredMonsterPreviewSnapshots,
  authoredSeaGuardianPreviewSnapshots,
} from "./event-preview.js";

export interface MapEditorStageHandle {
  setTool(tool: EditorTool): void;
  /** Surface (`null`) or the underground storey edited by every existing tool. */
  setEditingDepth(depth: number | null): void;
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
  /** Configure the world-space cutaway envelope around this map. */
  setInteriorShell(environment: MapEnvironment, shell?: InteriorShell): void;
  setLighting(dayNightCycle: boolean, fixedLighting: MapFixedLighting): void;
  /** The map's authored weather. An edit like any other: it joins the undo history and pushes
   *  itself into the live scene, so the author sees the rain they just chose. */
  setWeather(weather: MapWeather): void;
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
  setSelectedElementScale(scale: number): boolean;
  setSelectedBridgeDimensions(dimensions: BridgeDimensions): boolean;
  setSelectedBuildingSettings(settings: BuildingSettings): boolean;
  setSelectedNativeSceneryDimensions(dimensions: BuildingDimensions): boolean;
  deleteSelected(): boolean;
  beginEventDraft(id: string): MapEvent | null;
  commitEventDraft(draft: MapEvent): void;
  deleteEvent(id: string): void;
  bindSelectedElement(binding: ElementEventBinding): string | null;
  highlightEvent(id: string | null): void;
  selectEvent(id: string): void;
  dispose(): void;
}

function supportsWheelElevation(tool: EditorTool): boolean {
  const content = tool.kind === "rect" || tool.kind === "fill" ? tool.content : tool;
  return content.kind === "elevation" || content.kind === "block";
}

export interface MapEditorStageState {
  /** Monotone rendered document revision; lets React inspectors refresh even when summary flags stay equal. */
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  selection: EditorSelection | null;
  placementRejectedAt: number | null;
  /** The first door of a door link, while the author is between its two clicks. Published so the
   *  palette can say which step it is on rather than leaving the author to guess whether the first
   *  click registered. */
  linkAnchor: { col: number; row: number } | null;
  /** First cell of an in-progress reciprocal teleporter placement. */
  pendingTeleportOrigin?: { col: number; row: number } | null;
  /** First wall edge of an in-progress variable-width opening. */
  wallOpeningAnchor?: InteriorShellOpeningRun | null;
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

function wallOpeningPoint(edge: InteriorShellOpeningRun, size: number): { x: number; z: number } {
  switch (edge.side) {
    case "north":
      return { x: edge.col + 0.5 - size / 2, z: edge.row - size / 2 };
    case "south":
      return { x: edge.col + 0.5 - size / 2, z: edge.row + 1 - size / 2 };
    case "east":
      return { x: edge.col + 1 - size / 2, z: edge.row + 0.5 - size / 2 };
    case "west":
      return { x: edge.col - size / 2, z: edge.row + 0.5 - size / 2 };
  }
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
  const dimensions = nativeSceneryDimensionsOrDefault(
    element.assetId,
    override ?? element.building?.dimensions ?? element.dimensions,
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
  const current = nativeSceneryDimensionsOrDefault(
    element.assetId,
    element.building?.dimensions ?? element.dimensions,
  );
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
  return proportionalNativeSceneryDimensions(element.assetId, axis, snapped);
}

/**
 * The cells a placement ghost outlines, as offsets from the anchor cell.
 *
 * A bridge takes them from `bridgePlacementLayout`, the authority that decides its footprint
 * everywhere else (`elementCells`, the heightfield bake, the resize gizmo), rather than from the
 * authored `visualFootprint` the two sprite-era cards carried. The two agree for a fresh 3x1 deck,
 * which is exactly why the drift would be invisible the day the default changes. Every other asset
 * keeps its authored footprint, which is its own truth.
 */
export function previewFootprintOffsets(
  asset: EditorAssetDefinition,
  col: number,
  row: number,
): readonly CellOffset[] {
  const layout = bridgePlacementLayout({ assetId: asset.id, col, row });
  if (!layout) return asset.editor.visualFootprint;
  const cells: CellOffset[] = [];
  for (let deckRow = 0; deckRow < layout.rows; deckRow += 1) {
    for (let deckCol = 0; deckCol < layout.cols; deckCol += 1) {
      cells.push({
        col: layout.startCol + deckCol - col,
        row: layout.startRow + deckRow - row,
      });
    }
  }
  return cells;
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

/**
 * The storage whose FOOT lands on a ground point. Now `elementFootStorage`'s only job, and this is
 * the wrapper that speaks tile units.
 *
 * Worth knowing why quest #26 existed at all: this inverse was already correct and already here,
 * and DRAGGING an element has always used it. Only first placement went the other way, through the
 * pointer's own quarter-cell, which is why moving a prop felt precise and putting one down did not.
 */
function placementAtGroundPoint(
  point: { x: number; z: number },
  mapSize: number,
): Pick<MapElement, "col" | "row" | "offsetX" | "offsetY"> {
  return elementFootStorage(
    (point.x + mapSize / 2) * TILE_SIZE,
    (point.z + mapSize / 2) * TILE_SIZE,
  );
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
    let editingDepth: number | null = null;
    let selected: EditorSelection | null = null;
    let highlightedEventId: string | null = null;
    let dim = defaultDimForMode(history.activeMode);
    let gridVisible = true;
    let collisionsVisible = false;
    let zoom = 100;
    let revision = 0;
    let placementRejections = 0;
    let pendingTeleportOrigin: { col: number; row: number } | null = null;
    let wallOpeningFrom: InteriorShellOpeningRun | null = null;
    let hover: { col: number; row: number; offsetX: number; offsetY: number } | null = null;
    let painting = false;
    let panning = false;
    let spaceHeld = false;
    let strokeStart: EditorMap | null = null;
    let rectangleWheelSteps = 0;
    let dragSelection: EditorSelection | null = null;
    // The first door of a pending link. Held here rather than on the map so the completed pair is
    // ONE `applyTool` call and therefore one undo step, and so a half-finished link can never be
    // serialized or make the map read as dirty. Cleared whenever the tool changes.
    let linkFrom: { col: number; row: number } | null = null;
    let resizeDrag:
      | {
          kind: "building";
          axis: BuildingResizeAxis;
          selection: Extract<EditorSelection, { kind: "element" }>;
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
    /**
     * Which ramp direction currently reads as "toward the right of the screen".
     *
     * The pan handler below IS the definition of that mapping: it rotates a screen drag into world
     * space with the yaw's cosine and sine, so the screen's right is the world vector
     * `(cos yaw, -sin yaw)`. With four directions to choose from, the preference is simply the one
     * whose own vector points most that way, which keeps the two-direction rule this replaced and
     * extends it honestly. A cell where several ramps genuinely fit (a trench, a pit) therefore
     * climbs toward the author's right whichever way they have turned the camera, instead of
     * snapping to a world axis that is off-screen.
     */
    const RAMP_VECTORS: Readonly<Record<RampDirection, { x: number; z: number }>> = {
      east: { x: 1, z: 0 },
      west: { x: -1, z: 0 },
      south: { x: 0, z: 1 },
      north: { x: 0, z: -1 },
    };
    const stairsPreference = (): RampDirection => {
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);
      let best: RampDirection = "east";
      let bestDot = Number.NEGATIVE_INFINITY;
      for (const [direction, vector] of Object.entries(RAMP_VECTORS) as [
        RampDirection,
        { x: number; z: number },
      ][]) {
        const dot = vector.x * rightX + vector.z * rightZ;
        if (dot > bestDot) {
          bestDot = dot;
          best = direction;
        }
      }
      return best;
    };
    /** What a click would actually apply: the palette's tool plus the state only the stage holds
     *  (the first door of a pending link, the camera-derived ramp preference). */
    const activeTool = (): EditorTool => {
      if (tool.kind === "link" && linkFrom) return { ...tool, from: linkFrom };
      if (tool.kind === "stairs") return { ...tool, prefer: stairsPreference() };
      return tool;
    };
    let disposed = false;
    let lastCursorKey = "";
    const visualEvents = (): MapEvent[] => [
      ...map.events.filter((event) => (event.undergroundDepth ?? null) === editingDepth),
      ...nativeHarvestEvents(
        map.elements.filter((element) => (element.undergroundDepth ?? null) === editingDepth),
        map.events.length + 1,
      ),
    ];
    let renderedEvents = authoredEventPreviewSnapshots(visualEvents(), "map-editor");
    let renderedMonsters: SceneSample["monsters"] = [];
    let renderedSeaGuardians: SceneSample["seaGuardians"] = [];

    const dimensions = () => editorMapSize(map);
    const selectedElement = (): MapElement | null => {
      if (selected?.kind !== "element") return null;
      const selection = selected;
      return map.elements.find((candidate) => sameElementSlot(candidate, selection)) ?? null;
    };
    const selectedBuildingElement = (): MapElement | null => {
      const element = selectedElement();
      return element && nativeSceneryDimensionsOrDefault(element.assetId) ? element : null;
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
      const size = Math.max(cols, rows);
      // A pending link owns the selection highlight: the first door IS what the author has picked,
      // and there is no element or event selection worth showing in the middle of the two clicks.
      const pendingLink = pendingTeleportOrigin ?? linkFrom;
      const focusSelection = wallOpeningFrom
        ? wallOpeningPoint(wallOpeningFrom, size)
        : pendingLink
          ? {
              x: pendingLink.col + 0.5 - size / 2,
              z: pendingLink.row + 0.5 - size / 2,
            }
          : highlightedEventId
            ? selectionPoint(map, { kind: "event", id: highlightedEventId })
            : selectionPoint(map, selected);
      const hoverPoint = hover
        ? history.activeMode === "element"
          ? authoredElementGroundPoint(hover, size)
          : { x: hover.col + 0.5 - size / 2, z: hover.row + 0.5 - size / 2 }
        : null;
      // The preview shows what the click would WRITE, not what the palette holds: a bridge takes its
      // orientation from the crossing under the cursor, so resolving it here is what makes the
      // ghosted deck turn as the pointer moves from a north-south river to an east-west one.
      const selectedAssetId = editorToolPreviewAssetId(tool);
      const previewAssetId =
        selectedAssetId && hover
          ? placedAssetId(map, selectedAssetId, hover.col, hover.row)
          : selectedAssetId;
      const previewAsset = previewAssetId ? editorAsset(previewAssetId) : null;
      const previewBridgeTop =
        hover && previewAssetId && tool.kind === "element" && bridgeOrientation(previewAssetId)
          ? authoredBridgeTop(
              { cols, rows },
              { ...hover, assetId: previewAssetId },
              heightfield.levels,
              size,
            )
          : undefined;
      const groundLayer = map.layers[0];
      const hoveredStairs =
        hover && tool.kind === "stairs" && groundLayer
          ? inferStairsRun(groundLayer, hover.col, hover.row, stairsPreference())
          : null;
      const hoveredUndergroundStair =
        hover && tool.kind === "underground" && tool.operation === "stairs"
          ? undergroundStairPlacement(map, tool, hover.col, hover.row, editingDepth)
          : null;
      const buildingResize = selectedBuildingGuide();
      const bridgeResize = selectedBridgeGuide();
      const rotation = selectedRotationGuide();
      const rect = derivedRect();
      const undergroundStamp =
        hover && tool.kind === "underground" && tool.operation !== "stairs"
          ? (() => {
              const shaftRect =
                (tool.operation === "shaft" || tool.operation === "fill") &&
                tool.shape === "rect" &&
                map.strokeAnchor
                  ? {
                      c0: Math.min(map.strokeAnchor.col, hover.col),
                      r0: Math.min(map.strokeAnchor.row, hover.row),
                      c1: Math.max(map.strokeAnchor.col, hover.col),
                      r1: Math.max(map.strokeAnchor.row, hover.row),
                    }
                  : null;
              const alongX = tool.direction === "east" || tool.direction === "west";
              const followsDirection = tool.operation === "tunnel";
              const requestedCols = followsDirection
                ? alongX
                  ? tool.length
                  : tool.width
                : tool.width;
              const requestedRows = followsDirection
                ? alongX
                  ? tool.width
                  : tool.length
                : tool.length;
              return {
                x: (shaftRect?.c0 ?? hover.col) - size / 2,
                z: (shaftRect?.r0 ?? hover.row) - size / 2,
                cols: shaftRect
                  ? shaftRect.c1 - shaftRect.c0 + 1
                  : Math.min(cols - hover.col, Math.max(1, Math.trunc(requestedCols))),
                rows: shaftRect
                  ? shaftRect.r1 - shaftRect.r0 + 1
                  : Math.min(rows - hover.row, Math.max(1, Math.trunc(requestedRows))),
                elevation: undergroundFloorHeight(tool.depth),
                operation: tool.operation,
              };
            })()
          : null;
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
        undergroundStamp,
        // The ghost shows the ramp the cell can actually take. Where none fits it still draws, at
        // the default orientation and marked invalid, which the overlay paints red: an author who
        // hovers a flat field or a north-south bank sees a refusal rather than nothing at all.
        stairsPreview:
          hover && tool.kind === "stairs"
            ? {
                ramps: hoveredStairs?.cells.map((cell) =>
                  authoredOneCellRamp(cell.col, cell.row, size, cell.direction, cell.lowLevel),
                ) ?? [authoredOneCellRamp(hover.col, hover.row, size, "east", 0)],
                valid: hoveredStairs !== null,
                levelHeight: heightfield.levelHeight,
              }
            : hover && tool.kind === "underground" && tool.operation === "stairs"
              ? {
                  ramps: [
                    undergroundRamp(
                      hoveredUndergroundStair ?? {
                        depth: Math.max(editingDepth ?? 0, Math.trunc(tool.depth)),
                        fromDepth: Math.min(editingDepth ?? 0, Math.trunc(tool.depth)),
                        col: hover.col,
                        row: hover.row,
                        direction: tool.direction,
                        length: undergroundStairRequiredLength(tool, editingDepth),
                        width: Math.max(1, Math.trunc(tool.width)),
                      },
                      size,
                    ),
                  ],
                  valid: hoveredUndergroundStair !== null,
                  levelHeight: heightfield.levelHeight,
                  material: undergroundStyleMaterial(tool.style),
                }
              : null,
        // Two shapes through one channel. With an asset it is the scenery ghost and its footprint;
        // WITHOUT one it is a bare validity cell, which is what a tool that places no art still owes
        // the author. The hero start point is the case that asked for it: its two guards (covered by
        // scenery, unwalkable) refuse most of a decorated map, and a refusal nobody can see coming
        // reads as a broken tool.
        assetPreview:
          hover && hoverPoint && (previewAsset || tool.kind === "spawn")
            ? {
                point: hoverPoint,
                footprint: previewAsset
                  ? previewFootprintOffsets(previewAsset, hover.col, hover.row).map((cell) => ({
                      x: hoverPoint.x + cell.col,
                      z: hoverPoint.z + cell.row,
                    }))
                  : [hoverPoint],
                valid: placementLegalAt(
                  tool,
                  map,
                  hover.col,
                  hover.row,
                  history.activeMode,
                  editingDepth,
                ),
                ...(previewBridgeTop === undefined ? {} : { elevation: previewBridgeTop }),
                ...(previewAsset?.editor.renderLayer === "sky"
                  ? { skyAltitude: authoredSkyAltitude(heightfield) }
                  : {}),
              }
            : null,
      });
    };

    const redraw = (contentOnly = false): void => {
      const heightfield = compiled();
      renderedEvents = authoredEventPreviewSnapshots(visualEvents(), "map-editor");
      renderedMonsters = authoredMonsterPreviewSnapshots(visualEvents(), heightfield);
      renderedSeaGuardians = authoredSeaGuardianPreviewSnapshots(
        visualEvents(),
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
        previous.interiorShell === map.interiorShell &&
        previous.underground === map.underground &&
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
        linkAnchor: linkFrom,
        pendingTeleportOrigin,
        wallOpeningAnchor: wallOpeningFrom,
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
      // Painting asks "which cell is the pointer in", and flooring answers it. Only an ELEMENT is
      // stored as a foot, and a foot is not the pointer's own cell.
      if (history.activeMode !== "element") return { col, row, offsetX: 0, offsetY: 0 };
      // A BRIDGE is not stored as a foot: `elementWorldColliderGeometry` keys its deck off
      // `startCol`/`startRow` with the quarter as a plain nudge, so the pointer's own cell is the
      // right answer and solving for a foot would slide the whole crossing a cell north, off the
      // bank it was aimed at.
      const previewed = editorToolPreviewAssetId(tool);
      if (previewed && bridgeOrientation(previewed)) {
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
      }
      // Quest #26: store the triple whose FOOT is nearest the pointer, rather than storing the
      // pointer's own quarter-cell and letting `elementFootPixel` read it back from a different
      // origin. The two are not inverses, and using one for the other put every ghost 0.375 cells
      // east and 0.875 cells south of the mouse, with the left half of each cell unreachable.
      const foot = placementAtGroundPoint(point, size);
      // A foot origin sits on its cell's far edge, so solving for it can land one cell outside the
      // map along the north and west borders. Clamping the whole quarter-step (rather than `col`
      // alone) keeps the nearest EXPRESSIBLE foot instead of refusing a placement the author could
      // make before, and it only ever bites in the outermost half cell.
      const clamp = (
        cell: number,
        offset: number,
        limit: number,
      ): { cell: number; offset: number } => {
        const step = Math.min(
          Math.max(cell * ELEMENT_OFFSET_STEPS + offset, 0),
          (limit - 1) * ELEMENT_OFFSET_STEPS + ELEMENT_OFFSET_STEPS - 1,
        );
        const clamped = Math.floor(step / ELEMENT_OFFSET_STEPS);
        return { cell: clamped, offset: step - clamped * ELEMENT_OFFSET_STEPS };
      };
      const horizontal = clamp(foot.col, foot.offsetX, cols);
      const vertical = clamp(foot.row, foot.offsetY, rows);
      return {
        col: horizontal.cell,
        row: vertical.cell,
        offsetX: horizontal.offset,
        offsetY: vertical.offset,
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
      // A passage is defined by two wall edges, not by the floor cell under the cursor. Handle it
      // before `placementAt`: an outer wall lies exactly on the document edge, whose far half is no
      // longer a floor cell. The first click anchors; the second writes one undoable span.
      if (tool.kind === "wall-opening") {
        if (!isStrokeStart) return;
        const shell = map.interiorShell;
        const point = renderer.screenToWorld(clientX, clientY);
        const heightfield = compiled();
        const edge =
          shell && point
            ? interiorShellOpeningEdgeAt(
                heightfield.size,
                heightfield.levels,
                heightfield.materials,
                shell,
                point.x,
                point.z,
                heightfield.liquidLevels,
              )
            : null;
        if (!edge) {
          placementRejections += 1;
          notify();
          return;
        }
        if (!wallOpeningFrom) {
          wallOpeningFrom = edge;
          selected = null;
          drawOverlay(heightfield);
          notify();
          return;
        }
        const opening = interiorShellOpeningBetween(wallOpeningFrom, edge);
        if (!opening) {
          placementRejections += 1;
          notify();
          return;
        }
        const previous = map;
        const next = applyInteriorWallOpening(map, opening, tool.operation);
        if (!next || next === map) {
          placementRejections += 1;
          notify();
          return;
        }
        map = next;
        wallOpeningFrom = null;
        strokeRedraw(previous);
        notify();
        return;
      }

      const placement = placementAt(clientX, clientY);
      if (!placement) return;
      const { col, row, offsetX, offsetY } = placement;
      const key = `${col},${row},${offsetX},${offsetY}`;
      if (key === lastPaintedKey) return;
      lastPaintedKey = key;

      if (
        isStrokeStart &&
        tool.kind === "event" &&
        tool.eventKind === "normal" &&
        tool.preset === "teleporter"
      ) {
        if (pendingTeleportOrigin === null) {
          if (
            !eventCellAvailableAtDepth(map, col, row, editingDepth) ||
            map.events.length > MAX_EVENTS_PER_MAP - 2 ||
            runtimeEventCount(map.events) > MAX_RUNTIME_EVENTS_PER_MAP - 2
          ) {
            placementRejections += 1;
            notify();
            return;
          }
          pendingTeleportOrigin = { col, row };
          selected = null;
          drawOverlay();
          notify();
          return;
        }
        const source = pendingTeleportOrigin;
        const next = placeLinkedTeleporters(map, tool, source, { col, row }, editingDepth);
        if (!next) {
          placementRejections += 1;
          notify();
          return;
        }
        const previous = map;
        map = next;
        pendingTeleportOrigin = null;
        const placed = map.events.find(
          (event) =>
            event.col === source.col &&
            event.row === source.row &&
            (event.undergroundDepth ?? null) === editingDepth,
        );
        if (placed) selected = { kind: "event", id: placed.id };
        strokeRedraw(previous);
        notify();
        return;
      }

      if (tool.kind === "select") {
        if (isStrokeStart) {
          dragSelection = selectionAtMode(
            map,
            col,
            row,
            history.activeMode,
            offsetX,
            offsetY,
            editingDepth,
          );
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
        const exists = map.events.find(
          (event) =>
            event.col === col &&
            event.row === row &&
            (event.undergroundDepth ?? null) === editingDepth,
        );
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

      // A link's FIRST click writes nothing: it only remembers the door, so the pair that lands on
      // the second click is one map change and one undo step. Clicking the same door again is how
      // an author changes their mind without leaving the tool.
      if (tool.kind === "link" && isStrokeStart) {
        if (linkFrom && linkFrom.col === col && linkFrom.row === row) {
          linkFrom = null;
          drawOverlay();
          notify();
          return;
        }
        if (!linkFrom) {
          if (!canLinkDoorAt(map, col, row)) {
            placementRejections += 1;
            notify();
            return;
          }
          linkFrom = { col, row };
          drawOverlay();
          notify();
          return;
        }
      }

      const next = applyTool(
        map,
        activeTool(),
        col,
        row,
        isStrokeStart,
        history.activeMode,
        offsetX,
        offsetY,
        editingDepth,
      );
      if (next === null) {
        // A refused stroke has to SAY so. `elevation` joined the list when the brushes went relative:
        // "-1" on ground level, or "+1" at the top of the range, now returns null rather than
        // painting the same slot again, and a brush that silently does nothing reads as broken.
        if (
          tool.kind === "element" ||
          tool.kind === "event" ||
          tool.kind === "link" ||
          tool.kind === "elevation" ||
          tool.kind === "spawn"
        ) {
          placementRejections += 1;
          notify();
        }
        return;
      }
      if (next === map) return;
      const previous = map;
      map = next;
      if (tool.kind === "rect" && rectangleWheelSteps !== 0 && strokeStart) {
        const direction = rectangleWheelSteps > 0 ? "raise" : "lower";
        for (let step = 0; step < Math.abs(rectangleWheelSteps); step += 1) {
          map = adjustTerrainToolElevation(map, tool, col, row, direction, strokeStart) ?? map;
        }
      }
      if (tool.kind === "event") {
        const placed = map.events.find((event) => event.col === col && event.row === row);
        if (placed) selected = { kind: "event", id: placed.id };
      }
      // The pair landed: the tool is ready for the next link rather than still holding a door the
      // author already spent.
      if (tool.kind === "link") linkFrom = null;
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
        next = sourceElement.building
          ? updateSelectedBuildingSettings(map, drag.selection, {
              ...sourceElement.building,
              dimensions: nextDimensions,
            })
          : updateSelectedNativeSceneryDimensions(map, drag.selection, nextDimensions);
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
      const currentDimensions = building
        ? nativeSceneryDimensionsOrDefault(
            building.assetId,
            building.building?.dimensions ?? building.dimensions,
          )
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
        building &&
        currentDimensions
      ) {
        resizeDrag = {
          kind: "building",
          axis: resize.axis,
          selection: selected,
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
      rectangleWheelSteps = 0;
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
      rectangleWheelSteps = 0;
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
      if (painting && strokeStart && event.deltaY !== 0) {
        const placement = placementAt(event.clientX, event.clientY);
        const direction = event.deltaY < 0 ? "raise" : "lower";
        const terrainTool = activeTool();
        if (supportsWheelElevation(terrainTool)) {
          if (!placement) return;
          const next = adjustTerrainToolElevation(
            map,
            terrainTool,
            placement.col,
            placement.row,
            direction,
            strokeStart,
          );
          if (next && next !== map) {
            const previous = map;
            map = next;
            if (tool.kind === "rect") rectangleWheelSteps += direction === "raise" ? 1 : -1;
            strokeRedraw(previous);
            notify();
          }
          return;
        }
      }
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoom = Math.max(2, Math.min(250, zoom * factor));
      renderer.setCameraZoom(zoom);
      onZoomChange?.(Math.round(zoom));
    };

    const onDoubleClick = (event: MouseEvent): void => {
      const placement = placementAt(event.clientX, event.clientY);
      if (!placement) return;
      const eventAtCell = map.events.find(
        (candidate) =>
          candidate.col === placement.col &&
          candidate.row === placement.row &&
          (candidate.undergroundDepth ?? null) === editingDepth,
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
            editingDepth,
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
        {
          ...EMPTY_SAMPLE,
          seaGuardians: renderedSeaGuardians,
          monsters: renderedMonsters,
          events: renderedEvents,
        },
        { now } as RenderContext,
      );
    });
    centreCamera();
    redraw();
    notify();

    const handle: MapEditorStageHandle = {
      setTool(next) {
        pendingTeleportOrigin = null;
        tool = next;
        // A door picked under the link tool means nothing under any other tool, and a stale anchor
        // would silently pair the author's next link with a door they picked minutes ago.
        if (next.kind !== "link") linkFrom = null;
        wallOpeningFrom = null;
        renderer.setEditorPreviewAsset(editorToolPreviewAssetId(tool));
        refreshCursor();
        drawOverlay();
        notify();
      },
      setEditingDepth(depth) {
        // A two-click placement may never bridge two vertical planes accidentally. Changing the
        // viewed storey cancels its first endpoint just like changing tools or modes does.
        pendingTeleportOrigin = null;
        linkFrom = null;
        editingDepth =
          depth === null
            ? null
            : Math.max(-16, Math.min(16, Math.trunc(depth) || (depth < 0 ? -1 : 1)));
        selected = null;
        renderedEvents = authoredEventPreviewSnapshots(visualEvents(), "map-editor");
        const heightfield = compiled();
        renderedMonsters = authoredMonsterPreviewSnapshots(visualEvents(), heightfield);
        renderedSeaGuardians = authoredSeaGuardianPreviewSnapshots(
          visualEvents(),
          heightfield.size,
          heightfield.waterLevel,
        );
        renderer.setUndergroundDepth?.(editingDepth);
        refreshCursor();
        drawOverlay();
        notify();
      },
      setActiveMode(mode) {
        pendingTeleportOrigin = null;
        if (mode !== "field") wallOpeningFrom = null;
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
      setInteriorShell(environment, shell) {
        const interiorShell = environment === "interior" ? shell : undefined;
        if (
          environment === map.environment &&
          JSON.stringify(interiorShell) === JSON.stringify(map.interiorShell)
        ) {
          return;
        }
        const previous = map;
        const next = applyInteriorShellSetting(map, environment, interiorShell);
        history = commitEditorHistory({ ...history, present: map }, next);
        map = next;
        redrawMapChange(previous);
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
      setWeather(weather) {
        if (weather === (map.weather ?? "none")) return;
        const next = { ...map, weather };
        history = commitEditorHistory({ ...history, present: map }, next);
        map = next;
        renderer.setWeather?.(weather);
        notify();
      },
      undo() {
        stopStroke();
        const cancelledTeleport = pendingTeleportOrigin !== null || wallOpeningFrom !== null;
        pendingTeleportOrigin = null;
        wallOpeningFrom = null;
        const previousRect = derivedRect();
        const next = undoEditorHistory(history);
        if (next === history) {
          if (cancelledTeleport) {
            drawOverlay();
            notify();
          }
          return;
        }
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
        const cancelledTeleport = pendingTeleportOrigin !== null || wallOpeningFrom !== null;
        pendingTeleportOrigin = null;
        wallOpeningFrom = null;
        const previousRect = derivedRect();
        const next = redoEditorHistory(history);
        if (next === history) {
          if (cancelledTeleport) {
            drawOverlay();
            notify();
          }
          return;
        }
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
      setSelectedElementScale(scale) {
        if (selected?.kind !== "element") return false;
        return commitInspectorChange(updateSelectedElementScale(map, selected, scale));
      },
      setSelectedBridgeDimensions(dimensions) {
        if (selected?.kind !== "element") return false;
        return commitInspectorChange(updateSelectedBridgeDimensions(map, selected, dimensions));
      },
      setSelectedBuildingSettings(settings) {
        if (selected?.kind !== "element") return false;
        return commitInspectorChange(updateSelectedBuildingSettings(map, selected, settings));
      },
      setSelectedNativeSceneryDimensions(dimensions) {
        if (selected?.kind !== "element") return false;
        return commitInspectorChange(
          updateSelectedNativeSceneryDimensions(map, selected, dimensions),
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
