import { describe, expect, it } from "vitest";
import {
  CEMETERIES,
  CITY_GUARDS,
  MONSTER_SPAWNS,
  QUEST_DEFINITIONS,
  QUEST_SITES,
  SPAWN_POINTS,
} from "../src/shared/game.js";
// PLAYER_SIZE lives in simulation.ts, not game.ts.
import { PLAYER_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from "../src/shared/simulation.js";
import { isSolidKind, isWalkableBox, kindAt, TILE_SIZE } from "../src/shared/tilemap.js";
import { VERDANT_REACH_TILES } from "../src/shared/zones/verdant-reach-tiles.js";

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
});
