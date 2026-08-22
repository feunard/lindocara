import type { ColliderIndex } from "@lindocara/engine/hd2d/collider-index.js";
import type { TerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import { makeBillboard } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";

import { CAMERA, NANUQ } from "../settings.js";
import { type NpcHandle, planStaticNpc } from "./npc-base.js";

export type SnowNpc = NpcHandle;

/**
 * Nanuq, l'habitant de la banquise (Task 12 de l'île de neige) : la même forme de PNJ que Grota
 * (`createGrota`, `npc.ts`) — le calage terrain/collider/portée vit maintenant dans
 * `npc-base.ts`'s `planStaticNpc`, appelé ici comme là-bas. Un PNJ ne bouge pas, ne se bat pas,
 * et attend qu'on vienne lui parler ; tout ce qu'il a de vivant, c'est le fait qu'il se tourne
 * vers celui qui l'approche.
 *
 * La seule vraie différence avec `createGrota` : son sprite est GÉNÉRÉ à une seule pose (voir
 * `settings.ts`, `NANUQ`), pas une frame parmi plusieurs sur une feuille de pack Tiny Swords —
 * donc pas de `createAnimator`/`Clip` ici, `update()` ne fait que le retourner vers le héros.
 */
export function createSnowNpc(
  ctx: Hd2dContext,
  textures: TextureRegistry,
  query: TerrainQuery,
  colliders: ColliderIndex,
): SnowNpc {
  const spot = planStaticNpc(query, colliders, "Nanuq", NANUQ.at, NANUQ.radius, NANUQ.reach);

  const billboard = makeBillboard(ctx, {
    texture: textures.get("/tex/habitant.png"),
    height: NANUQ.size,
    aspect: NANUQ.aspect,
    foot: NANUQ.foot,
    pitch: CAMERA.pitch,
  });
  billboard.placeAt(spot.x, spot.y, spot.z);

  return {
    object: billboard.mesh,
    position: spot.position,
    inReach: spot.inReach,
    update(_dt, heroPosition) {
      // Il suit des yeux celui qui passe. Le sprite n'a qu'un profil, comme Grota et le
      // chevalier : le miroir fait le reste.
      billboard.setFlip(heroPosition.x < spot.x);
    },
  };
}
