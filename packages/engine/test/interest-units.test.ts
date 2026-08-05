import { describe, expect, it } from "vitest";
import { DIALOGUE_CLOSE_RADIUS } from "../src/event-commands.js";
import {
  CORPSE_VISIBILITY_RADIUS,
  GUARD_VISIBILITY_RADIUS,
  INTEREST_HYSTERESIS,
  LOCAL_CHAT_RADIUS,
  LOOT_VISIBILITY_RADIUS,
  MONSTER_VISIBILITY_RADIUS,
  PLAYER_VISIBILITY_RADIUS,
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
