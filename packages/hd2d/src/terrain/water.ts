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

export interface WaterOptions {
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
}

export interface Water {
  mesh: THREE.Mesh;
  /** Couleurs de la mer, pilotées par l'ambiance (voir `mood.ts`, `ResolvedMood.water`) : muter ces
   *  `THREE.Color` en place suffit, elles SONT les uniformes du shader. */
  readonly colors: { shallow: THREE.Color; deep: THREE.Color };
  setSparkle(v: number): void;
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
export function createWater(_ctx: Hd2dContext, field: HeightField, opts: WaterOptions): Water {
  const cx = field.cols / 2;
  const cz = field.rows / 2;
  const dist = landDistance(field);
  const { cols, rows } = field;

  const seg = Math.max(1, Math.round(opts.size / opts.segment));
  const geo = new THREE.PlaneGeometry(opts.size, opts.size, seg, seg);
  geo.rotateX(-Math.PI / 2);

  const position = geo.attributes.position;
  if (!position) throw new Error("PlaneGeometry sans attribut position");
  const shallow = new Float32Array(position.count);
  for (let k = 0; k < position.count; k++) {
    const i = Math.floor(position.getX(k) + cx);
    const j = Math.floor(position.getZ(k) + cz);
    const d =
      i < 0 || j < 0 || i >= cols || j >= rows
        ? Number.POSITIVE_INFINITY
        : (dist[j * cols + i] ?? Number.POSITIVE_INFINITY);
    shallow[k] = 1 - Math.min(1, d / opts.depthRange);
  }
  geo.setAttribute("aShallow", new THREE.Float32BufferAttribute(shallow, 1));

  const material = new THREE.MeshStandardMaterial({
    roughness: opts.roughness,
    metalness: 0,
  });
  const uniforms = {
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
     varying float vShallow;
     varying vec2 vSea;\n${shader.fragmentShader
       .replace(
         "#include <map_fragment>",
         `#include <map_fragment>
          diffuseColor.rgb = mix(uDeep, uShallow, vShallow);`,
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
  mesh.position.y = opts.level;
  mesh.receiveShadow = true;

  let temps = 0;
  return {
    mesh,
    colors: { shallow: uniforms.uShallow.value, deep: uniforms.uDeep.value },
    setSparkle(v) {
      uniforms.uWave.value = v;
    },
    update(dt) {
      temps += dt;
      uniforms.uTime.value = temps;
    },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}
