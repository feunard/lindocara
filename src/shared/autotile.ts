/**
 * Which variant of an autotile a neighbourhood calls for, as a pure function.
 *
 * Shared, not client-only, because three callers must agree: the editor's brush freezes the
 * variant it returns, the migration replays it over old maps, and the property test recomputes a
 * whole grid with it to prove incremental painting never leaves a stale edge behind.
 *
 * The offsets are relative to an autotile's `origin` in its atlas, so the same table serves the
 * flat grass group at column 0 and the raised group at column 5.
 */
import type { AutotileKind } from "./tileset.js";

/** True when the neighbour at this offset belongs to the same autotile as the cell being resolved. */
export type SameNeighbour = (dCol: number, dRow: number) => boolean;

/** N=1, E=2, S=4, W=8. */
export function edge16Mask(same: SameNeighbour): number {
  return (
    (same(0, -1) ? 1 : 0) | (same(1, 0) ? 2 : 0) | (same(0, 1) ? 4 : 0) | (same(-1, 0) ? 8 : 0)
  );
}

/** W=1, E=2. A cliff wall runs sideways and never stacks, so its vertical neighbours say nothing. */
export function run4Mask(same: SameNeighbour): number {
  return (same(-1, 0) ? 1 : 0) | (same(1, 0) ? 2 : 0);
}

/**
 * The sixteen cells of a 4x4 autotile group, indexed by `edge16Mask`.
 *
 * The sheet carries no inner-corner tiles and does not need them: the rim is drawn inset along each
 * tile's edge, so two adjacent edge tiles close cleanly around a concave corner. Verified before
 * this was written — see docs/screenshots/autotile-proof.png.
 */
export const EDGE16_LUT: readonly { col: number; row: number }[] = [
  { col: 3, row: 3 }, //  0  alone
  { col: 3, row: 2 }, //  1  N          — the foot of a column
  { col: 0, row: 3 }, //  2  E          — the left end of a row
  { col: 0, row: 2 }, //  3  N+E        — a bottom-left corner
  { col: 3, row: 0 }, //  4  S          — the head of a column
  { col: 3, row: 1 }, //  5  N+S        — the middle of a column
  { col: 0, row: 0 }, //  6  E+S        — a top-left corner
  { col: 0, row: 1 }, //  7  N+E+S      — a left edge
  { col: 2, row: 3 }, //  8  W          — the right end of a row
  { col: 2, row: 2 }, //  9  N+W        — a bottom-right corner
  { col: 1, row: 3 }, // 10  E+W        — the middle of a row
  { col: 1, row: 2 }, // 11  N+E+W      — a bottom edge
  { col: 2, row: 0 }, // 12  S+W        — a top-right corner
  { col: 2, row: 1 }, // 13  N+S+W      — a right edge
  { col: 1, row: 0 }, // 14  E+S+W      — a top edge
  { col: 1, row: 1 }, // 15  all        — plain fill
];

/** Four cells of one row, indexed by `run4Mask`: the same left/middle/right/lone ordering the
 *  wall band of `Tilemap_color1.png` is drawn in. */
export const RUN4_LUT: readonly { col: number; row: number }[] = [
  { col: 3, row: 0 }, // 0  neither — a lone one-wide wall
  { col: 2, row: 0 }, // 1  W       — the right end of a run
  { col: 0, row: 0 }, // 2  E       — the left end of a run
  { col: 1, row: 0 }, // 3  W+E     — the middle of a run
];

export function autotileOffset(kind: AutotileKind, mask: number): { col: number; row: number } {
  const table = kind === "run4" ? RUN4_LUT : EDGE16_LUT;
  const offset = table[mask];
  // Every mask this module produces is in range and both tables are dense, so this cannot happen —
  // but the types do not know that and `noNonNullAssertion` is on.
  if (!offset) throw new Error(`no ${kind} variant for mask ${mask}`);
  return offset;
}
