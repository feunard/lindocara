import { ROGUE_BALANCE } from "@lindocara/engine/rogue.js";
import { CLASS_SKILLS, type SkillDefinition, type SkillSlot } from "@lindocara/engine/skills.js";
import {
  activeEvolutionVariant,
  CLASS_TALENTS,
  conflictingExclusiveTalent,
  normalizeTalentSelection,
  skillWithTalents,
  type TalentNode,
  talentBranchSlots,
  talentEffect,
  talentState,
  unlockTalent,
} from "@lindocara/engine/talents.js";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("class talents", () => {
  it("ships all twenty-one branches with the exact reusable A/B evolution topology", () => {
    let branchCount = 0;
    for (const [playerClass, nodes] of Object.entries(CLASS_TALENTS)) {
      const typedClass = playerClass as keyof typeof CLASS_TALENTS;
      const slots = talentBranchSlots(typedClass);
      expect(slots).toEqual(playerClass === "peasant" ? [1, 2, 3, 4, 5] : [2, 3, 4, 5]);
      for (const slot of slots) {
        branchCount += 1;
        const branch = nodes.filter((node) => node.slot === slot);
        const skill = CLASS_SKILLS[typedClass][slot - 1];
        const root = branch.find((node) => node.root);
        const tierOne = branch.filter((node) => node.tier === 1);
        const synergy = branch.filter((node) => node.tier === 2);
        const finals = branch.filter((node) => node.tier === 3);
        const ultimates = branch.filter((node) => node.tier === 4);
        const group = `${playerClass}.${skill?.id}.evolution`;
        expect(branch).toHaveLength(7);
        expect(root).toMatchObject({
          id: `${playerClass}.${skill?.id}.root`,
          tier: 0,
          column: 0,
          requires: [],
          requiresAll: true,
          effects: [],
        });
        expect(tierOne).toHaveLength(2);
        expect(tierOne.map((node) => node.column)).toEqual([-1, 1]);
        expect(tierOne.every((node) => node.requiresAll)).toBe(true);
        expect(tierOne.map((node) => node.requires)).toEqual([[root?.id], [root?.id]]);
        expect(synergy).toHaveLength(1);
        expect(synergy[0]).toMatchObject({
          column: 0,
          requires: tierOne.map((node) => node.id),
          requiresAll: false,
        });
        expect(finals).toHaveLength(2);
        expect(finals.map((node) => node.column)).toEqual([-1, 1]);
        expect(finals.map((node) => node.variantId)).toEqual(["a", "b"]);
        expect(finals.map((node) => node.exclusiveGroup)).toEqual([group, group]);
        expect(finals.every((node) => node.requiresAll)).toBe(true);
        expect(finals.map((node) => node.requires)).toEqual(
          Array.from({ length: 2 }, () => [...tierOne.map((node) => node.id), synergy[0]?.id]),
        );
        expect(ultimates).toHaveLength(1);
        expect(ultimates[0]).toMatchObject({
          tier: 4,
          column: 0,
          label: "ultimate",
          requires: [...tierOne.map((node) => node.id), synergy[0]?.id],
          requiresAll: true,
          requiresOneOf: finals.map((node) => node.id),
        });
      }
    }
    expect(branchCount).toBe(21);
  });

  it("allows every skill slot in the talent contract", () => {
    expectTypeOf<TalentNode["slot"]>().toEqualTypeOf<SkillSlot>();
    const basicAttackBranch: TalentNode["slot"] = 1;
    expect(basicAttackBranch).toBe(1);
  });

  it("marks every existing capstone as the compatible A variant of a stable exclusive group", () => {
    for (const [playerClass, nodes] of Object.entries(CLASS_TALENTS)) {
      if (playerClass === "rogue") continue;
      const typedClass = playerClass as keyof typeof CLASS_TALENTS;
      for (const slot of talentBranchSlots(typedClass)) {
        const capstone = nodes.find((node) => node.slot === slot && node.tier === 3);
        expect(capstone).toMatchObject({
          exclusiveGroup: expect.stringContaining(`${playerClass}.`),
          variantId: "a",
        });
        expect(activeEvolutionVariant(typedClass, [capstone?.id ?? ""], slot)).toBe(capstone);
      }
    }
  });

  it("ships two exclusive final variants for every Rogue technique branch", () => {
    const expected = [
      ["rogue.shadow_step.executor", "rogue.shadow_step.shadow_return"],
      ["rogue.vanish.predator", "rogue.vanish.smoke_screen"],
      ["rogue.poisoned_shiv.concentrated_venom", "rogue.poisoned_shiv.rupture"],
      ["rogue.shadow_dance.dark_harvest", "rogue.shadow_dance.thousand_cuts"],
    ];
    for (const [index, slot] of ([2, 3, 4, 5] as const).entries()) {
      const finals = CLASS_TALENTS.rogue.filter((node) => node.slot === slot && node.tier === 3);
      expect(finals.map((node) => node.id)).toEqual(expected[index]);
      expect(finals.map((node) => node.variantId)).toEqual(["a", "b"]);
      expect(new Set(finals.map((node) => node.exclusiveGroup)).size).toBe(1);
    }

    const prerequisites = CLASS_TALENTS.rogue
      .filter((node) => node.slot === 2 && !node.root && node.tier < 3)
      .map((node) => node.id);
    expect(
      normalizeTalentSelection("rogue", 10, [
        ...prerequisites,
        "rogue.shadow_step.executor",
        "rogue.shadow_step.shadow_return",
      ]),
    ).toEqual([...prerequisites, "rogue.shadow_step.executor"]);
  });

  it("detects a conflicting future variant without changing legacy capstone selections", () => {
    const legacyId = "ranger.piercing_arrow.ricochet";
    const legacy = CLASS_TALENTS.ranger.find((node) => node.id === legacyId);
    if (!legacy?.exclusiveGroup) throw new Error("legacy capstone group missing");
    const legacySelection = [
      ...CLASS_TALENTS.ranger
        .filter((node) => node.slot === 2 && !node.root && node.tier < 3)
        .map((node) => node.id),
      legacyId,
    ];

    expect(normalizeTalentSelection("ranger", 10, legacySelection)).toEqual(legacySelection);
    expect(
      conflictingExclusiveTalent("ranger", [legacyId], {
        id: "ranger.piercing_arrow.line_piercer",
        exclusiveGroup: legacy.exclusiveGroup,
      }),
    ).toBe(legacy);
  });

  it("requires every intermediate and either exclusive final before the Shadow Step ultimate", () => {
    const intermediates = [
      "rogue.shadow_step.ambush",
      "rogue.shadow_step.reach",
      "rogue.shadow_step.readiness",
    ];
    const ultimate = "rogue.shadow_step.veil_crossing";

    expect(normalizeTalentSelection("rogue", 10, [...intermediates, ultimate])).toEqual(
      intermediates,
    );
    expect(unlockTalent("rogue", 10, intermediates, ultimate)).toMatchObject({
      ok: false,
      reason: "prerequisite",
    });
    for (const final of ["rogue.shadow_step.executor", "rogue.shadow_step.shadow_return"]) {
      const fullBranch = [...intermediates, final];
      expect(unlockTalent("rogue", 10, fullBranch, ultimate)).toEqual({
        ok: true,
        selected: [...fullBranch, ultimate],
      });
      expect(normalizeTalentSelection("rogue", 10, [...fullBranch, ultimate])).toEqual([
        ...fullBranch,
        ultimate,
      ]);
    }
    expect(talentEffect("rogue", [ultimate], "rogue_shadow_phase", 2)).toEqual({
      kind: "rogue_shadow_phase",
    });
  });

  it("keeps warrior legacy capstones as A and rejects their mutually exclusive B choices", () => {
    const expected = [
      ["warrior.iron_guard.riposte", "warrior.iron_guard.rempart"],
      ["warrior.shield_bash.mastery", "warrior.shield_bash.seismic_impact"],
      ["warrior.battle_cry.mastery", "warrior.battle_cry.rallying_cry"],
      ["warrior.whirlwind.mastery", "warrior.whirlwind.cyclone"],
    ];
    for (const [index, slot] of ([2, 3, 4, 5] as const).entries()) {
      const finals = CLASS_TALENTS.warrior.filter((node) => node.slot === slot && node.tier === 3);
      expect(finals.map((node) => node.id)).toEqual(expected[index]);
      expect(finals.map((node) => node.variantId)).toEqual(["a", "b"]);
      expect(new Set(finals.map((node) => node.exclusiveGroup)).size).toBe(1);
    }

    const prerequisites = CLASS_TALENTS.warrior
      .filter((node) => node.slot === 2 && !node.root && node.tier < 3)
      .map((node) => node.id);
    const legacySelection = [...prerequisites, "warrior.iron_guard.riposte"];
    expect(
      normalizeTalentSelection("warrior", 10, [...legacySelection, "warrior.iron_guard.rempart"]),
    ).toEqual(legacySelection);
    expect(
      unlockTalent("warrior", 10, legacySelection, "warrior.iron_guard.rempart"),
    ).toMatchObject({ ok: false, reason: "exclusive" });
  });

  it("keeps ranger legacy capstones as A and normalizes every conflicting B choice", () => {
    const expected = [
      ["ranger.piercing_arrow.ricochet", "ranger.piercing_arrow.line_piercer"],
      ["ranger.volley.mastery", "ranger.volley.focused"],
      ["ranger.dash.mastery", "ranger.dash.retreat_shot"],
      ["ranger.heartseeker.execute", "ranger.heartseeker.comet_arrow"],
    ];
    for (const [index, slot] of ([2, 3, 4, 5] as const).entries()) {
      const finals = CLASS_TALENTS.ranger.filter((node) => node.slot === slot && node.tier === 3);
      expect(finals.map((node) => node.id)).toEqual(expected[index]);
      expect(finals.map((node) => node.variantId)).toEqual(["a", "b"]);
      expect(new Set(finals.map((node) => node.exclusiveGroup)).size).toBe(1);
    }

    const prerequisites = CLASS_TALENTS.ranger
      .filter((node) => node.slot === 2 && !node.root && node.tier < 3)
      .map((node) => node.id);
    const legacySelection = [...prerequisites, "ranger.piercing_arrow.ricochet"];
    expect(
      normalizeTalentSelection("ranger", 10, [
        ...legacySelection,
        "ranger.piercing_arrow.line_piercer",
      ]),
    ).toEqual(legacySelection);
  });

  it("keeps priest legacy capstones as A and rejects their mutually exclusive B choices", () => {
    const expected = [
      ["priest.mend.chain", "priest.mend.emergency"],
      ["priest.blink.mastery", "priest.blink.sacred_passage"],
      ["priest.prayer.mastery", "priest.prayer.absolution"],
      ["priest.divine_nova.mastery", "priest.divine_nova.mercy"],
    ];
    for (const [index, slot] of ([2, 3, 4, 5] as const).entries()) {
      const finals = CLASS_TALENTS.priest.filter((node) => node.slot === slot && node.tier === 3);
      expect(finals.map((node) => node.id)).toEqual(expected[index]);
      expect(finals.map((node) => node.variantId)).toEqual(["a", "b"]);
      expect(new Set(finals.map((node) => node.exclusiveGroup)).size).toBe(1);
    }

    const prerequisites = CLASS_TALENTS.priest
      .filter((node) => node.slot === 2 && !node.root && node.tier < 3)
      .map((node) => node.id);
    const legacySelection = [...prerequisites, "priest.mend.chain"];
    expect(unlockTalent("priest", 10, legacySelection, "priest.mend.emergency")).toMatchObject({
      ok: false,
      reason: "exclusive",
    });
  });

  it("grants one spendable point per level while keeping learned roots free", () => {
    const initial = talentState("ranger", 10, []);
    expect(initial).toEqual({ selected: [], pointsSpent: 0, pointsAvailable: 10 });

    const roots = CLASS_TALENTS.ranger.filter((node) => node.root).map((node) => node.id);
    expect(normalizeTalentSelection("ranger", 10, roots)).toEqual([]);
    expect(talentState("ranger", 10, roots).pointsAvailable).toBe(10);
  });

  it("enforces skill levels, prerequisites and the level point cap", () => {
    expect(unlockTalent("warrior", 2, [], "warrior.iron_guard.fortified")).toMatchObject({
      ok: false,
      reason: "locked_skill",
    });
    expect(unlockTalent("warrior", 3, [], "warrior.iron_guard.riposte")).toMatchObject({
      ok: false,
      reason: "prerequisite",
    });

    const first = unlockTalent("warrior", 3, [], "warrior.iron_guard.fortified");
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("expected first talent to unlock");
    const second = unlockTalent("warrior", 3, first.selected, "warrior.iron_guard.perfect");
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("expected second talent to unlock");
    const third = unlockTalent("warrior", 3, second.selected, "warrior.iron_guard.readiness");
    expect(third.ok).toBe(true);
    if (!third.ok) throw new Error("expected third talent to unlock");
    expect(unlockTalent("warrior", 3, third.selected, "warrior.iron_guard.riposte")).toMatchObject({
      ok: false,
      reason: "points",
    });
  });

  it("applies selected modifiers only to the matching non-basic skill", () => {
    const selected = ["ranger.piercing_arrow.force", "ranger.piercing_arrow.reach"];
    const base = CLASS_SKILLS.ranger[1];
    const improved = skillWithTalents("ranger", selected, 2);
    expect(improved.power).toBeGreaterThan(base?.power ?? 0);
    expect(improved.range).toBeGreaterThan(base?.range ?? 0);
    expect(skillWithTalents("ranger", selected, 1)).toEqual(CLASS_SKILLS.ranger[0]);
  });

  it("keeps historical basic attacks untouched while allowing Peasant slot-one modifiers", () => {
    for (const playerClass of ["warrior", "ranger", "priest", "rogue"] as const) {
      expect(
        skillWithTalents(
          playerClass,
          ["peasant.woodcutters_swing.readiness", "peasant.woodcutters_swing.reach"],
          1,
        ),
      ).toBe(CLASS_SKILLS[playerClass][0]);
    }

    const axe = skillWithTalents(
      "peasant",
      ["peasant.woodcutters_swing.readiness", "peasant.woodcutters_swing.reach"],
      1,
    );
    expect(axe.cooldownMs).toBe(370);
    expect(axe.range).toBe(60.5);
    expect(axe).not.toBe(CLASS_SKILLS.peasant[0]);

    const peasantBase = CLASS_SKILLS.peasant[0];
    if (!peasantBase) throw new Error("Peasant basic skill missing");
    const authoredBase: SkillDefinition = { ...peasantBase, range: 80 };
    expect(
      skillWithTalents("peasant", ["peasant.woodcutters_swing.reach"], 1, authoredBase).range,
    ).toBe(89.6);
  });

  it("exposes the ranger ricochet and warrior perfect-parry capstones", () => {
    expect(talentEffect("ranger", ["ranger.piercing_arrow.ricochet"], "ricochet", 2)).toMatchObject(
      { ratio: 0.6, range: 160 },
    );
    expect(
      talentEffect("warrior", ["warrior.iron_guard.perfect"], "perfect_parry", 2),
    ).toMatchObject({ windowMs: 220 });
  });

  it("exposes distinct warrior utility variants without changing offensive capstone values", () => {
    expect(talentEffect("warrior", ["warrior.iron_guard.rempart"], "ally_guard", 2)).toEqual({
      kind: "ally_guard",
      radius: 120,
      reduction: 0.25,
    });
    const colossus = skillWithTalents("warrior", ["warrior.shield_bash.mastery"], 3);
    const seismic = skillWithTalents("warrior", ["warrior.shield_bash.seismic_impact"], 3);
    expect(colossus.power).toBe(Math.round((CLASS_SKILLS.warrior[2]?.power ?? 0) * 1.3));
    expect(
      talentEffect("warrior", ["warrior.shield_bash.mastery"], "colossus_charge", 3),
    ).toMatchObject({ throughPowerRatio: 0.7, maxTargets: 6 });
    expect(seismic.distance).toBeLessThan(CLASS_SKILLS.warrior[2]?.distance ?? 0);
    expect(talentEffect("warrior", ["warrior.whirlwind.mastery"], "steel_tempest", 5)).toEqual({
      kind: "steel_tempest",
    });
    expect(talentEffect("warrior", ["warrior.whirlwind.cyclone"], "cyclone", 5)).toMatchObject({
      ticks: 4,
      intervalMs: 250,
    });
  });

  it("gives every class a materially stronger named evolution", () => {
    const warrior = skillWithTalents("warrior", ["warrior.shield_bash.mastery"], 3);
    expect(warrior.power).toBeGreaterThan(CLASS_SKILLS.warrior[2]?.power ?? 0);
    expect(warrior.distance).toBeGreaterThan(CLASS_SKILLS.warrior[2]?.distance ?? 0);

    const ranger = skillWithTalents("ranger", ["ranger.dash.mastery"], 4);
    expect(ranger.distance).toBeGreaterThan(CLASS_SKILLS.ranger[3]?.distance ?? 0);
    expect(ranger.cooldownMs).toBeLessThan(CLASS_SKILLS.ranger[3]?.cooldownMs ?? Infinity);
    expect(talentEffect("ranger", ["ranger.dash.mastery"], "windstep", 4)).toEqual({
      kind: "windstep",
    });

    const priest = skillWithTalents("priest", ["priest.prayer.mastery"], 4);
    expect(priest.power).toBeGreaterThan(CLASS_SKILLS.priest[3]?.power ?? 0);
    expect(priest.radius).toBeGreaterThan(CLASS_SKILLS.priest[3]?.radius ?? 0);
    expect(
      talentEffect("priest", ["priest.blink.mastery"], "luminous_transfiguration", 3),
    ).toMatchObject({ radius: 95, power: 16, powerPerLevel: 1 });
  });

  it("adds four arrows to the five-arrow Volley", () => {
    expect(talentEffect("ranger", ["ranger.volley.mastery"], "extra_projectiles", 3)).toMatchObject(
      { value: 4 },
    );
  });

  it("centralizes the four ranger B variant contracts", () => {
    expect(
      talentEffect("ranger", ["ranger.piercing_arrow.line_piercer"], "line_piercer", 2),
    ).toMatchObject({ bonusPerTarget: 0.15, maxBonus: 0.6 });
    expect(talentEffect("ranger", ["ranger.volley.focused"], "focused_volley", 3)).toMatchObject({
      spreadMultiplier: 0.28,
      minimumPowerRatio: 0.35,
    });
    expect(talentEffect("ranger", ["ranger.dash.retreat_shot"], "retreat_shot", 4)).toMatchObject({
      projectiles: 3,
      powerRatio: 0.45,
      range: 280,
    });
    expect(
      talentEffect("ranger", ["ranger.heartseeker.comet_arrow"], "comet_arrow", 5),
    ).toMatchObject({ directPowerRatio: 0.85, radius: 105, splashPowerRatio: 0.65 });
  });

  it("centralizes the priest specialization and cleanse contracts", () => {
    expect(talentEffect("priest", ["priest.mend.emergency"], "emergency_mend", 2)).toMatchObject({
      threshold: 0.3,
      powerMultiplier: 0.75,
    });
    expect(
      talentEffect("priest", ["priest.blink.sacred_passage"], "sacred_passage", 3),
    ).toMatchObject({ width: 22, power: 18, powerPerLevel: 1 });
    expect(talentEffect("priest", ["priest.prayer.mastery"], "sanctuary", 4)).toMatchObject({
      ticks: 3,
      intervalMs: 1_000,
      tickPowerRatio: 0.35,
    });
    expect(talentEffect("priest", ["priest.prayer.absolution"], "absolution", 4)).toEqual({
      kind: "absolution",
      cleanse: "poison",
    });
    expect(
      talentEffect("priest", ["priest.divine_nova.mastery"], "nova_judgment", 5),
    ).toMatchObject({
      damageMultiplier: 1.4,
      healMultiplier: 0.6,
      executeThreshold: 0.3,
      executeMultiplier: 0.35,
    });
    expect(talentEffect("priest", ["priest.divine_nova.mercy"], "nova_mercy", 5)).toMatchObject({
      damageMultiplier: 0.6,
      healMultiplier: 1.4,
      reviveNearest: true,
    });
  });

  it("centralizes all eight Rogue evolution contracts", () => {
    expect(
      talentEffect("rogue", ["rogue.shadow_step.executor"], "rogue_executor", 2),
    ).toMatchObject({
      openingBonusRatio: ROGUE_BALANCE.opening.executorBonusRatio,
      killWindowMs: 2_000,
      cooldownReductionRatio: 0.5,
    });
    expect(
      talentEffect("rogue", ["rogue.shadow_step.shadow_return"], "rogue_shadow_return", 2),
    ).toMatchObject({ windowMs: 2_000 });
    expect(talentEffect("rogue", ["rogue.vanish.predator"], "rogue_predator", 3)).toMatchObject({
      openingBonusRatio: ROGUE_BALANCE.opening.predatorBonusRatio,
      shivWindowMs: 2_000,
      poisonPowerMultiplier: 1.5,
    });
    expect(
      talentEffect("rogue", ["rogue.vanish.smoke_screen"], "rogue_smoke_screen", 3),
    ).toMatchObject({ protectionMs: 750 });
    expect(skillWithTalents("rogue", ["rogue.vanish.smoke_screen"], 3).cooldownMs).toBe(11_200);
    expect(
      talentEffect(
        "rogue",
        ["rogue.poisoned_shiv.concentrated_venom"],
        "rogue_concentrated_venom",
        4,
      ),
    ).toMatchObject({ maxStacks: 3 });
    expect(
      talentEffect("rogue", ["rogue.poisoned_shiv.rupture"], "rogue_rupture", 4),
    ).toMatchObject({ remainingDamageRatio: 0.6, detonationMultiplier: 1.5 });
    expect(
      talentEffect("rogue", ["rogue.shadow_dance.dark_harvest"], "rogue_dark_harvest", 5),
    ).toMatchObject({ cooldownReductionPerKillMs: 1_500 });
    expect(
      talentEffect("rogue", ["rogue.shadow_dance.thousand_cuts"], "rogue_thousand_cuts", 5),
    ).toMatchObject({ repeatPowerRatio: 0.6 });
  });
});
