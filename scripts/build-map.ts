/**
 * Rasterises the world's typed terrain — boundary walls, forests/rivers/cliffs, and building
 * footprints — into tile data, so the tilemap carries not just collision but what a cell IS.
 *
 * Run with: npm run map:build
 */
import { writeFileSync } from "node:fs";
import {
  BOUNDARY_OBSTACLES,
  OBSTACLES,
  type Rect,
  SAFE_ZONE,
  TERRAIN_BLOCKERS,
  WORLD_LANDMARKS,
} from "@lindocara/engine/game.js";
import { VERDANT_REACH_BOUNDS, type WorldBounds } from "@lindocara/engine/simulation.js";
import { TILE_SIZE, type TileKind } from "@lindocara/engine/tilemap.js";
import {
  SUNKEN_ISLES_BOUNDS,
  SUNKEN_ISLES_FORESTS,
  SUNKEN_ISLES_ISLETS,
  SUNKEN_ISLES_LAND,
  SUNKEN_ISLES_LANDMARKS,
} from "@lindocara/engine/zones/sunken-isles.js";
import { TEST_ZONE_TERRAIN } from "@lindocara/engine/zones.js";

/**
 * How much of a cell must be blocked before the cell is a wall.
 *
 * Not "any overlap" (walls would fatten by up to 63px and swallow spawn points that today sit a
 * few pixels from a building), and not "entirely covered" (a 120px-thick wall could straddle cell
 * boundaries and vanish). Half is the rule that preserves both walls and the gaps between them.
 *
 * Unchanged from Slice 1: a reviewer verified all 3,225 cells of the current map against an
 * independent reimplementation of this exact rule, and changing it here would move collision.
 */
const SOLID_COVERAGE = 0.5;

function coverage(rects: readonly Rect[], col: number, row: number): number {
  const x0 = col * TILE_SIZE;
  const y0 = row * TILE_SIZE;
  let covered = 0;
  // Sample on a 8x8 sub-grid: exact enough at 64px, and immune to overlapping rects being
  // double-counted, which a naive area sum would get wrong.
  const STEPS = 8;
  const step = TILE_SIZE / STEPS;
  for (let sy = 0; sy < STEPS; sy++) {
    for (let sx = 0; sx < STEPS; sx++) {
      const px = x0 + (sx + 0.5) * step;
      const py = y0 + (sy + 0.5) * step;
      const hit = rects.some(
        (r) => px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height,
      );
      if (hit) covered++;
    }
  }
  return covered / (STEPS * STEPS);
}

/** One labelled source of terrain: its rects, and the kind a cell becomes when they cover it. */
interface Layer {
  rects: readonly Rect[];
  kind: TileKind;
}

/**
 * Paints a cell's kind from a stack of layers, later entries winning over earlier ones — so a
 * building collider sitting on a forest's edge reads as a building, not as trees (Step 4 of the
 * task brief). This is a decision, not an accident: the renderer needs exactly one kind per
 * cell, and "the thing built last is what you see" is the simplest rule that stays deterministic.
 *
 * Solidity is decided once, from `allRects` — the same union `OBSTACLES` has always been — so
 * relabelling a cell's kind can never move a wall: this function cannot produce a "grass" (or
 * any non-solid) result for a cell that union already calls solid, and cannot solidify a cell
 * that union calls open, regardless of how the layers below are sliced up.
 *
 * A cell can be solid by that union without any single layer alone reaching SOLID_COVERAGE
 * across it — e.g. a forest and a building collider each covering a bit less than half of the
 * same cell. The fallback below attributes that cell to whichever layer actually touches it,
 * same last-wins rule as the main pass.
 */
function paintKind(
  layers: readonly Layer[],
  allRects: readonly Rect[],
  col: number,
  row: number,
): TileKind {
  if (coverage(allRects, col, row) < SOLID_COVERAGE) return "grass";
  let kind: TileKind | undefined;
  for (const layer of layers) {
    if (coverage(layer.rects, col, row) >= SOLID_COVERAGE) kind = layer.kind;
  }
  if (kind !== undefined) return kind;
  for (const layer of layers) {
    if (coverage(layer.rects, col, row) > 0) kind = layer.kind;
  }
  // Unreachable in practice: `allRects` is the union of every layer's rects, so if the union
  // covers this cell at all, at least one layer above has positive coverage on it. Kept as a
  // safe, deterministic fallback rather than a non-null assertion.
  return kind ?? "water";
}

function rasteriseVerdant(bounds: WorldBounds): {
  cols: number;
  rows: number;
  kinds: TileKind[];
} {
  const cols = Math.ceil(bounds.width / TILE_SIZE);
  const rows = Math.ceil(bounds.height / TILE_SIZE);
  // Applied in this order — the world's edge, then terrain, then buildings — so a later source
  // wins where it overlaps an earlier one. See paintKind's doc comment for why this can never
  // move the solid mask, only the label a solid cell gets.
  const layers: Layer[] = [
    { rects: BOUNDARY_OBSTACLES, kind: "water" },
    ...TERRAIN_BLOCKERS.map(
      (blocker): Layer => ({
        rects: [blocker.rect],
        // A cliff is a sheer drop: to a player it is exactly as impassable as deep water.
        kind: blocker.kind === "forest" ? "forest" : "water",
      }),
    ),
    ...WORLD_LANDMARKS.flatMap((landmark): Layer[] =>
      landmark.collider === undefined ? [] : [{ rects: [landmark.collider], kind: "building" }],
    ),
  ];
  const kinds: TileKind[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      kinds.push(paintKind(layers, OBSTACLES, col, row));
    }
  }
  return { cols, rows, kinds };
}

/**
 * The flat two-kind rasteriser Slice 1 shipped. Kept for the synthetic test zone, which has no
 * typed terrain sources (forests, rivers, buildings) of its own — just one untyped obstacle rect.
 */
function rasteriseFlat(
  bounds: WorldBounds,
  obstacles: readonly Rect[],
): {
  cols: number;
  rows: number;
  kinds: TileKind[];
} {
  const cols = Math.ceil(bounds.width / TILE_SIZE);
  const rows = Math.ceil(bounds.height / TILE_SIZE);
  const kinds: TileKind[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      kinds.push(coverage(obstacles, col, row) >= SOLID_COVERAGE ? "water" : "grass");
    }
  }
  return { cols, rows, kinds };
}

/**
 * Land as the positive space.
 *
 * Both rasterisers above start a cell as `grass` and paint water onto it — the world is ground, and
 * the sea is a hole cut in it. An archipelago is the other way round, so this one starts every cell
 * as water and paints the islands.
 *
 * It deliberately reuses `coverage` and `SOLID_COVERAGE` rather than deciding for itself what
 * counts as land: an island rasteriser with its own idea of "half-covered" is two zones quietly
 * disagreeing about collision.
 */
function rasteriseIslands(
  bounds: WorldBounds,
  landRects: readonly Rect[],
  layers: readonly Layer[],
): {
  cols: number;
  rows: number;
  kinds: TileKind[];
} {
  const cols = Math.ceil(bounds.width / TILE_SIZE);
  const rows = Math.ceil(bounds.height / TILE_SIZE);
  const kinds: TileKind[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (coverage(landRects, col, row) < SOLID_COVERAGE) {
        kinds.push("water");
        continue;
      }
      // Same last-wins rule as paintKind: a house on a treeline reads as a house.
      let kind: TileKind = "grass";
      for (const layer of layers) {
        if (coverage(layer.rects, col, row) >= SOLID_COVERAGE) kind = layer.kind;
      }
      kinds.push(kind);
    }
  }
  return { cols, rows, kinds };
}

/**
 * Turns a solid slab of `forest` into a grid of tree trunks.
 *
 * A tree stands on exactly two cells: the trunk it grows out of, and the canopy above it. Only the
 * trunk is solid — you walk *under* the branches, which is what the art has always drawn and what
 * the collision never admitted. So a forest is not a filled rectangle of blocked cells; it is
 * trunks on every second row, with the canopy row between them left open.
 *
 * Scanned bottom-up per column so the forest's *bottom* edge always lands on a trunk: that edge is
 * the one you see from open ground, and a canopy floating there with no trunk under it reads as a
 * tree standing on nothing.
 *
 * You still cannot walk through a forest — the next trunk row stops you — but you can now stand in
 * under the eaves, one cell deep. That is a gameplay change, and an intended one.
 */
function thinForestToTrunks(
  kinds: TileKind[],
  cols: number,
  rows: number,
): { kinds: TileKind[]; trunks: number } {
  const out = [...kinds];
  let trunks = 0;
  for (let col = 0; col < cols; col++) {
    let canopyReserved = false;
    for (let row = rows - 1; row >= 0; row--) {
      const index = row * cols + col;
      if (out[index] !== "forest") {
        canopyReserved = false;
        continue;
      }
      if (canopyReserved) {
        // The tree below owns this cell as its canopy. Open ground you can stand under.
        out[index] = "grass";
        canopyReserved = false;
        continue;
      }
      trunks++;
      canopyReserved = true;
    }
  }
  return { kinds: out, trunks };
}

function emit(
  name: string,
  constant: string,
  data: { cols: number; rows: number; kinds: TileKind[] },
): string {
  // One character per cell, one line per row: a 75-wide map stays readable and diffable in git,
  // and a hand edit in Tiled later shows up as a legible change rather than a wall of numbers.
  const CHAR: Record<TileKind, string> = {
    grass: ".",
    plateau: "^",
    forest: "T",
    building: "B",
    water: "#",
    bridge: "=",
  };
  const rowsText = [];
  for (let row = 0; row < data.rows; row++) {
    const line = data.kinds
      .slice(row * data.cols, (row + 1) * data.cols)
      .map((k) => CHAR[k])
      .join("");
    rowsText.push(`  "${line}",`);
  }
  return `// GENERATED by scripts/build-map.ts — do not edit by hand. Run: npm run map:build

import type { TileMap } from "../tilemap.js";
import { decodeTileMap } from "../tilemap-codec.js";

const ROWS = [
${rowsText.join("\n")}
];

/** ${name} */
export const ${constant}: TileMap = decodeTileMap(ROWS);
`;
}

// Verdant Reach's height (2700) isn't a multiple of TILE_SIZE (64), so `rasteriseVerdant` rounds
// up to 43 rows and the last one (row 42) straddles the world's real bottom edge — only its top
// 12px are inside the world at all. That sliver sits inside the 96px-thick bottom boundary wall
// (BOUNDARY_OBSTACLES / WORLD_BOUNDARY_DEPTH in game.ts) but doesn't reach the 50% coverage
// threshold on its own, so row 42 comes out all-grass rather than solid. It looks like a bug —
// an inexplicable strip of open ground — but it's inert: row 41 sits entirely inside that same
// wall and rasterises fully solid, sealing row 42 off, and clampToWorld never lets a player's y
// go far enough down for their box to clear row 41 in the first place. Left as-is on purpose;
// see "keeps the last row unreachable" in test/tilemap-data.test.ts, which pins both halves of
// why nobody will ever stand there.
const verdantSolid = rasteriseVerdant(VERDANT_REACH_BOUNDS);
const verdantThinned = thinForestToTrunks(verdantSolid.kinds, verdantSolid.cols, verdantSolid.rows);
const verdant = { ...verdantSolid, kinds: verdantThinned.kinds };
writeFileSync(
  "src/shared/zones/verdant-reach-tiles.ts",
  emit("Verdant Reach", "VERDANT_REACH_TILES", verdant),
);

const test = rasteriseFlat(TEST_ZONE_TERRAIN, TEST_ZONE_TERRAIN.obstacles);
writeFileSync(
  "src/shared/zones/mmo-test-zone-tiles.ts",
  emit("Crossing Annex", "MMO_TEST_ZONE_TILES", test),
);

// The islets go in as land so they rasterise as scenery you can see, but nothing is placed on them:
// they are detached, and detached land is land no player can reach.
const islesSolid = rasteriseIslands(
  SUNKEN_ISLES_BOUNDS,
  [...SUNKEN_ISLES_LAND, ...SUNKEN_ISLES_ISLETS],
  [
    { rects: SUNKEN_ISLES_FORESTS, kind: "forest" },
    ...SUNKEN_ISLES_LANDMARKS.flatMap((landmark): Layer[] =>
      landmark.collider === undefined ? [] : [{ rects: [landmark.collider], kind: "building" }],
    ),
  ],
);
const islesThinned = thinForestToTrunks(islesSolid.kinds, islesSolid.cols, islesSolid.rows);
const isles = { ...islesSolid, kinds: islesThinned.kinds };
writeFileSync(
  "src/shared/zones/sunken-isles-tiles.ts",
  emit("Sunken Isles", "SUNKEN_ISLES_TILES", isles),
);

console.log(
  `verdant-reach ${verdant.cols}x${verdant.rows}, mmo-test-zone ${test.cols}x${test.rows}, sunken-isles ${isles.cols}x${isles.rows}`,
);
// Each trunk is one tree the renderer will draw: a forest cell IS a tree, which is why nothing has
// to agree with a second list of tree positions.
console.log(`trees: verdant-reach ${verdantThinned.trunks}, sunken-isles ${islesThinned.trunks}`);
console.log(`safe zone spans x ${SAFE_ZONE.x}..${SAFE_ZONE.x + SAFE_ZONE.width}`);
