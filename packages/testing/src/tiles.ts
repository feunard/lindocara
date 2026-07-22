/**
 * Builds a `TileMap` for a hand-authored test terrain. Real zones get their tiles from
 * `scripts/build-map.ts`, which rasterises production rectangles with a 50%-coverage rule tuned
 * to avoid fattening walls onto nearby spawn points. Tests here only need "does this rectangle
 * block a cell", so any overlap marks the cell solid — simpler, and conservative in the same
 * direction the pathfinding tests want (a wall should never leak through a rasterised gap).
 */
import { type ColliderIndex, emptyColliderIndex } from "@lindocara/engine/collider.js";
import type { Rect } from "@lindocara/engine/game.js";
import { TILE_SIZE, type TileKind, type TileMap } from "@lindocara/engine/tilemap.js";

/** The sub-cell half of `TerrainGeometry`, empty. A hand-authored test terrain describes its
 *  obstacles as tiles; only an authored map's elements produce colliders. */
export function noColliders(tiles: TileMap): ColliderIndex {
  return emptyColliderIndex(tiles.cols, tiles.rows);
}

export function tileMapFromRects(width: number, height: number, rects: readonly Rect[]): TileMap {
  const cols = Math.ceil(width / TILE_SIZE);
  const rows = Math.ceil(height / TILE_SIZE);
  const kinds: TileKind[] = [];
  for (let row = 0; row < rows; row++) {
    const y0 = row * TILE_SIZE;
    const y1 = y0 + TILE_SIZE;
    for (let col = 0; col < cols; col++) {
      const x0 = col * TILE_SIZE;
      const x1 = x0 + TILE_SIZE;
      const solid = rects.some(
        (rect) =>
          rect.x < x1 && rect.x + rect.width > x0 && rect.y < y1 && rect.y + rect.height > y0,
      );
      kinds.push(solid ? "water" : "grass");
    }
  }
  return { cols, rows, kinds };
}
