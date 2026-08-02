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
  uSunDir: { value: THREE.Vector3 };
  uTime: { value: number };
}

/** La voûte céleste : son mesh est à ajouter à la scène, `apply` la fait suivre l'ambiance
 *  courante et `update` la fait suivre la caméra. */
export interface Sky {
  mesh: THREE.Mesh;
  /** L'horizon du ciel : c'est cette teinte que doit prendre le brouillard de la scène. */
  readonly horizon: THREE.Color;
  apply(mood: ResolvedMood, sunDirection: THREE.Vector3): void;
  update(dt: number, camera: THREE.Camera): void;
}

/**
 * Voûte céleste. Elle remplace un `scene.background` de couleur unie, qui posait l'île sur un
 * aplat.
 *
 * Attention à ce qu'on en attend : la caméra plonge de 38° avec un FOV de 22°, donc son champ va
 * de 27° à 49° SOUS l'horizon — le ciel n'entre jamais dans le cadre, à aucun zoom. Ce qu'on voit
 * en haut de l'image, c'est la mer lointaine noyée dans le brouillard. C'est pour ça que le
 * brouillard prend la couleur d'horizon de cette voûte : la bande haute du cadre devient un vrai
 * horizon dégradé au lieu d'un aplat de fog. Le dégradé, le halo et les étoiles n'apparaissent, eux,
 * que si l'on redresse le pitch de la caméra.
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

  return {
    mesh,
    get horizon() {
      return u.uHorizon.value;
    },
    apply(mood, sunDirection) {
      u.uTop.value.copy(mood.sky.top);
      u.uHorizon.value.copy(mood.sky.horizon);
      u.uGlow.value.copy(mood.sky.glow);
      u.uGlowStrength.value = mood.sky.glowStrength;
      u.uStars.value = mood.sky.stars;
      u.uSunDir.value.copy(sunDirection).normalize();
    },
    update(dt, camera) {
      u.uTime.value += dt;
      // La voûte suit la caméra : on ne peut ni en sortir ni l'approcher.
      mesh.position.copy(camera.position);
    },
  };
}
