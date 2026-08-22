import * as THREE from "three";

import type { Hd2dContext } from "./context.js";
import type { ResolvedMood } from "./mood.js";
import { SkyShader } from "./shaders.js";

// `THREE.ShaderMaterial.uniforms` est typé côté three comme un index signature (`{ [name: string]:
// IUniform }`), donc `noUncheckedIndexedAccess` marque chaque accès comme possiblement `undefined`
// — alors que ce sont les uniformes de `SkyShader`, déclarées juste au-dessus. Un cast local
// restaure la forme exacte sans semer des `!` partout (même pattern que `pipeline.ts`).
interface SkyUniforms {
  uTop: { value: THREE.Color };
  uHorizon: { value: THREE.Color };
  uGlow: { value: THREE.Color };
  uGlowStrength: { value: number };
  uStars: { value: number };
  uAurora: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uTime: { value: number };
}

/** Teinte d'aurore fixe, mélangée à l'horizon de l'ambiance courante — un choix optique, pas un
 *  paramètre de `MoodConfig` : le phénomène a toujours la même couleur, seule son intensité varie
 *  (voir `update`). Volontairement PÂLE : `fog.color` copie cet horizon (voir l'appelant), et le
 *  brouillard couvre tout l'arrière-plan au-delà de `fog.far` — une teinte saturée y devient un
 *  aplat vert plein écran plutôt qu'une COULEUR D'HORIZON. Vérifié à l'écran (voir le rapport de
 *  la task) : `#4dffa0` à 50 % lavait toute l'image dès que le brouillard proche recouvrait le
 *  cadre.
 */
const AURORA_TINT = new THREE.Color("#a8e6c2");
/** Poids MAXIMUM du mélange, à pleine intensité d'aurore — jamais 1 : l'horizon doit rester
 *  reconnaissable comme l'horizon de l'ambiance, teinté, pas remplacé. */
const AURORA_MIX_MAX = 0.16;

/** La voûte céleste : son mesh est à ajouter à la scène, `apply` la fait suivre l'ambiance
 *  courante et `update` la fait suivre la caméra ainsi que l'intensité d'aurore, qui peut varier
 *  image par image indépendamment de tout fondu d'ambiance (voir `update`). */
export interface Sky {
  mesh: THREE.Mesh;
  /** L'horizon du ciel : c'est cette teinte que doit prendre le brouillard de la scène. Reflète
   *  déjà la teinte d'aurore du dernier `update()` — jamais seulement celle de l'ambiance. */
  readonly horizon: THREE.Color;
  apply(mood: ResolvedMood, sunDirection: THREE.Vector3): void;
  /** `aurora` (0..1) est relu à CHAQUE appel, indépendamment de `apply` : l'appelant peut le faire
   *  varier en dehors de tout fondu d'ambiance (une zone qu'on traverse, par exemple) sans que la
   *  voûte ait besoin de savoir pourquoi. */
  update(dt: number, camera: THREE.Camera, aurora: number): void;
  dispose(): void;
}

/**
 * Voûte céleste. Elle remplace un `scene.background` de couleur unie, qui posait l'île sur un
 * aplat.
 *
 * Attention à ce qu'on en attend : la caméra plonge de 38° avec un FOV de 22°, donc son champ va
 * de 27° à 49° SOUS l'horizon — le ciel n'entre jamais dans le cadre, à aucun zoom. Ce qu'on voit
 * en haut de l'image, c'est la mer lointaine noyée dans le brouillard. C'est pour ça que le
 * brouillard prend la couleur d'horizon de cette voûte : la bande haute du cadre devient un vrai
 * horizon dégradé au lieu d'un aplat de fog. Le dégradé, le halo, les étoiles et les rubans
 * d'aurore n'apparaissent, eux, que si l'on redresse le pitch de la caméra — `uAurora` se voit
 * quand même, à la caméra du jeu, par la teinte qu'il donne à `uHorizon` (et donc au brouillard).
 */
// `_ctx` n'est lu par aucun calcul ici : la voûte ne suit ni yaw ni billboard, et sa géométrie ne
// dépend d'aucun réglage de `Hd2dConfig`. Le paramètre reste dans la signature parce que toutes les
// fabriques de scène du package (`createCloudCover`, `applyFillFromPointLight`, ...) prennent le
// `Hd2dContext` du jeu/éditeur qui les appelle — un appelant n'a pas à se demander au cas par cas
// laquelle en a réellement besoin.
export function createSky(_ctx: Hd2dContext): Sky {
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms),
    vertexShader: SkyShader.vertexShader,
    fragmentShader: SkyShader.fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 20), material);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;

  const u = material.uniforms as unknown as SkyUniforms;
  // Horizon de l'ambiance SEULE, sans la teinte d'aurore — `apply()` l'écrit, `update()` s'en sert
  // comme base pour retendre `uHorizon` chaque image. Sans ce mémo, il faudrait soit refaire
  // tourner tout `apply()` à 60 Hz (le fondu jour/nuit ne le fait qu'en transition, exprès), soit
  // laisser l'aurore s'accumuler sur elle-même d'une image à l'autre.
  const horizonAmbiance = new THREE.Color(SkyShader.uniforms.uHorizon.value.getHex());

  return {
    mesh,
    get horizon() {
      return u.uHorizon.value;
    },
    apply(mood, sunDirection) {
      u.uTop.value.copy(mood.sky.top);
      horizonAmbiance.copy(mood.sky.horizon);
      u.uHorizon.value.copy(horizonAmbiance);
      u.uGlow.value.copy(mood.sky.glow);
      u.uGlowStrength.value = mood.sky.glowStrength;
      u.uStars.value = mood.sky.stars;
      u.uSunDir.value.copy(sunDirection).normalize();
    },
    update(dt, camera, aurora) {
      u.uTime.value += dt;
      u.uAurora.value = aurora;
      // L'aurore teinte l'horizon (et donc le brouillard, `fog.color.copy(sky.horizon)` côté
      // appelant) : à la plongée et au champ de la caméra du jeu, c'est le SEUL chemin par lequel
      // le phénomène se voit — la voûte elle-même n'entre jamais dans le cadre (voir le registre
      // des pièges de rendu). Repart de `horizonAmbiance` à chaque image : sans ça, `lerp`
      // accumulerait la teinte au lieu de la doser par `aurora`.
      if (aurora > 0.001)
        u.uHorizon.value.copy(horizonAmbiance).lerp(AURORA_TINT, aurora * AURORA_MIX_MAX);
      else u.uHorizon.value.copy(horizonAmbiance);
      // La voûte suit la caméra : on ne peut ni en sortir ni l'approcher.
      mesh.position.copy(camera.position);
    },
    // Revue finale (point E2) : `Sky` était la seule fabrique du package sans `dispose()`, alors
    // qu'elle alloue sa propre `SphereGeometry`/`ShaderMaterial` — non partagées, sans risque de
    // les libérer sous les pieds d'un autre consommateur.
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
