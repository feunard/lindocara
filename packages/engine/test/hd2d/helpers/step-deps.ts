import type { ColliderQuery, StepDeps } from "@lindocara/engine/hd2d/hero-state.js";
import type {
  TerrainLiquid,
  TerrainMaterial,
  TerrainQuery,
  TerrainRampSample,
} from "@lindocara/engine/hd2d/terrain-query.js";

interface Options {
  /** `true` where an obstacle blocks. Default: nowhere. */
  bloque?: (x: number, z: number, y?: number) => boolean;
  /** Ground height, or `null` for water. Default: flat at 0. */
  hauteur?: (x: number, z: number) => number | null;
  surface?: (x: number, z: number, ceilingY: number) => number | null;
  matiere?: (x: number, z: number) => TerrainMaterial | null;
  liquide?: (x: number, z: number) => TerrainLiquid | null;
  /** World height of the water surface at a point. Default: 0 everywhere, which is what every map
   *  without water at elevation answers. */
  eau?: (x: number, z: number) => number;
  /** The slope under a point, for the tests that care what a ramp may and may not lift a body
   *  over. Default: no ramps anywhere. */
  rampe?: (x: number, z: number) => TerrainRampSample | null;
  /** Whether one segment follows a stair corridor. Default: never. */
  franchit?: (fromX: number, fromZ: number, toX: number, toZ: number, r: number) => boolean;
  /** The highest ground the body's DISC touches. Default: the height under the point itself, which
   *  is what a fixture with no relief beside the hero wants. */
  maxAutour?: (x: number, z: number, r: number, ceilingY?: number) => number;
}

/** Flat, obstacle-free terrain, every part of which can be overridden — every
 *  `hero-step-*.test.ts` uses it: one fixture, not one per test file. */
export function depsPlates(o: Options = {}): StepDeps {
  const hauteur = o.hauteur ?? (() => 0);
  const matiere = o.matiere ?? (() => "herbe" as TerrainMaterial);
  const query: TerrainQuery = {
    heightAt: (x, z) => hauteur(x, z),
    surfaceAt: (x, z, ceilingY) => o.surface?.(x, z, ceilingY) ?? hauteur(x, z),
    maxHeightAround: (x, z, r, ceilingY) => o.maxAutour?.(x, z, r, ceilingY) ?? hauteur(x, z) ?? 0,
    levelAt: (x, z) => (hauteur(x, z) === null ? null : 0),
    kindAt: (x, z) => matiere(x, z),
    liquidAt: (x, z) =>
      o.liquide?.(x, z) ??
      (matiere(x, z) === "lave" ? "lava" : hauteur(x, z) === null ? "water" : null),
    rampAt: (x, z) => o.rampe?.(x, z) ?? null,
    canTraverseRamp: (fromX, fromZ, toX, toZ, r) =>
      o.franchit?.(fromX, fromZ, toX, toZ, r) ?? false,
    cellCenter: (i, j) => [i + 0.5, j + 0.5],
    // A world with no elevated water answers the same surface everywhere, which is what every
    // map but the lab's summit spring does. `eau` lets a test place water higher when it wants to.
    waterLevelAt: (x, z) => o.eau?.(x, z) ?? 0,
  };
  const colliders: ColliderQuery = { blocked: (x, z, _r, y) => o.bloque?.(x, z, y) ?? false };
  return {
    query,
    colliders,
    hero: {
      speed: 4.2,
      radius: 0.3,
      offset: 0.35,
      friction: { herbe: 80, neige: 130, glace: 0.35 },
      vitesseSol: { herbe: 1, neige: 0.55, glace: 1 },
      jump: { speed: 6, gravity: 18, coyote: 0.12 },
      glide: { fall: 2 },
      swim: { speed: 0.6, breath: 12, climb: 1.2 },
      pasTousLes: 1.2,
      brasseTousLes: 1.6,
      haleineRepos: 2.2,
      traceEcart: 0.12,
    },
    world: { size: 72, levelHeight: 0.9, waterLevel: 0, maxStep: 1 },
  };
}
