/**
 * How one frozen tile id becomes one sheet cell — the arithmetic the world renderer and the map
 * editor stage both draw authored maps with.
 *
 * It lives here rather than in either of them because two hand-synchronised copies of tile-drawing
 * arithmetic is exactly how the editor and the game start disagreeing about what a map looks like.
 * No PixiJS in it: it answers "which sheet cell, which container, which tint", and the caller owns
 * the sprite.
 */
import { autotileOffset, autotileVariantCount } from "@lindocara/engine/autotile.js";
import type { TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import {
  type Autotile,
  decodeTileId,
  EMPTY_TILE,
  type FixedTile,
  type TilePriority,
  type Tileset,
} from "@lindocara/engine/tileset.js";

/** An autotile's variant offset applied to its group origin — the one place the two are added. */
function offsetCell(
  origin: { col: number; row: number },
  offset: { col: number; row: number },
): { col: number; row: number } {
  return { col: origin.col + offset.col, row: origin.row + offset.row };
}

/**
 * The sheet cell for one autotile ref, or `undefined` when the variant is outside what its kind
 * can produce.
 *
 * `tileIdInTileset` (`shared/tileset.ts`) is supposed to keep an out-of-range `run4` variant from
 * ever reaching a saved map or a wire frame — but this runs on every cell of every repaint, for ids
 * that already survived that check once and are trusted from then on. Belt and braces: degrading
 * here too means a gap in that upstream guard, a legacy row from before it existed, or a bug this
 * function itself doesn't have yet, still can't reach `autotileOffset`'s throw from inside the
 * ticker callback and kill the render loop.
 */
export function autotileSheetCell(
  autotile: Autotile,
  variant: number,
): { col: number; row: number } | undefined {
  if (variant >= autotileVariantCount(autotile.kind)) return undefined;
  return offsetCell(autotile.origin, autotileOffset(autotile.kind, variant));
}

/** Everything a caller needs to draw one cell of one layer: where on the sheet, which container,
 *  and the tileset's own tint (elevation shading is baked into the entry). */
export interface TileDraw {
  cell: { col: number; row: number };
  priority: TilePriority;
  tint: number;
}

/**
 * One cell of one layer, resolved against a tileset — or `null` when there is nothing to draw.
 *
 * An id nothing can answer for (an empty cell, an out-of-bounds cell, a slot past what the tileset
 * declares, a variant its autotile's kind can't produce) draws nothing rather than throwing. This
 * runs inside a repaint, and a frame is the worst possible place to discover a bad id.
 */
export function tileDrawAt(
  tileset: Tileset,
  layer: TileLayer,
  col: number,
  row: number,
): TileDraw | null {
  if (col < 0 || col >= layer.cols || row < 0 || row >= layer.rows) return null;
  const ref = decodeTileId(layer.ids[row * layer.cols + col] ?? EMPTY_TILE);
  if (ref.kind === "empty") return null;
  // Resolved in one branch each, not a pair of ternaries: an `Autotile` and a `FixedTile` share no
  // cell fields, so narrowing has to carry from the ref to the entry in the same step.
  let entry: Autotile | FixedTile;
  let cell: { col: number; row: number };
  if (ref.kind === "autotile") {
    const autotile = tileset.autotiles[ref.slot];
    if (!autotile) return null;
    const resolved = autotileSheetCell(autotile, ref.variant);
    if (!resolved) return null;
    entry = autotile;
    cell = resolved;
  } else {
    const fixed = tileset.fixed[ref.index];
    if (!fixed) return null;
    entry = fixed;
    cell = { col: fixed.col, row: fixed.row };
  }
  return { cell, priority: entry.priority, tint: entry.tint ?? 0xffffff };
}
