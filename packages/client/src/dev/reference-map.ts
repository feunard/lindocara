/**
 * La carte étalon : Pixel Frog's own promo scene, rebuilt out of our own brushes.
 *
 * This exists to answer one question a test suite cannot — *does an authored map look as good as
 * the art pack it is made of?* It is the visual target the renderer, the tileset choice and any
 * future shader work are judged against, so it is hand-composed rather than generated: every
 * plateau ribbon, every tree cluster and every building here is a decision, not a dice roll.
 *
 * Four composition rules are copied deliberately from the reference art, because they are exactly
 * what `scripts/lib/island-terrain.ts`'s uniform scatter cannot produce:
 *
 *  1. **Cliffs are ribbons, not regions.** Long one-cell-high terraces cut the green into readable
 *     bands. A plateau that is merely a big blob reads as a second field, not as relief.
 *  2. **Foliage clusters, and a cluster is one species.** Real stands of trees repeat; picking a
 *     variant per tree is what makes generated woodland read as confetti.
 *  3. **Density is not uniform.** Edges and corners are crowded, the middle is deliberately open —
 *     that open middle is both where the eye rests and where the game is played.
 *  4. **Decorations overlap.** Trees are placed at quarter-cell offsets so their canopies mass
 *     together; `sameElementSlot` is the identity, and overlap is explicitly legal.
 *
 * Everything is deterministic: the jitter comes from a seeded PRNG, never `Math.random`, so the
 * étalon is byte-identical on every build and a visual diff means someone changed something.
 */
import {
  EMPTY_MARKERS,
  MAP_LAYERS,
  type MapData,
  type MapElement,
} from "@lindocara/engine/map-data.js";
import {
  eraseRect,
  paintElevation,
  paintRectAutotile,
  paintStairs,
  resolveWholeLayer,
} from "@lindocara/engine/tile-brush.js";
import { emptyLayer, type TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import {
  GRASS_SLOTS,
  TINY_SWORDS_TILESET,
  TINY_SWORDS_TILESET_ID,
} from "@lindocara/engine/tilesets/tiny-swords.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";

export const REFERENCE_MAP_COLS = 40;
export const REFERENCE_MAP_ROWS = 28;

type Rect = readonly [c0: number, r0: number, c1: number, r1: number];

/**
 * The landmass, as a union of rectangles.
 *
 * Rectangles rather than a noise blob on purpose: the reference coastline is genuinely blocky —
 * tile-aligned steps of varying depth — and a smoothed blob rounds exactly those steps away. The
 * irregularity comes from how the rectangles disagree at their edges, and from `BAYS` below.
 */
const LAND: readonly Rect[] = [
  [3, 2, 17, 9], // north-west lobe — the castle stands here
  [18, 4, 26, 10], // north-central saddle
  [27, 3, 37, 11], // north-east lobe — the deep woods
  [4, 10, 31, 14], // the central band everything hangs off
  [2, 15, 13, 21], // south-west lobe — the watchtower
  [21, 14, 37, 22], // south-east lobe — the village
  [14, 15, 20, 18], // the neck joining the two southern lobes
  [24, 23, 34, 24], // southern shore strip
  [2, 24, 6, 26], // a bare islet, bushes only
  // A real island, with no causeway back: the reference puts its southern tower out in the water,
  // and a land bridge here also sealed the channel behind it into a landlocked pool.
  [15, 22, 20, 26], // the tower islet
];

/** Sea bitten back out of the union above. This is what stops the coast reading as a stack of boxes. */
const BAYS: readonly Rect[] = [
  [14, 2, 17, 3], // a notch in the northern shore
  [3, 12, 6, 14], // the western bay
  [27, 12, 31, 13], // the channel between the central band and the village
  // A narrow fjord cut south through the saddle. It must reach the open sea at row 3 or it is a
  // pond: `scripts/preview-reference-map.ts` flood-fills from the border and would say so.
  [19, 4, 20, 11],
  [33, 3, 37, 4], // breaks the north-east corner
  [10, 20, 13, 21], // scallops the south-west shore
];

/** Level-1 terraces. Note how flat and wide the two ribbons are — they exist to cut the green. */
const PLATEAU_1: readonly Rect[] = [
  [4, 3, 10, 7], // the castle mount
  [12, 8, 17, 9], // ribbon, north-west
  [29, 4, 35, 8], // the wooded height
  [22, 10, 30, 11], // the long central ribbon — the map's strongest horizontal line
  [4, 16, 10, 18], // the watchtower terrace
];

/** A second tier, only under the castle. One level-2 island is enough to read as height. */
const PLATEAU_2: readonly Rect[] = [[5, 4, 8, 6]];

/**
 * Staircases, as `[col, row, direction, lowLevel]` — the clicked cell is always the LOW half.
 *
 * `paintStairs` refuses a pair whose two endpoints are not a matching elevation boundary, and
 * refusing is a silent no-op. `buildReferenceMapBuild` therefore counts what actually landed and
 * reports it (`stairsPlaced`), so a terrace edit that quietly orphans a staircase shows up as a
 * number in the ASCII preview rather than as an unreachable plateau nobody notices for a week.
 */
const STAIRS: readonly (readonly [number, number, "east" | "west", 0 | 1])[] = [
  [11, 6, "west", 0], // up the castle mount from the east
  [9, 5, "west", 1], // the inner climb to the keep
  [18, 9, "west", 0], // onto the north-west ribbon
  [28, 6, "east", 0], // onto the wooded height
  [21, 11, "east", 0], // onto the central ribbon, from the west
  [31, 11, "west", 0], // and off its eastern end
  [11, 17, "west", 0], // onto the watchtower terrace
];

const TREES: readonly EditorAssetId[] = [
  "resource.terrain-resources-wood-trees.tree1",
  "resource.terrain-resources-wood-trees.tree2",
  "resource.terrain-resources-wood-trees.tree3",
  "resource.terrain-resources-wood-trees.tree4",
] as EditorAssetId[];

const BUSHES: readonly EditorAssetId[] = [
  "decoration.terrain-decorations-bushes.bushe1",
  "decoration.terrain-decorations-bushes.bushe2",
  "decoration.terrain-decorations-bushes.bushe3",
  "decoration.terrain-decorations-bushes.bushe4",
] as EditorAssetId[];

const ROCKS: readonly EditorAssetId[] = [
  "decoration.terrain-decorations-rocks.rock1",
  "decoration.terrain-decorations-rocks.rock2",
  "decoration.terrain-decorations-rocks.rock3",
  "decoration.terrain-decorations-rocks.rock4",
] as EditorAssetId[];

const WATER_ROCKS: readonly EditorAssetId[] = [
  "decoration.terrain-decorations-rocks-in-the-water.water-rocks-01",
  "decoration.terrain-decorations-rocks-in-the-water.water-rocks-02",
  "decoration.terrain-decorations-rocks-in-the-water.water-rocks-03",
  "decoration.terrain-decorations-rocks-in-the-water.water-rocks-04",
] as EditorAssetId[];

const CASTLE = "building.buildings-blue-buildings.castle" as EditorAssetId;
const TOWER = "building.buildings-blue-buildings.tower" as EditorAssetId;
const HOUSES: readonly EditorAssetId[] = [
  "building.buildings-blue-buildings.house1",
  "building.buildings-blue-buildings.house2",
  "building.buildings-blue-buildings.house3",
] as EditorAssetId[];

/** mulberry32, seeded from a string. Deterministic jitter: the étalon must not drift between builds. */
function rngFor(seed: string): () => number {
  let state = 0x9e3779b9;
  for (const character of seed) state = (state ^ character.charCodeAt(0)) * 0x01000193;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function element(
  assetId: EditorAssetId,
  col: number,
  row: number,
  offsetX = 0,
  offsetY = 0,
): MapElement {
  return { col, row, offsetX, offsetY, assetId };
}

/**
 * One stand of foliage: N instances of ONE species, jittered inside a radius around a centre.
 *
 * The species is chosen per CLUSTER, which is rule 2 above and the single biggest difference
 * between this and `scatter()`. Slots already taken are skipped rather than replaced, so a dense
 * cluster saturates its cells instead of silently dropping to one element per position.
 */
function cluster(
  taken: Set<string>,
  random: () => number,
  assets: readonly EditorAssetId[],
  centerCol: number,
  centerRow: number,
  radius: number,
  count: number,
): MapElement[] {
  const species = assets[Math.floor(random() * assets.length)];
  if (!species) return [];
  const out: MapElement[] = [];
  for (let attempt = 0; attempt < count * 4 && out.length < count; attempt += 1) {
    // Squared bias towards the centre: a stand is dense at its heart and thins at its edge.
    const angle = random() * Math.PI * 2;
    const distance = radius * random() * random();
    const col = Math.round(centerCol + Math.cos(angle) * distance);
    const row = Math.round(centerRow + Math.sin(angle) * distance);
    if (col < 0 || col >= REFERENCE_MAP_COLS || row < 0 || row >= REFERENCE_MAP_ROWS) continue;
    const offsetX = Math.floor(random() * 4);
    const offsetY = Math.floor(random() * 4);
    const key = `${col}:${row}:${offsetX}:${offsetY}`;
    if (taken.has(key)) continue;
    taken.add(key);
    out.push(element(species, col, row, offsetX, offsetY));
  }
  return out;
}

function forEachRectCell(rect: Rect, visit: (col: number, row: number) => void): void {
  const [c0, r0, c1, r1] = rect;
  for (let row = r0; row <= r1; row += 1) for (let col = c0; col <= c1; col += 1) visit(col, row);
}

export interface ReferenceMapBuild {
  map: MapData;
  /** How many of `STAIRS` actually landed. Anything below `STAIRS.length` means an orphaned terrace. */
  stairsPlaced: number;
  stairsRequested: number;
}

/**
 * Paint the étalon.
 *
 * Order is load-bearing: ground first, then the bays bitten out of it, then elevation (which owns
 * layer 1's cliff faces and must run after the coastline is final), then stairs, then decoration
 * last — the same "decor knows about everything already placed" discipline the island generator
 * got right.
 */
export function buildReferenceMapBuild(): ReferenceMapBuild {
  const cols = REFERENCE_MAP_COLS;
  const rows = REFERENCE_MAP_ROWS;
  const grass = GRASS_SLOTS[0];
  if (grass === undefined) throw new Error("tileset has no ground slot");

  let ground = emptyLayer(cols, rows);
  for (const [c0, r0, c1, r1] of LAND) {
    ground = paintRectAutotile(ground, TINY_SWORDS_TILESET, grass, c0, r0, c1, r1);
  }
  for (const [c0, r0, c1, r1] of BAYS) {
    ground = eraseRect(ground, TINY_SWORDS_TILESET, c0, r0, c1, r1);
  }
  // One oracle pass: every rect above re-resolved only its own neighbours, and rectangles that meet
  // along an edge can leave the join holding a variant neither of them recomputed.
  ground = resolveWholeLayer(ground, TINY_SWORDS_TILESET);

  let layers: TileLayer[] = [ground, emptyLayer(cols, rows), emptyLayer(cols, rows)];
  for (const rect of PLATEAU_1) {
    forEachRectCell(rect, (col, row) => {
      layers = paintElevation(layers, TINY_SWORDS_TILESET, 1, col, row);
    });
  }
  for (const rect of PLATEAU_2) {
    forEachRectCell(rect, (col, row) => {
      layers = paintElevation(layers, TINY_SWORDS_TILESET, 2, col, row);
    });
  }

  let stairsPlaced = 0;
  for (const [col, row, direction, lowLevel] of STAIRS) {
    const before = layers[1];
    layers = paintStairs(layers, TINY_SWORDS_TILESET, col, row, direction, lowLevel);
    if (layers[1] !== before) stairsPlaced += 1;
  }

  const random = rngFor("lindocara-reference-map");
  const taken = new Set<string>();
  const elements: MapElement[] = [];

  // Buildings first: they are the composition's anchors, and everything else has to make way.
  elements.push(element(CASTLE, 8, 7));
  elements.push(element(TOWER, 7, 18));
  elements.push(element(TOWER, 18, 25));
  // A village is a cluster too — four houses close enough to touch, not four scattered buildings.
  const village: readonly (readonly [number, number, number])[] = [
    [30, 17, 0],
    [33, 17, 1],
    [31, 20, 2],
    [35, 19, 0],
  ];
  for (const [col, row, variant] of village) {
    const house = HOUSES[variant];
    if (house) elements.push(element(house, col, row));
  }
  for (const placed of elements) taken.add(`${placed.col}:${placed.row}:0:0`);

  // Foliage: crowded at the edges and corners, thinning towards the open centre.
  const stands: readonly (readonly [number, number, number, number])[] = [
    [5, 9, 3, 14], // north-west shore
    [15, 4, 3, 12], // above the notch
    [23, 5, 3, 11], // the saddle
    [33, 6, 4, 22], // the deep north-east wood — the densest mass on the map
    [30, 3, 3, 12],
    [35, 21, 4, 18], // the south-east wood, balancing it
    [30, 23, 3, 10],
    [5, 20, 3, 12], // south-west shore
    [17, 16, 2, 7], // a thin screen on the neck
    [25, 15, 2, 6],
  ];
  for (const [col, row, radius, count] of stands) {
    elements.push(...cluster(taken, random, TREES, col, row, radius, count));
  }

  // Bushes hug the terrace rims — the small green spill over a cliff edge that the reference art
  // uses everywhere and that costs nothing to author.
  const rims: readonly (readonly [number, number])[] = [
    [4, 7],
    [7, 7],
    [10, 7],
    [13, 9],
    [16, 9],
    [23, 11],
    [26, 11],
    [29, 11],
    [30, 8],
    [34, 8],
    [5, 18],
    [9, 18],
    [3, 25],
    [5, 25],
  ];
  for (const [col, row] of rims) {
    elements.push(...cluster(taken, random, BUSHES, col, row, 1, 2));
  }

  // Loose rock near cliff feet and shorelines, sparse enough to read as incident, not as texture.
  const scree: readonly (readonly [number, number])[] = [
    [12, 7],
    [20, 12],
    [27, 9],
    [8, 14],
    [22, 20],
    [16, 21],
    [33, 12],
    [6, 16],
  ];
  for (const [col, row] of scree) {
    elements.push(...cluster(taken, random, ROCKS, col, row, 1, 1));
  }

  // Reefs. They hug the coast in the reference: a rock alone mid-ocean reads as a mistake.
  const reefs: readonly (readonly [number, number])[] = [
    [1, 6],
    [2, 11],
    [8, 23],
    [12, 24],
    [21, 25],
    [23, 20],
    [38, 8],
    [38, 17],
    [35, 26],
    [19, 2],
    [26, 2],
    [1, 19],
  ];
  for (const [col, row] of reefs) {
    elements.push(...cluster(taken, random, WATER_ROCKS, col, row, 1, 1));
  }

  const map: MapData = {
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols,
    rows,
    layers: layers.slice(0, MAP_LAYERS),
    elements,
    // The open centre, which is the point of leaving it open.
    spawn: { col: 19, row: 13 },
    markers: EMPTY_MARKERS,
  };
  return { map, stairsPlaced, stairsRequested: STAIRS.length };
}

export function buildReferenceMap(): MapData {
  return buildReferenceMapBuild().map;
}
