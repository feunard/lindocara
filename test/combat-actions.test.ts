import {
  MAX_PROJECTILE_LIFETIME_MS,
  MAX_PROJECTILE_RANGE,
  MAX_PROJECTILES_PER_PLAYER,
  MAX_PROJECTILES_PER_ROOM,
  MONSTER_ACTIONS,
  PLAYER_ACTIONS,
} from "@lindocara/engine/combat-actions.js";
import { ATTACK_COOLDOWN_MS } from "@lindocara/engine/game.js";
import { CLASS_SKILLS } from "@lindocara/engine/skills.js";
import { describe, expect, it } from "vitest";

describe("directional class kit contract", () => {
  it("preserves the five reference cooldowns for every class", () => {
    expect(ATTACK_COOLDOWN_MS).toBe(325);
    expect(CLASS_SKILLS.warrior.map((skill) => skill.cooldownMs)).toEqual([
      325, 8_000, 3_200, 5_500, 8_000,
    ]);
    expect(CLASS_SKILLS.ranger.map((skill) => skill.cooldownMs)).toEqual([
      325, 2_000, 5_000, 7_000, 8_500,
    ]);
    expect(CLASS_SKILLS.priest.map((skill) => skill.cooldownMs)).toEqual([
      325, 1_500, 8_000, 6_000, 10_000,
    ]);
  });

  it("keeps every skill id aligned with one explicit directional execution", () => {
    for (const playerClass of ["warrior", "ranger", "priest"] as const) {
      expect(PLAYER_ACTIONS[playerClass].map((action) => action.skillId)).toEqual(
        CLASS_SKILLS[playerClass].map((skill) => skill.id),
      );
      expect(PLAYER_ACTIONS[playerClass].every((action) => action.anticipationMs > 0)).toBe(true);
      expect(PLAYER_ACTIONS[playerClass].every((action) => action.recoveryMs > 0)).toBe(true);
    }
  });

  it("aligns every slot-one action timeline with its 325 ms cooldown", () => {
    expect(
      (["warrior", "ranger", "priest"] as const).map((playerClass) => {
        const action = PLAYER_ACTIONS[playerClass][0];
        if (!action) throw new Error(`missing slot one action for ${playerClass}`);
        return action.anticipationMs + action.recoveryMs;
      }),
    ).toEqual([325, 325, 325]);
    expect(PLAYER_ACTIONS.priest[0]).toMatchObject({
      skillId: "radiant_bolt",
      anticipationMs: 140,
      recoveryMs: 185,
    });
  });

  it("defines straight ranger shots, a projectile fan, and an unguided Heartseeker", () => {
    expect(PLAYER_ACTIONS.ranger[0]).toMatchObject({
      skillId: "quick_shot",
      shape: "projectile",
      projectile: { kind: "arrow", pierce: 0 },
    });
    expect(PLAYER_ACTIONS.ranger[1]).toMatchObject({
      projectile: { kind: "piercing_arrow", pierce: 7 },
    });
    expect(PLAYER_ACTIONS.ranger[2]).toMatchObject({
      shape: "volley",
      projectile: { kind: "volley_arrow", count: 5 },
    });
    expect(PLAYER_ACTIONS.ranger[4]).toMatchObject({
      projectile: { kind: "heartseeker", speed: 700, pierce: 0 },
    });
  });

  it("configures Mend as an ally-only healing projectile", () => {
    const mend = CLASS_SKILLS.priest.find((skill) => skill.id === "mend");
    expect(mend).toMatchObject({
      cooldownMs: 1_500,
      range: 195,
      power: 35,
      allyPower: 35,
    });
    expect(PLAYER_ACTIONS.priest[1]).toMatchObject({
      shape: "heal_projectile",
      projectile: { kind: "healing_light", pierce: 0 },
    });
  });

  it("applies the requested ranged and mobility range increases", () => {
    expect(CLASS_SKILLS.ranger.map((skill) => skill.range)).toEqual([382.5, 405, 324, 0, 517.5]);
    expect(CLASS_SKILLS.ranger[2]?.radius).toBe(324);
    expect(CLASS_SKILLS.priest.slice(0, 2).map((skill) => skill.range)).toEqual([337.5, 195]);
    expect(CLASS_SKILLS.priest[2]).toMatchObject({ id: "blink", distance: 247.5 });
    expect(CLASS_SKILLS.warrior[1]).toMatchObject({
      id: "iron_guard",
      reduction: 0.5,
    });
    expect(CLASS_SKILLS.warrior[1]?.durationMs).toBeUndefined();
    expect(CLASS_SKILLS.warrior[3]).toMatchObject({
      id: "battle_cry",
      effect: "area_taunt",
      power: 0,
    });
    expect(PLAYER_ACTIONS.warrior[3]).toMatchObject({ shape: "area_taunt" });
  });

  it("gives every monster species a telegraphed active frame and bounded recovery", () => {
    for (const action of Object.values(MONSTER_ACTIONS)) {
      expect(action.anticipationMs).toBeGreaterThanOrEqual(400);
      expect(action.recoveryMs).toBeGreaterThan(0);
      expect(action.range).toBeGreaterThan(0);
      expect(action.hitboxRadius).toBeGreaterThan(0);
    }
  });

  it("bounds projectile count, range, and lifetime defensively", () => {
    expect(MAX_PROJECTILES_PER_PLAYER).toBeLessThanOrEqual(12);
    expect(MAX_PROJECTILES_PER_ROOM).toBeLessThanOrEqual(48);
    expect(MAX_PROJECTILE_RANGE).toBe(540);
    expect(MAX_PROJECTILE_LIFETIME_MS).toBe(2_500);
  });
});
