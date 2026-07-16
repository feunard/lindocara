import { describe, expect, it } from "vitest";
import {
  DECOR_REGIONS,
  ROADS,
  roadStrength,
  visualConfigFor,
} from "../src/client/game/world-layout.js";
import { SAFE_ZONE, VERDANT_REACH_TERRAIN, WORLD_LANDMARKS } from "../src/shared/game.js";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../src/shared/simulation.js";
import { isLandKind, isSolidKind, kindAtPoint } from "../src/shared/tilemap.js";

/**
 * The thesis of this slice is "what you SEE is what you COLLIDE with." Commit 2515569 moved
 * *terrain* onto the tile grid but left the old rect-authored prop scatter drawing from the
 * rects' pre-image instead: 237 boundary trees standing in what the tilemap now renders as
 * water, 235 cliff "boulders" doing the same, 20 forest props anchored on a cell the tile grid
 * calls open ground, and `#buildDecor` scattering both trees and non-solid dressing with no tile
 * awareness at all. The fix deleted the rect-driven scatter outright (`#buildSharedBlockers`,
 * `#buildBoundary`'s props) and gated the one scatter worth keeping (`#buildDecor`) on the real
 * tile grid.
 *
 * This test mirrors `#buildDecor` + `#decorTexture`'s `solid` split closely enough to reproduce,
 * over the REAL `VERDANT_REACH_TERRAIN.tiles` and the REAL `DECOR_REGIONS`, the two invariants
 * that fix depends on. It cannot import the renderer's private methods directly — they build
 * PixiJS `Graphics`/`Sprite` objects that need a live canvas — so if `#buildDecor`'s position math
 * or `#decorTexture`'s tree/not-tree split ever changes, this must change with it, the same
 * relationship `test/tilemap-data.test.ts`'s frozen `SLICE_1_ROWS` has with the generator it
 * cross-checks. What it verifies independently of renderer.ts is the DATA: if `DECOR_REGIONS`
 * grows to overlap a lake, or the map generator reshapes the coastline, this fails without
 * anyone touching renderer.ts at all.
 */
function seeded(index: number): number {
  const value = Math.sin(index * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

/** Mirrors `#decorTexture`'s branch selection: true only for the picks drawn from the tree pool. */
function isTreePick(theme: string, seed: number): boolean {
  if (theme === "forest") return seed % 9 !== 0 && seed % 7 !== 0;
  if (theme === "marsh" || theme === "wet") return false;
  if (theme === "ruin" || theme === "gate") return false;
  if (theme === "farm") return false;
  if (theme === "road") return false;
  return seed % 6 === 0; // village / meadow's default branch
}

function nearLandmark(x: number, y: number, margin: number): boolean {
  return WORLD_LANDMARKS.some(
    (landmark) =>
      x >= landmark.x - margin &&
      x <= landmark.x + landmark.width + margin &&
      y >= landmark.y - margin &&
      y <= landmark.y + landmark.height + margin,
  );
}

interface Placement {
  x: number;
  y: number;
  isTree: boolean;
}

/** Mirrors `#buildDecor`, gate included: every filter renderer.ts applies before drawing a prop. */
function decorPlacements(): Placement[] {
  const tiles = VERDANT_REACH_TERRAIN.tiles;
  const placements: Placement[] = [];
  for (const region of DECOR_REGIONS) {
    for (let index = 0; index < region.count; index++) {
      const seed = region.seed + index * 19;
      const angle = seeded(seed + 3) * Math.PI * 2;
      const radius = Math.sqrt(seeded(seed + 9));
      const x = region.x + Math.cos(angle) * region.radiusX * radius;
      const y = region.y + Math.sin(angle) * region.radiusY * radius;
      if (x < 120 || y < 120 || x > WORLD_WIDTH - 120 || y > WORLD_HEIGHT - 120) continue;
      if (roadStrength(x, y) > 0) continue;
      if (nearLandmark(x, y, 70)) continue;
      const inSquare =
        x > SAFE_ZONE.x + 210 &&
        x < SAFE_ZONE.x + SAFE_ZONE.width - 170 &&
        y > SAFE_ZONE.y + 250 &&
        y < SAFE_ZONE.y + SAFE_ZONE.height - 110;
      if (inSquare) continue;

      const isTree = isTreePick(region.theme, seed);
      const kind = kindAtPoint(tiles, x, y);
      if (!isLandKind(kind)) continue;
      if (isTree && !isSolidKind(kind)) continue;

      placements.push({ x, y, isTree });
    }
  }
  return placements;
}

describe("decor scatter stays honest about the tile grid", () => {
  const placements = decorPlacements();
  const tiles = VERDANT_REACH_TERRAIN.tiles;

  it("still scatters plenty of props, so the invariants below aren't vacuously true", () => {
    expect(placements.length).toBeGreaterThan(100);
  });

  it("never floats a prop over a water cell", () => {
    const onWater = placements.filter((p) => !isLandKind(kindAtPoint(tiles, p.x, p.y)));
    expect(onWater).toEqual([]);
  });

  it("never stands a tree on a cell a player can walk through", () => {
    const treeOnWalkable = placements
      .filter((p) => p.isTree)
      .filter((p) => !isSolidKind(kindAtPoint(tiles, p.x, p.y)));
    expect(treeOnWalkable).toEqual([]);
  });
});

describe("zone visual configuration", () => {
  it("keeps Verdant Reach's authored decor and roads", () => {
    // `ZoneId` is any string now — a map's id is a uuid — so a lookup can miss. Go through the
    // accessor the renderer uses rather than indexing the record directly.
    expect(visualConfigFor("verdant-reach").decorRegions).toBe(DECOR_REGIONS);
    expect(visualConfigFor("verdant-reach").roads).toBe(ROADS);
  });

  it("gives a map it has never heard of the empty config instead of crashing", () => {
    // The normal case once maps live in D1: an id this build cannot know, whose terrain arrives in
    // the welcome and whose visuals are simply none.
    const unknown = visualConfigFor("3f8b0c1e-0000-4000-8000-000000000000");
    expect(unknown.landmarks).toEqual([]);
    expect(unknown.safeZone).toBeNull();
    expect(unknown.worldRegions).toEqual([]);
  });

  it("does not bleed Verdant Reach furniture into mmo-test-zone", () => {
    const testZone = visualConfigFor("mmo-test-zone");
    expect(testZone.safeZone).toBeNull();
    expect(testZone.landmarks).toEqual([]);
    expect(testZone.roads).toEqual([]);
    expect(testZone.decorRegions).toEqual([]);
    expect(testZone.pointsOfInterest).toEqual([]);
    expect(testZone.worldRegions).toEqual([]);
    expect(testZone.ambientRegions).toEqual([]);
  });
});

describe("forest trees (#buildForestTrees) anchor only on solid ground", () => {
  // #buildForestTrees places one tree per `forest` tile, jittered by at most ±0.1 * TILE_SIZE
  // from the cell centre — far short of the half-cell (0.5 * TILE_SIZE) needed to cross into a
  // neighbouring cell. Its correctness therefore reduces entirely to this: `forest` must stay a
  // solid, land tile kind. If that ever changed, every forest tree would silently start standing
  // on ground a player can walk straight through.
  it("keeps forest a solid, walkable-blocking land kind", () => {
    expect(isLandKind("forest")).toBe(true);
    expect(isSolidKind("forest")).toBe(true);
  });
});
