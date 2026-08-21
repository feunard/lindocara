import * as THREE from "three";
import type { Hd2dContext } from "../context.js";
import type { HeightField } from "./field.js";

const NEIGHBORS_4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Distance en cases à la terre la plus proche, propagée depuis chaque case de terre par
 * plus-court-chemin en largeur (comme le `distTerre` du PoC). C'est elle qui fait passer la mer du
 * turquoise de haut-fond au bleu du large : sans elle, l'étendue entière serait un aplat, et rien
 * ne dirait où l'on a pied.
 */
function landDistance(field: HeightField): Float64Array {
  const { cols, rows } = field;
  const dist = new Float64Array(cols * rows).fill(Number.POSITIVE_INFINITY);
  // File plate [i0, j0, i1, j1, ...] plutôt qu'un tableau de tuples : une seule allocation, pas de
  // désindexation à chaque pas.
  const queue: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (field.levelAt(i, j) === null) continue;
      dist[j * cols + i] = 0;
      queue.push(i, j);
    }
  }
  for (let k = 0; k < queue.length; k += 2) {
    const i = queue[k] ?? 0;
    const j = queue[k + 1] ?? 0;
    const d = dist[j * cols + i] ?? 0;
    for (const [di, dj] of NEIGHBORS_4) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const idx = nj * cols + ni;
      if ((dist[idx] ?? Number.POSITIVE_INFINITY) <= d + 1) continue;
      dist[idx] = d + 1;
      queue.push(ni, nj);
    }
  }
  return dist;
}

// Ce que le PoC dit vraiment : `WORLD.size` (72, la grille de tuiles) donne `waterTex.repeat.set(size
// * 0.5, ...)` = 36 répétitions, mais le plan lui-même mesure `WIDE = size * 3` = 216 unités — trois
// lignes plus loin, sur une variable DIFFÉRENTE. 216 unités / 36 répétitions = UNE TUILE DE TEXTURE
// COUVRE 6 UNITÉS MONDE. C'est cet invariant-là qu'il faut préserver, pas la formule `size * 0.5` :
// elle mélangeait par accident deux grandeurs qui ne coïncident que si le plan mesure exactement 3x
// la grille. Ici `opts.size` EST déjà la largeur réelle du plan (il va tel quel dans
// `PlaneGeometry`) : dériver la répétition en unités-monde-par-tuile plutôt qu'en fraction de `size`
// reste correct quelle que soit la taille de plan choisie par l'appelant.
const DEFAULT_TEXTURE_WORLD_SIZE = 6;

export interface WaterOptions {
  /** Texture de surface — modulée par le dégradé de profondeur (voir plus bas), pas affichée
   *  telle quelle : elle casse l'aplat du dégradé et donne son grain à la mer. `createWater` en
   *  CLONE une copie propre à cette mer (voir plus bas, même motif que `cloneSheetMap` dans
   *  `billboard.ts`) : l'objet passé ici reste inchangé et reste la propriété du registre de
   *  textures de l'appelant — `dispose()` ne le libère jamais, une autre surface peut le partager
   *  sans qu'aucune mer n'en modifie le wrap, le repeat ou l'offset dans le dos d'une autre. */
  texture: THREE.Texture;
  /** Hauteur monde du plan d'eau. */
  level: number;
  /** Côté du plan, en unités monde. */
  size: number;
  /** Espacement voulu entre deux sommets, en unités monde — c'est lui qui porte le dégradé de
   *  profondeur ; le plan reste plat, seules les NORMALES ondulent (voir plus bas). */
  segment: number;
  /** Distance en cases sur laquelle l'eau passe de la teinte de haut-fond à celle du large. */
  depthRange: number;
  /** 0.12 fait de la mer un miroir : à cette échelle le lobe spéculaire du soleil couvre le cadre
   *  entier et l'écran vire au blanc laiteux — une nappe, pas des reflets. Il faut une surface
   *  franchement rugueuse pour que la lumière se casse en éclats au lieu de s'étaler ; le PoC
   *  utilise 0.46. */
  roughness: number;
  /** Largeur monde, en unités, qu'UNE TUILE de la texture doit couvrir — indépendant de `size` et
   *  de `segment`. Par défaut 6 (voir `DEFAULT_TEXTURE_WORLD_SIZE` ci-dessus, l'invariant mesuré
   *  dans le PoC). La répétition posée sur la texture vaut `size / textureWorldSize` : exprimé
   *  ainsi, un appelant qui ignore tout du PoC ne peut pas se tromper en changeant `size`. */
  textureWorldSize?: number;
  /**
   * World `[x, z]` centre of the surface. Defaults to the world origin, which is where the sea
   * belongs.
   *
   * Giving it a centre is what lets water exist somewhere OTHER than the sea — a pool at the foot
   * of a waterfall, a spring on a summit. Combined with `level`, it is what "water at elevation"
   * means here: the same material, the same four crossed swells, the same mood-driven colours and
   * sparkle as the ocean, just somewhere else and higher up. A pool faked with its own flat shader
   * reads as a painted disc no matter how it is tinted, because it has none of that.
   */
  center?: readonly [number, number];
  /**
   * Shallowness (0 = open sea, 1 = right against the shore), replacing the depth gradient derived
   * from the height field. Either a constant, or a function of the position WITHIN the surface,
   * in world units relative to its centre.
   *
   * A small pool needs this. The field gradient answers "how far is the nearest land", which is the
   * right question for an ocean and a meaningless one for a body of water entirely within a few
   * feet of its own bank — worse, a pool sitting ON land samples distance 0 everywhere and comes
   * out uniformly shore-coloured by accident rather than by intent.
   *
   * Prefer the FUNCTION form for anything small. A constant makes `mix(deep, shallow, k)` one flat
   * colour across the whole surface, which is a blue rectangle however good the material is — the
   * summit spring was exactly that until it was given a bowl.
   */
  shallow?: number | ((x: number, z: number) => number);
}

export interface Water {
  mesh: THREE.Mesh;
  /** Couleurs de la mer, pilotées par l'ambiance (voir `mood.ts`, `ResolvedMood.water`) : muter ces
   *  `THREE.Color` en place suffit, elles SONT les uniformes du shader. */
  readonly colors: { shallow: THREE.Color; deep: THREE.Color };
  setSparkle(v: number): void;
  /**
   * Refait le dégradé de haut-fond pour un nouveau relief, SANS reconstruire le plan.
   *
   * C'est toute la raison d'être de cette méthode : le plan de 385x385 sommets coûte 17-23 ms à
   * allouer et ne dépend que de `size` — pas une seule de ses positions ne bouge quand la côte
   * change — alors que `aShallow`, la seule chose que le relief pilote, se recalcule en ~1 ms.
   * L'éditeur repeignait la mer entière par case peinte faute de cette distinction.
   *
   * Sans effet si `shallow` a été fourni en constante ou en fonction : ces deux formes ne lisent
   * pas le champ, donc rien à y rafraîchir.
   */
  setField(field: HeightField): void;
  update(dt: number): void;
  dispose(): void;
}

/**
 * La mer : un plan opaque, subdivisé assez fin pour porter un dégradé de profondeur par sommet,
 * dont seules les NORMALES ondulent — la géométrie reste plate, le niveau de l'eau sert aux
 * collisions ailleurs dans le jeu, on ne le déforme pas.
 *
 * Opaque, jamais translucide : l'écume est peinte en découpe (`alphaTest`), donc AVANT les
 * matériaux transparents. Une mer translucide repasserait par-dessus et la recouvrirait de 12 %.
 */
// `_ctx` n'est lu par aucun calcul ici : contrairement au sol et à l'écume, le PoC ne greffe PAS
// l'ombre des nuages sur la mer — son shader est déjà entièrement custom (dégradé de profondeur +
// houles). Le paramètre reste dans la signature parce que toutes les fabriques de scène du package
// prennent le `Hd2dContext` du jeu/éditeur qui les appelle (voir `sky.ts`) — un appelant n'a pas à
// se demander au cas par cas laquelle en a réellement besoin.
/**
 * The map's ground, as a one-texel-per-cell mask: 255 where a cell HAS ground, 0 where it is water
 * or off the map.
 *
 * This is what keeps a dry pit dry. The sea is one flat plane at `level`, three times wider than
 * the grid, and until ground could sink below that level it was hidden everywhere it mattered by
 * terrain standing above it. A pit floor is BELOW it, so the plane simply closed over the pit and
 * drew a pond.
 *
 * A mask rather than geometry, for two reasons the alternatives fail on: cutting holes in the plane
 * would need it rebuilt per terrain edit, and the plane is 17-23 ms to allocate and is deliberately
 * reused across scenes (see `Water.setField`); and per-vertex masking would be as coarse as the
 * plane's own segments, which are two world units, so the coastline would fray. One texel per cell,
 * sampled NEAREST, cuts exactly on cell boundaries at any plane resolution.
 */
export function groundMaskData(field: HeightField): Uint8Array {
  const data = new Uint8Array(field.cols * field.rows);
  for (let j = 0; j < field.rows; j++) {
    for (let i = 0; i < field.cols; i++) {
      data[j * field.cols + i] = field.levelAt(i, j) === null ? 0 : 255;
    }
  }
  return data;
}

function groundMaskTexture(field: HeightField): THREE.DataTexture {
  const data = groundMaskData(field);
  const texture = new THREE.DataTexture(data, field.cols, field.rows, THREE.RedFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createWater(_ctx: Hd2dContext, field: HeightField, opts: WaterOptions): Water {
  const seg = Math.max(1, Math.round(opts.size / opts.segment));
  const geo = new THREE.PlaneGeometry(opts.size, opts.size, seg, seg);
  geo.rotateX(-Math.PI / 2);

  const position = geo.attributes.position;
  if (!position) throw new Error("PlaneGeometry sans attribut position");
  const shallow = new Float32Array(position.count);

  /** Le dégradé de haut-fond, seule part de cette mer que le relief pilote. Séparé du plan pour
   *  pouvoir être refait seul — voir `Water.setField`. */
  const fillShallow = (source: HeightField): void => {
    if (typeof opts.shallow === "number") {
      shallow.fill(opts.shallow);
      return;
    }
    if (typeof opts.shallow === "function") {
      const at = opts.shallow;
      for (let k = 0; k < position.count; k++) {
        shallow[k] = at(position.getX(k), position.getZ(k));
      }
      return;
    }
    const cx = source.cols / 2;
    const cz = source.rows / 2;
    const { cols, rows } = source;
    const dist = landDistance(source);
    for (let k = 0; k < position.count; k++) {
      const i = Math.floor(position.getX(k) + cx);
      const j = Math.floor(position.getZ(k) + cz);
      // Le plan mesure trois fois la grille : la plupart de ses sommets tombent DEHORS. Les compter
      // comme infiniment loin de la terre coupait net le dégradé au cadre du champ — une côte qui
      // touche le bord perdait toute sa frange de haut-fond, tandis qu'un bord doublé d'eau à
      // l'intérieur du cadre gardait la sienne : le liseré devenait franc d'un côté, absent de
      // l'autre. La distance CONTINUE dehors : on se ramène à la case du bord la plus proche et on
      // ajoute le débord, ce qui prolonge exactement la même rampe au large.
      const ci = Math.min(cols - 1, Math.max(0, i));
      const cj = Math.min(rows - 1, Math.max(0, j));
      const overshoot = Math.hypot(i - ci, j - cj);
      const d = (dist[cj * cols + ci] ?? Number.POSITIVE_INFINITY) + overshoot;
      shallow[k] = 1 - Math.min(1, d / opts.depthRange);
    }
  };

  fillShallow(field);
  // `BufferAttribute`, jamais `Float32BufferAttribute` : celui-ci RECOPIE le tableau qu'on lui
  // donne (`super(new Float32Array(array), ...)`), si bien que `fillShallow` écrirait ensuite dans
  // un tampon détaché de la géométrie — le dégradé ne bougerait plus jamais, sans rien signaler.
  const shallowAttribute = new THREE.BufferAttribute(shallow, 1);
  geo.setAttribute("aShallow", shallowAttribute);

  // Clonée, jamais mutée en place : `opts.texture` est documentée partageable (voir
  // `WaterOptions.texture`), et cette mer pose son propre wrap/repeat et fait défiler son propre
  // offset à chaque frame (`update`, plus bas). Muter l'original ferait de deux mers sur la même
  // texture un bug à distance — la seconde construite écraserait le `repeat` de la première, et
  // les deux `update()` cumuleraient leur défilement sur le même `.offset`. Le clone PARTAGE la
  // Source (pas de second upload GPU, voir `cloneSheetMap` dans `billboard.ts`) ; seuls
  // wrap/repeat/offset lui sont propres.
  const texture = opts.texture.clone();
  // `RepeatWrapping` posé ICI plutôt que documenté comme un pré-requis côté appelant : une texture
  // dont le wrap resterait au défaut (`ClampToEdge`) répéterait son bord, pas son motif, et rien ne
  // le signale — un seul carreau étiré sur toute la mer, sans erreur ni avertissement. `needsUpdate`
  // est nécessaire si la texture d'origine a déjà été uploadée par le registre (voir `textures.ts`) :
  // changer `wrapS`/`wrapT` après upload ne prend effet qu'à la prochaine synchronisation GPU.
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  const textureWorldSize = opts.textureWorldSize ?? DEFAULT_TEXTURE_WORLD_SIZE;
  texture.repeat.set(opts.size / textureWorldSize, opts.size / textureWorldSize);
  texture.needsUpdate = true;

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: opts.roughness,
    metalness: 0,
  });
  let groundMask = groundMaskTexture(field);
  const uniforms = {
    uGround: { value: groundMask },
    /** World rect of the grid, as origin + inverse size, so the shader costs one multiply. */
    uGroundRect: {
      value: new THREE.Vector4(-field.cols / 2, -field.rows / 2, 1 / field.cols, 1 / field.rows),
    },
    uTime: { value: 0 },
    // Couleurs volontairement SOMBRES et saturées : c'est un plan horizontal qui prend le soleil de
    // plein fouet, et ACES désature tout ce qui monte vers les hautes lumières — un turquoise pâle
    // finirait en nappe grise, comme la mer claire vue dans le PoC avant ce réglage.
    uShallow: { value: new THREE.Color("#93e6dc") },
    uDeep: { value: new THREE.Color("#0f5f80") },
    uWave: { value: 1 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float aShallow;\nvarying float vShallow;\nvarying vec2 vSea;\n${shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
       vShallow = aShallow;
       vSea = (modelMatrix * vec4(transformed, 1.0)).xz;`,
    )}`;
    shader.fragmentShader = `uniform float uTime, uWave;
     uniform vec3 uShallow, uDeep;
     uniform sampler2D uGround;
     uniform vec4 uGroundRect;
     varying float vShallow;
     varying vec2 vSea;\n${shader.fragmentShader
       .replace(
         "#include <clipping_planes_fragment>",
         // Discarded over any cell that HAS ground, which is a no-op everywhere the terrain already
         // stood above the plane and is the whole fix where it does not: a sunken level is dry
         // ground, not a seabed. Outside the grid the sea carries on, which is what the plane's
         // extra width is for.
         `#include <clipping_planes_fragment>
          {
            vec2 cell = (vSea - uGroundRect.xy) * uGroundRect.zw;
            if (cell.x > 0.0 && cell.x < 1.0 && cell.y > 0.0 && cell.y < 1.0 &&
                texture2D(uGround, cell).r > 0.5) discard;
          }`,
       )
       .replace(
         "#include <map_fragment>",
         // La texture ne sert plus qu'à MODULER : la couleur vient du dégradé de profondeur, que la
         // luminance de la texture casse en grain plutôt que d'écraser en aplat.
         `#include <map_fragment>
          float lum = dot(diffuseColor.rgb, vec3(0.3333));
          diffuseColor.rgb = mix(uDeep, uShallow, vShallow) * (0.72 + 0.56 * lum);`,
       )
       // Quatre houles analytiques croisées, dérivées à la main : sans elles la normale du plan est
       // parfaitement plate, et le soleil n'accroche nulle part malgré une roughness basse — la mer
       // reste un aplat. On n'a besoin d'aucune normal map, et `viewMatrix` est déclaré côté
       // fragment, ce qui suffit à ramener la normale monde dans l'espace vue (le plan n'a pas
       // d'échelle).
       .replace(
         "#include <normal_fragment_begin>",
         `#include <normal_fragment_begin>
          {
            vec2 g = vec2(0.0);
            vec4 fr = vec4(0.79, 1.31, 2.17, 3.43);
            vec4 sp = vec4(0.62, 0.94, 1.37, 1.81);
            vec4 am = vec4(0.055, 0.032, 0.017, 0.009);
            vec2 d0 = normalize(vec2( 0.92,  0.39));
            vec2 d1 = normalize(vec2(-0.51,  0.86));
            vec2 d2 = normalize(vec2( 0.31, -0.95));
            vec2 d3 = normalize(vec2(-0.87, -0.49));
            g += d0 * (fr.x * am.x * cos(dot(vSea, d0) * fr.x + uTime * sp.x));
            g += d1 * (fr.y * am.y * cos(dot(vSea, d1) * fr.y + uTime * sp.y));
            g += d2 * (fr.z * am.z * cos(dot(vSea, d2) * fr.z + uTime * sp.z));
            g += d3 * (fr.w * am.w * cos(dot(vSea, d3) * fr.w + uTime * sp.w));
            vec3 wn = normalize(vec3(-g.x * uWave, 1.0, -g.y * uWave));
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
          }`,
       )}`;
  };
  // Sans ça, three réutiliserait le programme d'un matériau non patché ayant les mêmes réglages, et
  // la greffe passerait à la trappe une fois sur deux.
  material.customProgramCacheKey = () => "sea";

  const mesh = new THREE.Mesh(geo, material);
  const [centreX, centreZ] = opts.center ?? [0, 0];
  mesh.position.set(centreX, opts.level, centreZ);
  mesh.receiveShadow = true;

  let temps = 0;
  return {
    mesh,
    colors: { shallow: uniforms.uShallow.value, deep: uniforms.uDeep.value },
    setSparkle(v) {
      uniforms.uWave.value = v;
    },
    setField(next) {
      // The mask is refreshed even when `shallow` was given as a constant or a function: those two
      // forms replace the DEPTH GRADIENT, not the question of where there is ground at all, and a
      // pool that kept a stale mask would flood the pit an author just dug under it.
      groundMask.dispose();
      groundMask = groundMaskTexture(next);
      uniforms.uGround.value = groundMask;
      uniforms.uGroundRect.value.set(-next.cols / 2, -next.rows / 2, 1 / next.cols, 1 / next.rows);
      if (opts.shallow !== undefined) return;
      fillShallow(next);
      shallowAttribute.needsUpdate = true;
    },
    update(dt) {
      temps += dt;
      uniforms.uTime.value = temps;
      // Léger défilement de la texture, en plus de l'ondulation des normales — deux mouvements de
      // fréquences différentes qui ne se resynchronisent jamais à l'oeil.
      texture.offset.x += dt * 0.012;
      texture.offset.y += dt * 0.008;
    },
    dispose() {
      geo.dispose();
      material.dispose();
      groundMask.dispose();
      // Le CLONE (voir plus haut) appartient à cette mer, donc à elle de le libérer. `opts.texture`
      // — l'original — n'est en revanche jamais touché : il appartient au registre de textures de
      // l'appelant (voir la doc de `WaterOptions.texture`), une autre surface pourrait le partager.
      texture.dispose();
    },
  };
}
