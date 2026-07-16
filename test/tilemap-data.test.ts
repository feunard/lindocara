import { describe, expect, it } from "vitest";
import {
  CEMETERIES,
  CITY_GUARDS,
  MONSTER_SPAWNS,
  QUEST_DEFINITIONS,
  QUEST_SITES,
  SPAWN_POINTS,
  TERRAIN_BLOCKERS,
} from "../src/shared/game.js";
// PLAYER_SIZE lives in simulation.ts, not game.ts.
import { PLAYER_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from "../src/shared/simulation.js";
import {
  isSolidKind,
  isWalkableBox,
  kindAt,
  kindAtPoint,
  TILE_SIZE,
} from "../src/shared/tilemap.js";
import { SUNKEN_ISLES_SPAWNS } from "../src/shared/zones/sunken-isles.js";
import { SUNKEN_ISLES_TILES } from "../src/shared/zones/sunken-isles-tiles.js";
import { VERDANT_REACH_TILES } from "../src/shared/zones/verdant-reach-tiles.js";

// Frozen exactly as `src/shared/zones/verdant-reach-tiles.ts` read the moment before Task 1
// touched the generator — copied by hand from the committed file, not computed from it, and
// never regenerated. At that point the generator only ever emitted "water" or "grass", so solid
// meant one thing: the character is "#". This is the independent witness the bit-identical test
// below compares against; if it were derived from the new map instead, that test would compare
// the new generator to itself and prove nothing.
const SLICE_1_ROWS = [
  "###########################################################################",
  "###########################################################################",
  "#####################...##########################################.......##",
  "##......................##########################################.......##",
  "##.....................................###...............................##",
  "##..........####..###..................###...............................##",
  "##..........####..###..................###...............................##",
  "##.....................................###...............................##",
  "##.....................................###....................#############",
  "##.....................................###....................#############",
  "##......#......................##......###............#.......#############",
  "##..................####.......##.....................##.......############",
  "##..................####.................................................##",
  "##.......................................................................##",
  "##....####..............................##...............................##",
  "##.....##...####.###...................#########.........................##",
  "##..........###..##....................#########.........................##",
  "##......................######...###############.....................###.##",
  "##......................######...###############.........##..........###.##",
  "##......................######...###############.........................##",
  "#####################...######...###############.........................##",
  "#####################...######...###########################.............##",
  "#####################....####.....########......############.............##",
  "#####################..................###......############.............##",
  "#####################..................###......###########..............##",
  "#####################..................###...............................##",
  "#####################...................##...............................##",
  "#####################....................................................##",
  "#####################.......####................###...............#########",
  "##.............###..........####...............#####...........############",
  "##..............#...........####.......###......###.........###############",
  "##.....................................########.............###############",
  "##.....................................########.............###############",
  "##.....................................########................############",
  "##.....................................########..........#.....############",
  "##.....................................########................############",
  "##.....................................########......####......############",
  "##.....................########################.....#####......############",
  "##.....................########################.....#####......############",
  "##.....................########################................############",
  "##....................#########################................############",
  "###########################################################################",
  "...........................................................................",
] as const;

function solidMaskFromSlice1(): number[] {
  return SLICE_1_ROWS.flatMap((row) => [...row].map((char) => (char === "#" ? 1 : 0)));
}

// A tilemap that swallows a spawn point strands a player in a rock forever; one that swallows a
// quest site makes the quest uncompletable. The old rectangles allowed both to sit a few pixels
// from a wall, and 64px cells are coarser than a few pixels — so this is where we find out.
describe("the generated Verdant Reach tilemap", () => {
  it("covers the whole world", () => {
    expect(VERDANT_REACH_TILES.cols).toBe(Math.ceil(WORLD_WIDTH / TILE_SIZE));
    expect(VERDANT_REACH_TILES.rows).toBe(Math.ceil(WORLD_HEIGHT / TILE_SIZE));
    expect(VERDANT_REACH_TILES.kinds).toHaveLength(
      VERDANT_REACH_TILES.cols * VERDANT_REACH_TILES.rows,
    );
  });

  it("keeps every player spawn point walkable", () => {
    for (const point of SPAWN_POINTS) {
      expect(
        isWalkableBox(VERDANT_REACH_TILES, point, PLAYER_SIZE),
        `spawn ${point.x},${point.y}`,
      ).toBe(true);
    }
  });

  it("keeps every quest site and quest giver reachable", () => {
    for (const site of QUEST_SITES) {
      expect(isWalkableBox(VERDANT_REACH_TILES, site, PLAYER_SIZE), `site ${site.id}`).toBe(true);
    }
    for (const quest of QUEST_DEFINITIONS) {
      const giver = quest.giver;
      expect(isWalkableBox(VERDANT_REACH_TILES, giver, PLAYER_SIZE), `giver ${giver.id}`).toBe(
        true,
      );
    }
  });

  it("keeps every monster spawn and guard post walkable", () => {
    for (const spawn of MONSTER_SPAWNS) {
      expect(isWalkableBox(VERDANT_REACH_TILES, spawn, PLAYER_SIZE), `monster ${spawn.id}`).toBe(
        true,
      );
    }
    for (const guard of CITY_GUARDS) {
      expect(isWalkableBox(VERDANT_REACH_TILES, guard, PLAYER_SIZE), `guard ${guard.id}`).toBe(
        true,
      );
    }
  });

  it("keeps every cemetery walkable, so a released ghost is not born inside a rock", () => {
    for (const cemetery of CEMETERIES) {
      expect(
        isWalkableBox(VERDANT_REACH_TILES, cemetery, PLAYER_SIZE),
        `cemetery ${cemetery.id}`,
      ).toBe(true);
    }
  });

  it("walls the world in", () => {
    expect(isWalkableBox(VERDANT_REACH_TILES, { x: 0, y: 0 }, PLAYER_SIZE)).toBe(false);
    expect(
      isWalkableBox(VERDANT_REACH_TILES, { x: WORLD_WIDTH - PLAYER_SIZE, y: 1000 }, PLAYER_SIZE),
    ).toBe(false);
  });

  // Row 42 (the last one) is 2700-2752px, past WORLD_HEIGHT (2700): 43 rows * 64px overshoots a
  // world height that is not a multiple of TILE_SIZE. It rasterises all-grass because its sliver
  // inside the world (2688-2700) doesn't clear the 50% solid threshold. That would still make it
  // reachable, except row 41 sits entirely inside the 96px bottom boundary wall and rasterises
  // fully solid, sealing row 42 off — and clampToWorld caps a player's y at
  // WORLD_HEIGHT - PLAYER_SIZE (2668), so a box can never even reach past row 41 to test it. This
  // pins both halves of that: the sealing row, and the clamp that keeps anyone from touching it.
  it("keeps the last row unreachable: a solid row 41 seals off an all-grass row 42", () => {
    const lastRow = VERDANT_REACH_TILES.rows - 1;
    const sealingRow = lastRow - 1;
    for (let col = 0; col < VERDANT_REACH_TILES.cols; col++) {
      expect(isSolidKind(kindAt(VERDANT_REACH_TILES, col, sealingRow)), `col ${col}`).toBe(true);
    }

    // No clamped position puts a box's top row past the sealing row...
    const maxY = WORLD_HEIGHT - PLAYER_SIZE;
    expect(Math.floor(maxY / TILE_SIZE)).toBe(sealingRow);

    // ...so standing as far down as the world allows is blocked everywhere along x, for every
    // player that could ever reach that y at all.
    for (let x = 0; x <= WORLD_WIDTH - PLAYER_SIZE; x += TILE_SIZE) {
      expect(isWalkableBox(VERDANT_REACH_TILES, { x, y: maxY }, PLAYER_SIZE), `x ${x}`).toBe(false);
    }
  });

  // This used to demand the solid mask be bit-identical to the rect union. It no longer can be, and
  // that is the point: a forest is now trunks with an open canopy row above each, so you can stand
  // in under the branches instead of colliding with a wall of leaves.
  //
  // The guarantee is therefore narrower but still exact — collision may only ever OPEN, only on a
  // canopy cell, and only directly above a trunk. Water and buildings must not move by one cell.
  // If this fails, something other than the forest thinning changed collision.
  it("opens collision only where a canopy sits over a trunk, and nowhere else", () => {
    const SOLID_BEFORE = solidMaskFromSlice1();
    const solidNow = VERDANT_REACH_TILES.kinds.map((kind) => (isSolidKind(kind) ? 1 : 0));
    expect(solidNow.length).toBe(SOLID_BEFORE.length);

    let opened = 0;
    for (let index = 0; index < solidNow.length; index++) {
      if (solidNow[index] === SOLID_BEFORE[index]) continue;
      const col = index % VERDANT_REACH_TILES.cols;
      const row = Math.floor(index / VERDANT_REACH_TILES.cols);
      const where = `cell ${col},${row}`;

      // Never the other way: nothing that was walkable may start blocking.
      expect(SOLID_BEFORE[index], `${where} must have been solid`).toBe(1);
      expect(solidNow[index], `${where} must now be open`).toBe(0);
      // It opened because it is a canopy: grass, with the tree it belongs to directly below.
      expect(kindAt(VERDANT_REACH_TILES, col, row), `${where} is a canopy`).toBe("grass");
      expect(kindAt(VERDANT_REACH_TILES, col, row + 1), `${where} stands over a trunk`).toBe(
        "forest",
      );
      opened++;
    }
    // The thinning must actually have run. Zero would mean this test proves nothing.
    expect(opened).toBeGreaterThan(0);
  });

  it("labels the forests as forest, the water as water, and the ground under buildings as building", () => {
    // The first forest blocker: heartroot-north-canopy. The first water blocker: river-north-deepwater.
    const forest = TERRAIN_BLOCKERS.find((b) => b.kind === "forest");
    const water = TERRAIN_BLOCKERS.find((b) => b.kind === "water");
    if (!forest || !water) throw new Error("expected a forest and a water blocker");
    // heartroot-north-canopy is a thin 120px canopy strip (under 2 tiles tall) — offsetting +96
    // into it, as a chunkier blocker would allow, lands in a cell this rect alone covers only
    // 37.5% of, which is correctly "grass" (open) under the unchanged SOLID_COVERAGE rule and
    // matches the frozen Slice 1 mask. +64 stays inside the one row this strip fully covers.
    expect(kindAtPoint(VERDANT_REACH_TILES, forest.rect.x + 64, forest.rect.y + 64)).toBe("forest");
    expect(kindAtPoint(VERDANT_REACH_TILES, water.rect.x + 96, water.rect.y + 96)).toBe("water");
    // No blue lakes where the buildings are.
    expect(VERDANT_REACH_TILES.kinds.filter((k) => k === "building").length).toBeGreaterThan(0);
  });
});

describe("the Sunken Isles map", () => {
  it("is a 40x30 map with the open sea all the way round it", () => {
    expect(SUNKEN_ISLES_TILES.cols).toBe(40);
    expect(SUNKEN_ISLES_TILES.rows).toBe(30);
    for (let col = 0; col < SUNKEN_ISLES_TILES.cols; col++) {
      expect(kindAt(SUNKEN_ISLES_TILES, col, 0)).toBe("water");
      expect(kindAt(SUNKEN_ISLES_TILES, col, SUNKEN_ISLES_TILES.rows - 1)).toBe("water");
    }
    for (let row = 0; row < SUNKEN_ISLES_TILES.rows; row++) {
      expect(kindAt(SUNKEN_ISLES_TILES, 0, row)).toBe("water");
      expect(kindAt(SUNKEN_ISLES_TILES, SUNKEN_ISLES_TILES.cols - 1, row)).toBe("water");
    }
  });

  // The whole point of `rasteriseIslands` is that water is the default. If this ever drops, the
  // zone has quietly become a field with ponds in it — which is the other rasteriser's job.
  it("is mostly sea — it is an archipelago, not a rectangle with ponds", () => {
    const water = SUNKEN_ISLES_TILES.kinds.filter((k) => k === "water").length;
    expect(water / SUNKEN_ISLES_TILES.kinds.length).toBeGreaterThan(0.35);
  });

  it("stands every spawn on walkable land", () => {
    for (const spawn of SUNKEN_ISLES_SPAWNS) {
      expect(isWalkableBox(SUNKEN_ISLES_TILES, spawn, PLAYER_SIZE)).toBe(true);
    }
  });

  it("puts its buildings and treelines on the islands", () => {
    expect(SUNKEN_ISLES_TILES.kinds.filter((k) => k === "building").length).toBeGreaterThan(0);
    expect(SUNKEN_ISLES_TILES.kinds.filter((k) => k === "forest").length).toBeGreaterThan(0);
  });
});
