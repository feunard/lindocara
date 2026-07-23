import { bakeCollision, MAP_LAYERS, parseMapData } from "@lindocara/engine/map-data.js";
import { paintAutotile } from "@lindocara/engine/tile-brush.js";
import { emptyLayer, encodeTileLayer, type TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { kindAt } from "@lindocara/engine/tilemap.js";
import {
  GRASS_SLOTS,
  TINY_SWORDS_TILESET,
  TINY_SWORDS_TILESET_ID,
} from "@lindocara/engine/tilesets/tiny-swords.js";
import { describe, expect, it } from "vitest";

function grassField(cols: number, rows: number): [TileLayer, TileLayer, TileLayer] {
  let ground = emptyLayer(cols, rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      ground = paintAutotile(ground, TINY_SWORDS_TILESET, GRASS_SLOTS[0], col, row);
    }
  }
  return [ground, emptyLayer(cols, rows), emptyLayer(cols, rows)];
}

describe("collision baked from layers", () => {
  it("reads an empty ground cell as water", () => {
    const [ground, above, top] = grassField(4, 4);
    const ids = [...ground.ids];
    ids[0] = 0;
    const baked = bakeCollision({
      tilesetId: TINY_SWORDS_TILESET_ID,
      cols: 4,
      rows: 4,
      layers: [{ ...ground, ids }, above, top],
      elements: [],
      spawn: { col: 1, row: 1 },
    });
    expect(kindAt(baked, 0, 0)).toBe("water");
    expect(kindAt(baked, 1, 1)).toBe("grass");
  });

  it.each([
    1, 2,
  ] as const)("reads an impassable tile on authored layer %i as solid", (layerIndex) => {
    const layers = grassField(4, 4);
    layers[layerIndex] = paintAutotile(layers[layerIndex], TINY_SWORDS_TILESET, 3, 2, 2);
    const baked = bakeCollision({
      tilesetId: TINY_SWORDS_TILESET_ID,
      cols: 4,
      rows: 4,
      layers,
      elements: [],
      spawn: { col: 0, row: 0 },
    });
    expect(kindAt(baked, 2, 2)).toBe("forest");
  });

  it("parses a wire payload and rejects a layer count that is not three", () => {
    const layers = grassField(20, 15);
    const payload = {
      tilesetId: TINY_SWORDS_TILESET_ID,
      cols: 20,
      rows: 15,
      layers: layers.map(encodeTileLayer),
      elements: [],
      spawn: { col: 1, row: 1 },
    };
    expect(parseMapData(payload)).not.toBeNull();
    expect(parseMapData({ ...payload, layers: payload.layers.slice(0, 2) })).toBeNull();
    expect(parseMapData({ ...payload, tilesetId: "nope" })).toBeNull();
    expect(MAP_LAYERS).toBe(3);
  });
});
