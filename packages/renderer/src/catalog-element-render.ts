import { ELEMENT_OFFSET_PX, type MapElement } from "@lindocara/engine/map-data.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { Container, Sprite, type Texture } from "pixi.js";
import type { EditorAssetArt } from "./editor-asset-art.js";

export const CATALOG_ELEMENT_CYCLE_MS = 1_400;

export interface CatalogElementView {
  container: Container;
  sprite: Sprite;
  frames: readonly Texture[];
  layer: "ground" | "object" | "canopy";
  x: number;
  y: number;
}

/**
 * One placement/render contract shared by the editor and the authoritative game's renderer.
 *
 * This arithmetic is duplicated by `elementWorldCollider` in `map-data.ts` on purpose (shared
 * cannot import client) and the two must be changed together, or a collider stops sitting under
 * its sprite.
 */
export function createCatalogElementView(
  element: MapElement,
  art: EditorAssetArt,
): CatalogElementView | null {
  const first = art.frames[0];
  if (!first) return null;
  const x = element.col * TILE_SIZE + TILE_SIZE / 2 + element.offsetX * ELEMENT_OFFSET_PX;
  const y =
    (element.row + 1) * TILE_SIZE + art.definition.footOffset + element.offsetY * ELEMENT_OFFSET_PX;
  const container = new Container();
  container.position.set(x, y);
  const sprite = new Sprite(first);
  sprite.anchor.set(art.definition.anchor.x, art.definition.anchor.y);
  container.addChild(sprite);
  return {
    container,
    sprite,
    frames: art.frames,
    layer: art.definition.editor.renderLayer,
    x,
    y,
  };
}

/** An event's graphic is fit into this many tiles, anchored bottom-centre on its cell — a uniform
 *  one-cell marker rule, deliberately unlike `createCatalogElementView`'s per-asset footprint. */
export const EVENT_GRAPHIC_FIT_TILES = 1.6;

/**
 * The ONE event graphic crop/placement path, shared by the editor overlay (`paintEventCell`) and the
 * authoritative game's renderer so neither forks its own. An event is a fixed one-cell marker: its
 * frame is scaled to fit ~1.6 tiles and anchored bottom-centre on the cell, whatever the asset's own
 * footprint. Rendering only — appearance, never collision.
 */
export function createEventGraphicSprite(col: number, row: number, frame: Texture): Sprite {
  const sprite = new Sprite(frame);
  const fit = Math.min(
    (TILE_SIZE * EVENT_GRAPHIC_FIT_TILES) / frame.width,
    (TILE_SIZE * EVENT_GRAPHIC_FIT_TILES) / frame.height,
  );
  sprite.width = frame.width * fit;
  sprite.height = frame.height * fit;
  sprite.anchor.set(0.5, 1);
  sprite.position.set(col * TILE_SIZE + TILE_SIZE / 2, row * TILE_SIZE + TILE_SIZE);
  return sprite;
}

export function catalogElementFrameAt(
  elapsedMs: number,
  frames: readonly Texture[],
): Texture | undefined {
  if (frames.length === 0) return undefined;
  const index = Math.floor((Math.max(0, elapsedMs) / CATALOG_ELEMENT_CYCLE_MS) * frames.length);
  return frames[index % frames.length];
}
