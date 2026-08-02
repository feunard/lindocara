import * as THREE from "three";
import type { Hd2dContext } from "./context.js";

/**
 * Couverture nuageuse, version 2. Avant, c'étaient cinq quads invisibles qui écrivaient dans la
 * shadow map : ça marchait, mais leurs bords étaient aussi nets que ceux d'un tronc — une ombre de
 * nuage à l'emporte-pièce — et il fallait les rendre invisibles à la main parce que leur plan
 * croisait la ligne de visée à 38° de plongée.
 *
 * Ici, plus aucune géométrie : une carte de couverture qui dérive et vient multiplier l'albédo du
 * décor ET des sprites. Les bords sont doux par construction, ça ne coûte pas une passe d'ombre, et
 * le héros s'assombrit quand un nuage lui passe dessus — ce que la shadow map ne faisait pas, les
 * sprites ne recevant alors aucune ombre.
 */

export interface CloudCover {
  setStrength(v: number): void;
  update(dt: number): void;
  offset(): THREE.Vector2;
  dispose(): void;
}

/**
 * Carte de couverture fabriquée au chargement : des taches douces accumulées en additif, dessinées
 * neuf fois chacune (centre + huit décalages) pour que la texture se raccorde à elle-même quand on
 * la répète.
 */
function coverageTexture(size = 512, seed = 1337): THREE.CanvasTexture {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const cx = canvas.getContext("2d");
  if (!cx) throw new Error("Contexte 2D indisponible");
  cx.fillStyle = "#000";
  cx.fillRect(0, 0, size, size);
  cx.globalCompositeOperation = "lighter";

  // Deux octaves : de grandes masses, puis des lambeaux qui en déchirent le bord.
  for (const [count, rMin, rMax, alpha] of [
    [14, 0.16, 0.34, 0.55],
    [40, 0.05, 0.13, 0.32],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const r = (rMin + rng() * (rMax - rMin)) * size;
      for (const dx of [-size, 0, size]) {
        for (const dy of [-size, 0, size]) {
          const g = cx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
          g.addColorStop(0, `rgba(255,255,255,${alpha})`);
          g.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.45})`);
          g.addColorStop(1, "rgba(255,255,255,0)");
          cx.fillStyle = g;
          cx.beginPath();
          cx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
          cx.fill();
        }
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

/**
 * Greffe l'ombre des nuages sur un matériau existant, à partir des uniformes DU CONTEXTE (voir
 * `context.ts`, `CloudUniforms`) — le PoC les lisait sur un objet de module partagé par toute la
 * page ; ici chaque contexte a les siens, donc deux scènes ne se font jamais dériver leurs nuages
 * l'une l'autre.
 *
 * `atOrigin` : pour un sprite, on échantillonne à l'ORIGINE de l'objet et non par fragment. Un
 * billboard est un plan vertical : pris par fragment, la carte s'y étirerait en une traînée
 * verticale, et le haut de l'arbre serait à l'ombre pendant que son pied est au soleil.
 */
export function applyCloudShadow(
  ctx: Hd2dContext,
  material: THREE.Material,
  { atOrigin = false }: { atOrigin?: boolean } = {},
): void {
  const uniforms = ctx.cloudUniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `varying vec2 vCloudXZ;\n${shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
       vCloudXZ = ${atOrigin ? "modelMatrix[3].xz" : "(modelMatrix * vec4(transformed, 1.0)).xz"};`,
    )}`;
    shader.fragmentShader = `uniform sampler2D uCloudMap;
     uniform vec2 uCloudOffset;
     uniform float uCloudScale, uCloudStrength, uCloudSoftness;
     varying vec2 vCloudXZ;\n${shader.fragmentShader.replace(
       "#include <map_fragment>",
       `#include <map_fragment>
        float cloud = texture2D(uCloudMap, vCloudXZ * uCloudScale + uCloudOffset).r;
        diffuseColor.rgb *= 1.0 - uCloudStrength *
          smoothstep(0.5 - uCloudSoftness, 0.5 + uCloudSoftness, cloud);`,
     )}`;
  };
  // Sans ça, three réutiliserait le programme d'un matériau non patché ayant les mêmes réglages, et
  // la greffe passerait à la trappe une fois sur deux.
  material.customProgramCacheKey = () => (atOrigin ? "cloud-origin" : "cloud-frag");
}

/**
 * Fabrique la couverture nuageuse de CE contexte et branche sa dérive sur ses uniformes.
 *
 * `coverageTexture()` dessine sur un canvas : le projet vitest `hd2d` tourne en `node`, sans DOM, et
 * `document` y est indéfini. On ne construit donc la vraie carte que si `document` existe — en
 * navigateur réel — et on laisse sinon le texel noir neutre posé par `createHd2dContext` (voir
 * `neutralCloudTexture`) : `update()`/`offset()`/`setStrength()` restent utilisables sans DOM, ce
 * dont `clouds.test.ts` profite pour ne construire que la dérive, jamais la texture.
 */
export function createCloudCover(ctx: Hd2dContext): CloudCover {
  const uniforms = ctx.cloudUniforms;
  // Le neutre posé par LE CONTEXTE avant que cette couverture ne prenne `uCloudMap` — capturé ICI,
  // avant toute écrasement, pour être restauré tel quel au `dispose()` plutôt que d'en refabriquer
  // un. Revue finale (point E4) : `dispose()` fabriquait auparavant un second neutre à chaque
  // appel, orphelinant celui du contexte (jamais disposé, sans jamais être réutilisé non plus).
  const neutre = uniforms.uCloudMap.value;
  let built: THREE.CanvasTexture | undefined;

  if (typeof document !== "undefined") {
    built = coverageTexture();
    uniforms.uCloudMap.value = built;
  }

  return {
    setStrength(v) {
      uniforms.uCloudStrength.value = v;
    },
    update(dt) {
      uniforms.uCloudOffset.value.x += ctx.config.cloudShadow.drift[0] * dt;
      uniforms.uCloudOffset.value.y += ctx.config.cloudShadow.drift[1] * dt;
    },
    offset: () => uniforms.uCloudOffset.value,
    dispose() {
      // Cette couverture est seule propriétaire de la texture qu'elle a construite : `uCloudMap` est
      // en revanche PARTAGÉ par référence avec tous les matériaux greffés (`applyCloudShadow` fait
      // `Object.assign(shader.uniforms, uniforms)`) — s'ils sont encore rendus après ce `dispose()`,
      // ils échantillonneraient une texture dont la ressource GPU vient d'être libérée. On repose
      // donc INCONDITIONNELLEMENT `uCloudMap` sur le neutre du CONTEXTE — capturé plus haut, jamais
      // refabriqué — pour que le contexte reste dans un état valide et rendable après `dispose()`,
      // y compris quand aucune vraie carte n'a été construite (`built` indéfini, projet vitest
      // `node`) : la garantie ne doit pas dépendre de la plate-forme. Ce neutre reste la propriété du
      // contexte : c'est lui qui le libère, dans SON propre `dispose()` (`context.ts`).
      built?.dispose();
      uniforms.uCloudMap.value = neutre;
    },
  };
}
