import { createAnimator, makeBillboard } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import { CAMERA, CAMP_TEST } from "../settings.js";
import type { Colliders } from "./colliders.js";
import { type NpcHandle, planStaticNpc } from "./npc-base.js";
import type { TerrainQuery } from "./terrain-query.js";

export type CampTestNpc = NpcHandle;

/** PNJ bac à sable : même contrat que Grota, posé près du feu (`settings.ts`, `CAMP_TEST`). */
export function createCampTestNpc(
  ctx: Hd2dContext,
  textures: TextureRegistry,
  query: TerrainQuery,
  colliders: Colliders,
): CampTestNpc {
  const spot = planStaticNpc(
    query,
    colliders,
    "Voyageur",
    CAMP_TEST.at,
    CAMP_TEST.radius,
    CAMP_TEST.reach,
  );

  const billboard = makeBillboard(ctx, {
    texture: textures.get("/tex/warrior.png"),
    cols: CAMP_TEST.frame.cols,
    rows: CAMP_TEST.frame.rows,
    height: CAMP_TEST.size,
    aspect: 1,
    foot: CAMP_TEST.foot,
    pitch: CAMERA.pitch,
  });
  billboard.placeAt(spot.x, spot.y, spot.z);

  const anim = createAnimator(
    billboard,
    { row: 0, frames: CAMP_TEST.frame.frames, fps: CAMP_TEST.frame.fps },
    CAMP_TEST.frame.cols,
  );

  return {
    object: billboard.mesh,
    position: spot.position,
    inReach: spot.inReach,
    update(dt, heroPosition) {
      anim.update(dt);
      billboard.setFlip(heroPosition.x < spot.x);
    },
  };
}
