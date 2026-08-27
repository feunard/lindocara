// Une grille sérialisée, adaptée au `HeightField` lu par le maillage. Elle reçoit des tableaux
// PRIMITIFS, jamais un objet carte : ce package ne doit pas apprendre ce qu'est une carte. Le lien
// matière -> atlas relève de la direction artistique et reste donc lui aussi chez l'appelant.

import type { HeightField } from "./field.js";

export interface HeightFieldGridOptions {
  /** Côté de la grille carrée, en cases. */
  size: number;
  /** `size * size`, par lignes (index = j * size + i). `null` = eau. */
  levels: readonly (number | null)[];
  /** `size * size`. Sans signification là où `levels` vaut `null`. */
  materials: readonly string[];
  /** Liquides explicites facultatifs et leurs paliers de surface. */
  liquids?: readonly ("water" | "lava" | null)[];
  liquidLevels?: readonly (number | null)[];
  /** Matière + palier -> clé d'atlas. La direction artistique reste chez l'appelant. */
  materialKey(material: string, level: number): string;
}

export function heightFieldFromGrid(opts: HeightFieldGridOptions): HeightField {
  const { size, levels, materials, liquids, liquidLevels, materialKey } = opts;
  const inBounds = (i: number, j: number) => i >= 0 && j >= 0 && i < size && j < size;
  const indexOf = (i: number, j: number): number => j * size + i;
  const liquidAt = (i: number, j: number): "water" | "lava" | null => {
    if (!inBounds(i, j)) return "water";
    const index = indexOf(i, j);
    const explicit = liquids?.[index] ?? null;
    if (explicit) return explicit;
    if (levels[index] !== null && materials[index] === "lave") return "lava";
    return levels[index] === null ? "water" : null;
  };
  const liquidLevelAt = (i: number, j: number): number | null => {
    if (!inBounds(i, j)) return null;
    const index = indexOf(i, j);
    if (liquids?.[index]) return liquidLevels?.[index] ?? null;
    return levels[index] !== null && materials[index] === "lave" ? (levels[index] ?? null) : null;
  };
  return {
    cols: size,
    rows: size,
    levelAt(i, j) {
      if (!inBounds(i, j)) return null;
      if (liquidAt(i, j)) return null;
      return levels[indexOf(i, j)] ?? null;
    },
    materialAt(i, j) {
      if (!inBounds(i, j)) return null;
      if (liquidAt(i, j)) return null;
      const level = levels[indexOf(i, j)];
      if (level === null || level === undefined) return null;
      const material = materials[indexOf(i, j)];
      return material === undefined ? null : materialKey(material, level);
    },
    liquidAt,
    liquidLevelAt,
    waterAt(i, j) {
      return liquidAt(i, j) === "water" ? liquidLevelAt(i, j) : null;
    },
  };
}
