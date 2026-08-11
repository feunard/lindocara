import type * as THREE from "three";

/**
 * Un atlas de terrain : une image du pack Tiny Swords (Free Pack / Update 010), une teinte par
 * palier ou par matière. `block` dit quel bloc 4x4 elle contient — celui bordé d'eau (le liseré
 * d'écume est déjà peint) ou celui bordé de vide (bordure touffue, faite pour coiffer une paroi) —
 * ou `"flat"` pour une image sans bordure d'autotile du tout, une seule tuile. `tilePx` est la
 * taille en pixels d'UNE tuile — c'est l'appelant qui la connaît (il déclare l'atlas), pas ce
 * module : la déduire de `texture.image` serait fragile avant décodage (`null` en test, pas
 * forcément prêt en usage réel), et la coder en dur romprait le jour où un tileset a une autre
 * taille de tuile que les 64 px de ce pack.
 */
export interface TerrainAtlas {
  texture: THREE.Texture;
  cols: number;
  rows: number;
  block: "water-edge" | "cliff-edge" | "flat";
  /** La rangée de paroi dont le PIED touche la terre : de petites touffes d'herbe à sa base. */
  wallRow: number;
  /**
   * La rangée de paroi dont le pied touche l'EAU : un feston d'écume blanche à sa base.
   *
   * Le pack en dessine bien deux, l'une SOUS l'autre, et ce ne sont PAS une bande et sa répétition
   * — ce que ce commentaire a longtemps affirmé, au prix d'une falaise qui plongeait en mer avec de
   * l'herbe au ras des vagues. Ce sont deux variantes ALTERNATIVES, choisies par ce qui se trouve
   * au pied de la falaise ; leurs sommets sont identiques, seules leurs bases diffèrent.
   *
   * Facultative : la feuille de sable (10x4) n'a aucune bande de paroi, et le sable ne descend
   * jamais — `meshTerrain` retombe alors sur `wallRow`.
   */
  wallRowInWater?: number;
  tilePx: number;
}

// Colonne d'origine du bloc 4x4 dans le tileset, selon ce que la bordure regarde (voir
// `TerrainAtlas.block`) : 0 pour le bloc bordé d'EAU (le liseré d'écume y est déjà peint), 5 pour
// le bloc bordé de VIDE (bordure touffue, faite pour coiffer une paroi — les parois elles-mêmes
// s'y raccordent toujours, quel que soit le bloc du dessus).
export const WATER_EDGE_COL = 0;
export const CLIFF_EDGE_COL = 5;

/** Colonne de base du bloc 4x4 selon ce que porte cet atlas, ou `null` pour `"flat"` — une seule
 *  tuile, sans autotiling. */
export function blockOrigin(atlas: TerrainAtlas): number | null {
  if (atlas.block === "water-edge") return WATER_EDGE_COL;
  if (atlas.block === "cliff-edge") return CLIFF_EDGE_COL;
  return null;
}

/**
 * Rectangle UV d'une tuile, rentré d'un demi-texel pour ne pas mordre la voisine : un atlas sans
 * mipmaps (voir `textures.ts`, atlas = pas de mipmaps) échantillonné par sous-rectangles bave sur
 * ses voisines dès que les UV tombent pile sur la frontière.
 */
export function tileUV(
  atlas: TerrainAtlas,
  col: number,
  row: number,
): { u0: number; v0: number; u1: number; v1: number } {
  const iu = 0.5 / (atlas.cols * atlas.tilePx);
  const iv = 0.5 / (atlas.rows * atlas.tilePx);
  return {
    u0: col / atlas.cols + iu,
    u1: (col + 1) / atlas.cols - iu,
    // Les UV partent du bas de l'image, les lignes se comptent depuis le haut.
    v0: 1 - (row + 1) / atlas.rows + iv,
    v1: 1 - row / atlas.rows - iv,
  };
}
