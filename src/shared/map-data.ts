/**
 * What a map IS, as pure rules.
 *
 * This is the only place a map payload becomes collision, and that is the whole point of the file.
 * Terrain now arrives over the wire instead of being imported, so the old guarantee — client and
 * server read the same compile-time constant — has to be replaced by a deliberate one: both sides
 * call `bakeCollision` on the same payload. Two decoders that "should" agree is exactly how
 * prediction becomes unfixable; `step()` carries the same argument about movement, for the same
 * reason.
 */

import type { TileKind, TileMap } from "./tilemap.js";
import { decodeTileMap } from "./tilemap-codec.js";

export const ELEMENT_KINDS = ["tree", "bush", "stone"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

export interface MapElement {
  col: number;
  row: number;
  kind: ElementKind;
  variant: number;
}

export interface MapData {
  blocks: readonly string[];
  elements: readonly MapElement[];
  spawn: { col: number; row: number };
}

/** What an element may stand on, and whether you bump into it. */
export const ELEMENT_RULES: Readonly<
  Record<ElementKind, { on: readonly TileKind[]; collides: boolean }>
> = {
  tree: { on: ["grass"], collides: true },
  bush: { on: ["grass"], collides: false },
  /** A stone in the shallows. Water is already solid, so allowing this changes nothing about
   *  collision — it is a placement permission, not a collision rule. */
  stone: { on: ["grass", "water"], collides: true },
};

export function isElementKind(value: unknown): value is ElementKind {
  return typeof value === "string" && (ELEMENT_KINDS as readonly string[]).includes(value);
}

export function canPlaceElement(kind: ElementKind, on: TileKind): boolean {
  return ELEMENT_RULES[kind].on.includes(on);
}

/**
 * The ground, plus everything standing on it that you bump into.
 *
 * Colliding elements are baked into the tilemap rather than taught to the collision code, so
 * `isWalkableBox`, `step` and `prediction.ts` never learn that elements exist. On the day terrain
 * starts arriving over the wire, exactly one thing changes.
 *
 * A colliding element becomes `forest` — the existing kind for "land you cannot walk through" — and
 * never overwrites water, which is already solid and should keep looking like water underneath.
 */
export function bakeCollision(map: MapData): TileMap {
  const tiles = decodeTileMap(map.blocks);
  const kinds = [...tiles.kinds];
  for (const element of map.elements) {
    if (!ELEMENT_RULES[element.kind].collides) continue;
    const index = element.row * tiles.cols + element.col;
    if (kinds[index] !== "grass") continue;
    kinds[index] = "forest";
  }
  return { ...tiles, kinds };
}

/**
 * Elements off the wire, checked like the untrusted data they are.
 *
 * Bounds are NOT checked here: the caller knows the map's size and this does not. An element with a
 * silly cell draws nowhere and collides with nothing — collision is already baked into the tiles by
 * the time these arrive — so the shape is what matters.
 */
export function parseMapElements(value: unknown): MapElement[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: MapElement[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const item = raw as Record<string, unknown>;
    const { col, row, variant } = item;
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) return null;
    if (!Number.isSafeInteger(variant)) return null;
    if (!isElementKind(item.kind)) return null;
    parsed.push({
      col: col as number,
      row: row as number,
      kind: item.kind,
      variant: variant as number,
    });
  }
  return parsed;
}

/** The only two block characters a map may contain. Everything else is scenery standing on them. */
const BLOCK_CHARS = new Set([".", "#"]);

/**
 * Defensive, exactly like client intent already is.
 *
 * A malformed map that reaches `decodeTileMap` throws on the first paint — a ragged row, an unknown
 * character, an element hanging off the edge. This returns null instead and the frame is dropped.
 * `parseServerMessage` only checks its top level and casts what is nested (known debt, recorded in
 * docs/mmo-migration-plan.md §11); terrain is not a field to extend that habit to.
 */
export function parseMapData(value: unknown): MapData | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { blocks, elements, spawn } = record;

  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const first: unknown = blocks[0];
  if (typeof first !== "string" || first.length === 0) return null;
  const cols = first.length;
  for (const row of blocks) {
    if (typeof row !== "string" || row.length !== cols) return null;
    for (const char of row) if (!BLOCK_CHARS.has(char)) return null;
  }
  const rows = blocks.length;

  if (!Array.isArray(elements)) return null;
  const parsed: MapElement[] = [];
  for (const raw of elements) {
    if (typeof raw !== "object" || raw === null) return null;
    const item = raw as Record<string, unknown>;
    const { col, row, variant } = item;
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) return null;
    if (!Number.isSafeInteger(variant)) return null;
    if (!isElementKind(item.kind)) return null;
    if ((col as number) < 0 || (col as number) >= cols) return null;
    if ((row as number) < 0 || (row as number) >= rows) return null;
    parsed.push({
      col: col as number,
      row: row as number,
      kind: item.kind,
      variant: variant as number,
    });
  }

  if (typeof spawn !== "object" || spawn === null) return null;
  const spawnRecord = spawn as Record<string, unknown>;
  const { col: spawnCol, row: spawnRow } = spawnRecord;
  if (!Number.isSafeInteger(spawnCol) || !Number.isSafeInteger(spawnRow)) return null;
  if ((spawnCol as number) < 0 || (spawnCol as number) >= cols) return null;
  if ((spawnRow as number) < 0 || (spawnRow as number) >= rows) return null;

  return {
    blocks: blocks as string[],
    elements: parsed,
    spawn: { col: spawnCol as number, row: spawnRow as number },
  };
}
