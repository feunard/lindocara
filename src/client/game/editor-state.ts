/** Pure map-editor mutations. Placement, footprints and collision all come from the shared
 * catalogue, so the browser and authoritative map API cannot disagree. */
import {
  bakeCollision,
  canPlaceElement,
  elementCoversCell,
  elementFitsMap,
  elementPlacementCells,
  elementsOverlap,
  MAX_MAP_ELEMENTS,
  type MapData,
  type MapElement,
} from "../../shared/map-data.js";
import { isSolidKind, kindAt } from "../../shared/tilemap.js";
import type { EditorAssetId } from "../../shared/tiny-swords-catalog.js";

export interface EditorMap {
  name: string;
  blocks: string[];
  elements: MapElement[];
  spawn: { col: number; row: number };
}

export type EditorTool =
  | { kind: "block"; block: "grass" | "water" }
  | { kind: "element"; assetId: EditorAssetId }
  | { kind: "eraser" }
  | { kind: "spawn" }
  | { kind: "pan" };

const BLOCK_CHAR: Record<"grass" | "water", string> = { grass: ".", water: "#" };

export function blankMap(name: string, cols: number, rows: number): EditorMap {
  const blocks = Array.from({ length: rows }, () => ".".repeat(cols));
  return {
    name,
    blocks,
    elements: [],
    spawn: { col: Math.floor(cols / 2), row: Math.floor(rows / 2) },
  };
}

function toMapData(map: EditorMap): MapData {
  return { blocks: map.blocks, elements: map.elements, spawn: map.spawn };
}

function isWalkableCell(map: EditorMap, col: number, row: number): boolean {
  return !isSolidKind(kindAt(bakeCollision(toMapData(map)), col, row));
}

function withBlock(blocks: string[], col: number, row: number, char: string): string[] {
  return blocks.map((line, r) =>
    r === row ? line.slice(0, col) + char + line.slice(col + 1) : line,
  );
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

function placementTerrainValid(map: EditorMap, element: MapElement): boolean {
  const ground = bakeCollision({ blocks: map.blocks, elements: [], spawn: map.spawn });
  if (!elementFitsMap(element, ground.cols, ground.rows)) return false;
  // Every occupied visual cell must satisfy the asset's catalogue terrain rule. This also validates
  // multi-cell buildings and both bridge orientations, rather than checking only their anchor.
  return elementPlacementCells(element).every((cell) =>
    canPlaceElement(element.assetId, kindAt(ground, cell.col, cell.row)),
  );
}

export function applyTool(
  map: EditorMap,
  tool: EditorTool,
  col: number,
  row: number,
): EditorMap | null {
  const rows = map.blocks.length;
  const cols = map.blocks[0]?.length ?? 0;
  if (col < 0 || row < 0 || col >= cols || row >= rows) return null;

  switch (tool.kind) {
    case "block": {
      const blocks = withBlock(map.blocks, col, row, BLOCK_CHAR[tool.block]);
      const candidate: EditorMap = { ...map, blocks };
      const elements = candidate.elements.filter(
        (element) =>
          !elementCoversCell(element, col, row) || placementTerrainValid(candidate, element),
      );
      const next = { ...candidate, elements };
      return keepsSpawnClear(next) ? next : null;
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
      return keepsSpawnClear(next) ? next : null;
    }
    case "eraser": {
      const elements = withoutElementAt(map.elements, col, row);
      return elements.length === map.elements.length ? map : { ...map, elements };
    }
    case "spawn": {
      if (map.elements.some((element) => elementCoversCell(element, col, row))) return null;
      if (!isWalkableCell(map, col, row)) return null;
      return { ...map, spawn: { col, row } };
    }
    case "pan":
      return map;
    default:
      throw new Error(`unknown editor tool: ${JSON.stringify(tool)}`);
  }
}
