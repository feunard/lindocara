import type * as THREE from "three";

/**
 * Un atlas de terrain : une image du pack Tiny Swords (Free Pack / Update 010), une teinte par
 * palier ou par matière. `block` dit quel bloc 4x4 elle contient — celui bordé d'eau (le liseré
 * d'écume est déjà peint) ou celui bordé de vide (bordure touffue, faite pour coiffer une paroi) —
 * ou `"flat"` pour une image sans bordure d'autotile du tout, une seule tuile. `wallRow` est la
 * ligne de la paroi qui se raccorde SOUS le bloc bordé de vide ; la bande répétable qui la
 * prolonge est la ligne suivante.
 */
export interface TerrainAtlas {
  texture: THREE.Texture;
  cols: number;
  rows: number;
  block: "water-edge" | "cliff-edge" | "flat";
  wallRow: number;
}

/**
 * Taille en pixels d'une tuile dans ce pack — mesurée une fois pour toutes (576/9 = 640/10 = 64) et
 * constante sur tous les atlas de terrain, tuiles ou parois. `TerrainAtlas` ne porte pas de
 * dimension pixel : contrairement au PoC (`ts.px`), le demi-texel se cale donc sur cette
 * connaissance du pack plutôt que sur `texture.image`, qui n'est pas fiable avant décodage.
 */
const TILE_PX = 64;

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
  const iu = 0.5 / (atlas.cols * TILE_PX);
  const iv = 0.5 / (atlas.rows * TILE_PX);
  return {
    u0: col / atlas.cols + iu,
    u1: (col + 1) / atlas.cols - iu,
    // Les UV partent du bas de l'image, les lignes se comptent depuis le haut.
    v0: 1 - (row + 1) / atlas.rows + iv,
    v1: 1 - row / atlas.rows - iv,
  };
}
