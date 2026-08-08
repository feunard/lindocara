/**
 * The running game's actors — players, monsters and guards — as HD-2D billboards.
 *
 * ONE responsibility, deliberately narrow: keep one billboard alive per actor the frame loop still
 * shows, place it on the ground under its position, turn it the way the snapshot faces it, and give
 * it back the moment it leaves. It is not a sprite framework: it holds no animation clip and no
 * effect, because this piece draws actors and nothing else. What sheet an actor draws with is the
 * ADAPTER's knowledge and lives in `game-renderer.ts`; `@lindocara/hd2d` below stays domain-free
 * and never learns what a monster is.
 *
 * The billboard's shape — `height`, `aspect`, `foot`, `pitch` — is `apps/lab/src/world/hero.ts`'s,
 * and the reasons are in `docs/hd2d-rendering.md`: a sprite is a strictly VERTICAL plane pivoted on
 * its feet and stretched to cancel the camera's plunge (tilting it towards the camera lays it
 * backwards and sinks its head into whatever is behind it).
 */

import type { TerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import type { Billboard, Facing } from "@lindocara/hd2d/billboard.js";
import { makeBillboard } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";
import { HD2D_CAMERA } from "./scene.js";

export type ActorKind = "player" | "monster" | "guard";

/** One actor of one frame, as the renderer hands it over. Every coordinate is the snapshot's own —
 *  TILE units, grid centre as origin — so `sync` converts nothing. */
export interface ActorView {
  id: string;
  kind: ActorKind;
  /** GROUND axis, in tile units with the grid centre as origin — the snapshot's own coordinate,
   *  with no conversion left between the wire and the scene. */
  x: number;
  /** ELEVATION, as the actor's own authority reported it. Read only when one of the three flags
   *  below says the actor is off the ground; a walking actor is placed on the TERRAIN under it
   *  (`heightAt`) instead, because a grounded elevation one snapshot stale would jitter the sprite
   *  through the floor it is standing on. */
  y: number;
  /** The other GROUND axis. */
  z: number;
  /**
   * The three locomotion flags, straight off the snapshot.
   *
   * They exist because the position stream alone cannot tell a jump from a swim from a glide, and
   * the difference is exactly what decides where the sprite belongs. Since S3 moved movement to the
   * client, a remote hero's elevation is a fact its own client computed and the room relayed — so
   * ground-snapping every actor would make every OTHER player's jump invisible, and would draw a
   * swimmer standing on the bed beneath them. Nothing about that fails; it just looks wrong forever.
   *
   * Only a player ever sets one. Monsters and guards are stepped by the room, which walks them on
   * the ground and nowhere else, so they cross with all three false.
   */
  airborne: boolean;
  swimming: boolean;
  gliding: boolean;
  /** Vertical velocity, used only for stretch/squash. */
  vy: number;
  /** Optional canopy texture. Only player views provide one. */
  canopyTextureKey?: string;
  /** Which way the actor is turned. The Tiny Swords units are drawn in profile only, so `north`
   *  and `south` deliberately leave the current profile alone (`facingToFlip`). */
  facing: Facing;
  /** A url in the `TextureRegistry` the registry was built with. */
  textureKey: string;
}

/**
 * What a registry needs of the scene it draws into. A structural type rather than `Hd2dScene`:
 * everything here is plain data or a pure query, which is what lets the suite exercise placement in
 * jsdom without a canvas or a GL context.
 */
export interface BillboardScene {
  /** Where billboards are parented. */
  root: THREE.Object3D;
  /** The ground under a point. The scene's own, so an actor and the terrain it stands on can never
   *  disagree. */
  query: TerrainQuery;
  /** Grid side in cells — the `size` half of the bridge above. */
  size: number;
  /** Where an actor stands when there is no ground under it at all (it is swimming, or the server
   *  has put it off the map). */
  waterLevel: number;
}

export interface BillboardRegistry {
  /** The frame's complete actor list. Anything absent from it is removed. */
  sync(actors: readonly ActorView[]): void;
  dispose(): void;
}

/**
 * Where an actor's feet sit inside its frame, as a fraction of the frame's height from the bottom.
 *
 * Two numbers because the Tiny Swords pack has two rosters with two conventions. Every UNIT (the
 * player classes, and a guard, which is a warrior) is drawn on the same baseline — 56px up a 192px
 * frame, the very `footOffset` the deleted PixiJS path used. The ENEMY pack measures its ground line per
 * species (`ENEMY_RENDER_METRICS`), and those measurements cluster at ~0.30 of the frame; the
 * registry deliberately does not know a species, so it takes the cluster. A troll (0.23) therefore
 * stands ~0.3 tiles deep and a pig rider (0.35) ~0.3 tiles high until an actor carries its own
 * measurement across the wire.
 */
export const ACTOR_FOOT: Record<ActorKind, number> = {
  player: 56 / 192,
  guard: 56 / 192,
  monster: 0.3,
};

/** Every actor sheet this game ships is a single ROW of square frames — 1536x192 for eight warrior
 *  idle poses, 1152x192 for six running ones, and so on up to a troll's 384px frames. Falling back
 *  to a unit's 192 keeps a texture whose bytes have not landed from sizing a sprite at zero. */
const DEFAULT_FRAME_PX = 192;

function sheetOf(texture: THREE.Texture): { cols: number; framePx: number } {
  const image = texture.image as { width?: number; height?: number } | null | undefined;
  const framePx =
    typeof image?.height === "number" && image.height > 0 ? image.height : DEFAULT_FRAME_PX;
  const width = typeof image?.width === "number" && image.width > 0 ? image.width : framePx;
  return { cols: Math.max(1, Math.round(width / framePx)), framePx };
}

/**
 * Where an actor's feet belong this frame.
 *
 * Three cases, and the order between the first two is load-bearing:
 *
 * - **Swimming wins first.** A swimmer's body is held at the surface by the rule itself
 *   (`hero-step.ts` pins `y` to the water level on entry), so the water line is the answer whatever
 *   elevation rides beside the flag — and the ground under a swimmer is the BED, which is where the
 *   sprite would sink to if the terrain were consulted. Reading the flag rather than the reported
 *   `y` also means a stale or hostile elevation cannot float a swimmer above their own sea.
 * - **Airborne or gliding: the reported elevation**, which is the whole point of relaying it. The
 *   two are checked independently even though the rule clears the canopy on landing: they are three
 *   separate booleans on the wire, and a glider drawn on the grass is never the right reading.
 * - **Otherwise the TERRAIN under the actor** — the scene's own query, so an actor and the ground it
 *   stands on can never disagree, and a monster or guard (no flags, ever) is unaffected. The
 *   `waterLevel` fallback is for a point with no ground at all: off the map, or over open water.
 */
function elevationOf(actor: ActorView, scene: BillboardScene): number {
  if (actor.swimming) return scene.waterLevel;
  if (actor.airborne || actor.gliding) return actor.y;
  return scene.query.heightAt(actor.x, actor.z) ?? scene.waterLevel;
}

interface Entry {
  billboard: Billboard;
  canopy: Billboard | null;
  /** Kept so a texture change — a class swap, a recoloured guard — rebuilds rather than silently
   *  keeping the old sheet forever. */
  textureKey: string;
  canopyTextureKey: string | undefined;
}

export const GLIDER_HEIGHT = 2.45;
export const GLIDER_ASPECT = 0.938;
export const GLIDER_LIFT = 1.05;

/**
 * `ctx` is passed explicitly, and must be the very context that built `scene`: `makeBillboard`
 * grafts THAT context's cloud-shadow uniforms onto each sprite's material and registers the mesh in
 * its yaw registry. A context of our own would give actors that neither darken under a cloud nor
 * turn with the camera — the same reasoning `terrainGroupFor` carries in `scene.ts`.
 */
export function createBillboardRegistry(
  ctx: Hd2dContext,
  scene: BillboardScene,
  textures: TextureRegistry,
): BillboardRegistry {
  const entries = new Map<string, Entry>();

  function create(actor: ActorView): Entry {
    const texture = textures.get(actor.textureKey);
    const { cols, framePx } = sheetOf(texture);
    const billboard = makeBillboard(ctx, {
      texture,
      cols,
      rows: 1,
      // The pack's own scale system, and the same one the deleted PixiJS path drew with: a frame is worth
      // its native pixels at 64 to the tile, so a 192px goblin and a 384px troll stay in proportion
      // with each other and with the heroes rather than each being scaled to taste.
      height: framePx / TILE_SIZE,
      aspect: 1,
      foot: ACTOR_FOOT[actor.kind],
      pitch: HD2D_CAMERA.pitch,
    });
    scene.root.add(billboard.mesh);
    return {
      billboard,
      canopy: null,
      textureKey: actor.textureKey,
      canopyTextureKey: actor.canopyTextureKey,
    };
  }

  function createCanopy(textureKey: string): Billboard {
    const canopy = makeBillboard(ctx, {
      texture: textures.get(textureKey),
      height: GLIDER_HEIGHT,
      aspect: GLIDER_ASPECT,
      foot: 0,
      pitch: HD2D_CAMERA.pitch,
    });
    scene.root.add(canopy.mesh);
    return canopy;
  }

  function drop(entry: Entry): void {
    scene.root.remove(entry.billboard.mesh);
    entry.billboard.dispose();
    if (entry.canopy) {
      scene.root.remove(entry.canopy.mesh);
      entry.canopy.dispose();
    }
  }

  return {
    sync(actors) {
      const present = new Set<string>();
      for (const actor of actors) {
        present.add(actor.id);
        let entry = entries.get(actor.id);
        if (
          entry &&
          (entry.textureKey !== actor.textureKey ||
            entry.canopyTextureKey !== actor.canopyTextureKey)
        ) {
          drop(entry);
          entry = undefined;
        }
        if (!entry) {
          entry = create(actor);
          entries.set(actor.id, entry);
        }
        const stretch = THREE.MathUtils.clamp(actor.vy * 0.018, -0.1, 0.13);
        entry.billboard.mesh.scale.set(1 - stretch * 0.6, 1 + stretch, 1);
        entry.billboard.placeAt(actor.x, elevationOf(actor, scene), actor.z);
        entry.billboard.setFacing(actor.facing);
        if (actor.gliding && actor.canopyTextureKey) {
          entry.canopy ??= createCanopy(actor.canopyTextureKey);
          entry.canopy.mesh.visible = true;
          entry.canopy.setFacing(actor.facing);
          entry.canopy.placeAt(actor.x, elevationOf(actor, scene) + GLIDER_LIFT, actor.z);
        } else if (entry.canopy) {
          entry.canopy.mesh.visible = false;
        }
      }
      for (const [id, entry] of entries) {
        if (present.has(id)) continue;
        drop(entry);
        entries.delete(id);
      }
    },
    dispose() {
      for (const entry of entries.values()) drop(entry);
      entries.clear();
    },
  };
}
