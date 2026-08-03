import * as THREE from "three";
import type { Colliders } from "./colliders.js";
import type { TerrainQuery } from "./terrain-query.js";

/**
 * Ce qu'un PNJ statique EST, indépendamment de son billboard : une position posée sur le
 * terrain (jamais dans l'eau) et un test de portée de parole. Grota (`npc.ts`) et l'habitant
 * de la banquise (`snow-npc.ts`) partagent ce contrat au mot près — c'est la forme extraite ici,
 * pas leur billboard (animé pour l'un, pose unique pour l'autre) ni leur texte.
 */
export interface NpcHandle {
  object: THREE.Mesh;
  position: THREE.Vector3;
  /** À portée de parole ? Comparé au carré : pas de racine par frame. */
  inReach(p: THREE.Vector3): boolean;
  update(dt: number, heroPosition: THREE.Vector3): void;
}

/** Ce que `planStaticNpc` a calé, à passer tel quel au billboard de la fabrique appelante. */
export interface NpcSpot {
  x: number;
  y: number;
  z: number;
  position: THREE.Vector3;
  inReach(p: THREE.Vector3): boolean;
}

/**
 * Calage commun à tout PNJ statique du labo : refuse une position dans l'eau, enregistre son
 * collider, prépare le test de portée au carré. Ne pose ni billboard ni animation — chaque
 * fabrique (`createGrota`, `createSnowNpc`) garde son propre texte, son propre atlas et son
 * propre animateur (ou son absence) ; c'est tout ce qui restait réellement partagé entre les
 * deux après un relevé de revue de code (interface, garde de hauteur, enregistrement du
 * collider, test `inReach`), donc c'est tout ce que cette fonction fait.
 */
export function planStaticNpc(
  query: TerrainQuery,
  colliders: Colliders,
  label: string,
  at: readonly [number, number],
  radius: number,
  reach: number,
): NpcSpot {
  const [x, z] = at;
  const y = query.heightAt(x, z);
  if (y === null) throw new Error(`${label} est dans l'eau (${x}, ${z})`);
  colliders.add(x, z, radius);
  const portee2 = reach * reach;
  return {
    x,
    y,
    z,
    position: new THREE.Vector3(x, y, z),
    inReach(p) {
      const dx = p.x - x;
      const dz = p.z - z;
      return dx * dx + dz * dz <= portee2;
    },
  };
}
