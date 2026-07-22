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
import { EDGE16_LUT } from "@lindocara/engine/autotile.js";
import { isLandKind, kindAt, type TileKind, type TileMap } from "@lindocara/engine/tilemap.js";

/** N=1, E=2, S=4, W=8. A bit is set when that neighbour is land. */
export function landMask(map: TileMap, col: number, row: number): number {
  return (
    (isLandKind(kindAt(map, col, row - 1)) ? 1 : 0) |
    (isLandKind(kindAt(map, col + 1, row)) ? 2 : 0) |
    (isLandKind(kindAt(map, col, row + 1)) ? 4 : 0) |
    (isLandKind(kindAt(map, col - 1, row)) ? 8 : 0)
  );
}

/**
 * Does this land tile need a foam blob under it?
 *
 * All eight neighbours, not `landMask`'s four: the blob bleeds ~9px past the tile on every side,
 * so a land tile whose only water neighbour is diagonal still shows foam in that corner. Checking
 * orthogonals alone leaves a bite missing from every diagonal step of a coastline.
 *
 * Interior tiles are skipped because the ground drawn on top of them hides their blob completely —
 * this is an overdraw optimisation, not a visual rule. Off-map counts as water, so an island
 * running to the map edge still gets a shore.
 */
export function needsFoam(map: TileMap, col: number, row: number): boolean {
  if (!isLandKind(kindAt(map, col, row))) return false;
  for (let dRow = -1; dRow <= 1; dRow += 1) {
    for (let dCol = -1; dCol <= 1; dCol += 1) {
      if (dCol === 0 && dRow === 0) continue;
      if (!isLandKind(kindAt(map, col + dCol, row + dRow))) return true;
    }
  }
  return false;
}

/** Re-exported so the renderer keeps one import site while the table itself lives in `shared/`,
 *  where the editor brush and the migration also read it. */
export const AUTOTILE_LUT = EDGE16_LUT;

export function landTile(map: TileMap, col: number, row: number): { col: number; row: number } {
  const tile = AUTOTILE_LUT[landMask(map, col, row)];
  // Every mask is 0..15 and the table has all sixteen, so this cannot happen — but the types do
  // not know that and `noNonNullAssertion` is on.
  if (!tile) throw new Error(`no tile for mask at ${col},${row}`);
  return tile;
}

/** Which ground texture bucket `#updateTerrain` paints a kind as. Only two exist today because
 *  only two ground textures were ever vendored (`Tilemap_Flat.png`'s autotiled land, and water). */
export type TileVisual = "land" | "water";

/**
 * Every `TileKind` must resolve to an explicit entry here — that is the whole point. `isLandKind`
 * alone (`kind !== "water"`) would happily keep working forever, silently drawing any future kind
 * as plain grass; a `Record<TileKind, TileVisual>` is exhaustive at compile time; a new tile kind
 * with no entry here fails the build, not the first player who stands on it.
 *
 * `plateau` and `bridge` are listed even though nothing emits them yet and both draw identically
 * to `grass` today — that sameness is a decision recorded here, not `isLandKind`'s catch-all
 * happening to agree.
 */
const TILE_VISUALS: Record<TileKind, TileVisual> = {
  grass: "land",
  plateau: "land",
  forest: "land",
  building: "land",
  bridge: "land",
  water: "water",
};

/** The renderer's one ground-texture decision. Throws rather than defaulting to grass, so a tile
 *  kind that reaches this without a treatment — only possible if a value bypasses the type system,
 *  since `TILE_VISUALS` above is otherwise exhaustive — fails loudly instead of quietly painting a
 *  grass causeway over water. */
export function tileVisual(kind: TileKind): TileVisual {
  const visual = TILE_VISUALS[kind];
  if (!visual) throw new Error(`no visual treatment for tile kind "${kind}"`);
  return visual;
}
