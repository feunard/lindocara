/**
 * What the vertical rule may answer when no surface is reachable under the hero's feet.
 *
 * `surfaceAt` answers `null` for two situations that are not the same: nothing is there at all (a
 * void cell, open water) and something IS there but stands above the ceiling a grounded body may
 * step to. Reading the second as the first sends the hero to the map's water plane, and a water
 * plane is not a floor: on ordinary ground it sits below and the hero sinks through the terrain,
 * while on the sunken ground opened up by negative elevations it sits ABOVE and the hero is lifted
 * out of the pit in a single frame.
 *
 * Both fixtures put the hero's FOOTPRINT over a cell it could never have walked onto, which is the
 * state a teleport, a knockback or a terrain edit leaves behind: none of those consult `canEnter`,
 * so the vertical rule has to be sound on its own.
 */

import { createHeroState, type StepDeps } from "@lindocara/engine/hd2d/hero-state.js";
import { stepHero } from "@lindocara/engine/hd2d/hero-step.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import {
  BODY_RADIUS,
  HERO_FOOTPRINT_OFFSET,
  MAX_STEP,
  zoneTerrainFromHeightfield,
} from "@lindocara/engine/terrain-access.js";
import { describe, expect, it } from "vitest";

const SIZE = 16;
const LEVEL_HEIGHT = 0.9;
/** The sea plane of an ordinary map: below level 0, and ABOVE a floor sunk one level. */
const WATER_LEVEL = -0.05;
const PIT = -LEVEL_HEIGHT;
const IMMOBILE = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false };

/**
 * Rows 0-3 carry a three-level wall, rows 8-11 a floor sunk one level, everything else is level 0.
 * Cell row `j` covers `z` in `[j - 8, j - 7)`.
 */
function levelOfRow(row: number): number {
  if (row < 4) return 3;
  if (row >= 8 && row < 12) return -1;
  return 0;
}

function deps(): StepDeps {
  const levels: (number | null)[] = [];
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) levels.push(levelOfRow(row));
  }
  const map: MapData = {
    version: 1,
    size: SIZE,
    levelHeight: LEVEL_HEIGHT,
    waterLevel: WATER_LEVEL,
    levels,
    materials: new Array(SIZE * SIZE).fill("herbe"),
    colliders: [],
    spawns: [],
    elements: [],
    events: [],
    ramps: [],
  };
  const terrain = zoneTerrainFromHeightfield(map);
  return {
    query: terrain.query,
    colliders: terrain.colliders,
    hero: {
      speed: 4.2,
      radius: BODY_RADIUS,
      offset: HERO_FOOTPRINT_OFFSET,
      friction: { herbe: 80, neige: 130, glace: 0.35 },
      vitesseSol: { herbe: 1, neige: 0.55, glace: 1 },
      jump: { speed: 9, gravity: 30, coyote: 0.12 },
      glide: { fall: 2.2 },
      swim: { speed: 0.45, breath: 11, climb: 0.5 },
      pasTousLes: 1.2,
      brasseTousLes: 0.85,
      haleineRepos: 2.2,
      traceEcart: 0.14,
    },
    world: {
      size: SIZE,
      levelHeight: LEVEL_HEIGHT,
      waterLevel: WATER_LEVEL,
      maxStep: MAX_STEP,
    },
  };
}

describe("a foot over ground it cannot reach never reads the water plane as its floor", () => {
  it("keeps a hero on level-0 ground instead of sinking it to the sea", () => {
    // Centre on level 0 (row 4), footprint 0.15 further north, over the three-level wall (row 3).
    const state = createHeroState(0, -3.9, 0, 11, 2.2);
    state.groundY = 0;

    const d = deps();
    for (let i = 0; i < 120; i++) stepHero(state, IMMOBILE, 1 / 60, d);

    expect(state.y).toBeCloseTo(0, 6);
    expect(state.airborne).toBe(false);
    expect(state.swimming).toBe(false);
  });

  it("keeps a hero on a floor sunk below the sea plane instead of lifting it out", () => {
    // Centre in the pit (row 8), footprint 0.15 further north, over the level-0 rim (row 7).
    const state = createHeroState(0, 0.1, PIT, 11, 2.2);
    state.groundY = PIT;

    stepHero(state, IMMOBILE, 1 / 60, deps());

    expect(state.y).toBeCloseTo(PIT, 6);
    expect(state.groundY).toBeCloseTo(PIT, 6);
  });
});
