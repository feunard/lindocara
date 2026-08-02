// Les requêtes de terrain que le héros consomme : c'est de la COLLISION, pas du rendu. Elles
// remonteront dans `@lindocara/engine` en S2, autoritatives et partagées avec la prédiction —
// gardées pures et sans dépendance à `three` pour que ce jour-là le déplacement ne change pas de
// fichier, seulement d'adresse.

/** Les cinq matières de sol du labo — deux chaudes (l'île tropicale), trois froides (l'île du
 *  nord). Une union exportée plutôt que `string` : `engine` en fera la future autorité serveur, et
 *  une matière "stringly typed" y serait un passif dès la première faute de frappe silencieuse —
 *  le compilateur doit pouvoir rejeter `"herb"` à la place. `"glace-fine"` est une matière de
 *  RÈGLE (elle cède sous le poids) : elle partage l'apparence de `"glace"` tant que la Task 7 ne
 *  lui a pas donné son propre visuel de craquelure — voir `main.ts`, `atlases`. */
export type TerrainMaterial = "sable" | "herbe" | "neige" | "glace" | "glace-fine";

export interface TerrainQuery {
  /** Hauteur monde du sol sous un point, ou `null` si c'est de l'eau / hors carte. */
  heightAt(wx: number, wz: number): number | null;
  /**
   * Hauteur du sol la plus haute sous un DISQUE. Tester un point laisserait le corps du
   * personnage s'enfoncer de sa demi-largeur dans les falaises — c'est un volume qui se déplace,
   * pas un point. L'eau compte pour son propre niveau : c'est une surface où l'on nage, pas un
   * mur. Le hors-carte non plus n'est pas un mur — on nage jusqu'au large, c'est le souffle qui
   * ramène. Jamais `-Infinity`, y compris pour `r = 0` (un disque dégénéré en un point reste un
   * point à tester).
   */
  maxHeightAround(wx: number, wz: number, r: number): number;
  /** Palier (0, 1, 2, ...) sous un point, ou `null` si c'est de l'eau / hors carte. */
  levelAt(wx: number, wz: number): number | null;
  /** Matière du sol sous un point, ou `null` si c'est de l'eau / hors carte. */
  kindAt(wx: number, wz: number): TerrainMaterial | null;
  /** Centre monde d'une cellule. */
  cellCenter(i: number, j: number): [number, number];
}

/** Ce dont `createTerrainQuery` a besoin : les mêmes accesseurs indexés par CELLULE que
 *  `HeightField` (voir `island.ts`), plus les deux constantes d'échelle qui manquent à
 *  `HeightField` — lui reste en paliers bruts, ces requêtes répondent en unités monde. */
export interface TerrainQuerySource {
  /** Côté de la grille, en cases. */
  size: number;
  /** Hauteur d'un palier, en unités monde. */
  levelHeight: number;
  /** Hauteur monde du plan d'eau. */
  waterLevel: number;
  /** Palier de la case (i, j), ou `null` hors grille / eau. */
  at(i: number, j: number): number | null;
  /** Matière de la case (i, j), ou `null` hors grille / eau. */
  kindAt(i: number, j: number): TerrainMaterial | null;
}

/**
 * Port des méthodes de requête de `terrain.js` du PoC (`heightAt`,
 * `maxHeightAround`, `levelAt`, `kindAt`, `cellCenter`), détachées de la construction du
 * heightmap : `island.ts` fournit les accesseurs indexés par cellule, cette fonction ne fait que
 * les convertir en requêtes en coordonnées MONDE.
 */
export function createTerrainQuery(source: TerrainQuerySource): TerrainQuery {
  const { size, levelHeight, waterLevel, at, kindAt } = source;
  const c = size / 2;
  const toCell = (w: number) => Math.floor(w + c);

  return {
    heightAt(wx, wz) {
      const h = at(toCell(wx), toCell(wz));
      return h === null ? null : h * levelHeight;
    },
    maxHeightAround(wx, wz, r) {
      let max = Number.NEGATIVE_INFINITY;
      for (let j = toCell(wz - r); j <= toCell(wz + r); j++) {
        for (let i = toCell(wx - r); i <= toCell(wx + r); i++) {
          // Point de la case le plus proche du centre : une case seulement frôlée par le coin de
          // la boîte englobante ne compte pas.
          const nx = Math.min(Math.max(wx, i - c), i + 1 - c);
          const nz = Math.min(Math.max(wz, j - c), j + 1 - c);
          // Strictement PLUS LOIN que `r` est exclu — pas "à `r` ou plus" : avec `r = 0`, le point
          // interrogé est lui-même à distance 0 de la case qui le contient (`nx === wx`,
          // `nz === wz`), donc `>= r*r` (0 >= 0) l'excluait à tort et la boucle ne trouvait plus
          // JAMAIS de case, renvoyant `-Infinity` — la promesse du JSDoc ci-dessus rompue dès que
          // `r = 0`, latent tant que seul `HERO.radius = 0.3` appelait cette fonction.
          if ((nx - wx) ** 2 + (nz - wz) ** 2 > r * r) continue;
          const h = at(i, j);
          max = Math.max(max, h === null ? waterLevel : h * levelHeight);
        }
      }
      return max;
    },
    levelAt(wx, wz) {
      return at(toCell(wx), toCell(wz));
    },
    kindAt(wx, wz) {
      return kindAt(toCell(wx), toCell(wz));
    },
    cellCenter(i, j) {
      return [i + 0.5 - c, j + 0.5 - c];
    },
  };
}
