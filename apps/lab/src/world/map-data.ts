// Une carte, en données. Ce que le labo dessine aujourd'hui par du code procédural, ce qu'un
// éditeur produira demain, et ce qu'un serveur doit pouvoir lire sans une ligne de rendu.
//
// `decodeMap` rend `null` plutôt que de jeter : ce format traversera un jour le réseau, et une
// carte corrompue ne doit pas abattre une salle entière. Même discipline que
// `parseClientMessage` dans `@lindocara/engine` — un `JSON.parse` enveloppé dans un `try` qui
// renverrait ensuite l'objet tel quel ne suffit pas : il faut vérifier chaque champ, pas
// seulement que le texte était du JSON valide.
//
// Reste PUR (ni DOM, ni `three`, ni horloge, ni aléa) : ce fichier partira dans
// `@lindocara/engine` à la Task 11, à côté de `terrain-query.ts` qui l'y a précédé.

import type { ColliderRect } from "./collider-index.js";
import type { TerrainMaterial, TerrainQuerySource } from "./terrain-query.js";

/** Les cinq matières de `TerrainMaterial`, en énumération de RUNTIME — le type seul ne suffit
 *  pas à valider une chaîne venue du réseau, il s'efface à la compilation. */
const TERRAIN_MATERIALS: readonly TerrainMaterial[] = [
  "sable",
  "herbe",
  "neige",
  "glace",
  "glace-fine",
];

function isTerrainMaterial(value: unknown): value is TerrainMaterial {
  return typeof value === "string" && (TERRAIN_MATERIALS as readonly string[]).includes(value);
}

export interface MapData {
  version: 1;
  /** Côté de la grille, en cases. */
  size: number;
  levelHeight: number;
  waterLevel: number;
  /** `size * size`, en ligne d'abord (index = j * size + i). `null` = eau. */
  levels: readonly (number | null)[];
  /** `size * size`. Sans signification là où `levels` vaut `null`. */
  materials: readonly TerrainMaterial[];
  colliders: readonly ColliderRect[];
  spawns: readonly { name: string; x: number; z: number }[];
}

/** Aucune transformation : la lisibilité prime tant que la taille n'est pas devenue un problème
 *  mesuré. `tile-layer-codec.ts` (`@lindocara/engine`) est le précédent si un jour elle l'est —
 *  un codage par plages, choisi là-bas parce qu'une carte est surtout de longues zones uniformes
 *  et parce qu'un texte en plages reste lisible dans une ligne de base et dans un test qui échoue,
 *  contrairement au base64. Ne pas le réutiliser ici sans la même preuve d'aller-retour ET la
 *  même preuve que du texte malformé rend toujours `null` : un codec compressé est plus dur à
 *  déboguer, et cette tâche n'a mesuré aucune taille qui le justifie.
 */
export function encodeMap(m: MapData): string {
  return JSON.stringify(m);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCollider(value: unknown): value is ColliderRect {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.z) &&
    isFiniteNumber(value.w) &&
    isFiniteNumber(value.h)
  );
}

function isSpawn(value: unknown): value is { name: string; x: number; z: number } {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.z)
  );
}

/**
 * Valide RÉELLEMENT une carte avant de la rendre utilisable : version, taille entière positive,
 * les deux grilles à exactement `size * size` entrées, chaque matière dans l'union, chaque
 * nombre fini. La moindre violation rend `null` — jamais une exception, jamais un objet
 * partiellement cru sur parole.
 */
export function decodeMap(s: string): MapData | null {
  let value: unknown;
  try {
    value = JSON.parse(s);
  } catch {
    return null;
  }

  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;

  const { size, levelHeight, waterLevel, levels, materials, colliders, spawns } = value;
  if (!Number.isInteger(size) || (size as number) <= 0) return null;
  if (!isFiniteNumber(levelHeight) || !isFiniteNumber(waterLevel)) return null;

  const cells = (size as number) * (size as number);
  if (!Array.isArray(levels) || levels.length !== cells) return null;
  if (!Array.isArray(materials) || materials.length !== cells) return null;
  for (const level of levels) {
    if (level !== null && !isFiniteNumber(level)) return null;
  }
  for (const material of materials) {
    if (!isTerrainMaterial(material)) return null;
  }

  if (!Array.isArray(colliders) || !colliders.every(isCollider)) return null;
  if (!Array.isArray(spawns) || !spawns.every(isSpawn)) return null;

  return {
    version: 1,
    size: size as number,
    levelHeight,
    waterLevel,
    levels: levels as (number | null)[],
    materials: materials as TerrainMaterial[],
    colliders: colliders as ColliderRect[],
    spawns: spawns as { name: string; x: number; z: number }[],
  };
}

/** Adapte une `MapData` décodée en ce que `createTerrainQuery` consomme : les mêmes accesseurs
 *  indexés par cellule que `HeightField` (`island.ts`), lus dans la grille sérialisée plutôt que
 *  calculés par le bruit procédural. */
export function mapToQuerySource(m: MapData): TerrainQuerySource {
  const inBounds = (i: number, j: number) => i >= 0 && j >= 0 && i < m.size && j < m.size;
  return {
    size: m.size,
    levelHeight: m.levelHeight,
    waterLevel: m.waterLevel,
    at(i, j) {
      if (!inBounds(i, j)) return null;
      return m.levels[j * m.size + i] ?? null;
    },
    kindAt(i, j) {
      if (!inBounds(i, j)) return null;
      // L'eau n'a pas de matière — `levels` reste l'autorité, `materials` "sans signification"
      // là où il vaut `null` (voir le commentaire du champ), donc on ne le lit même pas.
      if (m.levels[j * m.size + i] === null) return null;
      return m.materials[j * m.size + i] ?? null;
    },
  };
}
