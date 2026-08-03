import { createAnimator, makeBillboard } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import { CAMERA, GROTA } from "../settings.js";
import type { ColliderIndex } from "./collider-index.js";
import { type NpcHandle, planStaticNpc } from "./npc-base.js";
import type { TerrainQuery } from "./terrain-query.js";

export type Grota = NpcHandle;

/**
 * Grota, le panda. Un PNJ, donc : il ne bouge pas, il ne se bat pas, il attend
 * qu'on vienne lui parler. Tout ce qu'il a de vivant, c'est son ballant de
 * repos et le fait qu'il se tourne vers celui qui l'approche.
 */
export function createGrota(
  ctx: Hd2dContext,
  textures: TextureRegistry,
  query: TerrainQuery,
  colliders: ColliderIndex,
): Grota {
  const spot = planStaticNpc(query, colliders, "Grota", GROTA.at, GROTA.radius, GROTA.reach);

  const billboard = makeBillboard(ctx, {
    texture: textures.get("/tex/panda.png"),
    cols: GROTA.frame.cols,
    rows: GROTA.frame.rows,
    height: GROTA.size,
    aspect: 1,
    foot: GROTA.foot,
    pitch: CAMERA.pitch,
  });
  billboard.placeAt(spot.x, spot.y, spot.z);

  const anim = createAnimator(
    billboard,
    { row: 0, frames: GROTA.frame.frames, fps: GROTA.frame.fps },
    GROTA.frame.cols,
  );

  return {
    object: billboard.mesh,
    position: spot.position,
    inReach: spot.inReach,
    update(dt, heroPosition) {
      anim.update(dt);
      // Il suit des yeux celui qui passe. Le sprite n'a qu'un profil, comme le
      // chevalier : le miroir fait le reste.
      billboard.setFlip(heroPosition.x < spot.x);
    },
  };
}
