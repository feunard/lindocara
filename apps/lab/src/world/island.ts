import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import {
  createTerrainQuery,
  type TerrainMaterial,
  type TerrainQuery,
} from "@lindocara/engine/hd2d/terrain-query.js";
import type { HeightField } from "@lindocara/hd2d/terrain/field.js";
import { heightFieldFromGrid } from "@lindocara/hd2d/terrain/height-field-from-grid.js";
import { MOUNTAIN, NORD, WATERFALLS, WEST, WORLD } from "../settings.js";

/** Seuil d'appartenance à l'île du nord (lac + glace fine + neige) — voir son usage dans
 *  `generateIsland` ci-dessous. Sorti au niveau module (et exporté) pour que
 *  `test/zone-precede-matiere.test.ts` puisse en pinner la relation avec `ZONE_POLAIRE.rayon`
 *  (`settings.ts`) sans dupliquer la formule : l'ambiance doit s'installer PENDANT la nage, avant
 *  que le pied touche la neige, et seul un import du vrai symbole garantit que le test rougit si
 *  cet ordre se rompt un jour. */
export const NORD_EMPRISE = NORD.r + 2;

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

/** How far south of `MOUNTAIN` every relief disc reaches. All four share this edge — that is what
 *  makes the south face sheer. */
const MOUNTAIN_SOUTH_EDGE = 4.2;

/**
 * The mountain: four discs of shrinking radius whose SOUTH edges all coincide.
 *
 * Concentric discs — the obvious construction, and the first one built — give a wedding-cake
 * terraced cone with a one-level step on every side. That is lovely for climbing and useless for a
 * waterfall: each step is 0.9 units, far too short to read as falling water, and a sheet dropped
 * from the summit's south edge lands INSIDE the terrace below it rather than in front.
 *
 * Staggering each disc's centre north by `edge − r` instead aligns all four south edges, so the
 * south side drops from level 4 straight to level 0 in one 3.6-unit cliff, while the north and
 * flanks keep their terraces and stay climbable one jump at a time. That single sheer face is what
 * the waterfall hangs on.
 *
 * The one real cost: `mesh.ts` stretches ONE UV cell over a wall's full drop, so the rock on this
 * face is stretched 4× vertically where the water does not cover it. Accepted deliberately —
 * the alternative is no cliff to fall down.
 */
const tier = (r: number, h: number): IslandRelief => ({
  x: MOUNTAIN.x,
  z: MOUNTAIN.z + MOUNTAIN_SOUTH_EDGE - r,
  r,
  h,
});
const MOUNTAIN_RELIEFS: readonly IslandRelief[] = [
  tier(4.2, 1),
  tier(3.2, 2),
  tier(2.2, 3),
  tier(1.6, 4),
];

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
  // The fifth, west (see `WEST`, `settings.ts`): a mountain with a SHEER SOUTH FACE, reached only
  // by swimming. See `MOUNTAIN_RELIEFS` just below for why the discs are staggered rather than
  // concentric — it is the whole reason the waterfall reads as one.
  {
    x: WEST.x,
    z: WEST.z,
    r: WEST.r,
    onde: westShoreWave,
    reliefs: MOUNTAIN_RELIEFS,
  },
];

/** The west island's shoreline wave, named rather than inlined like its four neighbours' because
 *  `WEST_REACH_MAX` below has to sample the SAME function. Writing it twice would put the zone
 *  ordering test (`test/zone-precede-matiere.test.ts`) on a second source of truth that could drift
 *  from the island it claims to bound without anything noticing. */
function westShoreWave(a: number): number {
  return 0.12 * Math.sin(a * 3 + 2.2) + 0.05 * Math.sin(a * 5 - 0.4);
}

/** The west island's widest effective shoreline radius: `r · (0.94 − onde(a))` sampled around the
 *  full circle, which is exactly the threshold `makeHeightmap` applies. Exported so
 *  `test/zone-precede-matiere.test.ts` can pin `ZONE_FALLS.rayon` above it against the REAL symbol
 *  rather than a copied number — the same reason `NORD_EMPRISE` is exported. Computed once at
 *  module load: 720 samples of two sines, paid once per process, never per frame. */
export const WEST_REACH_MAX = ((): number => {
  let max = 0;
  for (let k = 0; k < 720; k++)
    max = Math.max(max, WEST.r * (0.94 - westShoreWave((k * Math.PI) / 360)));
  return max;
})();

/**
 * The plunge pool, CUT INTO the terrain rather than laid on top of it.
 *
 * A water surface placed over the ground reads as a decal however it is shaded — it has a hard
 * edge against the grass, and nothing about it says the ground stops there. Marking the cells as
 * water instead makes the pool the same thing the sea is: `meshTerrain` leaves a hole, the bank
 * gets its own walls, `createFoam` draws foam around it because foam is derived from exactly this
 * land/water boundary, and the hero swims in it. None of that had to be written.
 *
 * It works here because the fall lands at level 0, a hair above the global water level, so the sea
 * itself shows through the hole. A pool at ELEVATION cannot be cut this way — the hole would open a
 * shaft all the way down — and is a real water surface positioned by `createWater`'s `center` and
 * `level` instead. Both are in this island; the summit spring is the second kind.
 */
function isPlungePool(x: number, z: number): boolean {
  for (const fall of WATERFALLS) {
    if (fall.bottomLevel !== 0) continue;
    const dx = x - fall.x;
    const dz = z - (fall.z + fall.poolOffset);
    if (Math.hypot(dx, dz) < fall.poolRadius) return true;
  }
  return false;
}

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
        // The plunge pool is water, not ground — see `isPlungePool` above.
        cells[j * size + i] = isPlungePool(x, z) ? null : h;
        break;
      }
    }
  }
  return cells;
}

const LEVEL_SET = ["lvl0", "lvl1", "lvl2", "roche"] as const;
/** Levels 0-2 keep their own grass band; everything at 3 or above is rock. The clamp is what makes
 *  a mountain of any height legal without a fifth atlas — the terraces above 3 all share one. */
const levelSet = (h: number): string => LEVEL_SET[Math.min(h, LEVEL_SET.length - 1)] ?? "roche";

/**
 * La clé d'ATLAS d'une case, à partir de sa matière de RÈGLE (`TerrainMaterial`, cinq valeurs) et
 * de son palier — la distinction que `field.materialAt` fait depuis toujours (voir `generateIsland`
 * ci-dessous) : le sable et la neige gardent leur nom, la glace fine partage l'atlas de la glace (une
 * matière de règle sans encore d'apparence propre), et l'herbe se décline en trois bandes lvl0/1/2
 * pour que la falaise change d'image avec la hauteur. Exportée pour que `mapToHeightField`
 * (Task 10) puisse reconstruire un `HeightField` de RENDU depuis une `MapData` qui, elle, ne
 * connaît QUE la matière de règle — jamais la bande de rendu, qui n'est qu'une dérivation
 * (palier, matière) → bloc d'atlas, pas une donnée en soi.
 */
export function renderMaterialAt(kind: TerrainMaterial, level: number): string {
  if (kind === "sable" || kind === "neige") return kind;
  if (kind === "glace") return "glace";
  return levelSet(level);
}

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
  const LAC_R = 2.5;
  const c = size / 2;

  const kinds = new Array<TerrainMaterial | null>(size * size).fill(null);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (at(i, j) === null) continue;
      const x = i + 0.5 - c;
      const z = j + 0.5 - c;
      const dNord = Math.hypot(x - NORD.x, z - NORD.z);
      if (dNord < NORD_EMPRISE) {
        kinds[j * size + i] = dNord < LAC_R ? "glace" : "neige";
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
      // Ne devrait jamais être `null` ici (`kinds` est rempli partout où `at` ne l'est pas), mais
      // `renderMaterialAt` exige une matière non-nulle — un `null` défensif plutôt qu'un cast.
      return k === null ? null : renderMaterialAt(k, h);
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

/**
 * Reconstruit un `HeightField` de RENDU depuis une `MapData` DÉCODÉE (Task 10) — le pendant de
 * `generateIsland` quand la carte vient d'un fichier plutôt que du bruit procédural : même forme
 * (`levelAt`/`materialAt`), même convention de bande d'atlas (`renderMaterialAt`), pour que
 * `meshTerrain`/`createWater`/`createFoam` ne voient AUCUNE différence entre les deux origines.
 * Vit ici plutôt que dans `map-data.ts` : ce dernier reste sans dépendance vers `@lindocara/hd2d`
 * (il partira dans `@lindocara/engine`, qui ne doit rien savoir du rendu), alors qu'`island.ts`
 * importe déjà `HeightField` et connaît déjà la convention lvl0/lvl1/lvl2 — c'est le seul endroit du
 * labo où les deux notions (donnée de carte, bande de rendu) se rencontrent légitimement.
 */
export function mapToHeightField(m: MapData): HeightField {
  return heightFieldFromGrid({
    size: m.size,
    levels: m.levels,
    materials: m.materials,
    materialKey: (material, level) => renderMaterialAt(material as TerrainMaterial, level),
  });
}
