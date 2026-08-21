import {
  CLIFF_WALL_SLOT,
  elevationOfSlot,
  GRASS_SLOTS,
  isGroundElevation,
  MIN_TERRAIN_LEVEL,
  materialOfSlot,
  NO_GROUND_ELEVATION,
  SUNKEN_MATERIAL_SLOTS,
  TERRAIN_LEVELS,
  TERRAIN_MATERIAL_SLOTS,
  TINY_SWORDS_TILESET,
  TINY_SWORDS_TILESET_ID,
  terrainSlot,
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
    // Sunken slots answer with a NEGATIVE level, and a cliff face answers "not ground at all".
    // Those were the same value (-1) until ground could sink, which is why the sentinel moved.
    expect(SUNKEN_MATERIAL_SLOTS.herbe.map(elevationOfSlot)).toEqual([-1, -2, -3]);
    expect(SUNKEN_MATERIAL_SLOTS.glace.map(elevationOfSlot)).toEqual([-1, -2, -3]);
    expect(elevationOfSlot(CLIFF_WALL_SLOT)).toBe(NO_GROUND_ELEVATION);
    expect(isGroundElevation(elevationOfSlot(CLIFF_WALL_SLOT))).toBe(false);
    expect(isGroundElevation(-3)).toBe(true);
  });

  it("gives every sunken slot its own place, below the ground plane and darker with depth", () => {
    const sunken = Object.values(SUNKEN_MATERIAL_SLOTS).flat();
    // Twelve distinct slots, the last of the reservation, appended after every historical one so
    // no stored id changed meaning.
    expect(new Set(sunken).size).toBe(12);
    expect(Math.min(...sunken)).toBe(52);
    expect(Math.max(...sunken)).toBe(63);
    expect(MIN_TERRAIN_LEVEL).toBe(-3);
    const tintAt = (slot: number): number => {
      const tint = TINY_SWORDS_TILESET.autotiles[slot]?.tint;
      if (tint === undefined) throw new Error(`slot ${slot} has no tint`);
      return tint;
    };
    // A pit is in its own shadow: each level down is darker than the one above it.
    const [one, two, three] = SUNKEN_MATERIAL_SLOTS.herbe;
    expect(tintAt(one)).toBeGreaterThan(tintAt(two));
    expect(tintAt(two)).toBeGreaterThan(tintAt(three));
    // And it is ordinary ground: walkable, on the lowest render band, of its own material.
    for (const slot of sunken) {
      expect(TINY_SWORDS_TILESET.autotiles[slot]?.passable).toBe(true);
      expect(TINY_SWORDS_TILESET.autotiles[slot]?.renderLevel).toBe(0);
    }
    expect(materialOfSlot(SUNKEN_MATERIAL_SLOTS.sable[1])).toBe("sable");
    expect(terrainSlot("neige", -2)).toBe(SUNKEN_MATERIAL_SLOTS.neige[1]);
    expect(terrainSlot("neige", MIN_TERRAIN_LEVEL - 1)).toBeNull();
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

  it("keeps every declared slot inside the id space, which is now exactly full", () => {
    // 64 of the 64 the id space reserves: 52 for the ground plane and its ten plateaus, plus the
    // twelve the three sunken levels took. The next level in EITHER direction needs a fifteenth
    // block that does not exist, and buying it raises the reservation, which moves `FIXED_BASE`
    // and reinterprets every stored fixed id in every saved map. That is why the range stops here.
    expect(TINY_SWORDS_TILESET.autotiles.length).toBe(64);
    expect(TINY_SWORDS_TILESET.autotiles.length).toBeLessThanOrEqual(64);
    expect(GRASS_SLOTS).toHaveLength(TERRAIN_LEVELS);
  });
});
