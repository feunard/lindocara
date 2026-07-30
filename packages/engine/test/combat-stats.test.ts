import {
  CLASS_COMBAT_STATS,
  COMBAT_STAT_CAPS,
  CRITICAL_DAMAGE_MULTIPLIER,
  combatStatsForClass,
  effectiveCombatStats,
  initialCombatEntropy,
  resolveCriticalDamage,
  resolveEntropyChance,
  resolveIncomingAttack,
} from "@lindocara/engine/combat-stats.js";
import { describe, expect, it } from "vitest";

describe("balanced class combat statistics", () => {
  it("preserves each class identity without an all-purpose defensive winner", () => {
    expect(CLASS_COMBAT_STATS.warrior.physicalResistance).toBeGreaterThan(
      CLASS_COMBAT_STATS.priest.physicalResistance,
    );
    expect(CLASS_COMBAT_STATS.priest.magicalResistance).toBeGreaterThan(
      CLASS_COMBAT_STATS.warrior.magicalResistance,
    );
    expect(CLASS_COMBAT_STATS.rogue.dodgeChance).toBeGreaterThan(
      CLASS_COMBAT_STATS.warrior.dodgeChance,
    );
    expect(CLASS_COMBAT_STATS.rogue.criticalChance).toBeGreaterThan(
      CLASS_COMBAT_STATS.ranger.criticalChance,
    );
    expect(CLASS_COMBAT_STATS.rogue.physicalResistance).toBeLessThan(
      CLASS_COMBAT_STATS.ranger.physicalResistance,
    );
    expect(CLASS_COMBAT_STATS.rogue.magicalResistance).toBeLessThan(
      CLASS_COMBAT_STATS.ranger.magicalResistance,
    );
  });

  it("keeps expected direct-hit survival in a narrow party-balanced band", () => {
    const expectedDamageRatio = (
      playerClass: keyof typeof CLASS_COMBAT_STATS,
      damageType: "physical" | "magical",
    ) => {
      const stats = CLASS_COMBAT_STATS[playerClass];
      const afterDodge = 1 - stats.dodgeChance;
      const afterParry = damageType === "physical" ? 1 - stats.parryChance : 1;
      const resistance =
        damageType === "physical" ? stats.physicalResistance : stats.magicalResistance;
      return afterDodge * afterParry * (1 - resistance);
    };

    const physical = Object.keys(CLASS_COMBAT_STATS).map((playerClass) =>
      expectedDamageRatio(playerClass as keyof typeof CLASS_COMBAT_STATS, "physical"),
    );
    const magical = Object.keys(CLASS_COMBAT_STATS).map((playerClass) =>
      expectedDamageRatio(playerClass as keyof typeof CLASS_COMBAT_STATS, "magical"),
    );
    expect(Math.max(...physical) - Math.min(...physical)).toBeLessThan(0.25);
    expect(Math.max(...magical) - Math.min(...magical)).toBeLessThan(0.18);
  });

  it("caps additive progression without reducing class baselines", () => {
    const stats = combatStatsForClass("rogue", {
      dodgeChance: 5,
      parryChance: -5,
      physicalResistance: 5,
      magicalResistance: 5,
      criticalChance: 5,
    });
    expect(stats).toEqual({
      dodgeChance: COMBAT_STAT_CAPS.dodgeChance,
      parryChance: 0,
      physicalResistance: COMBAT_STAT_CAPS.physicalResistance,
      magicalResistance: COMBAT_STAT_CAPS.magicalResistance,
      criticalChance: COMBAT_STAT_CAPS.criticalChance,
    });
  });

  it("combines permanent and currently active boosts, then expires only the temporary part", () => {
    const boosted = effectiveCombatStats(
      "warrior",
      { magicalResistance: 0.05 },
      { magicalResistance: { bonus: 0.1, until: 20_000 } },
      10_000,
    );
    expect(boosted.magicalResistance).toBe(0.2);
    expect(
      effectiveCombatStats(
        "warrior",
        { magicalResistance: 0.05 },
        { magicalResistance: { bonus: 0.1, until: 20_000 } },
        20_001,
      ).magicalResistance,
    ).toBe(0.1);
  });
});

describe("deterministic anti-streak combat resolution", () => {
  it("delivers the exact authored proc count over a representative sequence", () => {
    let entropy = 0.13;
    let triggers = 0;
    for (let index = 0; index < 100; index += 1) {
      const roll = resolveEntropyChance(entropy, 0.2);
      entropy = roll.next;
      if (roll.triggered) triggers += 1;
    }
    expect(triggers).toBe(20);
  });

  it("creates stable independent per-hero seeds", () => {
    expect(initialCombatEntropy("hero-a")).toEqual(initialCombatEntropy("hero-a"));
    expect(initialCombatEntropy("hero-a")).not.toEqual(initialCombatEntropy("hero-b"));
  });

  it("lets dodge answer every direct hit and parry only physical hits", () => {
    const stats = combatStatsForClass("warrior", {
      dodgeChance: 0.97,
      parryChance: 0.88,
    });
    const physical = resolveIncomingAttack(100, "physical", stats, {
      dodge: 0.1,
      parry: 0.9,
      critical: 0,
    });
    expect(physical).toMatchObject({ avoidedBy: "parry", damage: 0 });

    const magical = resolveIncomingAttack(100, "magical", stats, {
      dodge: 0.1,
      parry: 0.99,
      critical: 0,
    });
    expect(magical.avoidedBy).toBeNull();
    expect(magical.damage).toBe(95);
    expect(magical.entropy.parry).toBe(0.99);
  });

  it("uses resistance after avoidance and a bounded 1.5x critical multiplier", () => {
    const mitigated = resolveIncomingAttack(100, "physical", combatStatsForClass("warrior"), {
      dodge: 0,
      parry: 0,
      critical: 0,
    });
    expect(mitigated).toMatchObject({ avoidedBy: null, damage: 78 });

    const critical = resolveCriticalDamage(100, combatStatsForClass("rogue"), {
      dodge: 0,
      parry: 0,
      critical: 0.9,
    });
    expect(CRITICAL_DAMAGE_MULTIPLIER).toBe(1.5);
    expect(critical).toMatchObject({ critical: true, damage: 150 });
  });

  it("never lets periodic damage consume or trigger critical entropy", () => {
    const entropy = { dodge: 0.2, parry: 0.3, critical: 0.95 };
    expect(resolveCriticalDamage(17, combatStatsForClass("rogue"), entropy, false)).toEqual({
      critical: false,
      damage: 17,
      entropy,
    });
  });
});
