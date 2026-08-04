import {
  createTerrainQuery,
  type TerrainMaterial,
  type TerrainQuery,
} from "@lindocara/engine/hd2d/terrain-query.js";
import { describe, expect, it } from "vitest";

/**
 * Construit une `TerrainQuery` à partir d'une grille de paliers écrite à la main
 * (`levels[j][i]`, `null` = eau/hors grille). C'est la primitive de collision — la même qui
 * remontera en `@lindocara/engine` en S2 comme autorité serveur — donc chaque test ici fixe une
 * position exacte et un rayon exacts, calculés à la main contre la grille, plutôt que de dériver
 * d'une île générée où une régression pourrait se cacher derrière la forme du terrain.
 */
function makeQuery(
  levels: readonly (number | null)[][],
  opts: { levelHeight?: number; waterLevel?: number } = {},
): TerrainQuery {
  const size = levels.length;
  const at = (i: number, j: number): number | null => {
    const row = levels[j];
    if (!row) return null;
    return row[i] ?? null;
  };
  // Non exercé par les tests ci-dessous (`heightAt`/`levelAt`/`maxHeightAround` ne le lisent
  // jamais) : requis uniquement pour satisfaire `TerrainQuerySource`.
  const kindAt = (i: number, j: number): TerrainMaterial | null =>
    at(i, j) === null ? null : "herbe";
  return createTerrainQuery({
    size,
    levelHeight: opts.levelHeight ?? 1,
    waterLevel: opts.waterLevel ?? -1,
    at,
    kindAt,
  });
}

describe("heightAt / levelAt", () => {
  // size=4, c=2 : la case i couvre x ∈ [i-2, i-1), pareil en z avec j.
  const levels = [
    [null, null, null, null],
    [null, 0, 3, null],
    [null, 0, 0, null],
    [null, null, null, null],
  ];

  it("heightAt renvoie la hauteur monde (palier * levelHeight) sur la terre", () => {
    const q = makeQuery(levels, { levelHeight: 0.9 });
    // Cellule (2,1) : palier 3, centre à x=0.5, z=-0.5.
    expect(q.heightAt(0.5, -0.5)).toBeCloseTo(3 * 0.9);
  });

  it("heightAt renvoie null sur l'eau", () => {
    const q = makeQuery(levels);
    // Cellule (0,0), en eau (null) : centre x=-1.5, z=-1.5.
    expect(q.heightAt(-1.5, -1.5)).toBeNull();
  });

  it("heightAt renvoie null hors carte", () => {
    const q = makeQuery(levels);
    expect(q.heightAt(-100, -100)).toBeNull();
  });

  it("levelAt renvoie le palier brut, sans mise à l'échelle", () => {
    const q = makeQuery(levels, { levelHeight: 0.9 });
    expect(q.levelAt(0.5, -0.5)).toBe(3);
    expect(q.levelAt(-1.5, -1.5)).toBeNull();
    expect(q.levelAt(-100, -100)).toBeNull();
  });
});

describe("maxHeightAround", () => {
  it("un disque entièrement sur une case plate rend la hauteur de cette case", () => {
    const levels = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const q = makeQuery(levels, { levelHeight: 1 });
    // Centre de la case (1,1) : x=-0.5, z=-0.5. Rayon 0.2 : reste entièrement dans la case.
    expect(q.maxHeightAround(-0.5, -0.5, 0.2)).toBe(0);
  });

  it("un disque qui chevauche une case plus haute rend la hauteur de la PLUS HAUTE", () => {
    const levels = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 2, 0], // case (2,2) surélevée
      [0, 0, 0, 0],
    ];
    const q = makeQuery(levels, { levelHeight: 1 });
    // Point dans la case (1,1) [x,z ∈ [-1,0)], près du coin qui touche la case (2,2) surélevée
    // [x,z ∈ [0,1)] — rayon assez grand pour que le disque atteigne réellement cette case
    // (distance au coin le plus proche : √0.02 ≈ 0.1414 < r = 0.15).
    expect(q.maxHeightAround(-0.1, -0.1, 0.15)).toBe(2);
  });

  it("une case seulement frôlée par le coin de la boîte englobante, mais hors du disque, ne compte pas", () => {
    const levels = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 5, 0], // même case surélevée, diagonale
      [0, 0, 0, 0],
    ];
    const q = makeQuery(levels, { levelHeight: 1 });
    // Même position que le test précédent, mais un rayon plus court : la case (2,2) entre encore
    // dans la boîte englobante [wx-r, wx+r] x [wz-r, wz+r] (elle est incluse dans la boucle), mais
    // le point de la case le plus proche du centre (0, 0) est à √0.02 ≈ 0.1414, strictement plus
    // loin que r = 0.12. Sans le clamp au point le plus proche — un bug qui testerait juste le
    // centre de la case, ou qui compterait toute case dont la boîte englobante intersecte —, ce
    // test échouerait en rendant 5 au lieu de 0.
    expect(q.maxHeightAround(-0.1, -0.1, 0.12)).toBe(0);
  });

  it("prend le maximum parmi PLUSIEURS cases chevauchées, pas la première rencontrée", () => {
    const levels = [
      [0, 0, 0, 0],
      [0, 1, 3, 0],
      [0, 0, 2, 0],
      [0, 0, 0, 0],
    ];
    const q = makeQuery(levels, { levelHeight: 1 });
    // Centré pile sur le coin commun aux quatre cases (1,1)=1 (1,2)=3 (2,1)=0 (2,2)=2 — un grand
    // rayon les couvre toutes.
    expect(q.maxHeightAround(0, 0, 0.9)).toBe(3);
  });

  it("l'eau compte pour son propre niveau, pas comme un mur", () => {
    const levels = [
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ];
    const q = makeQuery(levels, { levelHeight: 1, waterLevel: -0.5 });
    // Entièrement en pleine eau : aucune case de terre dans le disque, seul le niveau d'eau
    // s'applique — jamais -Infinity, jamais une valeur qui bloquerait un déplacement.
    expect(q.maxHeightAround(-0.5, -0.5, 0.2)).toBe(-0.5);
  });

  it("le hors-carte non plus n'est pas un mur — on nage jusqu'au large", () => {
    const levels = [
      [0, 0],
      [0, 0],
    ];
    const q = makeQuery(levels, { levelHeight: 1, waterLevel: -0.25 });
    // Loin en dehors de la grille 2x2 : toutes les cases visitées sont hors bornes (`at` renvoie
    // null exactement comme pour l'eau), donc le résultat est le niveau d'eau, pas un blocage.
    expect(q.maxHeightAround(-10, -10, 0.3)).toBe(-0.25);
  });

  it("un disque au bord de la carte mélange terre et hors-carte sans jamais bloquer", () => {
    const levels = [
      [0, 0],
      [0, 0],
    ];
    const q = makeQuery(levels, { levelHeight: 2, waterLevel: -1 });
    // Coin extrême de la case (0,0) [x,z ∈ [-1,0)] : une partie du disque déborde hors grille
    // (traité comme de l'eau), l'autre reste sur la terre (palier 0 * levelHeight 2 = 0). Le
    // maximum entre 0 (terre) et -1 (eau/hors-carte) est 0 — la terre l'emporte, sans qu'aucune
    // case hors-limite ne fasse planter ni ne domine artificiellement.
    expect(q.maxHeightAround(-0.9, -0.9, 0.3)).toBe(0);
  });

  it("r = 0 rend la hauteur de la case sous le point, jamais -Infinity", () => {
    // Revue finale (point C1) : `r * r` vaut 0 avec `r = 0`, et le point interrogé est à distance
    // 0 de sa propre case — l'ancienne exclusion `>= r*r` (0 >= 0) l'écartait à tort, et la
    // fonction rendait `-Infinity` malgré le JSDoc qui promet le contraire. Latent tant que seul
    // `HERO.radius = 0.3` appelait cette fonction ; atteignable dès qu'un rayon d'entité vaut 0.
    const levels = [
      [0, 0, 0, 0],
      [0, 0, 3, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const q = makeQuery(levels, { levelHeight: 1 });
    // Cellule (2,1) : palier 3, centre à x=0.5, z=-0.5.
    expect(q.maxHeightAround(0.5, -0.5, 0)).toBe(3);
  });

  it("r = 0 sur l'eau rend le niveau d'eau, jamais -Infinity", () => {
    const levels = [
      [null, null],
      [null, null],
    ];
    const q = makeQuery(levels, { levelHeight: 1, waterLevel: -0.5 });
    expect(q.maxHeightAround(0, 0, 0)).toBe(-0.5);
  });
});

// Le point C3 de la revue finale demandait une union typée plutôt qu'un `string` : ce test
// s'assure surtout que `TerrainMaterial` reste assignable là où `kindAt` le renvoie, sans quoi il
// n'aurait aucune utilité de compilation.
describe("TerrainMaterial", () => {
  it("kindAt renvoie une des deux matières typées, jamais un string arbitraire", () => {
    const levels = [
      [0, 0],
      [0, 0],
    ];
    const kindAt = (i: number, j: number): TerrainMaterial | null =>
      levels[j]?.[i] === undefined ? null : "sable";
    const q = createTerrainQuery({
      size: 2,
      levelHeight: 1,
      waterLevel: -1,
      at: (i, j) => levels[j]?.[i] ?? null,
      kindAt,
    });
    const material: TerrainMaterial | null = q.kindAt(-0.5, -0.5);
    expect(material).toBe("sable");
  });
});
