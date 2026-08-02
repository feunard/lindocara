/** Un terrain vu comme des données : un niveau et une matière par case, rien d'autre. C'est
 *  l'AUTEUR qui pose l'altitude ; parois, bordures et occlusion s'en déduisent. */
export interface HeightField {
  readonly cols: number;
  readonly rows: number;
  /** Niveau de la case, ou null si c'est de l'eau ou hors carte. */
  levelAt(i: number, j: number): number | null;
  /** Clé de matière — sert à choisir l'atlas et à ouvrir les arêtes entre matières. */
  materialAt(i: number, j: number): string | null;
}

/** Assombrissement apporté par UN voisin plus haut touchant un coin. */
export const AO_CORNER = 0.11;

/**
 * Une arête est « ouverte » — donc bordée — face au vide, face à un voisin plus bas, ou face à une
 * autre matière de même niveau. Un voisin PLUS HAUT ne l'ouvre pas : on est au pied de sa falaise,
 * c'est elle qui porte la bordure.
 *
 * Le sable se borde contre l'herbe et pas l'inverse : c'est lui qui dessine le trait de plage.
 */
export function openEdge(
  field: HeightField,
  i: number,
  j: number,
  di: number,
  dj: number,
): boolean {
  const h = field.levelAt(i, j);
  if (h === null) return false;
  const n = field.levelAt(i + di, j + dj);
  if (n === null || n < h) return true;
  const mine = field.materialAt(i, j);
  return mine === "sable" && field.materialAt(i + di, j + dj) !== "sable";
}

/**
 * Colonne (ou ligne) de l'autotile 4x4. Le choix est SÉPARABLE : la colonne ne dépend que des
 * arêtes ouvertes à l'ouest et à l'est, la ligne que de celles au nord et au sud.
 */
export function autotileAxis(a: boolean, b: boolean): 0 | 1 | 2 | 3 {
  return a && b ? 3 : a ? 0 : b ? 2 : 1;
}

/**
 * Un coin est occlus par chacun des trois voisins qui le touchent — les deux d'arête et le
 * diagonal — dès qu'ils sont plus hauts que lui. C'est ce qui creuse le pied des falaises et le
 * creux des marches, en vertex color et sans coûter une passe.
 */
export function cornerOcclusion(
  field: HeightField,
  i: number,
  j: number,
  di: number,
  dj: number,
): number {
  const h = field.levelAt(i, j);
  if (h === null) return 1;
  let n = 0;
  for (const [a, b] of [
    [di, 0],
    [0, dj],
    [di, dj],
  ] as const) {
    const v = field.levelAt(i + a, j + b);
    if (v !== null && v > h) n++;
  }
  return 1 - AO_CORNER * n;
}

/**
 * Nombre de paliers que la paroi doit descendre de ce côté. Zéro s'il n'y a pas de paroi.
 *
 * Face au vide, elle descend de TOUS ses paliers : sans ça il reste une bande apparemment vide
 * mais inaccessible au ras de l'eau — une falaise doit se voir sur ses quatre côtés.
 */
export function wallDrop(field: HeightField, i: number, j: number, di: number, dj: number): number {
  const h = field.levelAt(i, j);
  if (h === null) return 0;
  const n = field.levelAt(i + di, j + dj);
  if (n === null) return h;
  return n < h ? h - n : 0;
}
