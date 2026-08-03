import { makeBillboard } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";
import { CAMERA, NANUQ } from "../settings.js";
import type { Colliders } from "./colliders.js";
import type { TerrainQuery } from "./terrain-query.js";

export interface SnowNpc {
  object: THREE.Mesh;
  position: THREE.Vector3;
  /** À portée de parole ? Comparé au carré : pas de racine par frame. */
  inReach(p: THREE.Vector3): boolean;
  update(dt: number, heroPosition: THREE.Vector3): void;
}

/**
 * Nanuq, l'habitant de la banquise (Task 12 de l'île de neige) : la MÊME machinerie que Grota
 * (`createGrota`, `npc.ts`) — un second contenu dans un système qui en attend un, pas un second
 * système. Un PNJ ne bouge pas, ne se bat pas, et attend qu'on vienne lui parler ; tout ce qu'il
 * a de vivant, c'est le fait qu'il se tourne vers celui qui l'approche.
 *
 * La seule vraie différence avec `createGrota` : son sprite est GÉNÉRÉ à une seule pose (voir
 * `settings.ts`, `NANUQ`), pas une frame parmi plusieurs sur une feuille de pack Tiny Swords —
 * donc pas de `createAnimator`/`Clip` ici, `update()` ne fait que le retourner vers le héros.
 */
export function createSnowNpc(
  ctx: Hd2dContext,
  textures: TextureRegistry,
  query: TerrainQuery,
  colliders: Colliders,
): SnowNpc {
  const [x, z] = NANUQ.at;
  const y = query.heightAt(x, z);
  if (y === null) throw new Error(`Nanuq est dans l'eau (${x}, ${z})`);

  const billboard = makeBillboard(ctx, {
    texture: textures.get("/tex/habitant.png"),
    height: NANUQ.size,
    aspect: NANUQ.aspect,
    foot: NANUQ.foot,
    pitch: CAMERA.pitch,
  });
  billboard.placeAt(x, y, z);
  colliders.add(x, z, NANUQ.radius);

  const position = new THREE.Vector3(x, y, z);
  const portee2 = NANUQ.reach * NANUQ.reach;

  return {
    object: billboard.mesh,
    position,
    inReach(p) {
      const dx = p.x - x;
      const dz = p.z - z;
      return dx * dx + dz * dz <= portee2;
    },
    update(_dt, heroPosition) {
      // Il suit des yeux celui qui passe. Le sprite n'a qu'un profil, comme Grota et le
      // chevalier : le miroir fait le reste.
      billboard.setFlip(heroPosition.x < x);
    },
  };
}
