import { describe, expect, it } from "vitest";
import {
  CONSUMABLE_COOLDOWN_MS,
  CONSUMABLES,
  normalizeConsumables,
  RESURRECTION_DELAY_MS,
} from "../src/shared/consumables.js";
import type { TerrainGeometry } from "../src/shared/game.js";
import { merchantForTerrain } from "../src/shared/merchant.js";
import { isWalkableBox } from "../src/shared/tilemap.js";
import { tileMapFromRects } from "./support/tiles.js";

describe("consumable catalogue", () => {
  it("keeps restorative goods on gold and rare effects on crystals", () => {
    expect(CONSUMABLES.health_potion.currency).toBe("gold");
    expect(CONSUMABLES.mana_potion.currency).toBe("gold");
    expect(CONSUMABLES.damage_elixir.currency).toBe("crystals");
    expect(CONSUMABLES.oblivion_draught.currency).toBe("crystals");
    expect(CONSUMABLES.invisibility_potion.currency).toBe("crystals");
    expect(CONSUMABLES.resurrection_potion.currency).toBe("crystals");
    expect(CONSUMABLE_COOLDOWN_MS).toBe(10_000);
    expect(CONSUMABLES.resurrection_potion.durationMs).toBe(RESURRECTION_DELAY_MS);
  });

  it("normalizes untrusted counts and preserves legacy health potions", () => {
    expect(
      normalizeConsumables(
        { mana_potion: 2.9, damage_elixir: -4, invisibility_potion: Number.NaN },
        3,
      ),
    ).toMatchObject({
      health_potion: 3,
      mana_potion: 2,
      damage_elixir: 0,
      invisibility_potion: 0,
    });
  });
});

describe("runtime merchant placement", () => {
  it("chooses a deterministic walkable position near the room spawn", () => {
    const terrain: TerrainGeometry = {
      width: 512,
      height: 384,
      spawnPoints: [{ x: 160, y: 160 }],
      safeZone: null,
      obstacles: [],
      tiles: tileMapFromRects(512, 384, []),
    };
    const merchant = merchantForTerrain(terrain);
    expect(merchant).toEqual(merchantForTerrain(terrain));
    expect(isWalkableBox(terrain.tiles, merchant, 32)).toBe(true);
    expect(Math.hypot(merchant.x - 160, merchant.y - 160)).toBeLessThanOrEqual(160);
  });
});
