/**
 * One-way authoring compiler: the dense tile-editor document becomes the heightfield document the
 * game stores, validates, collides against and renders.
 *
 * This is deliberately not a runtime fallback. Creator tools and bundle importers call it before
 * writing a map; a world room still refuses a row whose `heightfield` column is absent. Keeping the
 * crossing here gives the editor its mature brush/event model without teaching the shipped client
 * about the retired Pixi/tile render path.
 */

import { bridgeDimensionsOrDefault, bridgeOrientation, bridgePlacementLayout } from "../bridges.js";
import { buildingArchetype, buildingVolumeDimensions } from "../buildings.js";
import { isNativeHarvestAsset } from "../harvest-presets.js";
import {
  type MapData as AuthoredMapData,
  ELEMENT_OFFSET_PX,
  elementWorldCollider,
  elementWorldColliderGeometry,
  type MapElement,
} from "../map-data.js";
import type { MapEvent } from "../map-events.js";
import {
  type StairsDirection,
  type StairsLowLevel,
  stairsDescriptor,
  stairsTilePlacements,
} from "../tile-brush.js";
import { TILE_SIZE } from "../tilemap.js";
import { decodeTileId, fixedId } from "../tileset.js";
import { elevationOfSlot, materialOfSlot } from "../tilesets/tiny-swords.js";
import { editorAsset, editorAssetCollisionElevation } from "../tiny-swords-catalog.js";
import type { ColliderRect } from "./collider-index.js";
import type { MapData } from "./map-data.js";
import type { TerrainMaterial, TerrainRamp } from "./terrain-query.js";

export const AUTHORED_LEVEL_HEIGHT = 0.9;
export const AUTHORED_WATER_LEVEL = -0.05;
const BRIDGE_RAIL_THICKNESS = 0.11;
const BUILDING_PARAPET_TOP = 0.37;
const RECTANGULAR_PARAPET_THICKNESS = 0.22;
const ROUND_PARAPET_SEGMENTS = 12;

function groundCoordinate(pixels: number, size: number): number {
  return pixels / TILE_SIZE - size / 2;
}

/** Project an authored decor anchor onto the HD-2D ground.
 *
 * The element's stored cell is its visual footprint cell: its foot is centred on X and planted on
 * the cell's lower Z edge before quarter-cell offsets are applied. The compiler and the editor's
 * hover/selection overlays must share this projection or the prop jumps when it is committed. */
export function authoredElementGroundPoint(
  element: Pick<MapElement, "col" | "row" | "offsetX" | "offsetY">,
  size: number,
): { x: number; z: number } {
  return {
    x: element.col + 0.5 + (element.offsetX * ELEMENT_OFFSET_PX) / TILE_SIZE - size / 2,
    z: element.row + 1 + (element.offsetY * ELEMENT_OFFSET_PX) / TILE_SIZE - size / 2,
  };
}

/** Visual centre of a compiled element. New bridge documents carry their dimensions and use the
 * centre of that whole deck; old heightfields omit dimensions and retain the legacy anchor path. */
function authoredElementRenderPoint(element: MapElement, size: number): { x: number; z: number } {
  const bridge = bridgePlacementLayout(element);
  if (!bridge) return authoredElementGroundPoint(element, size);
  return {
    x:
      bridge.startCol +
      (element.offsetX * ELEMENT_OFFSET_PX) / TILE_SIZE +
      bridge.cols / 2 -
      size / 2,
    z:
      bridge.startRow +
      (element.offsetY * ELEMENT_OFFSET_PX) / TILE_SIZE +
      bridge.rows / 2 -
      size / 2,
  };
}

function authoredLevel(id: number): number | null {
  const tile = decodeTileId(id);
  if (tile.kind === "empty") return null;
  if (tile.kind === "autotile") {
    const elevation = elevationOfSlot(tile.slot);
    return elevation < 0 ? 0 : elevation;
  }
  // Fixed ground art is uncommon (ramps live on the wall layer), but a valid fixed tile is land,
  // never an invisible hole. Its supporting elevation remains the ground layer's base level.
  return 0;
}

function authoredMaterial(id: number): TerrainMaterial {
  const tile = decodeTileId(id);
  return tile.kind === "autotile" ? materialOfSlot(tile.slot) : "herbe";
}

/** Whether an authored editor cell compiles to open water in the shipped heightfield. */
export function isAuthoredWaterCell(
  authored: Pick<AuthoredMapData, "cols" | "rows" | "layers">,
  col: number,
  row: number,
): boolean {
  if (col < 0 || row < 0 || col >= authored.cols || row >= authored.rows) return false;
  const ground = authored.layers[0];
  return authoredLevel(ground?.ids[row * authored.cols + col] ?? 0) === null;
}

/** The world-space ramp both committed stairs and the editor's pointer ghost use. */
export function authoredStairsRamp(
  col: number,
  row: number,
  size: number,
  direction: StairsDirection,
  lowLevel: StairsLowLevel,
): TerrainRamp {
  const parts = stairsTilePlacements(direction, lowLevel);
  const minCol = Math.min(...parts.map((part) => col + part.col));
  const maxCol = Math.max(...parts.map((part) => col + part.col));
  const minRow = Math.min(...parts.map((part) => row + part.row));
  const maxRow = Math.max(...parts.map((part) => row + part.row));
  return {
    x: minCol - size / 2,
    z: minRow - size / 2,
    width: maxCol - minCol + 1,
    depth: maxRow - minRow + 1,
    direction,
    lowLevel,
  };
}

function authoredRamps(authored: AuthoredMapData, size: number): TerrainRamp[] {
  const walls = authored.layers[1];
  if (!walls) return [];
  const ramps: TerrainRamp[] = [];
  for (let row = 0; row < authored.rows; row += 1) {
    for (let col = 0; col < authored.cols; col += 1) {
      const ref = decodeTileId(walls.ids[row * authored.cols + col] ?? 0);
      if (ref.kind !== "fixed") continue;
      const descriptor = stairsDescriptor(ref.index);
      if (descriptor?.part !== "low") continue;
      const complete = stairsTilePlacements(descriptor.direction, descriptor.lowLevel).every(
        (part) =>
          walls.ids[(row + part.row) * authored.cols + col + part.col] === fixedId(part.fixedIndex),
      );
      if (!complete) continue;
      ramps.push(authoredStairsRamp(col, row, size, descriptor.direction, descriptor.lowLevel));
    }
  }
  return ramps;
}

/** Select a bridge deck's bank elevation from its two ends, never from unrelated terrain beside it. */
export function authoredBridgeTop(
  authored: Pick<AuthoredMapData, "cols" | "rows">,
  element: MapElement,
  levels: readonly (number | null)[],
  size: number,
): number {
  const orientation = bridgeOrientation(element.assetId);
  const collider = elementWorldColliderGeometry(element);
  if (!orientation || !collider) return 0;
  const centreX = collider.x + collider.width / 2;
  const centreY = collider.y + collider.height / 2;
  const rotation = collider.rotation;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const length = orientation === "horizontal" ? collider.width : collider.height;
  const width = orientation === "horizontal" ? collider.height : collider.width;
  const samples = Math.max(1, Math.ceil(width / TILE_SIZE));
  const bankLevels: [Set<number>, Set<number>] = [new Set(), new Set()];
  for (const [bankIndex, direction] of [-1, 1].entries()) {
    const bank = bankLevels[bankIndex];
    if (!bank) continue;
    for (let sample = 0; sample < samples; sample += 1) {
      const across = -width / 2 + ((sample + 0.5) * width) / samples;
      const along = direction * (length / 2 + TILE_SIZE * 0.25);
      const localX = orientation === "horizontal" ? along : across;
      const localY = orientation === "horizontal" ? across : along;
      const worldX = centreX + localX * cos - localY * sin;
      const worldY = centreY + localX * sin + localY * cos;
      const col = Math.floor(worldX / TILE_SIZE);
      const row = Math.floor(worldY / TILE_SIZE);
      if (col < 0 || row < 0 || col >= authored.cols || row >= authored.rows) continue;
      const level = levels[row * size + col] ?? null;
      if (level !== null) bank.add(level);
    }
  }
  const shared = [...bankLevels[0]].filter((level) => bankLevels[1].has(level));
  const candidates = shared.length > 0 ? shared : [...bankLevels[0], ...bankLevels[1]];
  // A bridge between equal raised banks selects that shared level. With incomplete banks, preferring
  // the highest endpoint avoids the former pull toward the much larger level-0 area below a cliff.
  const level = candidates.length > 0 ? Math.max(...candidates) : 0;
  return level * AUTHORED_LEVEL_HEIGHT;
}

function bridgeRails(
  collider: ColliderRect,
  deckTop: number,
  orientation: "horizontal" | "vertical",
): ColliderRect[] {
  const top = deckTop + AUTHORED_LEVEL_HEIGHT;
  if (orientation === "horizontal") {
    return [
      orientedSubCollider(collider, 0, 0, collider.w, BRIDGE_RAIL_THICKNESS, { top }),
      orientedSubCollider(
        collider,
        0,
        collider.h - BRIDGE_RAIL_THICKNESS,
        collider.w,
        BRIDGE_RAIL_THICKNESS,
        { top },
      ),
    ];
  }
  return [
    orientedSubCollider(collider, 0, 0, BRIDGE_RAIL_THICKNESS, collider.h, { top }),
    orientedSubCollider(
      collider,
      collider.w - BRIDGE_RAIL_THICKNESS,
      0,
      BRIDGE_RAIL_THICKNESS,
      collider.h,
      { top },
    ),
  ];
}

function orientedSubCollider(
  parent: ColliderRect,
  offsetX: number,
  offsetZ: number,
  w: number,
  h: number,
  extra: Pick<ColliderRect, "top" | "support"> = {},
): ColliderRect {
  const rotation = parent.rotation ?? 0;
  if (rotation === 0) {
    const precise = (value: number): number => Math.round(value * 1e12) / 1e12;
    return { x: precise(parent.x + offsetX), z: precise(parent.z + offsetZ), w, h, ...extra };
  }
  const parentCx = parent.x + parent.w / 2;
  const parentCz = parent.z + parent.h / 2;
  const localCx = parent.x + offsetX + w / 2;
  const localCz = parent.z + offsetZ + h / 2;
  const dx = localCx - parentCx;
  const dz = localCz - parentCz;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const cx = parentCx + dx * cos - dz * sin;
  const cz = parentCz + dx * sin + dz * cos;
  return { x: cx - w / 2, z: cz - h / 2, w, h, ...(rotation ? { rotation } : {}), ...extra };
}

function elementBaseTop(
  element: Pick<MapElement, "col" | "row">,
  levels: readonly (number | null)[],
  size: number,
): number {
  const level = levels[element.row * size + element.col] ?? null;
  return level === null ? AUTHORED_WATER_LEVEL : level * AUTHORED_LEVEL_HEIGHT;
}

function buildingRoofCollider(
  collider: Pick<ColliderRect, "x" | "z" | "w" | "h">,
  element: MapElement,
  base: number,
): ColliderRect | null {
  const archetype = buildingArchetype(element.assetId);
  if (!archetype) return null;
  const volume = buildingVolumeDimensions(archetype, element.building?.dimensions);
  const eave = base + volume.wallHeight;
  const peak = eave + volume.roofHeight;
  if (volume.roofShape === "gable") {
    return {
      ...collider,
      support: "center",
      // `top` remains the maximum for old readers; current movement samples `surface` locally.
      top: peak,
      surface: {
        shape: "gable",
        eave,
        peak,
        axis: element.rotation === undefined && (element.orientation ?? 0) % 2 === 1 ? "z" : "x",
      },
    };
  }
  if (volume.roofShape === "cone") {
    return {
      ...collider,
      support: "center",
      top: peak,
      footprint: "ellipse",
      surface: { shape: "cone", eave, peak },
    };
  }
  return {
    ...collider,
    support: "center",
    // CircleGeometry is placed directly on the tower wall; fortress decks are 0.12 high and
    // centred 0.03 above it, hence their visible walking face is wallHeight + 0.09.
    top: eave + (archetype === "tower" ? 0.02 : 0.09),
    ...(archetype === "tower" ? { footprint: "ellipse" as const } : {}),
  };
}

/** Solid roof-edge volumes generated from the same crenellated archetype and resized footprint as
 * the rendered battlements. Rectangular roofs use four continuous parapets; round towers use the
 * renderer's twelve crenellation positions so their open deck stays circular. */
function buildingRoofEdgeColliders(
  collider: ColliderRect,
  element: MapElement,
  base: number,
): ColliderRect[] {
  const archetype = buildingArchetype(element.assetId);
  if (!archetype) return [];
  const asset = editorAsset(element.assetId);
  if (asset?.tags.some((tag) => tag === "construction" || tag.includes("inconstruction"))) {
    return [];
  }
  const volume = buildingVolumeDimensions(archetype, element.building?.dimensions);
  if (volume.roofShape !== "crenellated") return [];
  const top = base + volume.wallHeight + BUILDING_PARAPET_TOP;

  if (archetype !== "tower") {
    const legacyQuarterTurn =
      element.rotation === undefined && (element.orientation ?? 0) % 2 === 1;
    const thicknessX =
      collider.w *
      (legacyQuarterTurn
        ? RECTANGULAR_PARAPET_THICKNESS / 2.375
        : RECTANGULAR_PARAPET_THICKNESS / 3);
    const thicknessZ =
      collider.h *
      (legacyQuarterTurn
        ? RECTANGULAR_PARAPET_THICKNESS / 3
        : RECTANGULAR_PARAPET_THICKNESS / 2.375);
    return [
      orientedSubCollider(collider, 0, 0, collider.w, thicknessZ, { top, support: "center" }),
      orientedSubCollider(collider, 0, collider.h - thicknessZ, collider.w, thicknessZ, {
        top,
        support: "center",
      }),
      orientedSubCollider(collider, 0, 0, thicknessX, collider.h, { top, support: "center" }),
      orientedSubCollider(collider, collider.w - thicknessX, 0, thicknessX, collider.h, {
        top,
        support: "center",
      }),
    ];
  }

  const centreX = collider.x + collider.w / 2;
  const centreZ = collider.z + collider.h / 2;
  const radiusX = collider.w / 2;
  const radiusZ = collider.h / 2;
  const battlementWidth = 0.32 * radiusX;
  const battlementDepth = 0.28 * radiusZ;
  return Array.from({ length: ROUND_PARAPET_SEGMENTS }, (_, index) => {
    const angle = (index / ROUND_PARAPET_SEGMENTS) * Math.PI * 2;
    if (element.rotation !== undefined) {
      const parentRotation = collider.rotation ?? 0;
      const localX = Math.sin(angle) * radiusX * 0.93;
      const localZ = Math.cos(angle) * radiusZ * 0.93;
      const cos = Math.cos(parentRotation);
      const sin = Math.sin(parentRotation);
      const x = centreX + localX * cos - localZ * sin;
      const z = centreZ + localX * sin + localZ * cos;
      return {
        x: x - battlementWidth / 2,
        z: z - battlementDepth / 2,
        w: battlementWidth,
        h: battlementDepth,
        rotation: parentRotation - angle,
        top,
        support: "center" as const,
      };
    }
    const halfWidth =
      (Math.abs(Math.cos(angle)) * battlementWidth + Math.abs(Math.sin(angle)) * battlementDepth) /
      2;
    const halfDepth =
      (Math.abs(Math.sin(angle)) * battlementWidth + Math.abs(Math.cos(angle)) * battlementDepth) /
      2;
    const x = centreX + Math.sin(angle) * radiusX * 0.93;
    const z = centreZ + Math.cos(angle) * radiusZ * 0.93;
    return {
      x: x - halfWidth,
      z: z - halfDepth,
      w: halfWidth * 2,
      h: halfDepth * 2,
      top,
      support: "center" as const,
    };
  });
}

/**
 * Compile one authored scenery footprint into finite world volumes. Buildings use the same native
 * dimensions as their rendered mesh, so pitched and round roofs are real surfaces rather than a
 * flat plate cutting through the visible architecture.
 */
export function authoredElementColliders(
  authored: Pick<AuthoredMapData, "cols" | "rows">,
  element: MapElement,
  levels: readonly (number | null)[],
  size: number,
): ColliderRect[] {
  const exact = elementWorldColliderGeometry(element);
  const legacy = element.rotation === undefined ? elementWorldCollider(element) : null;
  const rect = legacy ? { ...legacy, rotation: 0 } : exact;
  const asset = editorAsset(element.assetId);
  if (!rect) return [];
  const collider = {
    x: groundCoordinate(rect.x, size),
    z: groundCoordinate(rect.y, size),
    w: rect.width / TILE_SIZE,
    h: rect.height / TILE_SIZE,
    ...(rect.rotation ? { rotation: rect.rotation } : {}),
  };
  if (asset?.editor.terrainOverride === "walkable") {
    const top = authoredBridgeTop(authored, element, levels, size);
    const orientation = bridgeOrientation(element.assetId);
    if (!orientation) return [];
    return [{ ...collider, top }, ...bridgeRails(collider, top, orientation)];
  }
  const roof = buildingRoofCollider(collider, element, elementBaseTop(element, levels, size));
  if (roof) {
    return [
      roof,
      ...buildingRoofEdgeColliders(collider, element, elementBaseTop(element, levels, size)),
    ];
  }
  const elevation = asset ? editorAssetCollisionElevation(asset) : null;
  return elevation === null
    ? [collider]
    : [
        {
          ...collider,
          top: elementBaseTop(element, levels, size) + elevation * AUTHORED_LEVEL_HEIGHT,
        },
      ];
}

function authoredContent(
  authored: AuthoredMapData,
  events: readonly MapEvent[],
  levels: readonly (number | null)[],
  size: number,
): Pick<MapData, "colliders" | "elements" | "events" | "spawns"> {
  // Native resources are live world events: keeping a static copy here would draw the intact asset
  // over its depleted state and leave an immortal collider behind after harvesting.
  const staticElements = authored.elements.filter(
    (element) => !isNativeHarvestAsset(element.assetId),
  );
  return {
    colliders: staticElements.flatMap((element) =>
      authoredElementColliders(authored, element, levels, size),
    ),
    spawns: [
      {
        name: "default",
        x: authored.spawn.col + 0.5 - size / 2,
        z: authored.spawn.row + 0.5 - size / 2,
      },
    ],
    elements: staticElements.map((element) => ({
      assetId: element.assetId,
      ...authoredElementRenderPoint(element, size),
      ...(element.orientation ? { orientation: element.orientation } : {}),
      ...(element.rotation === undefined ? {} : { rotation: element.rotation }),
      ...(bridgeOrientation(element.assetId)
        ? { bridge: bridgeDimensionsOrDefault(element.bridge) }
        : {}),
      ...(element.building?.dimensions ? { building: element.building.dimensions } : {}),
    })),
    events: events.map((event) => ({
      id: event.id,
      x: event.col + 0.5 - size / 2,
      z: event.row + 0.5 - size / 2,
      graphicAssetId: event.pages[0]?.graphicAssetId ?? null,
    })),
  };
}

/** Compile one validated editor map and its full authored event documents into heightfield bytes. */
export function compileAuthoredMap(
  authored: AuthoredMapData,
  events: readonly MapEvent[] = [],
): MapData {
  const size = Math.max(authored.cols, authored.rows);
  const cells = size * size;
  const levels: Array<number | null> = new Array<number | null>(cells).fill(null);
  const materials = new Array<TerrainMaterial>(cells).fill("herbe");
  const ground = authored.layers[0];

  for (let row = 0; row < authored.rows; row += 1) {
    for (let col = 0; col < authored.cols; col += 1) {
      const index = row * size + col;
      const id = ground?.ids[row * authored.cols + col] ?? 0;
      levels[index] = authoredLevel(id);
      materials[index] = authoredMaterial(id);
    }
  }

  return {
    version: 1,
    environment: authored.environment ?? "exterior",
    size,
    levelHeight: AUTHORED_LEVEL_HEIGHT,
    waterLevel: AUTHORED_WATER_LEVEL,
    levels,
    materials,
    ramps: authoredRamps(authored, size),
    ...authoredContent(authored, events, levels, size),
  };
}

/**
 * Recompile the authored facts that can change without touching terrain geometry. The editor uses
 * this for scenery, building, bridge, spawn and event edits so a 256x256 working canvas does not
 * rescan every ground cell merely because one prop moved. A size mismatch falls back to the full
 * compiler because the previous row-major terrain arrays no longer fit.
 */
export function compileAuthoredMapContent(
  authored: AuthoredMapData,
  terrain: MapData,
  events: readonly MapEvent[] = [],
): MapData {
  const size = Math.max(authored.cols, authored.rows);
  if (terrain.size !== size) return compileAuthoredMap(authored, events);
  return {
    ...terrain,
    ...authoredContent(authored, events, terrain.levels, size),
  };
}
