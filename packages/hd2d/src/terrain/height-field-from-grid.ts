// A serialized grid, adapted into the `HeightField` the mesher reads. Takes PRIMITIVE arrays, not
// a map object: this package must not learn what a map is (see `packages/hd2d/AGENTS.md`). The
// material -> atlas key mapping is art direction and stays with the caller for the same reason.

import type { HeightField } from "./field.js";

export interface HeightFieldGridOptions {
  /** Grid side, in cells. The field is square. */
  size: number;
  /** `size * size`, row-major (index = j * size + i). `null` = water. */
  levels: readonly (number | null)[];
  /** `size * size`. Meaningless wherever `levels` is `null`. */
  materials: readonly string[];
  /** Material + level -> atlas key. Art direction, so it stays with the caller. */
  materialKey(material: string, level: number): string;
}

export function heightFieldFromGrid(opts: HeightFieldGridOptions): HeightField {
  const { size, levels, materials, materialKey } = opts;
  const inBounds = (i: number, j: number) => i >= 0 && j >= 0 && i < size && j < size;
  return {
    cols: size,
    rows: size,
    levelAt(i, j) {
      if (!inBounds(i, j)) return null;
      return levels[j * size + i] ?? null;
    },
    materialAt(i, j) {
      if (!inBounds(i, j)) return null;
      const level = levels[j * size + i];
      if (level === null || level === undefined) return null;
      const material = materials[j * size + i];
      return material === undefined ? null : materialKey(material, level);
    },
  };
}
