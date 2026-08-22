/**
 * What a ramp is allowed to lift a body over.
 *
 * A ramp is the one place ground rises under a walking body: `MAX_STEP` is 0 everywhere else, so
 * without an exception nothing could ever be climbed. The exception used to be "on a ramp, skip the
 * height tests", which is not an exception but a hole: a body whose centre was on the slope could
 * stand with its disc buried in a wall of any height, and at the head of a flight of stairs the
 * plateau's edge is exactly there. Both movers now raise the ceiling to the ramp's own top instead,
 * and these are the cases that separate the two readings.
 */

import { createHeroState, type StepDeps } from "@lindocara/engine/hd2d/hero-state.js";
import { stepHero } from "@lindocara/engine/hd2d/hero-step.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { TerrainRampSample } from "@lindocara/engine/hd2d/terrain-query.js";
import {
  BODY_RADIUS,
  canStand,
  zoneTerrainFromHeightfield,
} from "@lindocara/engine/terrain-access.js";
import { describe, expect, it } from "vitest";

import { depsPlates } from "./hd2d/helpers/step-deps.js";

const SIZE = 16;
const LEVEL_HEIGHT = 0.5;

/**
 * A flat grid with a plateau from row 12 south, a one-cell ramp at (8, 11) climbing into it, and a
 * tower of `towerLevel` in the cell due east of that ramp. Cell `i` covers `[i - 8, i - 7)`, so the
 * ramp is `x in [0, 1)`, `z in [3, 4)` and the tower is `x in [1, 2)`.
 */
function terrainWithTower(towerLevel: number) {
  const levels: (number | null)[] = [];
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if (col === 9 && row === 11) levels.push(towerLevel);
      else levels.push(row >= 12 ? 1 : 0);
    }
  }
  const map: MapData = {
    version: 1,
    size: SIZE,
    levelHeight: LEVEL_HEIGHT,
    waterLevel: -0.25,
    levels,
    materials: new Array(SIZE * SIZE).fill("herbe"),
    colliders: [],
    spawns: [],
    elements: [],
    events: [],
    ramps: [{ x: 0, z: 3, width: 1, depth: 1, direction: "south", lowLevel: 0 }],
  };
  return zoneTerrainFromHeightfield(map);
}

describe("a ramp lifts a body to its own top, and no further", () => {
  // Half way up the one-cell ramp: ground 0.25, top 0.5.
  const RAMP_X = 0.5;
  const RAMP_Z = 3.5;
  // Pushed east until the disc bites the neighbouring cell.
  const AGAINST_NEIGHBOUR = 0.85;

  it("lets a climbing body reach the ground the ramp delivers it onto", () => {
    // The neighbour is the plateau itself, at the ramp's top height.
    const terrain = terrainWithTower(1);
    expect(canStand(terrain, RAMP_X, RAMP_Z, BODY_RADIUS, 0.25)).toBe(true);
    expect(canStand(terrain, AGAINST_NEIGHBOUR, RAMP_Z, BODY_RADIUS, 0.25)).toBe(true);
  });

  it("refuses a body whose disc is inside something taller than the ramp", () => {
    // Three levels: a tower beside the stairs, not the ground they lead to.
    const terrain = terrainWithTower(3);
    expect(terrain.query.maxHeightAround(AGAINST_NEIGHBOUR, RAMP_Z, BODY_RADIUS)).toBeCloseTo(1.5);
    // The centre is still on the slope, which used to be enough to wave the whole body through.
    expect(terrain.query.rampAt(AGAINST_NEIGHBOUR, RAMP_Z)).not.toBeNull();
    expect(canStand(terrain, AGAINST_NEIGHBOUR, RAMP_Z, BODY_RADIUS, 0.25)).toBe(false);
    // And the middle of the ramp, away from the tower, is unaffected.
    expect(canStand(terrain, RAMP_X, RAMP_Z, BODY_RADIUS, 0.25)).toBe(true);
  });

  it("still refuses a cliff to a body that is not on a ramp at all", () => {
    const terrain = terrainWithTower(3);
    // North of the tower, on flat ground, with the disc just reaching into its cell.
    expect(terrain.query.rampAt(1.5, 2.9)).toBeNull();
    expect(canStand(terrain, 1.5, 2.9, BODY_RADIUS, 0)).toBe(false);
  });
});

/** The client's own mover, which is what actually decides where a hero's sprite ends up. */
describe("the hero's step applies the same ramp ceiling", () => {
  const RAMP_TOP = 0.5;

  function deps(neighbourHeight: number): StepDeps {
    const sample: TerrainRampSample = {
      x: 0,
      z: 3,
      width: 1,
      depth: 1,
      direction: "east",
      lowLevel: 0,
      height: 0.25,
      progress: 0.5,
      lowHeight: 0,
      highHeight: RAMP_TOP,
    };
    return depsPlates({
      // Ground: the ramp's own slope under x < 1, the neighbour beyond it.
      hauteur: (x) => (x < 1 ? 0.25 : neighbourHeight),
      // The disc reaches 0.3 ahead of the centre, so it bites the neighbour from x = 0.7.
      maxAutour: (x) => (x + 0.3 >= 1 ? neighbourHeight : 0.25),
      rampe: (x) => (x < 1 ? sample : null),
      franchit: () => true,
    });
  }

  function walkEast(step: StepDeps): number {
    const state = createHeroState(0.5, 3.5, 0.25, 10, 2.2);
    state.groundY = 0.25;
    for (let tick = 0; tick < 120; tick++) {
      stepHero(
        state,
        { x: 1, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false },
        1 / 60,
        step,
      );
    }
    return state.x;
  }

  it("walks up to the ground at the ramp's top", () => {
    // The neighbour is the plateau: the hero climbs onto it and keeps going.
    expect(walkEast(deps(RAMP_TOP))).toBeGreaterThan(1);
  });

  it("stops against a wall taller than the ramp instead of walking inside it", () => {
    // The neighbour is three levels up. The hero must stop with its disc outside it, which is at
    // x = 0.7 for a radius of 0.3.
    const stopped = walkEast(deps(1.5));
    expect(stopped).toBeLessThan(0.75);
    expect(stopped).toBeGreaterThan(0.5);
  });
});
