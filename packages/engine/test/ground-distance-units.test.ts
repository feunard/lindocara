/**
 * Every constant that is compared against a GROUND DISTANCE, pinned to an absolute number.
 *
 * **This is the guard for a whole bug class, not a list of radii.** A distance constant that keeps
 * its pixel value while the comparison around it moves to tile units cannot fail anything: the
 * gate simply stops gating. `REWARD_DISTANCE` sat at a bare `900` — fourteen times the widest grid
 * — through an entire increment, so every reward-eligibility check was permanently true and every
 * alive player on the map earned from every kill. `DIALOGUE_CLOSE_RADIUS` was `3 * TILE_SIZE`, so
 * the walk-away dialogue close needed a hero to walk 192 tiles and could never fire.
 *
 * Behavioural tests do not catch these, and the reason is worth stating: a test that places its
 * actors `CONSTANT ± 1` apart keeps meaning "just inside/outside the range" whatever the range is,
 * and is therefore blind to the UNIT by construction. Only an absolute number pins it.
 *
 * **If you add a constant that gets compared to `groundDistance`, `withinGroundRange` or a squared
 * ground distance, add it here.** The list below is the complete set as of S3's tile-units
 * increment, enumerated by grepping every `groundDistance` and `withinGroundRange` call site
 * across the packages' sources and reading what each one is compared to.
 */
import { describe, expect, it } from "vitest";
import { REWARD_DISTANCE, THREAT_LEASH_DISTANCE } from "../src/cooperation.js";
import { CORPSE_RECLAIM_RANGE } from "../src/death.js";
import { DIALOGUE_CLOSE_RADIUS } from "../src/event-commands.js";
import {
  GUARD_ATTACK_RANGE,
  GUARD_DETECTION_RANGE,
  INTERACTION_RANGE,
  LOOT_PICKUP_RANGE,
  MONSTER_AGGRO_RANGE,
  MONSTER_ATTACK_RANGE,
} from "../src/game.js";
import {
  CORPSE_VISIBILITY_RADIUS,
  GUARD_VISIBILITY_RADIUS,
  INTEREST_HYSTERESIS,
  LOCAL_CHAT_RADIUS,
  LOOT_VISIBILITY_RADIUS,
  MONSTER_VISIBILITY_RADIUS,
  PLAYER_VISIBILITY_RADIUS,
  SPATIAL_CELL_SIZE,
  SPATIAL_EVENT_RADIUS,
} from "../src/interest.js";

// The pixel values these replace, kept here as the record of what was converted. When the same
// world is measured in tiles instead of pixels, every radius must cover the SAME ground — a
// rounded-off radius is a balance change wearing a refactor's clothes.
const TILE_SIZE = 64;

describe("interest radii, in tile units", () => {
  it("covers exactly the ground the pixel radii covered", () => {
    expect(PLAYER_VISIBILITY_RADIUS).toBe(900 / TILE_SIZE);
    expect(GUARD_VISIBILITY_RADIUS).toBe(900 / TILE_SIZE);
    expect(CORPSE_VISIBILITY_RADIUS).toBe(900 / TILE_SIZE);
    expect(MONSTER_VISIBILITY_RADIUS).toBe(850 / TILE_SIZE);
    expect(LOCAL_CHAT_RADIUS).toBe(700 / TILE_SIZE);
    expect(LOOT_VISIBILITY_RADIUS).toBe(650 / TILE_SIZE);
    expect(INTEREST_HYSTERESIS).toBe(96 / TILE_SIZE);
    expect(SPATIAL_EVENT_RADIUS).toBe(850 / TILE_SIZE);
    expect(SPATIAL_CELL_SIZE).toBe(256 / TILE_SIZE);
  });

  it("pins every other ground-distance constant to its pixel original", () => {
    // Reward eligibility — the one that survived the increment unconverted. At a bare 900 it was
    // ~14x the widest grid, so all three gates in `worldTick.ts`'s kill-reward path were
    // permanently true: the 14-tile proximity requirement `docs/cooperative-combat.md` describes
    // did not exist, and no suite could see it because a gate that always passes looks satisfied.
    expect(REWARD_DISTANCE).toBe(900 / TILE_SIZE);
    expect(THREAT_LEASH_DISTANCE).toBe(1_100 / TILE_SIZE);
    expect(MONSTER_AGGRO_RANGE).toBe(210 / TILE_SIZE);
    expect(MONSTER_ATTACK_RANGE).toBe(42 / TILE_SIZE);
    expect(GUARD_DETECTION_RANGE).toBe(360 / TILE_SIZE);
    expect(GUARD_ATTACK_RANGE).toBe(54 / TILE_SIZE);
    expect(INTERACTION_RANGE).toBe(92 / TILE_SIZE);
    expect(LOOT_PICKUP_RANGE).toBe(46 / TILE_SIZE);
    expect(CORPSE_RECLAIM_RANGE).toBe(44 / TILE_SIZE);
  });

  it("keeps every ground-distance constant inside a grid a map could actually have", () => {
    // The cheap catch-all, and the one that would have caught `REWARD_DISTANCE` without anybody
    // knowing its pixel original: the largest heightfield an author can build is 64 cells a side,
    // so a distance bound larger than that describes no reachable pair of points and is a gate
    // that cannot gate. Elevation-free by construction — these are all ground distances.
    const LARGEST_GRID = 64;
    for (const [name, value] of [
      ["REWARD_DISTANCE", REWARD_DISTANCE],
      ["THREAT_LEASH_DISTANCE", THREAT_LEASH_DISTANCE],
      ["DIALOGUE_CLOSE_RADIUS", DIALOGUE_CLOSE_RADIUS],
      ["PLAYER_VISIBILITY_RADIUS", PLAYER_VISIBILITY_RADIUS],
      ["MONSTER_VISIBILITY_RADIUS", MONSTER_VISIBILITY_RADIUS],
      ["GUARD_VISIBILITY_RADIUS", GUARD_VISIBILITY_RADIUS],
      ["CORPSE_VISIBILITY_RADIUS", CORPSE_VISIBILITY_RADIUS],
      ["LOOT_VISIBILITY_RADIUS", LOOT_VISIBILITY_RADIUS],
      ["LOCAL_CHAT_RADIUS", LOCAL_CHAT_RADIUS],
      ["SPATIAL_EVENT_RADIUS", SPATIAL_EVENT_RADIUS],
      ["MONSTER_AGGRO_RANGE", MONSTER_AGGRO_RANGE],
      ["MONSTER_ATTACK_RANGE", MONSTER_ATTACK_RANGE],
      ["GUARD_DETECTION_RANGE", GUARD_DETECTION_RANGE],
      ["GUARD_ATTACK_RANGE", GUARD_ATTACK_RANGE],
      ["INTERACTION_RANGE", INTERACTION_RANGE],
      ["LOOT_PICKUP_RANGE", LOOT_PICKUP_RANGE],
      ["CORPSE_RECLAIM_RANGE", CORPSE_RECLAIM_RANGE],
    ] as const) {
      expect(`${name}=${value}`).toBe(`${name}=${value}`);
      expect(value).toBeLessThanOrEqual(LARGEST_GRID);
      expect(value).toBeGreaterThan(0);
    }
  });

  it("pins the dialogue walk-away radius absolutely, not against itself", () => {
    // Three TILES. It was `3 * TILE_SIZE` — a pixel length — long after the two comparisons that
    // read it (`worldTick.ts`'s `groundDistance` calls) had moved to tile units, so the walk-away
    // close could never fire: a hero would have had to travel 192 tiles, past the edge of any grid,
    // and nothing failed.
    //
    // The end-to-end test of that behaviour cannot catch this, and the distinction is worth naming:
    // it walks the hero `DIALOGUE_CLOSE_RADIUS + 1` so that it keeps meaning "one unit beyond the
    // radius" whatever the radius is — which makes it blind to the radius's UNIT by construction.
    // Only an absolute number pins that, which is exactly what this file is for.
    expect(DIALOGUE_CLOSE_RADIUS).toBe(3);
    expect(DIALOGUE_CLOSE_RADIUS).toBeLessThan(LOOT_VISIBILITY_RADIUS);
  });

  it("keeps the ordering the AOI design depends on", () => {
    // Players are seen furthest, loot nearest, and hysteresis is far smaller than any radius —
    // an exit band wider than the band it guards would make entries and exits flap.
    expect(PLAYER_VISIBILITY_RADIUS).toBeGreaterThan(MONSTER_VISIBILITY_RADIUS);
    expect(MONSTER_VISIBILITY_RADIUS).toBeGreaterThan(LOCAL_CHAT_RADIUS);
    expect(LOCAL_CHAT_RADIUS).toBeGreaterThan(LOOT_VISIBILITY_RADIUS);
    expect(INTEREST_HYSTERESIS).toBeLessThan(LOOT_VISIBILITY_RADIUS / 4);
  });
});
