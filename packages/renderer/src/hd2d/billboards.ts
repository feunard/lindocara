/**
 * The running game's actors — players, monsters and guards — as HD-2D billboards.
 *
 * ONE responsibility, deliberately narrow: keep one billboard alive per actor the frame loop still
 * shows, place it on the ground under its position, and give it back the moment it leaves. It is
 * not a sprite framework: it holds no clip, no facing and no effect, because this piece draws
 * actors and nothing else. What sheet an actor draws with is the ADAPTER's knowledge and lives in
 * `game-renderer.ts`; `@lindocara/hd2d` below stays domain-free and never learns what a monster is.
 *
 * The billboard's shape — `height`, `aspect`, `foot`, `pitch` — is `apps/lab/src/world/hero.ts`'s,
 * and the reasons are in `docs/hd2d-rendering.md`: a sprite is a strictly VERTICAL plane pivoted on
 * its feet and stretched to cancel the camera's plunge (tilting it towards the camera lays it
 * backwards and sinks its head into whatever is behind it).
 */

import type { TerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import type { Billboard } from "@lindocara/hd2d/billboard.js";
import { makeBillboard } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import type * as THREE from "three";
import { HD2D_CAMERA } from "./scene.js";

//
// ============================ TILE→PIXEL BRIDGE ============================
// TEMPORARY, AND DELIBERATELY SO. The map is stored and shipped as a heightfield in TILE units,
// grid-centred; the server's simulation still runs in PIXELS with a top-left origin, so every
// snapshot on the wire carries pixels. This is the CLIENT half of the bridge whose server half is
// `packages/server/src/world/heightfield-pixel-bridge.ts`.
//
// It exists for exactly as long as that migration takes. When the server's geometry moves to tile
// units, DELETE both halves and every call site — `grep -rn "TILE→PIXEL BRIDGE"` finds them all.
// Do not grow it, and do not let a caller convert coordinates by hand instead of going through it.
// ===========================================================================

/** Top-left pixel units -> grid-centred tile units: the exact inverse of the server's
 *  `tileToPixel`. The origin shift is the half that gets forgotten, and forgetting it puts every
 *  actor half a map from the ground under its feet — `hd2d-billboards.test.ts` pins the round trip
 *  against the server's own function for that reason. */
export function pixelToTile(value: number, size: number): number {
  return value / TILE_SIZE - size / 2;
}

export type ActorKind = "player" | "monster" | "guard";

/** One actor of one frame, as the renderer hands it over. `x`/`y` are the snapshot's own GAME
 *  PIXELS, top-left origin, converted inside `sync` — so exactly one place in this package knows
 *  that two unit systems exist. `y` is the game's southward axis and becomes the scene's `z`. */
export interface ActorView {
  id: string;
  kind: ActorKind;
  x: number;
  y: number;
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
 * frame, the very `footOffset` the PixiJS path uses. The ENEMY pack measures its ground line per
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

interface Entry {
  billboard: Billboard;
  /** Kept so a texture change — a class swap, a recoloured guard — rebuilds rather than silently
   *  keeping the old sheet forever. */
  textureKey: string;
}

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
      // The pack's own scale system, and the same one the PixiJS path draws with: a frame is worth
      // its native pixels at 64 to the tile, so a 192px goblin and a 384px troll stay in proportion
      // with each other and with the heroes rather than each being scaled to taste.
      height: framePx / TILE_SIZE,
      aspect: 1,
      foot: ACTOR_FOOT[actor.kind],
      pitch: HD2D_CAMERA.pitch,
    });
    scene.root.add(billboard.mesh);
    return { billboard, textureKey: actor.textureKey };
  }

  function drop(entry: Entry): void {
    scene.root.remove(entry.billboard.mesh);
    entry.billboard.dispose();
  }

  return {
    sync(actors) {
      const present = new Set<string>();
      for (const actor of actors) {
        present.add(actor.id);
        let entry = entries.get(actor.id);
        if (entry && entry.textureKey !== actor.textureKey) {
          drop(entry);
          entry = undefined;
        }
        if (!entry) {
          entry = create(actor);
          entries.set(actor.id, entry);
        }
        const x = pixelToTile(actor.x, scene.size);
        const z = pixelToTile(actor.y, scene.size);
        entry.billboard.placeAt(x, scene.query.heightAt(x, z) ?? scene.waterLevel, z);
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
