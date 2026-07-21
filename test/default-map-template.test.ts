/**
 * Every new map is genuinely blank: a `MAP_MIN` field of flat grass, walkable everywhere, spawn dead
 * centre, no elements and — deliberately — no events. This pins the server-built template's shape (the
 * terrain a hero actually stands on) without a database: every cell walkable, a centred walkable
 * spawn, zero authored events, and edges the real autotile resolver already settled.
 */
import { describe, expect, it } from "vitest";
import { defaultMapInput, MAP_MIN_COLS, MAP_MIN_ROWS } from "../src/server/maps.js";
import { bakeCollision } from "../src/shared/map-data.js";
import { resolveWholeLayer } from "../src/shared/tile-brush.js";
import { isSolidKind, kindAt } from "../src/shared/tilemap.js";
import { TINY_SWORDS_TILESET } from "../src/shared/tilesets/tiny-swords.js";

function template() {
  const input = defaultMapInput("Fresh");
  return {
    input,
    baked: bakeCollision({
      tilesetId: input.tilesetId,
      cols: input.cols,
      rows: input.rows,
      layers: input.layers,
      elements: input.elements,
      spawn: input.spawn,
    }),
  };
}

describe("defaultMapInput", () => {
  it("is a MAP_MIN sized flat-grass field with a centred spawn", () => {
    const { input } = template();
    expect(input.cols).toBe(MAP_MIN_COLS);
    expect(input.rows).toBe(MAP_MIN_ROWS);
    expect(input.spawn).toEqual({
      col: Math.floor(MAP_MIN_COLS / 2),
      row: Math.floor(MAP_MIN_ROWS / 2),
    });
  });

  it("starts genuinely blank: no elements, no events", () => {
    const { input } = template();
    expect(input.elements).toEqual([]);
    expect(input.events).toEqual([]);
  });

  it("is walkable on every cell, spawn included", () => {
    const { input, baked } = template();
    for (let row = 0; row < input.rows; row += 1) {
      for (let col = 0; col < input.cols; col += 1) {
        expect(isSolidKind(kindAt(baked, col, row))).toBe(false);
      }
    }
  });

  it("has autotile edges already resolved", () => {
    const { input } = template();
    const ground = input.layers[0];
    if (!ground) throw new Error("expected a ground layer");
    // A second whole-layer resolve is a no-op — the template's edges are already settled.
    expect(resolveWholeLayer(ground, TINY_SWORDS_TILESET).ids).toEqual([...ground.ids]);
  });
});
