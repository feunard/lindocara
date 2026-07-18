/**
 * What a tile id means.
 *
 * A map cell stores an id; what the id *does* — whether you can walk on it, whether it draws in
 * front of a character — is a property of the tileset, authored once per tile. That indirection is
 * the whole design: collision stays derivable from what you see (`id -> tileset -> passable`), so
 * `tilemap.ts`'s rule that a cell stores what it IS rather than how it looks moves one level down
 * instead of being abandoned.
 *
 * The id space is RPG Maker XP's: a low band of autotile variants, then fixed tiles above it. One
 * decode rule covers both, which is worth more than the density lost to `run4` autotiles using
 * four of their sixteen variant slots.
 */

/** An empty cell. On the ground layer this reads as water — the void — when collision is baked. */
export const EMPTY_TILE = 0;

/** Every autotile reserves a full block, even `run4`, which uses only its first four. */
export const VARIANTS_PER_AUTOTILE = 16;

export const AUTOTILE_SLOTS = 64;

export const FIXED_BASE = 1 + AUTOTILE_SLOTS * VARIANTS_PER_AUTOTILE;

/** Growing either constant grows every id's digit width, which `MAX_MAP_JSON_BYTES`
 *  (server/index.ts) is sized against — see its comment before raising these. */

/** Drawn behind characters, or in front of them — an XP tile priority, reduced to two values. */
export type TilePriority = "below" | "above";

/**
 * `edge16` is the four-neighbour mask with sixteen variants — a full Wang set.
 * `run4` masks west and east only: cliff walls tile sideways and never vertically.
 */
export type AutotileKind = "edge16" | "run4";

export interface Autotile {
  atlas: string;
  /** Top-left cell of the tile group within the atlas. */
  origin: { col: number; row: number };
  kind: AutotileKind;
  passable: boolean;
  priority: TilePriority;
  /** Multiplicative colour, as PixiJS spends it. Carries elevation shading. */
  tint?: number;
}

export interface FixedTile {
  atlas: string;
  col: number;
  row: number;
  passable: boolean;
  priority: TilePriority;
  tint?: number;
}

export interface Tileset {
  id: string;
  autotiles: readonly Autotile[];
  fixed: readonly FixedTile[];
}

export type TileRef =
  | { kind: "empty" }
  | { kind: "autotile"; slot: number; variant: number }
  | { kind: "fixed"; index: number };

const EMPTY_REF: TileRef = { kind: "empty" };

export function autotileId(slot: number, variant: number): number {
  return 1 + slot * VARIANTS_PER_AUTOTILE + variant;
}

export function fixedId(index: number): number {
  return FIXED_BASE + index;
}

/**
 * Total: an id from a database row or a wire frame may be anything at all, and a cell nobody can
 * decode is an empty cell, not a crash on the first paint.
 */
export function decodeTileId(id: number): TileRef {
  if (!Number.isSafeInteger(id) || id <= EMPTY_TILE) return EMPTY_REF;
  if (id >= FIXED_BASE) return { kind: "fixed", index: id - FIXED_BASE };
  const offset = id - 1;
  return {
    kind: "autotile",
    slot: Math.floor(offset / VARIANTS_PER_AUTOTILE),
    variant: offset % VARIANTS_PER_AUTOTILE,
  };
}

/**
 * Whether a tileset actually declares this id, rather than merely being in-shape for the id space.
 *
 * `decodeTileId` alone cannot answer this — it has no tileset to check bounds against, which is
 * exactly why a slot or index past what a tileset declares used to reach `tileBlocks`
 * (`shared/map-data.ts`) and get baked as solid terrain: an id pointing at nothing was silently
 * treated as an obstacle instead of being refused. Callers that DO hold a resolved `Tileset` —
 * `parseMapData` and `validateMapInput` — use this to reject that id outright, at the one place
 * both the wire parser and the write-path validator can name every id a map may legally contain.
 */
export function tileIdInTileset(tileset: Tileset, id: number): boolean {
  if (id === EMPTY_TILE) return true;
  const ref = decodeTileId(id);
  if (ref.kind === "autotile") return ref.slot < tileset.autotiles.length;
  if (ref.kind === "fixed") return ref.index < tileset.fixed.length;
  return false;
}
