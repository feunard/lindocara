import { describe, expect, it } from "vitest";
import {
  CLIFF_WALL_SLOT,
  elevationOfSlot,
  GRASS_SLOTS,
  TINY_SWORDS_TILESET,
  TINY_SWORDS_TILESET_ID,
  tilesetById,
} from "../src/shared/tilesets/tiny-swords.js";

describe("the Tiny Swords tileset", () => {
  it("resolves by id", () => {
    expect(tilesetById(TINY_SWORDS_TILESET_ID)).toBe(TINY_SWORDS_TILESET);
    expect(tilesetById("nope")).toBeNull();
  });

  it("gives level 0 the flat group and levels 1 and 2 the raised group", () => {
    const [flat, one, two] = GRASS_SLOTS;
    expect(TINY_SWORDS_TILESET.autotiles[flat]?.origin).toEqual({ col: 0, row: 0 });
    expect(TINY_SWORDS_TILESET.autotiles[one]?.origin).toEqual({ col: 5, row: 0 });
    expect(TINY_SWORDS_TILESET.autotiles[two]?.origin).toEqual({ col: 5, row: 0 });
  });

  it("shades the raised levels apart and leaves the ground untinted", () => {
    const [flat, one, two] = GRASS_SLOTS;
    expect(TINY_SWORDS_TILESET.autotiles[flat]?.tint).toBeUndefined();
    expect(TINY_SWORDS_TILESET.autotiles[one]?.tint).not.toBe(
      TINY_SWORDS_TILESET.autotiles[two]?.tint,
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
    expect(GRASS_SLOTS.map(elevationOfSlot)).toEqual([0, 1, 2]);
    expect(elevationOfSlot(CLIFF_WALL_SLOT)).toBe(-1);
  });

  it("keeps every declared slot inside the id space", () => {
    expect(TINY_SWORDS_TILESET.autotiles.length).toBeLessThanOrEqual(64);
  });
});
