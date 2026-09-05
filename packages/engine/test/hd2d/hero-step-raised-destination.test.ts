/**
 * What `canEnter`'s centre rule may read as the height of a destination it cannot reach.
 *
 * `reachableSurfaceAt` answered the liquid plane whenever `surfaceAt` came back null, and null
 * covers two situations that are not the same: no ground at all (water, a void cell) and ground
 * that exists but stands above the ceiling. For the second the liquid plane INVERTS every
 * comparison the centre rule makes, because it sits below the hero: a three-level wall reads as a
 * step DOWN and the move is accepted.
 *
 * The hard barrier added with the elevation-fall fix covers the plain case, a grounded hero on
 * surface terrain, and these are the three states it deliberately steps aside for: a hero on a
 * ramp, a hero in the air, and a swimmer. The footprint disc is the other line of defence, and it
 * stops covering the same move exactly where the query drops cells from the footprint maximum for
 * a body under a surface, which is a hero on a bridge deck, on a ramp between storeys or beside a
 * shaft. These fixtures model that by answering the low ground from `maxHeightAround` while the
 * heightfield keeps reporting the wall truthfully, so the centre rule is on its own.
 */

import {
  createHeroState,
  type HeroState,
  type StepDeps,
} from "@lindocara/engine/hd2d/hero-state.js";
import { stepHero } from "@lindocara/engine/hd2d/hero-step.js";
import type {
  TerrainLiquid,
  TerrainQuery,
  TerrainRampSample,
} from "@lindocara/engine/hd2d/terrain-query.js";
import { describe, expect, it } from "vitest";

const LEVEL_HEIGHT = 0.9;
const WATER_LEVEL = -0.05;
/** The boundary: everything north of it is raised, everything south of it is the low region. */
const EDGE = -1;
/** The footprint leads the centre by `hero.offset`, so a centre south of this never put a foot on
 *  the raised cell. */
const KEPT_OUT = EDGE + 0.15;
const NORTH = { x: 0, z: -1, jump: false, attack: false, souffleTaux: 1, haleineVisible: false };

interface World {
  /** Height of the raised region north of `EDGE`. */
  high: number;
  /** Height of the low region, or `null` for open water. */
  low: number | null;
  /** Surface of the water filling the low region, when it is water. */
  pool?: number;
  /** A flat ramp under the hero, which is one of the states the barrier steps aside for. */
  ramp?: boolean;
}

function deps(world: World): StepDeps {
  const heightAt = (_x: number, z: number): number | null => (z < EDGE ? world.high : world.low);
  const floor = world.low ?? world.pool ?? WATER_LEVEL;
  /** A flat one-cell ramp sitting at the low ground: enough to put the hero in the "on a ramp"
   *  state the barrier steps aside for, without lifting it anywhere. */
  const ramp: TerrainRampSample = {
    x: 0,
    z: EDGE,
    width: 1,
    depth: 1,
    direction: "north",
    lowLevel: 0,
    progress: 0,
    height: floor,
    lowHeight: floor,
    highHeight: floor,
  };
  const query: TerrainQuery = {
    heightAt,
    surfaceAt: (x, z, ceilingY) => {
      const h = heightAt(x, z);
      return h !== null && h <= ceilingY + 1e-3 ? h : null;
    },
    // The under-a-surface exemption: the raised cells are dropped from the footprint maximum, so
    // the disc rule cannot refuse this move and the centre rule is the only thing left.
    maxHeightAround: () => floor,
    levelAt: () => 0,
    kindAt: () => "herbe",
    liquidAt: (x, z): TerrainLiquid | null => (heightAt(x, z) === null ? "water" : null),
    rampAt: () => (world.ramp ? ramp : null),
    canTraverseRamp: () => world.ramp === true,
    cellCenter: (i, j) => [i + 0.5, j + 0.5],
    // A dry land cell has no water of its own and answers the map's distant sea plane, which is
    // the value the old fallback handed to the centre rule.
    waterLevelAt: (x, z) => (heightAt(x, z) === null ? (world.pool ?? WATER_LEVEL) : WATER_LEVEL),
  };
  return {
    query,
    colliders: { blocked: () => false },
    hero: {
      speed: 4.2,
      radius: 0.25,
      offset: 0.15,
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
    world: { size: 72, levelHeight: LEVEL_HEIGHT, waterLevel: WATER_LEVEL, maxStep: 0 },
  };
}

/** Walks north for a second and answers how far north the centre ever got. */
function northmostZ(d: StepDeps, prepare: (s: HeroState) => void): number {
  const state = createHeroState(0, 0, 0, 11, 2.2);
  prepare(state);
  let northmost = state.z;
  for (let i = 0; i < 60; i++) {
    stepHero(state, NORTH, 1 / 60, d);
    northmost = Math.min(northmost, state.z);
  }
  return northmost;
}

describe("a destination too high to reach is not a step down", () => {
  it("refuses a hero on a ramp the centre of a three-level wall", () => {
    const d = deps({ high: 3 * LEVEL_HEIGHT, low: 0, ramp: true });
    const z = northmostZ(d, (s) => {
      s.y = 0;
      s.groundY = 0;
    });
    expect(z).toBeGreaterThan(KEPT_OUT);
  });

  it("refuses a jumping hero a wall its arc never clears", () => {
    // Jump speed 9 against gravity 30 tops out 1.35 above the take-off, well under the wall.
    const d = deps({ high: 3 * LEVEL_HEIGHT, low: 0 });
    const z = northmostZ(d, (s) => {
      s.y = 0;
      s.groundY = 0;
      s.airborne = true;
      s.vy = 9;
    });
    expect(z).toBeGreaterThan(KEPT_OUT);
  });

  it("refuses a swimmer a bank standing further above the water than it can mantle", () => {
    const POOL = 2.7;
    // `climb` is levelHeight * swim.climb, so 0.45, and this bank is 1.8 above the water.
    const d = deps({ high: POOL + 1.8, low: null, pool: POOL });
    const z = northmostZ(d, (s) => {
      s.y = POOL;
      s.groundY = POOL;
      s.swimming = true;
      s.liquid = "water";
    });
    expect(z).toBeGreaterThan(KEPT_OUT);
  });
});
