import { describe, expect, it } from "vitest";
import {
  CONSUMABLE_COOLDOWN_MS,
  CONSUMABLES,
  normalizeConsumables,
  RESURRECTION_DELAY_MS,
} from "../src/shared/consumables.js";
import { merchantForRuntimeRoom } from "../src/shared/merchant.js";

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
  it("does not synthesize a merchant before authored placement exists", () => {
    expect(merchantForRuntimeRoom()).toBeNull();
  });
});
