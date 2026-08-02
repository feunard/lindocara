import { describe, expect, it } from "vitest";
import { generateIsland, isBeach, mulberry32, waterDistance } from "../src/world/island.js";

describe("mulberry32", () => {
  it("est déterministe : même graine, même suite", () => {
    const a = mulberry32(20260801);
    const b = mulberry32(20260801);
    const suiteA = Array.from({ length: 20 }, () => a());
    const suiteB = Array.from({ length: 20 }, () => b());
    expect(suiteA).toEqual(suiteB);
  });

  it("donne des suites différentes pour des graines différentes", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const suiteA = Array.from({ length: 8 }, () => a());
    const suiteB = Array.from({ length: 8 }, () => b());
    expect(suiteA).not.toEqual(suiteB);
  });

  it("reste dans [0, 1)", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("waterDistance", () => {
  // Petite grille à la main, 3x3 :
  //   . . .
  //   . x .     x = terre (case (1,1)), tout le reste est de l'eau (null)
  //   . . .
  const at3 = (i: number, j: number): number | null => (i === 1 && j === 1 ? 0 : null);

  it("vaut 0 sur toute case d'eau", () => {
    const dist = waterDistance(3, at3);
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        if (i === 1 && j === 1) continue;
        expect(dist[j * 3 + i]).toBe(0);
      }
    }
  });

  it("vaut 1 sur la seule case de terre, entourée d'eau à distance 1 (4-voisinage)", () => {
    const dist = waterDistance(3, at3);
    expect(dist[1 * 3 + 1]).toBe(1);
  });

  it("propage la distance case par case sur un couloir de terre", () => {
    // Bande de terre de 5 colonnes sur toute la hauteur de la grille, bordée d'eau des deux côtés
    //   (i=0 et i=6 sont de l'eau sur TOUTE ligne, i=1..5 de la terre) : la terre est pleine sur
    //   chaque colonne, donc la seule direction vers l'eau est horizontale — un vrai couloir 1D
    //   plutôt qu'une bande de 1 case de haut, qui toucherait l'eau verticalement dès la première
    //   case et rendrait la propagation horizontale invisible au test.
    const size = 7;
    const at = (i: number, _j: number): number | null => (i >= 1 && i <= 5 ? 0 : null);
    const dist = waterDistance(size, at);
    // Le centre du couloir (i=3) est à 3 cases de l'eau la plus proche (i=0 ou i=6).
    expect(dist[0 * size + 3]).toBe(3);
    // Les bouts du couloir touchent l'eau directement.
    expect(dist[0 * size + 1]).toBe(1);
    expect(dist[0 * size + 5]).toBe(1);
  });
});

describe("isBeach", () => {
  // `waterDist` est fourni directement (plutôt que dérivé d'un vrai `waterDistance`) : ça isole
  // complètement le test de la géométrie de la grille, et permet de placer la distance à l'eau
  // exactement là où chaque cas en a besoin. `size = 10` (`c = 5`) donne des coordonnées monde
  // faciles à calculer à la main : `x = i - 4.5`, `z = j - 4.5`.
  const size = 10;
  const atLand = () => 0; // toujours palier 0 : seul l'angle/la distance décident
  const atOther = () => 1; // jamais palier 0 : `isBeach` doit refuser avant même de regarder le reste

  const distWith = (i: number, j: number, value: number): Int16Array => {
    const d = new Int16Array(size * size);
    d[j * size + i] = value;
    return d;
  };

  it("plein sud (arc ≈ 0), à distance 3 de l'eau : sable (seuil 3 sous 0.75 rad)", () => {
    // i=5, j=9 -> x=0.5, z=4.5 -> arc = atan2(0.5, 4.5) ≈ 0.11 rad, bien sous 0.75.
    expect(isBeach(5, 9, size, atLand, distWith(5, 9, 3))).toBe(true);
  });

  it("plein sud, à distance 4 de l'eau : plus de sable (au-delà du seuil 3)", () => {
    expect(isBeach(5, 9, size, atLand, distWith(5, 9, 4))).toBe(false);
  });

  it("plein nord (arc ≈ π), même au ras de l'eau : jamais de sable", () => {
    // i=5, j=0 -> x=0.5, z=-4.5 -> arc = atan2(0.5, -4.5) ≈ π - 0.11, bien au-delà de 1.2.
    expect(isBeach(5, 0, size, atLand, distWith(5, 0, 0))).toBe(false);
  });

  it("l'arc se resserre à ses extrémités : à distance 3, sable entre 0 et 0.75 rad mais plus entre 0.75 et 1.2 rad", () => {
    // i=8, j=6 -> x=3.5, z=1.5 -> arc = atan2(3.5, 1.5) ≈ 1.166 rad, dans [0.75, 1.2).
    // Même distance à l'eau (3) que le premier cas, mais le seuil est tombé à 2 ici : refusé.
    expect(isBeach(8, 6, size, atLand, distWith(8, 6, 3))).toBe(false);
    // À distance 2, le seuil resserré (2) l'accepte encore.
    expect(isBeach(8, 6, size, atLand, distWith(8, 6, 2))).toBe(true);
  });

  it("au-delà de 1.2 rad, jamais de sable, même collé à l'eau", () => {
    // i=9, j=5 -> x=4.5, z=0.5 -> arc = atan2(4.5, 0.5) ≈ 1.46 rad, au-delà de la coupure dure.
    expect(isBeach(9, 5, size, atLand, distWith(9, 5, 0))).toBe(false);
  });

  it("jamais de sable si la case elle-même n'est pas au palier 0", () => {
    expect(isBeach(5, 9, size, atOther, distWith(5, 9, 0))).toBe(false);
  });
});

describe("generateIsland", () => {
  it("est déterministe : mêmes options, même champ", () => {
    const a = generateIsland({ size: 24, seed: 1 });
    const b = generateIsland({ size: 24, seed: 1 });
    for (let j = 0; j < 24; j++) {
      for (let i = 0; i < 24; i++) {
        expect(a.field.levelAt(i, j)).toBe(b.field.levelAt(i, j));
        expect(a.field.materialAt(i, j)).toBe(b.field.materialAt(i, j));
      }
    }
  });

  it("produit à la fois de l'eau et de la terre", () => {
    const { field } = generateIsland({ size: 24, seed: 1 });
    let eau = 0;
    let terre = 0;
    for (let j = 0; j < 24; j++) {
      for (let i = 0; i < 24; i++) {
        if (field.levelAt(i, j) === null) eau++;
        else terre++;
      }
    }
    expect(eau).toBeGreaterThan(0);
    expect(terre).toBeGreaterThan(0);
  });

  it("matériaux de terrain cohérents avec le palier, île réelle (lvl0/lvl1/lvl2/sable)", () => {
    const { field } = generateIsland({ size: WORLD_SIZE, seed: WORLD_SEED });
    let sable = 0;
    for (let j = 0; j < WORLD_SIZE; j++) {
      for (let i = 0; i < WORLD_SIZE; i++) {
        const h = field.levelAt(i, j);
        const m = field.materialAt(i, j);
        if (h === null) {
          expect(m).toBeNull();
          continue;
        }
        expect(["lvl0", "lvl1", "lvl2", "sable"]).toContain(m);
        // Le sable n'existe qu'au palier 0.
        if (m === "sable") {
          expect(h).toBe(0);
          sable++;
        }
      }
    }
    // La plage sud existe bel et bien sur la vraie île, pas seulement en théorie.
    expect(sable).toBeGreaterThan(0);
  });
});

// Les vraies dimensions du monde (voir `settings.ts`, `WORLD`), dupliquées ici en constantes
// plutôt qu'importées : ce test vérifie `island.ts` avec les réglages réels, mais ne doit pas
// dépendre de `settings.ts` pour SA PROPRE définition de ce qu'est "la vraie carte".
const WORLD_SIZE = 72;
const WORLD_SEED = 20260801;
