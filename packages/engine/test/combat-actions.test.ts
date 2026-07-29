import {
  MAX_PROJECTILE_LIFETIME_MS,
  MAX_PROJECTILE_RANGE,
  MAX_PROJECTILES_PER_PLAYER,
  MAX_PROJECTILES_PER_ROOM,
  MONSTER_ACTIONS,
  MONSTER_SPECIAL_ACTIONS,
  PLAYER_ACTIONS,
} from "@lindocara/engine/combat-actions.js";
import { ATTACK_COOLDOWN_MS, PLAYER_CLASSES } from "@lindocara/engine/game.js";
import { ROGUE_BALANCE, roguePoisonTickPower } from "@lindocara/engine/rogue.js";
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
    expect(CLASS_SKILLS.rogue.map((skill) => skill.cooldownMs)).toEqual([
      325, 4_500, 14_000, 6_000, 11_000,
    ]);
  });

  it("keeps every skill id aligned with one explicit directional execution", () => {
    for (const playerClass of PLAYER_CLASSES) {
      expect(PLAYER_ACTIONS[playerClass].map((action) => action.skillId)).toEqual(
        CLASS_SKILLS[playerClass].map((skill) => skill.id),
      );
      expect(PLAYER_ACTIONS[playerClass].every((action) => action.anticipationMs > 0)).toBe(true);
      expect(PLAYER_ACTIONS[playerClass].every((action) => action.recoveryMs > 0)).toBe(true);
    }
  });

  it("aligns every slot-one action timeline with its 325 ms cooldown", () => {
    expect(
      PLAYER_CLASSES.map((playerClass) => {
        const action = PLAYER_ACTIONS[playerClass][0];
        if (!action) throw new Error(`missing slot one action for ${playerClass}`);
        return action.anticipationMs + action.recoveryMs;
      }),
    ).toEqual([325, 325, 325, 325]);
    expect(PLAYER_ACTIONS.priest[0]).toMatchObject({
      skillId: "radiant_bolt",
      anticipationMs: 140,
      recoveryMs: 185,
    });
  });

  it("declares the Rogue kit without any client-authored target contract", () => {
    expect(CLASS_SKILLS.rogue).toMatchObject([
      { id: "dual_slash", slot: 1, range: 58, power: 0 },
      { id: "shadow_step", slot: 2, effect: "shadow_step", range: 260 },
      { id: "vanish", slot: 3, effect: "stealth", durationMs: 8_000 },
      { id: "poisoned_shiv", slot: 4, range: 58, power: 14 },
      { id: "shadow_dance", slot: 5, effect: "shadow_dance", range: 360, power: 32 },
    ]);
    expect(PLAYER_ACTIONS.rogue.map((action) => action.shape)).toEqual([
      "arc",
      "shadow_step",
      "stealth",
      "arc",
      "shadow_dance",
    ]);
    expect(ROGUE_BALANCE.poisonedShiv).toMatchObject({
      poisonTicks: 5,
      poisonTickPower: 6,
      poisonTickPowerPerLevel: 1,
      poisonIntervalMs: 1_000,
    });
    expect([roguePoisonTickPower(1), roguePoisonTickPower(7)]).toEqual([6, 12]);
    expect(ROGUE_BALANCE.shadowDance.maximumHits).toBe(5);
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
      range: 390,
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
    expect(CLASS_SKILLS.priest.slice(0, 2).map((skill) => skill.range)).toEqual([337.5, 390]);
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

  it("defines distinct telegraphed boss techniques", () => {
    expect(Object.keys(MONSTER_SPECIAL_ACTIONS)).toHaveLength(15);
    expect(Object.keys(MONSTER_SPECIAL_ACTIONS)).toEqual(
      expect.arrayContaining([
        "ground_slam",
        "shadow_cone",
        "soul_drain",
        "bone_cleave",
        "grave_siphon",
        "horn_charge",
        "labyrinth_stomp",
        "troll_quake",
        "troll_sweep",
      ]),
    );
    expect(MONSTER_SPECIAL_ACTIONS.ground_slam).toMatchObject({
      shape: "circle",
      damageMultiplier: 1.45,
    });
    expect(MONSTER_SPECIAL_ACTIONS.shadow_cone).toMatchObject({
      shape: "cone",
      damageMultiplier: 1.3,
    });
    expect(MONSTER_SPECIAL_ACTIONS.soul_drain).toMatchObject({
      shape: "circle",
      healRatio: 0.65,
    });
    expect(MONSTER_SPECIAL_ACTIONS.horn_charge).toMatchObject({
      shape: "cone",
      damageMultiplier: 1.65,
    });
    expect(MONSTER_SPECIAL_ACTIONS.grave_siphon).toMatchObject({
      shape: "circle",
      healRatio: 0.5,
    });
    expect(MONSTER_SPECIAL_ACTIONS.troll_quake).toMatchObject({
      shape: "circle",
      damageMultiplier: 1.7,
    });
    for (const action of Object.values(MONSTER_SPECIAL_ACTIONS)) {
      expect(action.anticipationMs).toBeGreaterThanOrEqual(600);
      expect(action.cooldownMs).toBeGreaterThan(action.anticipationMs + action.recoveryMs);
      expect(action.range).toBeGreaterThan(MONSTER_ACTIONS.spear_goblin.range);
    }
  });

  it("bounds projectile count, range, and lifetime defensively", () => {
    expect(MAX_PROJECTILES_PER_PLAYER).toBeLessThanOrEqual(12);
    expect(MAX_PROJECTILES_PER_ROOM).toBeLessThanOrEqual(48);
    expect(MAX_PROJECTILE_RANGE).toBe(540);
    expect(MAX_PROJECTILE_LIFETIME_MS).toBe(2_500);
  });
});
