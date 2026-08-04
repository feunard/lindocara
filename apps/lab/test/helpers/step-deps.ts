import type { TerrainMaterial, TerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import type { ColliderQuery, StepDeps } from "../../src/world/hero-state.js";

interface Options {
  /** `true` là où un obstacle bloque. Par défaut : nulle part. */
  bloque?: (x: number, z: number) => boolean;
  /** Hauteur du sol, ou `null` pour de l'eau. Par défaut : plat à 0. */
  hauteur?: (x: number, z: number) => number | null;
  matiere?: (x: number, z: number) => TerrainMaterial | null;
}

/** Un terrain plat et sans obstacle, dont chaque morceau est surchargeable — `hero-step-*.test.ts`
 *  s'en servent tous : un seul fixture, pas un par task. */
export function depsPlates(o: Options = {}): StepDeps {
  const hauteur = o.hauteur ?? (() => 0);
  const matiere = o.matiere ?? (() => "herbe" as TerrainMaterial);
  const query: TerrainQuery = {
    heightAt: (x, z) => hauteur(x, z),
    maxHeightAround: (x, z) => hauteur(x, z) ?? 0,
    levelAt: (x, z) => (hauteur(x, z) === null ? null : 0),
    kindAt: (x, z) => matiere(x, z),
    cellCenter: (i, j) => [i + 0.5, j + 0.5],
  };
  const colliders: ColliderQuery = { blocked: (x, z) => o.bloque?.(x, z) ?? false };
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
      swim: { speed: 0.6, breath: 12, climb: 1.2 },
      pasTousLes: 1.2,
      brasseTousLes: 1.6,
      haleineRepos: 2.2,
      traceEcart: 0.12,
    },
    world: { size: 72, levelHeight: 0.9, waterLevel: 0, maxStep: 1 },
    glace: {
      charge: () => "intacte",
      relache: () => {},
      update: () => {},
      etat: () => "intacte",
      taille: () => 0,
    },
  };
}
