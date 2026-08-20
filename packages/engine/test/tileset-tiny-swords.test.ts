import {
  CLIFF_WALL_SLOT,
  elevationOfSlot,
  GRASS_SLOTS,
  TERRAIN_LEVELS,
  TERRAIN_MATERIAL_SLOTS,
  TINY_SWORDS_TILESET,
  TINY_SWORDS_TILESET_ID,
  tilesetById,
} from "@lindocara/engine/tilesets/tiny-swords.js";
import { describe, expect, it } from "vitest";

describe("the Tiny Swords tileset", () => {
  it("resolves by id", () => {
    expect(tilesetById(TINY_SWORDS_TILESET_ID)).toBe(TINY_SWORDS_TILESET);
    expect(tilesetById("nope")).toBeNull();
  });

  it("gives level 0 the flat group and levels 1 through 3 the raised group", () => {
    const [flat, one, two, three] = GRASS_SLOTS;
    expect(TINY_SWORDS_TILESET.autotiles[flat]?.origin).toEqual({ col: 0, row: 0 });
    expect(TINY_SWORDS_TILESET.autotiles[one]?.origin).toEqual({ col: 5, row: 0 });
    expect(TINY_SWORDS_TILESET.autotiles[two]?.origin).toEqual({ col: 5, row: 0 });
    expect(TINY_SWORDS_TILESET.autotiles[three]?.origin).toEqual({ col: 5, row: 0 });
  });

  it("shades the raised levels apart and leaves the ground untinted", () => {
    const [flat, one, two, three] = GRASS_SLOTS;
    expect(TINY_SWORDS_TILESET.autotiles[flat]?.tint).toBeUndefined();
    expect(TINY_SWORDS_TILESET.autotiles[one]?.tint).not.toBe(
      TINY_SWORDS_TILESET.autotiles[two]?.tint,
    );
    expect(TINY_SWORDS_TILESET.autotiles[two]?.tint).not.toBe(
      TINY_SWORDS_TILESET.autotiles[three]?.tint,
    );
  });

  it("makes every grass level walkable", () => {
    for (const slot of GRASS_SLOTS) {
      expect(TINY_SWORDS_TILESET.autotiles[slot]?.passable).toBe(true);
    }
  });

  it("makes the cliff wall a run4 you cannot walk through", () => {
    const wall = TINY_SWORDS_TILESET.autotiles[CLIFF_WALL_SLOT];
    expect(wall?.kind).toBe("run4");
    expect(wall?.origin).toEqual({ col: 5, row: 4 });
    expect(wall?.passable).toBe(false);
  });

  it("maps slots back to elevation levels", () => {
    expect(GRASS_SLOTS.map(elevationOfSlot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(elevationOfSlot(CLIFF_WALL_SLOT)).toBe(-1);
  });

  it("declares every slot its material tables name", () => {
    // The one that would have caught the drift: thin ice was retired by removing its material from
    // the generator, which shortened every block and slid the level-3 band down three slots while
    // the tables, and every saved map, went on naming the old ones. Sand, snow and ice at level 3
    // referenced slots that were not declared at all.
    for (const [material, slots] of Object.entries(TERRAIN_MATERIAL_SLOTS)) {
      for (const [level, slot] of slots.entries()) {
        expect(
          TINY_SWORDS_TILESET.autotiles[slot],
          `${material} level ${level} (slot ${slot})`,
        ).toBeDefined();
      }
    }
    // And the retired thin-ice slots, which hold the offsets those tables depend on.
    for (const slot of [16, 17, 18, 23]) {
      expect(TINY_SWORDS_TILESET.autotiles[slot], `retired slot ${slot}`).toBeDefined();
    }
  });

  it("keeps the historical slots meaning exactly what they meant", () => {
    // Levels 0 to 3 are in saved maps. A range that grows must not move one of them.
    expect(GRASS_SLOTS.slice(0, 4)).toEqual([0, 1, 2, 19]);
    expect(TERRAIN_MATERIAL_SLOTS.sable.slice(0, 4)).toEqual([7, 8, 9, 20]);
    expect(TERRAIN_MATERIAL_SLOTS.neige.slice(0, 4)).toEqual([10, 11, 12, 21]);
    expect(TERRAIN_MATERIAL_SLOTS.glace.slice(0, 4)).toEqual([13, 14, 15, 22]);
  });

  it("keeps every declared slot inside the id space", () => {
    // 52 of the 64 the id space reserves. A twelfth level would need four more per material and
    // would not fit; raising the reservation moves `FIXED_BASE` and renumbers every stored fixed
    // tile in every saved map, which is why the range stops here rather than anywhere else.
    expect(TINY_SWORDS_TILESET.autotiles.length).toBe(52);
    expect(TINY_SWORDS_TILESET.autotiles.length).toBeLessThanOrEqual(64);
    expect(GRASS_SLOTS).toHaveLength(TERRAIN_LEVELS);
  });
});
