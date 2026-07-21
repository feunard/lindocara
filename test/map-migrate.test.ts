import { bakeCollision } from "@lindocara/engine/map-data.js";
import { layersFromBlocks } from "@lindocara/engine/map-migrate.js";
import { kindAt } from "@lindocara/engine/tilemap.js";
import { decodeTileMap } from "@lindocara/engine/tilemap-codec.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import { describe, expect, it } from "vitest";

const BLOCKS = [
  "####################",
  "#..................#",
  "#....####..........#",
  "#....####..........#",
  "#..................#",
  "#........###.......#",
  "#........###.......#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "####################",
];

describe("migrating blocks to layers", () => {
  it("keeps the map's size", () => {
    const migrated = layersFromBlocks(BLOCKS);
    expect(migrated.cols).toBe(20);
    expect(migrated.rows).toBe(15);
    expect(migrated.layers).toHaveLength(3);
  });

  it("leaves layers one and two empty", () => {
    const migrated = layersFromBlocks(BLOCKS);
    expect(migrated.layers[1]?.ids.every((id) => id === 0)).toBe(true);
    expect(migrated.layers[2]?.ids.every((id) => id === 0)).toBe(true);
  });

  // The test that says the migration is safe.
  it("bakes cell-for-cell identical collision to the blocks it replaced", () => {
    const migrated = layersFromBlocks(BLOCKS);
    const after = bakeCollision({
      tilesetId: TINY_SWORDS_TILESET_ID,
      cols: migrated.cols,
      rows: migrated.rows,
      layers: migrated.layers,
      elements: [],
      spawn: { col: 1, row: 1 },
    });
    const before = decodeTileMap(BLOCKS);
    expect(after.cols).toBe(before.cols);
    expect(after.rows).toBe(before.rows);
    for (let row = 0; row < before.rows; row += 1) {
      for (let col = 0; col < before.cols; col += 1) {
        expect({ col, row, kind: kindAt(after, col, row) }).toEqual({
          col,
          row,
          kind: kindAt(before, col, row),
        });
      }
    }
  });
});
