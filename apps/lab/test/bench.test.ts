import type { TerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import { describe, expect, it } from "vitest";
import {
  BENCH_CENTER_OFFSET,
  BENCH_DRIFT_TOLERANCE,
  BENCH_RADIUS,
  BENCH_REFERENCE_ASPECT,
  benchStillValid,
  cameraGroundFootprint,
  POPULATION,
  scatterOnLand,
} from "../src/bench.js";
import { CAMERA } from "../src/settings.js";
import { mulberry32 } from "../src/world/island.js";

/**
 * Minimal `TerrainQuery`: only `levelAt` matters to `scatterOnLand` (the sole method it calls),
 * driven by an arbitrary `land` predicate in world coordinates. The other members exist only to
 * satisfy the interface.
 */
function makeQuery(land: (x: number, z: number) => boolean): TerrainQuery {
  return {
    heightAt: () => 0,
    maxHeightAround: () => 0,
    levelAt: (x, z) => (land(x, z) ? 0 : null),
    kindAt: () => "herbe",
    waterLevelAt: () => 0,
    rampAt: () => null,
    canTraverseRamp: () => false,
    cellCenter: (i, j) => [i, j],
  };
}

// Round 1 de revue : `scatterOnLand` tirait sur toute la carte, sans connaître le héros ni la
// caméra — une part de la population tombait hors du tronc de vue et hors de la passe d'ombre, et
// mesurait un coût GPU nul pour des entités jamais réellement rendues. L'invariant manquant :
// TOUS les points renvoyés, pas seulement en moyenne, doivent être à la fois sur la terre et dans
// le disque demandé.
describe("scatterOnLand", () => {
  it("keeps every point on land and inside the requested disk, even when the whole plane is land", () => {
    const center = [5, -3] as const;
    const radius = 14;
    const rng = mulberry32(1);
    const query = makeQuery(() => true); // toute la carte est de la terre : ne teste que le disque
    const count = 500; // grand échantillon : une fuite hors disque rare doit quand même se voir

    const points = scatterOnLand(query, rng, count, center, radius);

    expect(points).toHaveLength(count);
    for (const [x, z] of points) {
      const distance = Math.hypot(x - center[0], z - center[1]);
      // Marge flottante minime : le tirage polaire (`r = radius * sqrt(rng())`) ne peut
      // mathématiquement pas dépasser `radius`, l'epsilon n'existe que pour l'arrondi IEEE 754.
      expect(distance).toBeLessThanOrEqual(radius + 1e-9);
    }
  });

  it("rejects water and never returns a point outside the requested disk when land is only PART of it", () => {
    const center = [0, 0] as const;
    const radius = 14;
    const rng = mulberry32(7);
    // Demi-plan est = terre, ouest = eau : un tirage qui ignorerait `levelAt` renverrait des points
    // à x <= 0 aussi, donc ce test échouerait s'il redevenait un simple rejet sur un carré englobant
    // sans revérifier la terre.
    const query = makeQuery((x) => x > center[0]);
    const count = 200;

    const points = scatterOnLand(query, rng, count, center, radius);

    expect(points).toHaveLength(count);
    for (const [x, z] of points) {
      expect(x).toBeGreaterThan(center[0]);
      const distance = Math.hypot(x - center[0], z - center[1]);
      expect(distance).toBeLessThanOrEqual(radius + 1e-9);
    }
  });

  it("returns fewer than count points when land can't supply them, rather than looping forever", () => {
    const rng = mulberry32(3);
    const query = makeQuery(() => false); // toute la carte est de l'eau
    const points = scatterOnLand(query, rng, 10, [0, 0], 14);
    expect(points).toHaveLength(0);
  });
});

// Le tableau de peuplement engage le verdict du rapport : une divergence silencieuse avec le brief
// invaliderait la mesure sans qu'aucun écran ne le montre.
describe("POPULATION", () => {
  it("matches the brief's game-level table", () => {
    expect(POPULATION.game).toEqual({
      players: 4,
      monsters: 40,
      guards: 8,
      loot: 30,
      corpses: 4,
      projectiles: 12,
      effects: 6,
      castingLights: 1,
    });
  });

  it("matches the brief's heavy-level table", () => {
    expect(POPULATION.heavy).toEqual({
      players: 4,
      monsters: 90,
      guards: 16,
      loot: 70,
      corpses: 12,
      projectiles: 30,
      effects: 20,
      castingLights: 4,
    });
  });
});

// Round 2 de revue : un disque de rayon `BENCH_RADIUS` centré sur le HÉROS déborde encore du cadre
// côté caméra, parce que l'empreinte au sol réellement visible n'est pas symétrique autour de lui
// (une caméra qui plonge voit plus loin qu'elle ne voit près). Ces deux chiffres pinnent la
// géométrie qui a servi à corriger ça — une dérive future des réglages de `CAMERA` doit casser CE
// test, pas fausser silencieusement le harnais une troisième fois.
describe("cameraGroundFootprint", () => {
  it("matches the geometry verified against updateCamera during round 2 review", () => {
    const footprint = cameraGroundFootprint(CAMERA, BENCH_REFERENCE_ASPECT);
    expect(footprint.near).toBeCloseTo(9.0698, 3);
    expect(footprint.far).toBeCloseTo(19.1668, 3);
  });

  it("BENCH_CENTER_OFFSET is the midpoint of that footprint", () => {
    const footprint = cameraGroundFootprint(CAMERA, BENCH_REFERENCE_ASPECT);
    expect(BENCH_CENTER_OFFSET).toBeCloseTo((footprint.far - footprint.near) / 2, 9);
    expect(BENCH_CENTER_OFFSET).toBeCloseTo(5.0485, 3);
  });

  /**
   * Marge latérale la plus SERRÉE sur tout le disque, à un aspect donné : pour chaque profondeur
   * échantillonnée dans le disque (mesurée depuis SON centre le long de l'axe de visée), la
   * demi-largeur du disque à cette profondeur (cercle) comparée à la demi-largeur du tronc de vue
   * à la même profondeur (`halfWidthAt`, qui prend une profondeur depuis le HÉROS — d'où le
   * décalage de `BENCH_CENTER_OFFSET`). Le minimum ne tombe PAS au bord le plus large du disque
   * (là où `camera.fov` a le plus de recul) ni à son centre (là où le disque est le plus large
   * mais le tronc de vue déjà généreux) : c'est un calcul fin, pas un point remarquable — d'où
   * l'échantillonnage plutôt qu'une formule fermée.
   */
  function minLateralMargin(aspect: number): number {
    const footprint = cameraGroundFootprint(CAMERA, aspect);
    let min = Number.POSITIVE_INFINITY;
    for (let d = -BENCH_RADIUS; d <= BENCH_RADIUS; d += 0.01) {
      const discHalfWidth = Math.sqrt(Math.max(0, BENCH_RADIUS ** 2 - d ** 2));
      const halfWidth = footprint.halfWidthAt(BENCH_CENTER_OFFSET + d);
      min = Math.min(min, halfWidth - discHalfWidth);
    }
    return min;
  }

  // Round 3 de revue : `near`/`far` ne couvraient que l'axe vertical du FOV — l'axe latéral,
  // pourtant celui où `camera.fov` (vertical, three) ne s'applique PAS directement (il faut passer
  // par l'aspect), n'avait ni calcul ni test. Ces chiffres pinnent le seuil trouvé par la revue :
  // le disque tient latéralement à partir d'un aspect ≈ 1.66 (marge quasi nulle) ; en dessous
  // (1.6 — un MacBook en plein écran, ou une fenêtre avec les devtools ancrés à droite), les flancs
  // débordent ; à 16:9 (1.778, l'aspect des mesures publiées), la marge est d'environ 7 %.
  it("the disk barely fits laterally at aspect ~1.66, overflows below it, and keeps ~7% margin at 16:9", () => {
    expect(minLateralMargin(1.66)).toBeCloseTo(0, 1);
    expect(minLateralMargin(1.6)).toBeLessThan(0);
    const referenceMargin = minLateralMargin(BENCH_REFERENCE_ASPECT);
    expect(referenceMargin).toBeGreaterThan(0);
    expect(referenceMargin / BENCH_RADIUS).toBeCloseTo(0.067, 2);
  });
});

// Round 3 de revue : `scheduleBenchMeasure` (`main.ts`) se redéclenche à CHAQUE bascule jour/nuit,
// longtemps après `Bench.populate()` — le héros a pu marcher (la caméra le suit) et le joueur
// zoomer entre-temps. Une mesure prise alors porte sur une scène dont le peuplement est en grande
// partie hors cadre, et le HUD l'affichait jusqu'ici exactement comme une mesure valide.
describe("benchStillValid", () => {
  const populatedAt = { heroX: -2, heroZ: 4, cameraDistance: 40 };

  it("reste valide à l'identique", () => {
    expect(benchStillValid({ ...populatedAt }, populatedAt)).toBe(true);
  });

  it("reste valide sous la tolérance de dérive (gigue flottante)", () => {
    const current = {
      heroX: populatedAt.heroX + BENCH_DRIFT_TOLERANCE * 0.5,
      heroZ: populatedAt.heroZ,
      cameraDistance: populatedAt.cameraDistance,
    };
    expect(benchStillValid(current, populatedAt)).toBe(true);
  });

  it("s'invalide si le héros a marché depuis le peuplement", () => {
    const current = { ...populatedAt, heroX: populatedAt.heroX + 10 };
    expect(benchStillValid(current, populatedAt)).toBe(false);
  });

  it("s'invalide si la caméra a zoomé depuis le peuplement", () => {
    const current = { ...populatedAt, cameraDistance: populatedAt.cameraDistance + 10 };
    expect(benchStillValid(current, populatedAt)).toBe(false);
  });

  it("s'invalide juste au-delà de la tolérance", () => {
    const current = {
      ...populatedAt,
      heroZ: populatedAt.heroZ + BENCH_DRIFT_TOLERANCE + 1e-6,
    };
    expect(benchStillValid(current, populatedAt)).toBe(false);
  });
});

describe("scatterOnLand, centered the way main.ts actually centers it", () => {
  it("keeps every point within the visible ground footprint along the viewing axis, not just within BENCH_RADIUS of the hero", () => {
    const heroX = -2;
    const heroZ = 4;
    // Même calcul que `main.ts` : décalé de `BENCH_CENTER_OFFSET` dans le sens opposé à la caméra
    // (yaw=0, donc -Z — voir le commentaire de `main.ts` pour la convention).
    const center = [heroX, heroZ - BENCH_CENTER_OFFSET] as const;
    const rng = mulberry32(11);
    const query: TerrainQuery = {
      heightAt: () => 0,
      maxHeightAround: () => 0,
      levelAt: () => 0, // toute la carte est de la terre : isole la géométrie du disque
      kindAt: () => "herbe",
      waterLevelAt: () => 0,
      rampAt: () => null,
      canTraverseRamp: () => false,
      cellCenter: (i, j) => [i, j],
    };
    const footprint = cameraGroundFootprint(CAMERA, BENCH_REFERENCE_ASPECT);

    const points = scatterOnLand(query, rng, 500, center, BENCH_RADIUS);

    expect(points).toHaveLength(500);
    // Round 3 de revue : ce test jetait `x` (`for (const [, z] of points)`) — l'axe latéral restait
    // approximatif (`cameraGroundFootprint` ne modélisait que le FOV vertical) ET non couvert par
    // aucun test, exactement la combinaison qui laisse un bug vivre. `x` n'est plus abandonné.
    for (const [x, z] of points) {
      // `s` = distance signée depuis le héros le long de l'axe de visée, positive à l'opposé de la
      // caméra (même convention que `BENCH_CENTER_OFFSET`) : s = heroZ - z, puisque "à l'opposé de
      // la caméra" est -Z à yaw=0.
      const s = heroZ - z;
      expect(s).toBeGreaterThanOrEqual(-footprint.near - 1e-9);
      expect(s).toBeLessThanOrEqual(footprint.far + 1e-9);
      // Borne latérale, à l'aspect de référence (16:9 — voir `BENCH_REFERENCE_ASPECT` et
      // `apps/lab/AGENTS.md`) : le point ne doit pas non plus déborder du cadre par les flancs.
      expect(Math.abs(x - heroX)).toBeLessThanOrEqual(footprint.halfWidthAt(s) + 1e-9);
    }
  });
});
