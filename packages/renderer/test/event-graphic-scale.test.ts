/**
 * The event-graphic placement rule, pinned.
 *
 * An authored event's graphic has two shapes: a UNIT sheet (an NPC) draws at the pack's native size
 * and stands on its cell, and anything else stays a uniform one-cell marker. Before this rule every
 * event graphic was squeezed into `EVENT_GRAPHIC_FIT_TILES`, so a 192px monk frame rendered at 102px
 * — a ~53% NPC standing beside a full-size hero. Brumeval's Frère Anselme read as a barrel, and the
 * adventure's first objective was to talk to him.
 */
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import type { EditorAssetDefinition } from "@lindocara/engine/tiny-swords-catalog.js";
import { Rectangle, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import {
  createEventGraphicSprite,
  EVENT_GRAPHIC_FIT_TILES,
  isUnitSheetRole,
} from "../src/catalog-element-render.js";

type Placement = Pick<EditorAssetDefinition, "role" | "anchor" | "footOffset">;

/** The real catalogue values for `character.units-blue-units-monk.idle`. */
const MONK: Placement = {
  role: "character-animation",
  anchor: { x: 0.5, y: 1 },
  footOffset: 58,
};

/** The real catalogue values for `decoration.deco.09` — the supply-cache barrel. */
const BARREL: Placement = { role: "world-decoration", anchor: { x: 0.5, y: 1 }, footOffset: 11 };

function unitFrame(): Texture {
  // A Tiny Swords character frame: 192 square, mostly transparent padding around the body.
  return new Texture({ source: Texture.WHITE.source, frame: new Rectangle(0, 0, 192, 192) });
}

describe("event graphic placement", () => {
  it("recognises unit sheets and nothing else", () => {
    expect(isUnitSheetRole("character-animation")).toBe(true);
    expect(isUnitSheetRole("enemy-animation")).toBe(true);
    expect(isUnitSheetRole("world-decoration")).toBe(false);
    expect(isUnitSheetRole("world-building")).toBe(false);
    expect(isUnitSheetRole(undefined)).toBe(false);
  });

  it("draws an NPC at native size, never shrunk into the marker box", () => {
    const sprite = createEventGraphicSprite(3, 4, unitFrame(), MONK);
    // Native: the sprite is left at the frame's own dimensions, exactly like a player at 192.
    expect(sprite.width).toBe(192);
    expect(sprite.height).toBe(192);
    // The old bug, stated so it cannot come back: the marker fit would have been 102px.
    expect(sprite.width).toBeGreaterThan(TILE_SIZE * EVENT_GRAPHIC_FIT_TILES);
  });

  it("stands an NPC's feet on the cell's bottom edge", () => {
    const sprite = createEventGraphicSprite(3, 4, unitFrame(), MONK);
    expect(sprite.anchor.x).toBe(0.5);
    expect(sprite.anchor.y).toBe(1);
    expect(sprite.position.x).toBe(3 * TILE_SIZE + TILE_SIZE / 2);
    // `footOffset` = frameHeight - alphaBboxBottom, so anchoring that far BELOW the cell's bottom
    // edge cancels the padding and lands the visible feet on it — the element placement's own trick.
    expect(sprite.position.y).toBe((4 + 1) * TILE_SIZE + MONK.footOffset);
  });

  it("keeps every non-unit graphic a uniform one-cell marker", () => {
    const frame = new Texture({ source: Texture.WHITE.source, frame: new Rectangle(0, 0, 64, 64) });
    const sprite = createEventGraphicSprite(3, 4, frame, BARREL);
    const expected = TILE_SIZE * EVENT_GRAPHIC_FIT_TILES;
    expect(sprite.width).toBeCloseTo(expected, 5);
    expect(sprite.height).toBeCloseTo(expected, 5);
    // A marker sits ON the cell, not on the catalogue's foot offset.
    expect(sprite.position.y).toBe(4 * TILE_SIZE + TILE_SIZE);
  });

  it("falls back to the marker rule when no catalogue definition is supplied", () => {
    // The editor's hero-spawn marker draws a bare texture with no catalogue entry behind it.
    const frame = new Texture({
      source: Texture.WHITE.source,
      frame: new Rectangle(0, 0, 192, 192),
    });
    const sprite = createEventGraphicSprite(0, 0, frame);
    expect(sprite.width).toBeCloseTo(TILE_SIZE * EVENT_GRAPHIC_FIT_TILES, 5);
  });
});
