import { describe, expect, it } from "vitest";
import { POPULATION, scatterOnLand } from "../src/bench.js";
import { mulberry32 } from "../src/world/island.js";
import type { TerrainQuery } from "../src/world/terrain-query.js";

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
