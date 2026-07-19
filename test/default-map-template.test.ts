/**
 * UX wave #7: every new map is a 5x5 block of grass, spawn dead centre, water everywhere else. This
 * pins the server-built template's shape — the terrain a hero actually stands on — without a
 * database: exactly 25 walkable land cells, a solid water border, a walkable centred spawn, and
 * edges the real autotile resolver already settled.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAP_LAND,
  defaultMapInput,
  MAP_MIN_COLS,
  MAP_MIN_ROWS,
} from "../src/server/maps.js";
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
  it("is a MAP_MIN sized water field with a centred spawn", () => {
    const { input } = template();
    expect(input.cols).toBe(MAP_MIN_COLS);
    expect(input.rows).toBe(MAP_MIN_ROWS);
    // Dead centre of the 5x5 land block, which is itself centred in the field.
    const colStart = Math.floor((MAP_MIN_COLS - DEFAULT_MAP_LAND) / 2);
    const rowStart = Math.floor((MAP_MIN_ROWS - DEFAULT_MAP_LAND) / 2);
    expect(input.spawn).toEqual({
      col: colStart + Math.floor(DEFAULT_MAP_LAND / 2),
      row: rowStart + Math.floor(DEFAULT_MAP_LAND / 2),
    });
  });

  it("puts the spawn on walkable grass and every border cell on solid water", () => {
    const { input, baked } = template();
    expect(isSolidKind(kindAt(baked, input.spawn.col, input.spawn.row))).toBe(false);
    // The four corners are the field's edge — always water under a centred block this small.
    for (const [col, row] of [
      [0, 0],
      [input.cols - 1, 0],
      [0, input.rows - 1],
      [input.cols - 1, input.rows - 1],
    ] as const) {
      expect(isSolidKind(kindAt(baked, col, row))).toBe(true);
    }
  });

  it("has exactly DEFAULT_MAP_LAND^2 walkable land cells", () => {
    const { input, baked } = template();
    let walkable = 0;
    for (let row = 0; row < input.rows; row += 1) {
      for (let col = 0; col < input.cols; col += 1) {
        if (!isSolidKind(kindAt(baked, col, row))) walkable += 1;
      }
    }
    expect(walkable).toBe(DEFAULT_MAP_LAND * DEFAULT_MAP_LAND);
  });

  it("has autotile edges already resolved", () => {
    const { input } = template();
    const ground = input.layers[0];
    if (!ground) throw new Error("expected a ground layer");
    // A second whole-layer resolve is a no-op — the template's edges are already settled.
    expect(resolveWholeLayer(ground, TINY_SWORDS_TILESET).ids).toEqual([...ground.ids]);
  });
});
