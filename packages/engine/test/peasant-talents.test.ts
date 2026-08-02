import { HARVEST_PROFILE_LIMITS, type HarvestProfile } from "@lindocara/engine/harvest.js";
import { dictionaries } from "@lindocara/engine/i18n/index.js";
import {
  isPeasantTalentEffect,
  PEASANT_TALENT_EFFECT_KINDS,
  resolvePeasantBombPlan,
  resolvePeasantConstructionPlan,
  resolvePeasantHarvestPlan,
  resolvePeasantRationPlan,
} from "@lindocara/engine/peasant.js";
import { PEASANT_SUPPORT_SKILLS } from "@lindocara/engine/peasant-support.js";
import { SKILL_UNLOCK_LEVEL, type SkillSlot } from "@lindocara/engine/skills.js";
import {
  CLASS_TALENTS,
  normalizeTalentSelection,
  peasantBombTalentPlan,
  peasantConstructionTalentPlan,
  peasantHarvestTalentPlan,
  peasantTalentEffects,
  talentBranchSlots,
  unlockTalent,
} from "@lindocara/engine/talents.js";
import { describe, expect, it } from "vitest";

function harvestProfile(overrides: Partial<HarvestProfile> = {}): HarvestProfile {
  return {
    resource: "wood",
    tool: "axe",
    yieldAmount: 10,
    goldValue: 0,
    hitsRequired: 4,
    range: 54,
    harvestDurationMs: 1_000,
    exhaustedAssetId: null,
    exhaustionBehavior: "hide",
    respawn: "permanent",
    respawnDelayMs: 0,
    fadeDurationMs: 350,
    ...overrides,
  };
}

describe("Peasant talents", () => {
  it("defines five complete utility branches and one ultimate per technique", () => {
    expect(talentBranchSlots("peasant")).toEqual([1, 2, 3, 4, 5]);
    const expected = {
      1: ["clean_cut", "sweeping_fell", "great_felling"],
      2: ["rich_vein", "fragmentation", "mother_lode"],
      3: ["preservation", "field_feast", "grand_feast"],
      4: ["stockade", "campfire", "complete_encampment"],
      5: ["shrapnel", "concussion", "powder_keg"],
    } as const;
    for (const slot of [1, 2, 3, 4, 5] as const) {
      const nodes = CLASS_TALENTS.peasant.filter((node) => node.slot === slot);
      expect(nodes).toHaveLength(7);
      expect(
        nodes.filter((node) => node.tier === 3).map((node) => node.id.split(".").at(-1)),
      ).toEqual(expected[slot].slice(0, 2));
      expect(
        nodes
          .find((node) => node.tier === 4)
          ?.id.split(".")
          .at(-1),
      ).toBe(expected[slot][2]);
    }
  });

  it("normalizes persisted selections into a stable, exclusive, JSON-safe order", () => {
    const requested = [
      "peasant.woodcutters_swing.great_felling",
      "peasant.woodcutters_swing.sweeping_fell",
      "peasant.woodcutters_swing.clean_cut",
      "peasant.woodcutters_swing.reach",
      "peasant.woodcutters_swing.readiness",
      "peasant.woodcutters_swing.bounty",
      "peasant.woodcutters_swing.bounty",
      "peasant.woodcutters_swing.root",
      "peasant.unknown.dead_save_value",
    ];
    const expected = [
      "peasant.woodcutters_swing.bounty",
      "peasant.woodcutters_swing.readiness",
      "peasant.woodcutters_swing.reach",
      "peasant.woodcutters_swing.clean_cut",
      "peasant.woodcutters_swing.great_felling",
    ];
    const normalized = normalizeTalentSelection("peasant", 10, requested);
    expect(normalized).toEqual(expected);
    expect(normalizeTalentSelection("peasant", 10, JSON.parse(JSON.stringify(normalized)))).toEqual(
      expected,
    );
    expect(normalizeTalentSelection("peasant", 10, { selected: requested })).toEqual([]);
  });

  it("enforces each skill unlock level and the point cap", () => {
    for (const slot of [1, 2, 3, 4, 5] as const) {
      const first = CLASS_TALENTS.peasant.find((node) => node.slot === slot && node.tier === 1);
      if (!first) throw new Error(`Missing Peasant tier-one talent for slot ${slot}`);
      expect(unlockTalent("peasant", SKILL_UNLOCK_LEVEL[slot] - 1, [], first.id)).toMatchObject({
        ok: false,
        reason: "locked_skill",
      });
      expect(unlockTalent("peasant", SKILL_UNLOCK_LEVEL[slot], [], first.id).ok).toBe(true);
    }

    const first = "peasant.woodcutters_swing.bounty";
    expect(unlockTalent("peasant", 1, [first], "peasant.woodcutters_swing.readiness")).toEqual({
      ok: false,
      reason: "points",
    });
  });

  it("enforces A/B exclusivity and requires either evolution before every ultimate", () => {
    for (const slot of [1, 2, 3, 4, 5] as readonly SkillSlot[]) {
      const nodes = CLASS_TALENTS.peasant.filter((node) => node.slot === slot);
      const intermediates = nodes
        .filter((node) => node.tier === 1 || node.tier === 2)
        .map((node) => node.id);
      const finals = nodes.filter((node) => node.tier === 3);
      const ultimate = nodes.find((node) => node.tier === 4);
      const finalA = finals[0];
      const finalB = finals[1];
      if (!finalA || !finalB || !ultimate) throw new Error(`Incomplete Peasant slot ${slot}`);

      expect(unlockTalent("peasant", 20, intermediates, ultimate.id)).toMatchObject({
        ok: false,
        reason: "prerequisite",
      });
      expect(unlockTalent("peasant", 20, [...intermediates, finalA.id], finalB.id)).toMatchObject({
        ok: false,
        reason: "exclusive",
      });
      for (const final of finals) {
        expect(unlockTalent("peasant", 20, [...intermediates, final.id], ultimate.id)).toEqual({
          ok: true,
          selected: [...intermediates, final.id, ultimate.id],
        });
      }
    }
  });

  it("exposes every custom effect through the typed Peasant projection", () => {
    const customNodes = CLASS_TALENTS.peasant.filter((node) =>
      node.effects.some(isPeasantTalentEffect),
    );
    const selected = customNodes.map((node) => node.id);
    const effects = peasantTalentEffects(selected);
    expect(new Set(effects.map((effect) => effect.kind))).toEqual(
      new Set(PEASANT_TALENT_EFFECT_KINDS),
    );
    for (const slot of [1, 2, 3, 4, 5] as const) {
      expect(peasantTalentEffects(selected, slot).length).toBeGreaterThan(0);
    }
  });

  it("resolves axe talents into one authoritative material reward without mutating the profile", () => {
    const profile = harvestProfile();
    const original = structuredClone(profile);
    const plan = peasantHarvestTalentPlan(
      [
        "peasant.woodcutters_swing.bounty",
        "peasant.woodcutters_swing.readiness",
        "peasant.woodcutters_swing.reach",
        "peasant.woodcutters_swing.clean_cut",
        "peasant.woodcutters_swing.great_felling",
      ],
      1,
      profile,
    );
    expect(plan.skill).toMatchObject({ cooldownMs: 370, range: 60.5 });
    expect(plan.harvest).toEqual({
      resource: "wood",
      tool: "axe",
      yieldAmount: 19,
      goldValue: 0,
      primaryMaterialReward: { wood: 19 },
      bonusMaterialReward: {},
      materialReward: { wood: 19 },
      hitsRequired: 3,
      harvestDurationMs: 850,
      areaRadius: 128,
      maximumTargets: 6,
    });
    expect(profile).toEqual(original);
  });

  it("merges rich-vein material bonuses and preserves gold as existing currency", () => {
    const effects = peasantTalentEffects(
      [
        "peasant.prospectors_pick.ore_share",
        "peasant.prospectors_pick.rich_vein",
        "peasant.prospectors_pick.mother_lode",
      ],
      2,
    );
    const stone = resolvePeasantHarvestPlan(
      harvestProfile({ resource: "stone", tool: "pickaxe", yieldAmount: 8 }),
      effects,
    );
    expect(stone).toMatchObject({
      yieldAmount: 16,
      primaryMaterialReward: { stone: 16 },
      bonusMaterialReward: { iron: 3 },
      materialReward: { stone: 16, iron: 3 },
      areaRadius: 110,
      maximumTargets: 5,
    });

    const gold = resolvePeasantHarvestPlan(
      harvestProfile({
        resource: "gold",
        tool: "pickaxe",
        yieldAmount: 0,
        goldValue: 100,
      }),
      effects,
    );
    expect(gold).toMatchObject({
      yieldAmount: 0,
      goldValue: 240,
      primaryMaterialReward: {},
      bonusMaterialReward: {},
      materialReward: {},
    });

    const maximumGold = resolvePeasantHarvestPlan(
      harvestProfile({
        resource: "gold",
        tool: "pickaxe",
        yieldAmount: 0,
        goldValue: HARVEST_PROFILE_LIMITS.goldValue.max,
      }),
      effects,
    );
    expect(maximumGold.goldValue).toBe(HARVEST_PROFILE_LIMITS.goldValue.max);
  });

  it("turns ration effects into bounded healing, portions and group utility", () => {
    const effects = peasantTalentEffects(
      ["peasant.butchers_cut.preservation", "peasant.butchers_cut.grand_feast"],
      3,
    );
    expect(resolvePeasantRationPlan(effects)).toEqual({
      healing: 26,
      portions: 5,
      radius: 180,
      buffDurationMs: 10_000,
      powerBonusRatio: 0.15,
    });
  });

  it("resolves every alternate evolution into a material gameplay plan", () => {
    const sweeping = resolvePeasantHarvestPlan(
      harvestProfile(),
      peasantTalentEffects(["peasant.woodcutters_swing.sweeping_fell"], 1),
    );
    expect(sweeping).toMatchObject({ areaRadius: 84, maximumTargets: 3 });

    const fragmentation = resolvePeasantHarvestPlan(
      harvestProfile({ resource: "stone", tool: "pickaxe", yieldAmount: 8 }),
      peasantTalentEffects(["peasant.prospectors_pick.fragmentation"], 2),
    );
    expect(fragmentation).toMatchObject({
      hitsRequired: 3,
      harvestDurationMs: 850,
      areaRadius: 72,
      maximumTargets: 3,
    });

    const meat = resolvePeasantHarvestPlan(
      harvestProfile({ resource: "meat", tool: "knife" }),
      peasantTalentEffects(["peasant.butchers_cut.meat_share"], 3),
    );
    expect(meat.materialReward).toEqual({ meat: 13 });
    expect(
      resolvePeasantRationPlan(peasantTalentEffects(["peasant.butchers_cut.field_feast"], 3)),
    ).toEqual({
      healing: 12,
      portions: 1,
      radius: 120,
      buffDurationMs: 6_000,
      powerBonusRatio: 0.1,
    });

    expect(
      resolvePeasantConstructionPlan(peasantTalentEffects(["peasant.makeshift_camp.campfire"], 4)),
    ).toEqual({
      id: "makeshift_camp",
      cost: { wood: 4, stone: 2, meat: 2 },
      power: 90,
      durabilityMultiplier: 1.25,
      durationMs: 35_000,
      radius: 120,
      protectionRatio: 0.08,
      slowRatio: 0,
      costMultiplier: 1,
    });

    expect(
      resolvePeasantBombPlan(peasantTalentEffects(["peasant.homemade_bomb.shrapnel"], 5)),
    ).toEqual({
      id: "homemade_bomb",
      cost: { iron: 2, stone: 2 },
      power: 85,
      radius: 121,
      fragments: 4,
      fragmentPowerRatio: 0.25,
      slowRatio: 0,
      slowDurationMs: 0,
      knockbackDistance: 0,
      fuseDurationMs: 650,
      costMultiplier: 1,
    });
  });

  it("derives construction and bomb plans from the shared support contract", () => {
    expect(resolvePeasantConstructionPlan([])).toMatchObject({
      id: PEASANT_SUPPORT_SKILLS[4].id,
      cost: PEASANT_SUPPORT_SKILLS[4].cost,
      power: PEASANT_SUPPORT_SKILLS[4].power,
      radius: PEASANT_SUPPORT_SKILLS[4].radius,
      durationMs: PEASANT_SUPPORT_SKILLS[4].durationMs,
    });
    const camp = peasantConstructionTalentPlan([
      "peasant.makeshift_camp.reach",
      "peasant.makeshift_camp.readiness",
      "peasant.makeshift_camp.reinforcement",
      "peasant.makeshift_camp.stockade",
      "peasant.makeshift_camp.complete_encampment",
    ]);
    expect(camp.skill).toMatchObject({ cooldownMs: 10_200, range: 86.4, radius: 115.2 });
    expect(camp.support).toEqual({
      id: "makeshift_camp",
      cost: { wood: 2, stone: 1, meat: 1 },
      power: 90,
      durabilityMultiplier: 3,
      durationMs: 48_000,
      radius: 144,
      protectionRatio: 0.25,
      slowRatio: 0.4,
      costMultiplier: 0.5,
    });

    expect(resolvePeasantBombPlan([])).toMatchObject({
      id: PEASANT_SUPPORT_SKILLS[5].id,
      cost: PEASANT_SUPPORT_SKILLS[5].cost,
      power: PEASANT_SUPPORT_SKILLS[5].power,
      radius: PEASANT_SUPPORT_SKILLS[5].radius,
      fuseDurationMs: PEASANT_SUPPORT_SKILLS[5].durationMs,
    });
    const bomb = peasantBombTalentPlan([
      "peasant.homemade_bomb.force",
      "peasant.homemade_bomb.reach",
      "peasant.homemade_bomb.readiness",
      "peasant.homemade_bomb.concussion",
      "peasant.homemade_bomb.powder_keg",
    ]);
    expect(bomb.skill).toMatchObject({ cooldownMs: 8_800, range: 336, power: 95, radius: 123.2 });
    expect(bomb.support).toEqual({
      id: "homemade_bomb",
      cost: { iron: 1, stone: 1 },
      power: 119,
      radius: 191,
      fragments: 6,
      fragmentPowerRatio: 0.3,
      slowRatio: 0.6,
      slowDurationMs: 3_000,
      knockbackDistance: 48,
      fuseDurationMs: 650,
      costMultiplier: 0.5,
    });
  });

  it("provides French and English copy for every evolution and ultimate", () => {
    for (const slot of [1, 2, 3, 4, 5] as const) {
      const nodes = CLASS_TALENTS.peasant.filter(
        (node) => node.slot === slot && (node.tier === 3 || node.tier === 4),
      );
      for (const node of nodes) {
        const skill = node.id.split(".")[1];
        const prefix = node.tier === 4 ? "talent.ultimate" : "talent.evolution";
        const variant = node.variantId ? `.${node.variantId}` : "";
        for (const suffix of ["name", "description"] as const) {
          const key = `${prefix}.peasant.${skill}${variant}.${suffix}`;
          for (const locale of ["en", "fr"] as const) {
            expect(
              (dictionaries[locale] as Record<string, string>)[key],
              `${locale}:${key}`,
            ).toBeTypeOf("string");
          }
        }
      }
    }
  });
});
