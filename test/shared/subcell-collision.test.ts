import { describe, expect, it } from "vitest";
import { isWalkable, resolveTerrain } from "../../src/shared/game.js";
import { elementWorldCollider, type MapData, terrainFromMap } from "../../src/shared/map-data.js";
import { encodeTileLayer, parseTileLayer } from "../../src/shared/tile-layer-codec.js";
import { TILE_SIZE } from "../../src/shared/tilemap.js";
import { autotileId, EMPTY_TILE } from "../../src/shared/tileset.js";
import { GRASS_SLOTS, TINY_SWORDS_TILESET_ID } from "../../src/shared/tilesets/tiny-swords.js";

const COLS = 6;
const ROWS = 6;
const TREE = "resource.terrain-resources-wood-trees.tree3";

/** All grass, so nothing but an element can block. */
function grassMap(elements: MapData["elements"]): MapData {
  // Not `slot * 16`: `autotileId` is `1 + slot * VARIANTS_PER_AUTOTILE + variant`, and id 0 is the
  // EMPTY tile — which the ground pass calls water, making the whole fixture solid.
  const grassId = autotileId(GRASS_SLOTS[0] ?? 0, 15);
  const ground = parseTileLayer(
    encodeTileLayer({
      cols: COLS,
      rows: ROWS,
      ids: new Array<number>(COLS * ROWS).fill(grassId),
    }),
    COLS,
    ROWS,
  );
  const empty = parseTileLayer(
    encodeTileLayer({
      cols: COLS,
      rows: ROWS,
      ids: new Array<number>(COLS * ROWS).fill(EMPTY_TILE),
    }),
    COLS,
    ROWS,
  );
  if (!ground || !empty) throw new Error("fixture layers");
  return {
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: COLS,
    rows: ROWS,
    layers: [ground, empty, empty],
    elements,
    spawn: { col: 0, row: 0 },
  };
}

describe("sub-cell element collision", () => {
  it("blocks a body standing on the trunk", () => {
    const element = { col: 3, row: 3, offsetX: 0, offsetY: 0, assetId: TREE } as const;
    const terrain = terrainFromMap(grassMap([element]));
    const trunk = elementWorldCollider(element);
    expect(trunk).not.toBeNull();
    if (!trunk) return;
    expect(isWalkable({ x: trunk.x, y: trunk.y }, 8, terrain)).toBe(false);
  });

  it("lets a body walk through the same cell beside the trunk", () => {
    // The regression this whole tranche exists to fix: before, the cell was solid.
    const element = { col: 3, row: 3, offsetX: 0, offsetY: 0, assetId: TREE } as const;
    const terrain = terrainFromMap(grassMap([element]));
    expect(isWalkable({ x: 3 * TILE_SIZE, y: 3 * TILE_SIZE }, 8, terrain)).toBe(true);
  });

  it("moves the collider with the offset", () => {
    const aligned = elementWorldCollider({
      col: 2,
      row: 2,
      offsetX: 0,
      offsetY: 0,
      assetId: TREE,
    });
    const shifted = elementWorldCollider({
      col: 2,
      row: 2,
      offsetX: 3,
      offsetY: 1,
      assetId: TREE,
    });
    expect(aligned).not.toBeNull();
    expect(shifted).not.toBeNull();
    if (!aligned || !shifted) return;
    expect(shifted.x - aligned.x).toBe(48);
    expect(shifted.y - aligned.y).toBe(16);
  });

  it("stands the collider exactly on the cell's ground line", () => {
    // THE regression guard for the coordinate-space bug, and the only place it is mechanically
    // checkable: this is the one function that turns an authored rect into world pixels. The
    // catalogue authors in foot space, so a tree's collider must end exactly on `(row+1)*TILE_SIZE`.
    // Reintroducing the renderer's `footOffset` here — "to match createCatalogElementView" — pushes
    // it 22 px south, into the next cell, and this assertion is what catches that.
    const rect = elementWorldCollider({
      col: 2,
      row: 3,
      offsetX: 0,
      offsetY: 0,
      assetId: TREE,
    });
    expect(rect).not.toBeNull();
    if (!rect) return;
    expect(rect.y + rect.height).toBe(4 * TILE_SIZE);
    // And horizontally centred on the cell, not on its left edge.
    expect(rect.x + rect.width / 2).toBe(2 * TILE_SIZE + TILE_SIZE / 2);
  });

  it("gives a non-colliding asset no collider", () => {
    expect(
      elementWorldCollider({
        col: 1,
        row: 1,
        offsetX: 0,
        offsetY: 0,
        assetId: "decoration.terrain-decorations-bushes.bushe1",
      }),
    ).toBeNull();
  });

  it("slides along a trunk instead of stopping dead", () => {
    const element = { col: 3, row: 3, offsetX: 0, offsetY: 0, assetId: TREE } as const;
    const terrain = terrainFromMap(grassMap([element]));
    const trunk = elementWorldCollider(element);
    if (!trunk) return;
    const from = { x: trunk.x - 40, y: trunk.y };
    const desired = { x: trunk.x - 4, y: trunk.y + 8 };
    const resolved = resolveTerrain(from, desired, terrain);
    // Blocked on x, free on y: wall sliding still works against a sub-cell collider.
    expect(resolved.y).toBe(desired.y);
  });
});
