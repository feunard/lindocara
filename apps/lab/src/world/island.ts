import type { HeightField } from "@lindocara/hd2d/terrain/field.js";
import { WORLD } from "../settings.js";
import { createTerrainQuery, type TerrainQuery } from "./terrain-query.js";

/**
 * PRNG déterministe, port verbatim de `~/git/poc-hd-2d/src/world/terrain.js`. La forme de l'île
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

export interface GenerateIslandOptions {
  size: number;
  /** Réservé aux futures variations procédurales (props, Task 12) : la forme de l'île, `ILES`
   *  ci-dessus, est une donnée auteur fixe, pas encore tirée de cette graine. */
  seed: number;
}

/**
 * Port de `buildTerrain()` (`~/git/poc-hd-2d/src/world/terrain.js`), réduit à la génération pure :
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
  // Distance au premier carreau d'eau, en propagation depuis la mer.
  const distEau = new Int16Array(size * size).fill(9999);
  const file: number[] = [];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (at(i, j) !== null) continue;
      distEau[j * size + i] = 0;
      file.push(i, j);
    }
  }
  for (let k = 0; k < file.length; k += 2) {
    const i = file[k] ?? 0;
    const j = file[k + 1] ?? 0;
    const d = distEau[j * size + i] ?? 0;
    for (const [di, dj] of NEIGHBORS_4) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
      const idx = nj * size + ni;
      if ((distEau[idx] ?? 9999) <= d + 1) continue;
      distEau[idx] = d + 1;
      file.push(ni, nj);
    }
  }

  const c = size / 2;
  const estSable = (i: number, j: number): boolean => {
    if (at(i, j) !== 0) return false;
    const x = i + 0.5 - c;
    const z = j + 0.5 - c;
    // Angle mesuré depuis le plein sud (+Z) : la plage s'étend sur cet arc et se resserre à ses
    // extrémités plutôt que de s'arrêter net.
    const arc = Math.abs(Math.atan2(x, z));
    if (arc > 1.2) return false;
    return (distEau[j * size + i] ?? 9999) <= (arc < 0.75 ? 3 : 2);
  };

  const kinds = new Array<string | null>(size * size).fill(null);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (at(i, j) === null) continue;
      kinds[j * size + i] = estSable(i, j) ? "sable" : "herbe";
    }
  }
  const kindAt = (i: number, j: number): string | null =>
    i < 0 || j < 0 || i >= size || j >= size ? null : (kinds[j * size + i] ?? null);

  const field: HeightField = {
    cols: size,
    rows: size,
    levelAt: at,
    materialAt(i, j) {
      const h = at(i, j);
      if (h === null) return null;
      return kindAt(i, j) === "sable" ? "sable" : levelSet(h);
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
