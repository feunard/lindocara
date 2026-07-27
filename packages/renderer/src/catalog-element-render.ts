import { ELEMENT_OFFSET_PX, type MapElement } from "@lindocara/engine/map-data.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import type {
  EditorAssetDefinition,
  EditorRenderLayer,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { Container, Sprite, type Texture } from "pixi.js";
import type { EditorAssetArt } from "./editor-asset-art.js";

export const CATALOG_ELEMENT_CYCLE_MS = 1_400;

export interface CatalogElementView {
  container: Container;
  sprite: Sprite;
  frames: readonly Texture[];
  durationMs: number;
  layer: EditorRenderLayer;
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
    durationMs: art.definition.frame?.durationMs ?? CATALOG_ELEMENT_CYCLE_MS,
    layer: art.definition.editor.renderLayer,
    x,
    y,
  };
}

/** A non-character event graphic is fit into this many tiles, anchored bottom-centre on its cell —
 *  a uniform one-cell marker rule, deliberately unlike `createCatalogElementView`'s footprint. */
export const EVENT_GRAPHIC_FIT_TILES = 1.6;

/**
 * Roles whose art is a UNIT sheet, drawn at the pack's own scale rather than squeezed into a marker.
 *
 * A Tiny Swords character frame is 192px of mostly transparent padding around a ~79x89 body, so the
 * marker fit (192 -> 102) drew an authored NPC at 53% — a monk beside a hero read as a barrel, which
 * is how Brumeval's Frère Anselme became invisible. It is the same mistake the player sprite had at
 * 96, the guard at 102 and the whole bestiary in `enemy-art.ts`: shrinking one class of sprite breaks
 * a pack that is already in proportion with itself. A chest or a signpost is still a marker.
 */
const UNIT_SHEET_ROLES: ReadonlySet<string> = new Set(["character-animation", "enemy-animation"]);

export function isUnitSheetRole(role: string | undefined): boolean {
  return role !== undefined && UNIT_SHEET_ROLES.has(role);
}

/**
 * The ONE event graphic crop/placement path, shared by the editor overlay (`paintEventCell`) and the
 * authoritative game's renderer so neither forks its own. Rendering only — appearance, never
 * collision.
 *
 * Two rules, chosen by the asset's role:
 * - a unit sheet (an NPC) draws at NATIVE size and stands on the cell using the catalogue's own
 *   `anchor`/`footOffset` — the identical placement `createCatalogElementView` uses, so an authored
 *   villager is exactly as big as the hero talking to him;
 * - anything else stays a uniform one-cell marker fit into `EVENT_GRAPHIC_FIT_TILES`.
 *
 * `definition` is optional because one caller (the editor's hero-spawn marker) draws a bare texture
 * with no catalogue entry behind it; absent, the marker rule applies.
 */
export function createEventGraphicSprite(
  col: number,
  row: number,
  frame: Texture,
  definition?: Pick<EditorAssetDefinition, "role" | "anchor" | "footOffset">,
): Sprite {
  const sprite = new Sprite(frame);
  if (definition && isUnitSheetRole(definition.role)) {
    sprite.anchor.set(definition.anchor.x, definition.anchor.y);
    // `footOffset` is `frameHeight - alphaBboxBottom`, so placing the anchor that far BELOW the
    // cell's bottom edge lands the visible feet exactly on it. Same cancellation as an element.
    sprite.position.set(
      col * TILE_SIZE + TILE_SIZE / 2,
      (row + 1) * TILE_SIZE + definition.footOffset,
    );
    return sprite;
  }
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
  durationMs = CATALOG_ELEMENT_CYCLE_MS,
): Texture | undefined {
  if (frames.length === 0) return undefined;
  const cycle = Math.max(1, durationMs);
  const index = Math.floor((Math.max(0, elapsedMs) / cycle) * frames.length);
  return frames[index % frames.length];
}

/**
 * Advance one animated sprite, skipping a sprite that has already been destroyed.
 *
 * The guard is load-bearing, not defensive noise. Animated props and event graphics are advanced at
 * the TOP of `Renderer.render`, before the reconcile passes that would rebuild them; when the decor
 * layer is torn down (a map load, an element refresh) it destroys its children, so between that
 * teardown and the next reconcile the animation lists still point at destroyed sprites. Assigning
 * `texture` on a destroyed PixiJS Sprite reads its nulled `scale` and throws — inside the shared
 * Ticker, which kills the ticker and freezes the whole game on ONE bad frame.
 *
 * Returns whether the sprite is still alive, so a caller can drop the stale entry it just found.
 */
export function advanceCatalogAnimation(
  sprite: Sprite,
  elapsedMs: number,
  frames: readonly Texture[],
  durationMs = CATALOG_ELEMENT_CYCLE_MS,
): boolean {
  if (sprite.destroyed) return false;
  const frame = catalogElementFrameAt(elapsedMs, frames, durationMs);
  if (frame) sprite.texture = frame;
  return true;
}
