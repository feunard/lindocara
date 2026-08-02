import type { HeightField } from "../../src/terrain/field.js";

/**
 * Construit un champ depuis un dessin : un chiffre = un palier, `.` = l'eau, `s` = du sable au
 * palier 0. Une ligne du tableau = une rangée j, un caractère = une colonne i.
 *
 * Partagé entre `terrain-field.test.ts` (Task 8) et `terrain-water.test.ts` (Task 9) : le plan
 * l'écrivait deux fois, mais un seul dessin doit dire ce qu'est une case pour toute la suite
 * `terrain`.
 */
export function fieldFrom(rows: readonly string[]): HeightField {
  const cols = rows[0]?.length ?? 0;
  const at = (i: number, j: number): string | null => {
    if (i < 0 || j < 0 || j >= rows.length || i >= cols) return null;
    const ch = rows[j]?.[i];
    return ch === undefined || ch === "." ? null : ch;
  };
  return {
    cols,
    rows: rows.length,
    levelAt: (i, j) => {
      const ch = at(i, j);
      return ch === null ? null : ch === "s" ? 0 : Number(ch);
    },
    materialAt: (i, j) => {
      const ch = at(i, j);
      return ch === null ? null : ch === "s" ? "sable" : "herbe";
    },
  };
}
