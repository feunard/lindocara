/**
 * Choosing which grass tile to draw, as a pure function of the neighbourhood.
 *
 * The map stores what a cell IS; it never stores which sprite to draw. The sprite is derived from
 * the four orthogonal neighbours, so there is no step in which a human could place the wrong tile
 * beside another one. A seam is not unlikely here — it is unrepresentable.
 *
 * `Tilemap_Flat.png` is a 4x4 block: a 3x3 of edges and corners, a one-wide column, a one-tall
 * row, and a lone island. Those sixteen tiles are exactly the sixteen combinations of which
 * neighbours are land, which is why a 4-bit mask indexes it directly.
 *
 * The sheet has no inner-corner tiles, which looks fatal and is not: the rocky rim is drawn inset
 * along each tile's edge, so two adjacent edge tiles close cleanly around a concave corner.
 * Verified before this was written — see docs/screenshots/autotile-proof.png.
 */
import { isLandKind, kindAt, type TileMap } from "../../shared/tilemap.js";

/** N=1, E=2, S=4, W=8. A bit is set when that neighbour is land. */
export function landMask(map: TileMap, col: number, row: number): number {
  return (
    (isLandKind(kindAt(map, col, row - 1)) ? 1 : 0) |
    (isLandKind(kindAt(map, col + 1, row)) ? 2 : 0) |
    (isLandKind(kindAt(map, col, row + 1)) ? 4 : 0) |
    (isLandKind(kindAt(map, col - 1, row)) ? 8 : 0)
  );
}

/** Indexed by the mask above. Coordinates are cells of `Tilemap_Flat.png`'s first 4x4 group. */
export const AUTOTILE_LUT: readonly { col: number; row: number }[] = [
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

export function landTile(map: TileMap, col: number, row: number): { col: number; row: number } {
  const tile = AUTOTILE_LUT[landMask(map, col, row)];
  // Every mask is 0..15 and the table has all sixteen, so this cannot happen — but the types do
  // not know that and `noNonNullAssertion` is on.
  if (!tile) throw new Error(`no tile for mask at ${col},${row}`);
  return tile;
}
