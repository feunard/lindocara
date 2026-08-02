import * as THREE from "three";
import type { Hd2dContext } from "./context.js";

/** Sous cette distance, l'appoint cesse de croître : un sprite au contact ne divise pas par zéro. */
const DISTANCE_MIN = 0.6;
/** Un sprite collé au foyer ne doit pas partir au blanc. */
const APPOINT_MAX = 1.6;

/**
 * Ce que la vraie lumière RATE, et rien de plus.
 *
 * Un sprite est un plan qui regarde la caméra : une lumière placée DERRIÈRE lui ne peut
 * physiquement rien lui donner, son produit scalaire est négatif. Le héros à deux pas du feu, dos
 * à la flamme, s'éteignait donc complètement — correct, et complètement faux à l'oeil.
 *
 * Aucun réglage de lumière ne corrige ça, et les demi-lambert non plus : à contre-jour franc le
 * scalaire vaut -0.97, un « wrap » même total en tire 1 %. On calcule donc l'appoint à la main et
 * on le donne au matériau en émissif. Là où le sprite fait face à la flamme il vaut zéro, et c'est
 * la lumière ponctuelle qui joue : le total ne dépend plus de l'orientation, seulement de la
 * distance.
 */
export function fillAmount({
  dot,
  intensity,
  distance,
  gain = 0.42,
}: {
  dot: number;
  intensity: number;
  distance: number;
  gain?: number;
}): number {
  if (intensity <= 0) return 0;
  const d = Math.max(distance, DISTANCE_MIN);
  const manque = 1 - Math.max(0, dot);
  return Math.min(APPOINT_MAX, (intensity / (d * d)) * manque * gain);
}

/**
 * Applique l'appoint de la Task 6 à tous les billboards éclairés du contexte — port de
 * `fillFromPointLight` (`billboard.js` du PoC), qui itérait sur un tableau de
 * module au lieu de `ctx.litBillboards()`.
 *
 * Tourne à chaque frame sur tous les sprites éclairés : `nSprite`/`versSource` sont alloués une
 * seule fois par appel, hors de la boucle sur les sprites — un `Vector3` par sprite par frame est
 * exactement ce qu'il ne faut pas faire. Ce sont des locales de CETTE fonction plutôt que des
 * constantes de module comme dans le PoC : elles ne portent aucun état d'un appel à l'autre, et
 * garder l'état de scène hors du module (voir `context.ts`) reste la règle même quand cet état est
 * un simple scratch, pas seulement quand il est vraiment partagé.
 */
export function applyFillFromPointLight(
  ctx: Hd2dContext,
  position: THREE.Vector3,
  color: THREE.Color,
  intensity: number,
  gain = 0.42,
): void {
  const yaw = ctx.yaw();
  // Normale moyenne des quatre coins, tournée comme les sprites le sont.
  const nSprite = new THREE.Vector3(Math.sin(yaw) * 0.86, 0.42, Math.cos(yaw) * 0.86).normalize();
  const versSource = new THREE.Vector3();

  for (const { mesh, material, mid } of ctx.litBillboards()) {
    const emissive = material.emissive;
    if (intensity <= 0) {
      emissive.setScalar(0);
      continue;
    }
    versSource.set(
      position.x - mesh.position.x,
      position.y - (mesh.position.y + mid),
      position.z - mesh.position.z,
    );
    const distance = Math.max(versSource.length(), DISTANCE_MIN);
    versSource.divideScalar(distance);
    const dot = versSource.dot(nSprite);
    const k = fillAmount({ dot, intensity, distance, gain });
    emissive.copy(color).multiplyScalar(k);
  }
}
