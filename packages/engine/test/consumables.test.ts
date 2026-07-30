import {
  applyCombatStatConsumable,
  CONSUMABLE_COOLDOWN_MS,
  CONSUMABLE_IDS,
  CONSUMABLES,
  emptyConsumables,
  normalizeConsumables,
  RESURRECTION_DELAY_MS,
} from "@lindocara/engine/consumables.js";
import { merchantForRuntimeRoom } from "@lindocara/engine/merchant.js";
import { describe, expect, it } from "vitest";

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

  it("keeps every shop item represented in inventory and gameplay data", () => {
    expect(Object.keys(CONSUMABLES)).toEqual([...CONSUMABLE_IDS]);
    expect(Object.keys(emptyConsumables())).toEqual([...CONSUMABLE_IDS]);
  });

  it("refreshes temporary combat boosts without stacking the same item", () => {
    const now = 10_000;
    const first = applyCombatStatConsumable("evasion_tonic", {}, {}, now);
    expect(first).toMatchObject({
      applied: true,
      temporaryBoosts: { dodgeChance: { bonus: 0.08, until: 70_000 } },
    });
    if (!first) throw new Error("expected temporary combat-stat application");
    const refreshed = applyCombatStatConsumable(
      "evasion_tonic",
      first.permanentBonuses,
      first.temporaryBoosts,
      now + 20_000,
    );
    expect(refreshed?.temporaryBoosts.dodgeChance).toEqual({
      bonus: 0.08,
      until: 90_000,
    });
  });

  it("stops permanent manuals at five one-point upgrades", () => {
    let permanent = {};
    for (let use = 0; use < 5; use += 1) {
      const application = applyCombatStatConsumable("critical_manual", permanent, {}, 10_000);
      expect(application?.applied).toBe(true);
      permanent = application?.permanentBonuses ?? {};
    }
    expect(permanent).toEqual({ criticalChance: 0.05 });
    expect(applyCombatStatConsumable("critical_manual", permanent, {}, 10_000)).toMatchObject({
      applied: false,
      permanentBonuses: { criticalChance: 0.05 },
    });
  });
});

describe("runtime merchant placement", () => {
  it("does not synthesize a merchant before authored placement exists", () => {
    expect(merchantForRuntimeRoom()).toBeNull();
  });
});
