import * as THREE from "three";
import { makeFlatSprite } from "../billboard.js";
import type { Hd2dContext } from "../context.js";
import type { HeightField } from "./field.js";

const NEIGHBORS_4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

// La tache est une pastille arrondie qui n'occupe que 39 % de sa frame, le reste étant
// transparent (mesuré : 75 px opaques sur 192, alpha franc, sans dégradé). Dimensionner le quad à
// la case donnerait donc une pastille de 0.39 unité, entièrement cachée sous la tuile de terre : on
// ne verrait rien. Le quad se dimensionne sur la PASTILLE, pas sur la frame.
const FOAM_OPAQUE = 75 / 192;

/** Largeur voulue de la pastille visible : la case + son débord. 1.56 semait des mouchetures aux
 *  angles du littoral (le débord d'une pastille glissée sous le sol ne dépasse qu'aux marches, où
 *  seul le bout d'un coin ressort) ; 1.42 donne un liseré continu. */
export const FOAM_SPREAD = 1.42;

// Glissée sous le sol du palier 0 (y = 0, voir `mesh.ts`) : le sol la masque partout où il la
// recouvre, seul le débord dépasse — le liseré épouse donc exactement le découpage des cases. Posée
// SUR l'eau, elle formerait au contraire des pavés flottant au large. La marge est petite et
// arbitraire : assez pour rester visuellement sous le sol, pas assez pour risquer un z-fighting
// avec le plan d'eau qui passe juste en dessous.
const FOAM_Y = -0.03;

export interface FoamOptions {
  /** La bande de frames de l'écume — DÉCLARÉE `atlas: true` au registre de textures (voir
   *  `textures.ts`) : c'est une bande de plusieurs frames échantillonnée par sous-rectangles comme
   *  un tileset, et ses mipmaps moyenneraient les frames entre elles sans ce réglage. */
  texture: THREE.Texture;
  frames: number;
  fps: number;
  /** Débord de la pastille — voir `FOAM_SPREAD`. */
  spread: number;
}

export interface Foam {
  group: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

/**
 * L'écume est un liseré de RIVAGE, pas une bordure de falaise : seule une case de terre au palier 0
 * porte une tache, et seulement si l'un de ses quatre voisins directs est de l'eau. Le bord de la
 * carte compte comme de l'eau (`HeightField.levelAt` répond `null` hors grille, voir `field.ts`) :
 * sans ça, le rivage d'une île qui touche le bord de la grille perdrait son liseré.
 */
export function foamPlacements(field: HeightField): readonly { i: number; j: number }[] {
  const placements: { i: number; j: number }[] = [];
  for (let j = 0; j < field.rows; j++) {
    for (let i = 0; i < field.cols; i++) {
      if (field.levelAt(i, j) !== 0) continue;
      const touchesWater = NEIGHBORS_4.some(([di, dj]) => field.levelAt(i + di, j + dj) === null);
      if (touchesWater) placements.push({ i, j });
    }
  }
  return placements;
}

/**
 * Une tache par case de rivage, chacune un `makeFlatSprite` indépendant posé et glissé sous le sol
 * (voir `foamPlacements`/`FOAM_Y`). L'atlas de plusieurs frames avance TOUTES en phase : une marée
 * qui respire lentement, pas un clapot désordonné où chaque tache serait décalée.
 */
export function createFoam(ctx: Hd2dContext, field: HeightField, opts: FoamOptions): Foam {
  const cx = field.cols / 2;
  const cz = field.rows / 2;
  const size = opts.spread / FOAM_OPAQUE;

  const sprites = foamPlacements(field).map(({ i, j }) => {
    const sprite = makeFlatSprite(ctx, {
      texture: opts.texture,
      cols: opts.frames,
      rows: 1,
      size,
      alphaTest: 0.5,
    });
    sprite.mesh.position.set(i + 0.5 - cx, FOAM_Y, j + 0.5 - cz);
    return sprite;
  });

  const group = new THREE.Group();
  for (const sprite of sprites) group.add(sprite.mesh);

  let temps = 0;
  return {
    group,
    update(dt) {
      temps += dt;
      const frame = Math.floor((temps * opts.fps) % opts.frames);
      for (const sprite of sprites) sprite.setFrame(frame);
    },
    dispose() {
      for (const sprite of sprites) sprite.dispose();
      group.clear();
    },
  };
}
