import { Container, Sprite, type Texture } from "pixi.js";
import type { MapElement } from "../../shared/map-data.js";
import { TILE_SIZE } from "../../shared/tilemap.js";
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

/** One placement/render contract shared by the editor and the authoritative game's renderer. */
export function createCatalogElementView(
  element: MapElement,
  art: EditorAssetArt,
): CatalogElementView | null {
  const first = art.frames[0];
  if (!first) return null;
  const x = element.col * TILE_SIZE + TILE_SIZE / 2;
  const y = (element.row + 1) * TILE_SIZE + art.definition.footOffset;
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

export function catalogElementFrameAt(
  elapsedMs: number,
  frames: readonly Texture[],
): Texture | undefined {
  if (frames.length === 0) return undefined;
  const index = Math.floor((Math.max(0, elapsedMs) / CATALOG_ELEMENT_CYCLE_MS) * frames.length);
  return frames[index % frames.length];
}
