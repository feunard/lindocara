/**
 * The browser editor's rulebook — and only that. Every placement decision here is answered by
 * calling the exact same functions `validateMapInput` (server/maps.ts) calls: `ELEMENT_RULES`
 * (indirectly, through `canPlaceElement`), `bakeCollision`, `isSolidKind`, `kindAt`. Retyping any
 * of those rules here would let the editor preview one answer and the server enforce another —
 * exactly the "two copies that should agree" trap `shared/simulation.ts` exists to avoid for
 * movement.
 *
 * `applyTool` is pure copy-and-mutate: a change returns a new `EditorMap` and leaves the one it
 * was given untouched, a no-op (the eraser on an empty cell) returns the SAME reference, and a
 * refused edit returns `null`. Callers can tell all three apart without inspecting content.
 */
import {
  bakeCollision,
  canPlaceElement,
  type ElementKind,
  type MapData,
  type MapElement,
} from "../../shared/map-data.js";
import { isSolidKind, kindAt } from "../../shared/tilemap.js";

export interface EditorMap {
  name: string;
  blocks: string[];
  elements: MapElement[];
  spawn: { col: number; row: number };
}

export type EditorTool =
  | { kind: "block"; block: "grass" | "water" }
  | { kind: "element"; element: ElementKind; variant: number }
  | { kind: "eraser" }
  | { kind: "spawn" };

/** The only two block characters a map may contain (see `shared/tilemap-codec.ts`). */
const BLOCK_CHAR: Record<"grass" | "water", string> = { grass: ".", water: "#" };

/** All grass, spawn at the centre — the same starting point every new map gets. */
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

/** Walkability of one cell in a candidate map's FULL bake — ground plus colliding elements,
 *  exactly what a hero would actually stand on. */
function isWalkableCell(map: EditorMap, col: number, row: number): boolean {
  const baked = bakeCollision(toMapData(map));
  return !isSolidKind(kindAt(baked, col, row));
}

function withBlock(blocks: string[], col: number, row: number, char: string): string[] {
  return blocks.map((line, r) =>
    r === row ? line.slice(0, col) + char + line.slice(col + 1) : line,
  );
}

function withoutElementAt(elements: MapElement[], col: number, row: number): MapElement[] {
  return elements.filter((element) => element.col !== col || element.row !== row);
}

/** Refuses an edit that leaves the spawn cell unwalkable in `next`'s full bake — the spawn is
 *  only ever a problem when the edit lands on it, so callers pass the cell they just touched. */
function keepsSpawnWalkable(next: EditorMap, col: number, row: number): boolean {
  if (col !== next.spawn.col || row !== next.spawn.row) return true;
  return isWalkableCell(next, col, row);
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
      // Water drowns anything that cannot stand in it (a tree, a bush); a stone stays, since it
      // stands in the shallows just as well as on grass. Painting grass never strands an element:
      // every `ELEMENT_RULES.on` list includes grass.
      const elements =
        tool.block === "water"
          ? map.elements.filter(
              (element) =>
                element.col !== col ||
                element.row !== row ||
                canPlaceElement(element.kind, "water"),
            )
          : map.elements;
      const next: EditorMap = { ...map, blocks, elements };
      if (!keepsSpawnWalkable(next, col, row)) return null;
      return next;
    }
    case "element": {
      // Ground only — exactly `validateMapInput`'s `bakeCollision({ ...data, elements: [] })` —
      // so an element's own presence never affects what it may itself stand on.
      const ground = bakeCollision({ blocks: map.blocks, elements: [], spawn: map.spawn });
      const under = kindAt(ground, col, row);
      if (!canPlaceElement(tool.element, under)) return null;
      const placed: MapElement = { col, row, kind: tool.element, variant: tool.variant };
      const elements = [...withoutElementAt(map.elements, col, row), placed];
      const next: EditorMap = { ...map, elements };
      if (!keepsSpawnWalkable(next, col, row)) return null;
      return next;
    }
    case "eraser": {
      const present = map.elements.some((element) => element.col === col && element.row === row);
      if (!present) return map;
      return { ...map, elements: withoutElementAt(map.elements, col, row) };
    }
    case "spawn": {
      if (!isWalkableCell(map, col, row)) return null;
      return { ...map, spawn: { col, row } };
    }
    default:
      throw new Error(`unknown editor tool: ${JSON.stringify(tool)}`);
  }
}
