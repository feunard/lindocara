import type { HeightField } from "@lindocara/hd2d/terrain/field.js";
import { NORD, WORLD } from "../settings.js";
import { createTerrainQuery, type TerrainMaterial, type TerrainQuery } from "./terrain-query.js";

/**
 * PRNG déterministe, port verbatim de `terrain.js` du PoC. La forme de l'île
 * elle-même est une donnée AUTEUR (`ILES`, ci-dessous), pas procédurale — ce générateur n'est donc
 * pas encore consommé ICI. Il est porté quand même, exporté, parce que Task 12 en aura besoin pour
 * placer les props (`mulberry32(WORLD.seed + 7)` dans `props.js`), et qu'il vit à côté du reste du
 * générateur de terrain plutôt que d'être ajouté après coup.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface IslandRelief {
  x: number;
  z: number;
  r: number;
  h: number;
}

interface IslandShape {
  x: number;
  z: number;
  r: number;
  onde(a: number): number;
  reliefs: readonly IslandRelief[];
}

// Les îles sont décrites en coordonnées MONDE, pas en fractions de grille : agrandir la carte n'en
// change donc ni la taille ni la position.
const ILES: readonly IslandShape[] = [
  // La grande : disque déformé par deux harmoniques, avec ses plateaux.
  {
    x: 0,
    z: 0,
    r: 16,
    onde: (a) => 0.13 * Math.sin(a * 3 + 0.8) + 0.06 * Math.sin(a * 5 - 2.1),
    reliefs: [
      { x: 6.1, z: -5.8, r: 6.8, h: 1 }, // plateau
      { x: 7.5, z: -7.5, r: 3.1, h: 2 }, // sommet
      { x: -7.1, z: 8.2, r: 2.2, h: 1 }, // butte d'entraînement au saut
    ],
  },
  // Celle de l'est : plate, elle porte la maison (Task 12). Étirée vers le SUD plutôt qu'agrandie
  // partout — il fallait de la place devant la maison sans venir toucher l'île principale, qui
  // pousse jusqu'à x = 14.4 de ce côté.
  {
    x: 25,
    z: -1,
    r: 8.5,
    onde: (a) =>
      0.1 * Math.sin(a * 3 + 1.4) + 0.05 * Math.sin(a * 5) - 0.3 * Math.max(0, Math.sin(a)),
    reliefs: [],
  },
  // La petite, au sud : on ne l'atteint qu'à la nage.
  {
    x: 1,
    z: 24,
    r: 4.6,
    onde: (a) => 0.11 * Math.sin(a * 4 - 0.6),
    reliefs: [{ x: 2.2, z: 24.5, r: 1.9, h: 1 }],
  },
  // La quatrième, au nord (voir `NORD`, `settings.ts`) : gelée, et hors de portée à pied — le
  // couloir qui la sépare de la grande île reste de l'eau sur toute sa largeur (`island.test.ts`
  // le vérifie), donc son amplitude d'onde n'a pas besoin d'être petite comme celle d'un
  // littoral qu'on ne veut pas voir toucher son voisin : les deux masses sont déjà à des
  // dizaines d'unités l'une de l'autre. Un seul relief, un monticule de glace, tient le même
  // rôle qu'une butte d'herbe ailleurs : donner un prétexte de saut.
  {
    x: NORD.x,
    z: NORD.z,
    r: NORD.r,
    onde: (a) => 0.12 * Math.sin(a * 3 - 1.1) + 0.05 * Math.sin(a * 5 + 0.7),
    reliefs: [{ x: NORD.x + 4.5, z: NORD.z - 3.5, r: 2, h: 1 }],
  },
];

/** Palier par case, ou `null` si c'est de l'eau. */
function makeHeightmap(size: number): (number | null)[] {
  const c = size / 2;
  const cells = new Array<number | null>(size * size).fill(null);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = i + 0.5 - c;
      const z = j + 0.5 - c;
      for (const ile of ILES) {
        const dx = x - ile.x;
        const dz = z - ile.z;
        const d = Math.hypot(dx, dz) / ile.r + ile.onde(Math.atan2(dz, dx));
        if (d >= 0.94) continue;
        let h = 0;
        for (const r of ile.reliefs) if (Math.hypot(x - r.x, z - r.z) < r.r) h = Math.max(h, r.h);
        cells[j * size + i] = h;
        break;
      }
    }
  }
  return cells;
}

const LEVEL_SET = ["lvl0", "lvl1", "lvl2"] as const;
const levelSet = (h: number): string => LEVEL_SET[Math.min(h, LEVEL_SET.length - 1)] ?? "lvl2";

const NEIGHBORS_4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Distance en cases à l'eau la plus proche, propagée par plus-court-chemin en largeur (BFS) depuis
 * chaque case d'eau. Exportée — et prenant `at` en paramètre plutôt que de fermer sur l'état de
 * `generateIsland` — pour rester testable sur une petite grille construite à la main, sans avoir à
 * régénérer une île entière : c'est elle qui décide où la plage peut apparaître (`isBeach`,
 * ci-dessous), et une régression ici (un ordre de voisins différent, un off-by-one) se
 * propagerait silencieusement au tracé du rivage sans qu'aucun écran ne le montre.
 */
export function waterDistance(
  size: number,
  at: (i: number, j: number) => number | null,
): Int16Array {
  const dist = new Int16Array(size * size).fill(9999);
  const file: number[] = [];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (at(i, j) !== null) continue;
      dist[j * size + i] = 0;
      file.push(i, j);
    }
  }
  for (let k = 0; k < file.length; k += 2) {
    const i = file[k] ?? 0;
    const j = file[k + 1] ?? 0;
    const d = dist[j * size + i] ?? 0;
    for (const [di, dj] of NEIGHBORS_4) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
      const idx = nj * size + ni;
      if ((dist[idx] ?? 9999) <= d + 1) continue;
      dist[idx] = d + 1;
      file.push(ni, nj);
    }
  }
  return dist;
}

/**
 * Une case de palier 0 est du sable si elle tombe dans l'arc sud du littoral (angle mesuré depuis
 * le plein sud, +Z) et assez près de l'eau — l'arc se resserre à ses extrémités (rayon 2 plutôt
 * que 3 au-delà de 0.75 radian) pour que la plage s'amenuise au lieu de s'arrêter net. Exportée et
 * prenant `waterDist` déjà calculé (plutôt que de le recalculer) pour rester testable isolément de
 * `waterDistance` et de `generateIsland`.
 */
export function isBeach(
  i: number,
  j: number,
  size: number,
  at: (i: number, j: number) => number | null,
  waterDist: Int16Array,
): boolean {
  if (at(i, j) !== 0) return false;
  const c = size / 2;
  const x = i + 0.5 - c;
  const z = j + 0.5 - c;
  const arc = Math.abs(Math.atan2(x, z));
  if (arc > 1.2) return false;
  return (waterDist[j * size + i] ?? 9999) <= (arc < 0.75 ? 3 : 2);
}

/** Rayon du lac gelé de l'île du nord (voir `generateIsland`, la boucle `kinds`), en unités
 *  monde — hissé au niveau du module (plutôt que local à `generateIsland`) pour que
 *  `LAKE_OBSTACLES`, juste en dessous, puisse s'en réclamer dans sa docstring (la chaîne de
 *  rochers doit rester très en deçà de ce rayon) sans dupliquer le nombre à l'aveugle. */
export const LAC_R = 2.5;

/**
 * Task 7b (la glisse verrouillée, la règle Pokémon) : un disque de glace vide se traverse tout
 * droit et ne demande rien — la glisse verrouillée n'est intéressante que si le lac est AUTHORÉ,
 * pas généré lisse (voir le spec, section « La glace : glisse verrouillée »). Trois rochers en
 * chaîne, du sud-ouest au nord-est, posés par `props.ts` (`populate`, avec leur collider) :
 *
 * - le rocher central barre le passage le plus évident, tout droit par le milieu du lac, dans les
 *   deux axes cardinaux à la fois (nord-sud ET est-ouest) ;
 * - les deux rochers d'aile le prolongent en diagonale, assez proches du central pour qu'aucun
 *   des trois ne laisse un interstice où se faufiler (l'espacement, 0.53 unité sur chaque axe,
 *   tient sous le diamètre du héros, 0.6 — voir `HERO.radius`, `settings.ts`) : la chaîne se
 *   franchit seulement en la CONTOURNANT par un bout, jamais en la traversant.
 *
 * La chaîne ne fait qu'1.5 unité de bout en bout, très en deçà du rayon du lac (`LAC_R`, 2.5) :
 * chaque bout laisse une bande de glace nue assez large pour qu'on puisse la contourner UNE FOIS
 * qu'on s'est arrêté contre elle et qu'on a redirigé perpendiculairement — exactement le geste que
 * la glisse verrouillée impose (on ne peut pas simplement « obliquer légèrement » en glissant).
 * C'est délibérément une PREMIÈRE énigme simple, pas un labyrinthe : l'auteur redessinera un tracé
 * plus riche une fois la mécanique en main (voir le brief).
 */
export const LAKE_OBSTACLES: readonly { x: number; z: number }[] = [
  { x: NORD.x, z: NORD.z },
  { x: NORD.x + 0.53, z: NORD.z - 0.53 },
  { x: NORD.x - 0.53, z: NORD.z + 0.53 },
] as const;

export interface GenerateIslandOptions {
  size: number;
  /** Réservé aux futures variations procédurales (props, Task 12) : la forme de l'île, `ILES`
   *  ci-dessus, est une donnée auteur fixe, pas encore tirée de cette graine. */
  seed: number;
}

/**
 * Port de `buildTerrain()` (`terrain.js` du PoC), réduit à la génération pure :
 * heightmap, plage de sable, et les deux formes que consomment respectivement le rendu
 * (`HeightField`, que `meshTerrain` maille) et la collision (`TerrainQuery`, que le héros
 * interroge). La construction des meshes elle-même — atlas, eau, écume — reste à `main.ts`, qui
 * seul connaît les textures chargées.
 */
export function generateIsland(opts: GenerateIslandOptions): {
  field: HeightField;
  query: TerrainQuery;
} {
  const size = opts.size;
  const cells = makeHeightmap(size);
  const at = (i: number, j: number): number | null =>
    i < 0 || j < 0 || i >= size || j >= size ? null : (cells[j * size + i] ?? null);

  // --- plage : bande de sable sur l'arc sud du littoral -----------------------------------------
  const distEau = waterDistance(size, at);

  // --- île du nord : lac gelé au centre, glace fine à son bord, neige partout ailleurs ----------
  // Rayon du lac et largeur de la couronne de glace fine, en unités monde. La glace fine reste une
  // COURONNE ÉTROITE collée au bord du lac — jamais au milieu — pour qu'on la voie venir en
  // traversant plutôt que d'y tomber par surprise (contrainte du brief). Le seuil d'appartenance
  // (`NORD_EMPRISE`) n'a besoin que d'être plus large que le rayon effectif du littoral gelé
  // (`NORD.r` majoré de l'amplitude de son onde, ~8.3 unités ici) : il sert seulement à écarter les
  // trois autres îles, qui sont à des dizaines d'unités de distance.
  const GLACE_FINE_LARGEUR = 0.9;
  const NORD_EMPRISE = NORD.r + 2;
  const c = size / 2;

  const kinds = new Array<TerrainMaterial | null>(size * size).fill(null);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (at(i, j) === null) continue;
      const x = i + 0.5 - c;
      const z = j + 0.5 - c;
      const dNord = Math.hypot(x - NORD.x, z - NORD.z);
      if (dNord < NORD_EMPRISE) {
        kinds[j * size + i] =
          dNord < LAC_R ? "glace" : dNord < LAC_R + GLACE_FINE_LARGEUR ? "glace-fine" : "neige";
        continue;
      }
      kinds[j * size + i] = isBeach(i, j, size, at, distEau) ? "sable" : "herbe";
    }
  }
  const kindAt = (i: number, j: number): TerrainMaterial | null =>
    i < 0 || j < 0 || i >= size || j >= size ? null : (kinds[j * size + i] ?? null);

  const field: HeightField = {
    cols: size,
    rows: size,
    levelAt: at,
    materialAt(i, j) {
      const h = at(i, j);
      if (h === null) return null;
      const k = kindAt(i, j);
      if (k === "sable" || k === "neige") return k;
      // La glace fine partage l'atlas de la glace : c'est une matière de RÈGLE (elle cède sous le
      // poids), pas encore d'apparence — la Task 7 lui donnera son propre visuel de craquelure
      // (voir `main.ts`, `atlases`).
      if (k === "glace" || k === "glace-fine") return "glace";
      return levelSet(h);
    },
  };

  const query = createTerrainQuery({
    size,
    levelHeight: WORLD.levelHeight,
    waterLevel: WORLD.waterLevel,
    at,
    kindAt,
  });

  return { field, query };
}
