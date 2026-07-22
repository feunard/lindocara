import { colliderIndexFrom, emptyColliderIndex } from "@lindocara/engine/collider.js";
import { sweptProjectileTerrainImpact } from "@lindocara/engine/directional-combat.js";
import { isPathWalkable, TILE_SIZE, type TileMap } from "@lindocara/engine/tilemap.js";
import { describe, expect, it } from "vitest";

const COLS = 6;
const ROWS = 6;
const GRASS: TileMap = {
  cols: COLS,
  rows: ROWS,
  kinds: new Array(COLS * ROWS).fill("grass"),
};
const TRUNK = colliderIndexFrom(
  [{ x: 3 * TILE_SIZE + 24, y: 3 * TILE_SIZE + 24, width: 16, height: 16 }],
  COLS,
  ROWS,
);

describe("sub-cell sweeps", () => {
  it("stops a projectile on a trunk", () => {
    const hit = sweptProjectileTerrainImpact(
      { x: TILE_SIZE, y: 3 * TILE_SIZE + 32 },
      { x: 5 * TILE_SIZE, y: 3 * TILE_SIZE + 32 },
      4,
      GRASS,
      TRUNK,
    );
    expect(hit).not.toBeNull();
    expect(hit?.fraction).toBeGreaterThan(0);
    expect(hit?.fraction).toBeLessThan(1);
  });

  it("lets a projectile past the same cell above the trunk", () => {
    const hit = sweptProjectileTerrainImpact(
      { x: TILE_SIZE, y: 3 * TILE_SIZE + 4 },
      { x: 5 * TILE_SIZE, y: 3 * TILE_SIZE + 4 },
      2,
      GRASS,
      TRUNK,
    );
    expect(hit).toBeNull();
  });

  it("stops a monster body walking into a trunk", () => {
    expect(
      isPathWalkable(
        GRASS,
        { x: 0, y: 3 * TILE_SIZE + 24 },
        { x: 5 * TILE_SIZE, y: 3 * TILE_SIZE + 24 },
        32,
        TRUNK,
      ),
    ).toBe(false);
  });

  /**
   * The teeth of `addEdgeCrossings`. Tile-boundary crossings alone sample this 8px body at
   * x = …, 188.5, 220.5, … — a 32px stride with nothing sampled in between. An 8px collider at
   * x 200..208 sits entirely inside that gap, so without the collider's own edges in the crossing
   * list the sweep steps straight over it and reports the path clear.
   */
  it("does not step over a collider narrower than the tile-boundary sampling stride", () => {
    const collider = colliderIndexFrom(
      [{ x: 200, y: 2 * TILE_SIZE, width: 8, height: 8 }],
      COLS,
      ROWS,
    );
    expect(
      isPathWalkable(
        GRASS,
        { x: 0, y: 2 * TILE_SIZE },
        { x: 5 * TILE_SIZE, y: 2 * TILE_SIZE },
        8,
        collider,
      ),
    ).toBe(false);
  });

  it("is unchanged without colliders", () => {
    expect(
      isPathWalkable(
        GRASS,
        { x: 0, y: 0 },
        { x: 5 * TILE_SIZE, y: 0 },
        32,
        emptyColliderIndex(COLS, ROWS),
      ),
    ).toBe(true);
    expect(isPathWalkable(GRASS, { x: 0, y: 0 }, { x: 5 * TILE_SIZE, y: 0 }, 32)).toBe(true);
  });
});
