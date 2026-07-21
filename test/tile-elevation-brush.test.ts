import { paintElevation } from "@lindocara/engine/tile-brush.js";
import { emptyLayer, type TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { decodeTileId, fixedId } from "@lindocara/engine/tileset.js";
import {
  CLIFF_WALL_SLOT,
  GRASS_SLOTS,
  TINY_SWORDS_TILESET,
} from "@lindocara/engine/tilesets/tiny-swords.js";
import { describe, expect, it } from "vitest";

const set = TINY_SWORDS_TILESET;
const blank = (): ReturnType<typeof emptyLayer>[] => [
  emptyLayer(6, 6),
  emptyLayer(6, 6),
  emptyLayer(6, 6),
];

// `paintElevation` always returns the same three layers it was given (Task 5's `noUncheckedIndexedAccess`
// makes indexing an array yield `T | undefined`); a missing layer here is a real bug, so this throws
// loudly rather than silently narrowing to a type that would hide one.
function layerAt(layers: readonly TileLayer[], index: number): TileLayer {
  const layer = layers[index];
  if (!layer) throw new Error(`missing layer ${index}`);
  return layer;
}

function slotOf(layer: { cols: number; ids: readonly number[] }, col: number, row: number): number {
  const ref = decodeTileId(layer.ids[row * layer.cols + col] ?? 0);
  return ref.kind === "autotile" ? ref.slot : -1;
}

describe("the elevation brush", () => {
  it("writes the raised top on the ground layer", () => {
    const layers = paintElevation(blank(), set, 1, 2, 2);
    expect(slotOf(layerAt(layers, 0), 2, 2)).toBe(GRASS_SLOTS[1]);
  });

  it("drops a wall into the cell below a raised tile", () => {
    const layers = paintElevation(blank(), set, 1, 2, 2);
    expect(slotOf(layerAt(layers, 1), 2, 3)).toBe(CLIFF_WALL_SLOT);
  });

  it("draws one wall row whatever the drop, so level 2 beside level 0 is still one wall", () => {
    const layers = paintElevation(blank(), set, 2, 2, 2);
    expect(slotOf(layerAt(layers, 1), 2, 3)).toBe(CLIFF_WALL_SLOT);
    expect(slotOf(layerAt(layers, 1), 2, 4)).toBe(-1);
  });

  it("removes a wall the ground beneath no longer justifies", () => {
    let layers = paintElevation(blank(), set, 1, 2, 2);
    expect(slotOf(layerAt(layers, 1), 2, 3)).toBe(CLIFF_WALL_SLOT);
    layers = paintElevation(layers, set, 1, 2, 3);
    expect(slotOf(layerAt(layers, 1), 2, 3)).toBe(-1);
  });

  it("joins adjacent walls into a horizontal run", () => {
    let layers = paintElevation(blank(), set, 1, 2, 2);
    layers = paintElevation(layers, set, 1, 3, 2);
    // Left end has an east neighbour (mask 2); right end has a west neighbour (mask 1).
    const left = decodeTileId(layerAt(layers, 1).ids[3 * 6 + 2] ?? 0);
    const right = decodeTileId(layerAt(layers, 1).ids[3 * 6 + 3] ?? 0);
    expect(left).toEqual({ kind: "autotile", slot: CLIFF_WALL_SLOT, variant: 2 });
    expect(right).toEqual({ kind: "autotile", slot: CLIFF_WALL_SLOT, variant: 1 });
  });

  it("paints level 0 as flat grass with no wall at all", () => {
    const layers = paintElevation(blank(), set, 0, 2, 2);
    expect(slotOf(layerAt(layers, 0), 2, 2)).toBe(GRASS_SLOTS[0]);
    expect(slotOf(layerAt(layers, 1), 2, 3)).toBe(-1);
  });

  it("never overwrites a fixed tile (a ramp) with wall upkeep", () => {
    const start = blank();
    const ground = layerAt(start, 0);
    const walls = layerAt(start, 1);
    const overlay = layerAt(start, 2);
    const ids = [...walls.ids];
    ids[3 * walls.cols + 2] = fixedId(0);
    const layers = [ground, { ...walls, ids }, overlay];

    const result = paintElevation(layers, set, 1, 2, 2);

    expect(layerAt(result, 1).ids[3 * walls.cols + 2]).toBe(fixedId(0));
  });
});
