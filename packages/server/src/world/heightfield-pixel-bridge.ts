//
// ============================ TILE→PIXEL BRIDGE ============================
// The arithmetic itself lives in `packages/engine/src/hd2d/tile-pixel-bridge.ts` — read its banner
// first. It moved there because BOTH sides convert: the HD-2D renderer projects the snapshot's
// pixels back into tile units, and two copies of an origin shift is how the two sides silently
// disagree.
//
// This file is the SERVER's call site, and is TEMPORARY for exactly as long as that migration
// takes: it projects the stored heightfield's grid-centred TILE units into the PIXEL,
// top-left-origin geometry the current simulation collides against. It goes when the bridge goes —
// `grep -rn "TILE→PIXEL BRIDGE"` finds every site. Do not convert coordinates by hand here or
// anywhere else; go through `tileToPixel`.
// ===========================================================================

import { colliderIndexFrom } from "@lindocara/engine/collider.js";
import type { Rect, TerrainGeometry } from "@lindocara/engine/game.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { tileToPixel } from "@lindocara/engine/hd2d/tile-pixel-bridge.js";
import type { Vec2 } from "@lindocara/engine/simulation.js";
import { TILE_SIZE, type TileKind, type TileMap } from "@lindocara/engine/tilemap.js";

/**
 * Projects the stored heightfield into the pixel-unit `TerrainGeometry` the current simulation
 * collides against. Water and off-map are impassable; every ground cell is walkable, and the
 * authored collider rects ride across unchanged apart from their units.
 *
 * Elevation is deliberately NOT collision here: in the heightfield model a level change is a climb
 * the movement rule decides, not a cell you cannot enter — so every non-water cell bakes as
 * `grass`. `kindAt` already answers `water` for anything off the grid, so the map's rim needs no
 * baked border.
 */
export function pixelTerrainFromHeightfield(map: MapData): TerrainGeometry {
  // Same assembly as `terrainFromMap` (`engine/map-data.ts`): bake the grid, size the world from
  // it, index the sub-cell rects, and declare no safe zone — an authored map has no way to declare
  // one, and `monster-system` reads that rect as "monsters may not touch a player here".
  const tiles = bakeHeightfieldCollision(map);
  const width = tiles.cols * TILE_SIZE;
  const height = tiles.rows * TILE_SIZE;
  const rects: Rect[] = map.colliders.map((collider) => ({
    x: tileToPixel(collider.x, map.size),
    y: tileToPixel(collider.z, map.size),
    width: collider.w * TILE_SIZE,
    height: collider.h * TILE_SIZE,
  }));
  return {
    width,
    height,
    obstacles: [],
    spawnPoints: heightfieldSpawnPoints(map, width, height),
    safeZone: null,
    tiles,
    colliders: colliderIndexFrom(rects, tiles.cols, tiles.rows),
  };
}

/** `levels` is row-major on `size`, exactly the layout `TileMap.kinds` uses, so the two grids are
 *  the same walk. `null` is water — the format's own word for "no ground here". */
function bakeHeightfieldCollision(map: MapData): TileMap {
  const cells = map.size * map.size;
  // Every cell is written, so there is no default to seed: the grid is built by appending one kind
  // per cell rather than pre-filling and overwriting.
  const kinds: TileKind[] = [];
  for (let index = 0; index < cells; index += 1) {
    kinds.push((map.levels[index] ?? null) === null ? "water" : "grass");
  }
  return { cols: map.size, rows: map.size, kinds };
}

/**
 * `terrainFromMap` always supplies exactly one spawn point, and `spawnPosition` (`engine/game.ts`)
 * takes `spawnPoints.length` as a modulus — a geometry with none yields `NaN` there. A heightfield
 * may legitimately carry no authored spawn, so one is derived: the GROUND cell whose centre sits
 * nearest the grid's own centre.
 *
 * Nearest ground, not the centre itself: an island heightfield is mostly water, and its middle is
 * as likely to be sea as land — a bare geometric centre would seat a hero in the water and leave
 * the fallback looking correct in every test that only checks it returned a point.
 */
function heightfieldSpawnPoints(map: MapData, width: number, height: number): Vec2[] {
  const spawns = map.spawns.map((spawn) => ({
    x: tileToPixel(spawn.x, map.size),
    y: tileToPixel(spawn.z, map.size),
  }));
  if (spawns.length > 0) return spawns;

  const centre: Vec2 = { x: width / 2, y: height / 2 };
  let best: Vec2 | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let row = 0; row < map.size; row += 1) {
    for (let col = 0; col < map.size; col += 1) {
      if ((map.levels[row * map.size + col] ?? null) === null) continue;
      const point: Vec2 = {
        x: col * TILE_SIZE + TILE_SIZE / 2,
        y: row * TILE_SIZE + TILE_SIZE / 2,
      };
      const distance = (point.x - centre.x) ** 2 + (point.y - centre.y) ** 2;
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = point;
    }
  }
  // A heightfield with no ground at all has nowhere to stand; the centre is then the only answer
  // left, and it is water by construction rather than by oversight.
  return [best ?? centre];
}
