/**
 * The TILE→PIXEL bridge: the one place the stored heightfield's grid-centred tile units meet the
 * pixel, top-left-origin geometry the current simulation collides against.
 *
 * The conversion has both a SCALE and an ORIGIN SHIFT, and the origin shift is the half that
 * silently offsets a whole world by half a map when it is forgotten — it typechecks either way, so
 * it gets pinned here rather than discovered in a room.
 *
 * A pure unit suite despite living in the `server` project: the bridge is a function over `MapData`
 * with no repository, socket or clock in sight, exactly like the `src/world/**` system suites this
 * project already hosts.
 */
import { flattenColliderIndex } from "@lindocara/engine/collider.js";
import type { TerrainGeometry } from "@lindocara/engine/game.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { isSolidKind, kindAt, TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { describe, expect, it } from "vitest";
import { pixelTerrainFromHeightfield, tileToPixel } from "../src/world/heightfield-pixel-bridge.ts";

const map: MapData = {
  version: 1,
  size: 4,
  levelHeight: 0.5,
  waterLevel: 0,
  // row 1 is water; everything else is walkable ground.
  levels: [0, 0, 0, 0, null, null, null, null, 0, 0, 0, 0, 0, 0, 0, 0],
  materials: new Array(16).fill("herbe"),
  colliders: [{ x: -2, z: 0, w: 1, h: 1 }],
  spawns: [{ name: "start", x: 0, z: 0 }],
  elements: [],
  events: [],
};

/** The baked grid's answer for one cell, through the same junction the simulation asks. */
function isWalkableCell(terrain: TerrainGeometry, col: number, row: number): boolean {
  return !isSolidKind(kindAt(terrain.tiles, col, row));
}

describe("the TILE->PIXEL bridge", () => {
  it("maps the grid's centred origin onto the pixel world's corner", () => {
    // -size/2 is the map's west edge, which is pixel 0.
    expect(tileToPixel(-2, 4)).toBe(0);
    expect(tileToPixel(0, 4)).toBe(2 * TILE_SIZE);
    expect(tileToPixel(2, 4)).toBe(4 * TILE_SIZE);
  });

  it("sizes the pixel world from the grid", () => {
    const terrain = pixelTerrainFromHeightfield(map);
    expect(terrain.width).toBe(4 * TILE_SIZE);
    expect(terrain.height).toBe(4 * TILE_SIZE);
  });

  it("turns water into impassable cells and ground into walkable ones", () => {
    const terrain = pixelTerrainFromHeightfield(map);
    expect(terrain.tiles.rows).toBe(4);
    expect(terrain.tiles.cols).toBe(4);
    // Row 1 is water: not walkable. Row 0 is ground: walkable.
    expect(isWalkableCell(terrain, 1, 0)).toBe(true);
    expect(isWalkableCell(terrain, 1, 1)).toBe(false);
  });

  it("converts a collider rect into pixel space, origin included", () => {
    const terrain = pixelTerrainFromHeightfield(map);
    // `ColliderIndex` (`engine/collider.ts`) exposes buckets, not an `all()` query — the flattener
    // is how the rest of the server reads its rects back (`worldState.ts`'s `staticColliders`).
    const rects = flattenColliderIndex(terrain.colliders);
    expect(rects).toContainEqual([0, 2 * TILE_SIZE, TILE_SIZE, TILE_SIZE]);
  });

  it("converts the authored spawns into pixel space", () => {
    const terrain = pixelTerrainFromHeightfield(map);
    expect(terrain.spawnPoints).toEqual([{ x: 2 * TILE_SIZE, y: 2 * TILE_SIZE }]);
  });

  it("falls back to walkable ground, never the sea, when no spawn is authored", () => {
    // A 3x3 grid whose only ground is the far corner (2, 2). The grid's geometric centre is cell
    // (1, 1), which is water — a fallback that returned it would seat a hero in the sea, and on an
    // island heightfield that is the common case, not a contrived one.
    const island: MapData = {
      version: 1,
      size: 3,
      levelHeight: 0.5,
      waterLevel: 0,
      levels: [null, null, null, null, null, null, null, null, 0],
      materials: new Array(9).fill("herbe"),
      colliders: [],
      spawns: [],
      elements: [],
      events: [],
    };
    const terrain = pixelTerrainFromHeightfield(island);

    expect(terrain.spawnPoints).toEqual([{ x: 2.5 * TILE_SIZE, y: 2.5 * TILE_SIZE }]);
    expect(isWalkableCell(terrain, 2, 2)).toBe(true);
  });
});
