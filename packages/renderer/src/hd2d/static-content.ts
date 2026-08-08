/**
 * The map's own scenery — `MapData.elements` and the active page of `MapData.events` — as static
 * HD-2D billboards.
 *
 * Its own file rather than a second export in `billboards.ts`, because the two answer different
 * questions. `billboards.ts` keeps a registry ALIVE across frames: it diffs the actor list every
 * tick, creates, moves, turns and drops. Scenery has no frame: it is placed once when the map lands
 * and given back when the map goes. Folding it into the actor registry would have meant either
 * inventing a fourth `ActorKind` and re-syncing hundreds of immobile trees sixty times a second, or
 * teaching that registry a second lifecycle — which is exactly the "general sprite framework" its
 * own header refuses to become. What the two DO share is reused rather than copied: the
 * `BillboardScene` shape, `makeBillboard`, and the camera pitch a sprite's stretch is computed from.
 *
 * TWO rules bind this file, and neither is negotiable:
 *
 * - **Appearance only.** Nothing here derives a collider. Collision on this path is baked by the
 *   server from the terrain alone (`zoneTerrainFromHeightfield`, `engine/terrain-access.ts`), and
 *   the client bakes its prediction terrain from the same string; an authored element carries
 *   none — a tree you can walk through is the correct behaviour of this increment, an invisible
 *   wall around one is not.
 * - **An unknown asset id is skipped, never thrown.** A map authored against a catalogue this build
 *   does not have must lose one bush, not the whole world.
 *
 * `@lindocara/hd2d` stays domain-free: which sheet an asset id names, how many frames it holds and
 * where its feet sit are the ADAPTER's knowledge and live in `game-renderer.ts`, exactly as the
 * actor sheets and the terrain atlases do. This file only ever sees the resolved `StaticSpriteArt`.
 */

import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { Billboard, TextureUvRect } from "@lindocara/hd2d/billboard.js";
import { makeBillboard } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import type * as THREE from "three";
import type { BillboardScene } from "./billboards.js";
import { HD2D_CAMERA } from "./scene.js";

/**
 * One catalogue appearance, reduced to what a billboard is built from.
 *
 * Deliberately richer than the plan's bare `THREE.Texture`. A decoration is not an actor sheet: a
 * building is 128x192 and a rock 64x64, a bush is eight frames wide, and each asset carries its own
 * measured ground line. Guessing that from the image's own bytes — the `sheetOf` rule
 * `billboards.ts` applies to the actor roster, where every frame is square and every unit shares one
 * baseline — would draw a house as a 3x3 square and stand a tree in the ground. The catalogue
 * already holds all four numbers; the adapter reads them there and hands them over.
 */
export interface StaticSpriteArt {
  texture: THREE.Texture;
  /** Frames across the sheet. The FIRST frame is what a static placement draws (a sheet is not an
   *  animation — see `docs/hd2d-rendering.md`: a tree's sheet also holds its felling and its
   *  stump). */
  cols?: number;
  /** Frames down the sheet. */
  rows?: number;
  /** World height of ONE frame, in tiles. The pack's own scale, as for actors: a frame is worth its
   *  native pixels at 64 to the tile, so a tree and a hero stay in proportion. */
  height: number;
  /** Frame width / frame height. */
  aspect?: number;
  /** Where the art's feet sit in its frame, as a fraction of frame height from the bottom. */
  foot?: number;
  uvRect?: TextureUvRect;
}

/** Resolves a catalogue asset id to the art it draws with, or `null` when this build has no such
 *  asset — the caller skips it with a warning. */
export type StaticArtResolver = (assetId: string) => StaticSpriteArt | null;

export interface StaticContent {
  dispose(): void;
}

/**
 * Places every element and every graphic-bearing event of `map` into `scene`, once.
 *
 * `ctx` must be the very context that built `scene`, for the reason `createBillboardRegistry`
 * carries: `makeBillboard` grafts THAT context's cloud-shadow uniforms onto each sprite and
 * registers the mesh in its yaw registry.
 *
 * Coordinates ride across untouched. `HeightfieldElement`/`HeightfieldEvent` are already in TILE
 * units, grid-centred — the scene's own space — so there is no TILE→PIXEL bridge call in this file,
 * unlike `billboards.ts`'s `sync`, whose actors arrive in the snapshot's pixels.
 */
export function placeStaticContent(
  ctx: Hd2dContext,
  scene: BillboardScene,
  map: MapData,
  resolve: StaticArtResolver,
): StaticContent {
  const placed: Billboard[] = [];
  /** Unresolved ids, counted rather than reported one by one. A map dressed entirely out of assets
   *  this build cannot draw — the sub-rect crops are a real such family — would otherwise emit one
   *  line per PLACEMENT, hundreds of them, and bury whatever else the console had to say. The same
   *  care the graphicless-event skip below takes, applied to the case that actually is a warning. */
  const skipped = new Map<string, number>();

  function place(assetId: string, x: number, z: number): void {
    const sprite = resolve(assetId);
    if (!sprite) {
      skipped.set(assetId, (skipped.get(assetId) ?? 0) + 1);
      return;
    }
    const billboard = makeBillboard(ctx, {
      texture: sprite.texture,
      cols: sprite.cols ?? 1,
      rows: sprite.rows ?? 1,
      height: sprite.height,
      aspect: sprite.aspect ?? 1,
      foot: sprite.foot ?? 0,
      ...(sprite.uvRect ? { uvRect: sprite.uvRect } : {}),
      pitch: HD2D_CAMERA.pitch,
    });
    // The ground under the piece, or the sea when there is none: an offshore rock is authored on
    // water on purpose, and dropping it would be worse than floating it at sea level.
    billboard.placeAt(x, scene.query.heightAt(x, z) ?? scene.waterLevel, z);
    scene.root.add(billboard.mesh);
    placed.push(billboard);
  }

  for (const element of map.elements) place(element.assetId, element.x, element.z);
  for (const event of map.events) {
    // No graphic is an authored choice, not a missing asset: a bare trigger cell draws nothing and
    // says nothing. Warning here would fill the console on any map that uses invisible triggers.
    if (event.graphicAssetId === null) continue;
    place(event.graphicAssetId, event.x, event.z);
  }
  for (const [assetId, count] of skipped) {
    console.warn(`[hd2d] no art for asset id "${assetId}": skipped ${count} placement(s)`);
  }

  return {
    dispose() {
      for (const billboard of placed) {
        scene.root.remove(billboard.mesh);
        billboard.dispose();
      }
      placed.length = 0;
    },
  };
}
