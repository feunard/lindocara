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
  MAX_MAP_ELEMENTS,
  MAX_MAP_ENTRIES,
  MAX_MAP_EXITS,
  MAX_MAP_MONSTER_SPAWNS,
  MAX_PATROL_RADIUS,
  type MapData,
  type MapElement,
  type MapMarkers,
  MIN_PATROL_RADIUS,
} from "../../shared/map-data.js";
import { isSolidKind, kindAt } from "../../shared/tilemap.js";
import type { EditorAssetId } from "../../shared/tiny-swords-catalog.js";

export interface EditorMap {
  name: string;
  blocks: string[];
  elements: MapElement[];
  spawn: { col: number; row: number };
  markers: MapMarkers;
}

export type EditorTool =
  | { kind: "block"; block: "grass" | "water" }
  | { kind: "element"; assetId: EditorAssetId }
  | { kind: "eraser" }
  | { kind: "spawn" }
  | { kind: "pan" }
  | { kind: "marker-entry" }
  | { kind: "marker-exit" }
  | { kind: "marker-monster"; species: MonsterSpecies; patrolRadius: number };

const BLOCK_CHAR: Record<"grass" | "water", string> = { grass: ".", water: "#" };

export function blankMap(name: string, cols: number, rows: number): EditorMap {
  const blocks = Array.from({ length: rows }, () => ".".repeat(cols));
  return {
    name,
    blocks,
    elements: [],
    spawn: { col: Math.floor(cols / 2), row: Math.floor(rows / 2) },
    markers: EMPTY_MARKERS,
  };
}

function toMapData(map: EditorMap): MapData {
  return { blocks: map.blocks, elements: map.elements, spawn: map.spawn, markers: map.markers };
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
      return keepsSpawnClear(next) && keepsMarkersValid(next) ? next : null;
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
      return untouched ? map : { ...map, elements, markers: { entries, exits, monsterSpawns } };
    }
    case "spawn": {
      if (map.elements.some((element) => elementCoversCell(element, col, row))) return null;
      if (!isWalkableCell(map, col, row)) return null;
      const next = { ...map, spawn: { col, row } };
      return keepsMarkersValid(next) ? next : null;
    }
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
