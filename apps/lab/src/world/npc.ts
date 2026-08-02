import { createAnimator, makeBillboard } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";
import { CAMERA, GROTA } from "../settings.js";
import type { Colliders } from "./colliders.js";
import type { TerrainQuery } from "./terrain-query.js";

export interface Grota {
  object: THREE.Mesh;
  position: THREE.Vector3;
  /** À portée de parole ? Comparé au carré : pas de racine par frame. */
  inReach(p: THREE.Vector3): boolean;
  update(dt: number, heroPosition: THREE.Vector3): void;
}

/**
 * Grota, le panda. Un PNJ, donc : il ne bouge pas, il ne se bat pas, il attend
 * qu'on vienne lui parler. Tout ce qu'il a de vivant, c'est son ballant de
 * repos et le fait qu'il se tourne vers celui qui l'approche.
 */
export function createGrota(
  ctx: Hd2dContext,
  textures: TextureRegistry,
  query: TerrainQuery,
  colliders: Colliders,
): Grota {
  const [x, z] = GROTA.at;
  const y = query.heightAt(x, z);
  if (y === null) throw new Error(`Grota est dans l'eau (${x}, ${z})`);

  const billboard = makeBillboard(ctx, {
    texture: textures.get("/tex/panda.png"),
    cols: GROTA.frame.cols,
    rows: GROTA.frame.rows,
    height: GROTA.size,
    aspect: 1,
    foot: GROTA.foot,
    pitch: CAMERA.pitch,
  });
  billboard.placeAt(x, y, z);
  colliders.add(x, z, GROTA.radius);

  const anim = createAnimator(
    billboard,
    { row: 0, frames: GROTA.frame.frames, fps: GROTA.frame.fps },
    GROTA.frame.cols,
  );
  const position = new THREE.Vector3(x, y, z);
  const portee2 = GROTA.reach * GROTA.reach;

  return {
    object: billboard.mesh,
    position,
    inReach(p) {
      const dx = p.x - x;
      const dz = p.z - z;
      return dx * dx + dz * dz <= portee2;
    },
    update(dt, heroPosition) {
      anim.update(dt);
      // Il suit des yeux celui qui passe. Le sprite n'a qu'un profil, comme le
      // chevalier : le miroir fait le reste.
      billboard.setFlip(heroPosition.x < x);
    },
  };
}
