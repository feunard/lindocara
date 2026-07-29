import { CLASS_SKILLS } from "@lindocara/engine/skills.js";
import {
  activeEvolutionVariant,
  CLASS_TALENTS,
  conflictingExclusiveTalent,
  normalizeTalentSelection,
  skillWithTalents,
  talentEffect,
  talentState,
  unlockTalent,
} from "@lindocara/engine/talents.js";
import { describe, expect, it } from "vitest";

describe("class talents", () => {
  it("ships four rooted branches with three intermediates and one or two final evolutions", () => {
    for (const [playerClass, nodes] of Object.entries(CLASS_TALENTS)) {
      for (const slot of [2, 3, 4, 5] as const) {
        const branch = nodes.filter((node) => node.slot === slot);
        expect(branch.filter((node) => node.root)).toHaveLength(1);
        expect(branch.filter((node) => node.tier === 1)).toHaveLength(2);
        expect(branch.filter((node) => node.tier === 2)).toHaveLength(1);
        expect(branch.filter((node) => node.tier === 3).length).toBeGreaterThanOrEqual(1);
        expect(branch.filter((node) => node.tier === 3).length).toBeLessThanOrEqual(2);
        expect(branch[0]?.id).toContain(
          `${playerClass}.${CLASS_SKILLS[playerClass as keyof typeof CLASS_SKILLS][slot - 1]?.id}.root`,
        );
      }
    }
  });

  it("marks every existing capstone as the compatible A variant of a stable exclusive group", () => {
    for (const [playerClass, nodes] of Object.entries(CLASS_TALENTS)) {
      for (const slot of [2, 3, 4, 5] as const) {
        const capstone = nodes.find((node) => node.slot === slot && node.tier === 3);
        expect(capstone).toMatchObject({
          exclusiveGroup: expect.stringContaining(`${playerClass}.`),
          variantId: "a",
        });
        expect(
          activeEvolutionVariant(
            playerClass as keyof typeof CLASS_TALENTS,
            [capstone?.id ?? ""],
            slot,
          ),
        ).toBe(capstone);
      }
    }
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
    expect(seismic.distance).toBeLessThan(CLASS_SKILLS.warrior[2]?.distance ?? 0);
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

    const priest = skillWithTalents("priest", ["priest.prayer.mastery"], 4);
    expect(priest.power).toBeGreaterThan(CLASS_SKILLS.priest[3]?.power ?? 0);
    expect(priest.radius).toBeGreaterThan(CLASS_SKILLS.priest[3]?.radius ?? 0);
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
    });
    expect(talentEffect("priest", ["priest.prayer.absolution"], "absolution", 4)).toEqual({
      kind: "absolution",
      cleanse: "poison",
    });
    expect(
      talentEffect("priest", ["priest.divine_nova.mastery"], "nova_judgment", 5),
    ).toMatchObject({ damageMultiplier: 1.4, healMultiplier: 0.6 });
    expect(talentEffect("priest", ["priest.divine_nova.mercy"], "nova_mercy", 5)).toMatchObject({
      damageMultiplier: 0.6,
      healMultiplier: 1.4,
    });
  });
});
