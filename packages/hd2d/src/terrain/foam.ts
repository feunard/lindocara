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

// Glissée sous le sol du palier 0 (y = 0, voir `mesh.ts`), mais au-dessus du plan d'eau : le sol
// masque la pastille partout où il la recouvre, seul le débord dépasse — le liseré épouse donc
// exactement le découpage des cases. Posée SUR l'eau, elle formerait au contraire des pavés
// flottant au large. La marge est petite et arbitraire : assez pour rester visuellement sous le
// sol, pas assez pour risquer un z-fighting avec le plan d'eau — mais elle reste une marge AU-DESSUS
// du niveau d'eau réel (`FoamOptions.waterLevel`), jamais un Y absolu : figée en dur, une mer
// configurée à un niveau supérieur (`WaterOptions.level`, décision « la mer est opaque ») masquerait
// silencieusement TOUTE l'écume, vue du dessus, sans qu'aucun test ne puisse l'attraper.
const FOAM_MARGIN_ABOVE_WATER = 0.02;

/**
 * The visible span of an elevated strip ALONG its shoreline, in world units.
 *
 * It has to exceed the one-unit spacing between cells or the rim comes out DASHED: a round
 * pastille 0.6 across, dropped once per cell a unit apart, cannot touch its neighbours. Slightly
 * over one unit makes consecutive strips overlap into a continuous line.
 */
const FOAM_ELEVATED_ALONG = 1.25;

/** The visible span ACROSS the shoreline. Thin, so the rim reads as a line at the water's edge
 *  rather than as a pillow sitting on the bank — which is what a round sprite big enough to be
 *  continuous would look like. */
const FOAM_ELEVATED_ACROSS = 0.5;

/** How far an elevated strip is pushed from its cell's centre toward the water. Half a cell puts
 *  it exactly on the boundary. */
const FOAM_ELEVATED_PUSH = 0.5;

export interface FoamOptions {
  /** Height of one level tier, in world units — needed to place foam at an ELEVATED water surface
   *  (see `HeightField.waterAt`). The sea's own foam only ever needs `waterLevel`. */
  levelHeight: number;
  /** La bande de frames de l'écume — DÉCLARÉE `atlas: true` au registre de textures (voir
   *  `textures.ts`) : c'est une bande de plusieurs frames échantillonnée par sous-rectangles comme
   *  un tileset, et ses mipmaps moyenneraient les frames entre elles sans ce réglage. */
  texture: THREE.Texture;
  frames: number;
  fps: number;
  /** Débord de la pastille — voir `FOAM_SPREAD`. */
  spread: number;
  /** Niveau monde du plan d'eau — le même que `WaterOptions.level` passé à `createWater` pour LA
   *  MÊME mer. L'écume se pose `FOAM_MARGIN_ABOVE_WATER` au-dessus de lui, jamais à un Y figé : la
   *  mer est opaque (voir `water.ts`), donc tout niveau d'eau qui remonterait au-dessus de cette
   *  marge occulterait l'écume plutôt que de rester en dessous. */
  waterLevel: number;
}

export interface Foam {
  group: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

/**
 * L'écume est le liseré de TOUT terrain qui touche l'eau : une case de terre en porte une dès que
 * l'un de ses quatre voisins directs est de l'eau, à N'IMPORTE quel palier. Le bord de la carte
 * compte comme de l'eau (`HeightField.levelAt` répond `null` hors grille, voir `field.ts`) : sans
 * ça, le rivage d'une île qui touche le bord de la grille perdrait son liseré.
 *
 * Le palier ne change rien au placement parce qu'il ne change rien au DESSIN : la tache se pose au
 * niveau de la mer (voir `FOAM_MARGIN_ABOVE_WATER`) et le volume de l'île la masque — la coque de
 * paroi de `mesh.ts` ferme les découpes transparentes des falaises — donc seul son débord dépasse,
 * au ras de l'eau, au pied de la falaise. Le restreindre au palier 0 laissait une falaise plonger
 * dans la mer sur un trait net, sans une vague.
 */
export function foamPlacements(
  field: HeightField,
): readonly { i: number; j: number; water: number | null; toWater: readonly [number, number] }[] {
  const placements: {
    i: number;
    j: number;
    water: number | null;
    toWater: readonly [number, number];
  }[] = [];
  for (let j = 0; j < field.rows; j++) {
    for (let i = 0; i < field.cols; i++) {
      if (field.levelAt(i, j) === null) continue;
      let sea = false;
      const elevated: { dir: readonly [number, number]; level: number }[] = [];
      for (const [di, dj] of NEIGHBORS_4) {
        if (field.levelAt(i + di, j + dj) !== null) continue;
        const w = field.waterAt?.(i + di, j + dj);
        if (w === null || w === undefined) sea = true;
        else elevated.push({ dir: [di, dj], level: w });
      }
      // The sea wins wherever a cell touches both: it is the lower surface, and the one whose foam
      // belongs at the cell's foot rather than floating at its head. It also keeps this path
      // producing exactly ONE placement per shore cell, as it always has.
      if (sea) {
        placements.push({ i, j, water: null, toWater: [0, 0] });
        continue;
      }
      // Elevated water gets one strip per EDGE, not per cell. Per cell leaves a notch at every
      // corner — a cell touching the pool on two sides can only be oriented along one of them —
      // and corners are where a rim most obviously breaks.
      for (const { dir, level } of elevated) {
        placements.push({ i, j, water: level, toWater: dir });
      }
    }
  }
  return placements;
}

/**
 * Une tache par case de rivage, chacune un `makeFlatSprite` indépendant posé et glissé sous le sol
 * (voir `foamPlacements`/`FOAM_MARGIN_ABOVE_WATER`). L'atlas de plusieurs frames avance TOUTES en
 * phase : une marée qui respire lentement, pas un clapot désordonné où chaque tache serait décalée.
 */
export function createFoam(ctx: Hd2dContext, field: HeightField, opts: FoamOptions): Foam {
  const cx = field.cols / 2;
  const cz = field.rows / 2;
  const size = opts.spread / FOAM_OPAQUE;
  const y = opts.waterLevel + FOAM_MARGIN_ABOVE_WATER;

  const sprites = foamPlacements(field).map(({ i, j, water, toWater }) => {
    // The sea's blob is deliberately WIDER than a cell because the terrain tile buries most of it
    // and only the overhang shows (see `FOAM_SPREAD`). Water at ELEVATION is flush with the rock
    // around it, so nothing buries anything: drawn at the same size it renders as a white pillow
    // sitting on the summit.
    //
    // An elevated strip is therefore sized in TWO axes rather than one — long along its shoreline
    // so consecutive strips overlap into a continuous rim, thin across it so it reads as a line at
    // the water's edge. A single round sprite cannot be both: shrunk enough not to be a pillow it
    // no longer reaches its neighbour, and the rim comes out dashed.
    if (water === null) {
      const sprite = makeFlatSprite(ctx, {
        texture: opts.texture,
        cols: opts.frames,
        rows: 1,
        size,
        alphaTest: 0.5,
      });
      sprite.mesh.position.set(i + 0.5 - cx, y, j + 0.5 - cz);
      return sprite;
    }

    // `makeFlatSprite` lays `PlaneGeometry(size, size * aspect)` flat: `size` spans X, the product
    // spans Z. A shoreline whose water lies north or south runs along X and wants the length there;
    // one whose water lies east or west wants it along Z.
    const alongX = Math.abs(toWater[1]) >= Math.abs(toWater[0]);
    const along = FOAM_ELEVATED_ALONG / FOAM_OPAQUE;
    const across = FOAM_ELEVATED_ACROSS / FOAM_OPAQUE;
    const sprite = makeFlatSprite(ctx, {
      texture: opts.texture,
      cols: opts.frames,
      rows: 1,
      size: alongX ? along : across,
      aspect: alongX ? across / along : along / across,
      alphaTest: 0.5,
    });
    sprite.mesh.position.set(
      i + 0.5 - cx + toWater[0] * FOAM_ELEVATED_PUSH,
      water * opts.levelHeight + FOAM_MARGIN_ABOVE_WATER,
      j + 0.5 - cz + toWater[1] * FOAM_ELEVATED_PUSH,
    );
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
