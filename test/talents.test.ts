import { describe, expect, it } from "vitest";
import { CLASS_SKILLS } from "../src/shared/skills.js";
import {
  CLASS_TALENTS,
  normalizeTalentSelection,
  skillWithTalents,
  talentEffect,
  talentState,
  unlockTalent,
} from "../src/shared/talents.js";

describe("class talents", () => {
  it("ships four five-node branches per class, rooted in ability slots 2 through 5", () => {
    for (const [playerClass, nodes] of Object.entries(CLASS_TALENTS)) {
      expect(nodes).toHaveLength(20);
      for (const slot of [2, 3, 4, 5] as const) {
        const branch = nodes.filter((node) => node.slot === slot);
        expect(branch).toHaveLength(5);
        expect(branch.filter((node) => node.root)).toHaveLength(1);
        expect(branch[0]?.id).toContain(
          `${playerClass}.${CLASS_SKILLS[playerClass as keyof typeof CLASS_SKILLS][slot - 1]?.id}.root`,
        );
      }
    }
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
});
