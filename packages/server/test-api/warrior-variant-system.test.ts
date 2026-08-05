import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { maxHpForLevel, type PlayerClass } from "@lindocara/engine/game.js";
import { skillWithTalents, talentEffect } from "@lindocara/engine/talents.js";
import {
  activeRallyPowerMultiplier,
  advanceWarriorCyclones,
  advanceWarriorVortices,
  applyKingsChallenge,
  applyRallyingCry,
  applySeismicImpact,
  applyWarBanner,
  chargeCounterOffensive,
  colossusChargeImpacts,
  consumeCounterOffensive,
  cycloneImpactTimes,
  damageAfterWarriorProtection,
  startWarriorCyclone,
  startWarriorVortex,
} from "@lindocara/server/world/warrior-variant-system.js";
import { newPlayer, type PlayerRuntime, toProfile } from "@lindocara/server/world/world-runtime.js";
import { describe, expect, it, vi } from "vitest";

const IRON_GUARD_PREREQUISITES = [
  "warrior.iron_guard.fortified",
  "warrior.iron_guard.perfect",
  "warrior.iron_guard.readiness",
] as const;
const BATTLE_CRY_PREREQUISITES = [
  "warrior.battle_cry.reach",
  "warrior.battle_cry.readiness",
  "warrior.battle_cry.command",
] as const;
const WHIRLWIND_PREREQUISITES = [
  "warrior.whirlwind.force",
  "warrior.whirlwind.reach",
  "warrior.whirlwind.readiness",
] as const;

/**
 * `x` is given in the PIXELS this suite was written in and converted here, once, so every case
 * below keeps the spacing it was designed around while the system reads tile units.
 */
function runtime(
  id: string,
  playerClass: PlayerClass,
  xPixels: number,
  talents: readonly string[] = [],
): PlayerRuntime {
  return newPlayer(
    {
      id,
      nick: id,
      x: xPixels / 64,
      y: 0,
      z: 20 / 64,
      level: 10,
      xp: 0,
      hp: 100,
      appearance: { body: "wayfarer", primaryColor: "azure" },
      class: playerClass,
      equipment: starterEquipmentFor(playerClass),
      inventory: { potions: 2, gold: 0, crystals: 0 },
      quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
      zoneId: "verdant-reach",
      instanceId: "main",
      sessionEpoch: 1,
      wardRunExpiresAt: null,
      life: "alive",
      corpse: null,
      talents: [...talents],
    },
    `${id}-connection`,
    "verdant-reach:main",
  );
}

describe("authoritative warrior evolution systems", () => {
  it("lets one guarding Rempart protect a nearby ally without stacking several warriors", () => {
    const first = runtime("first", "warrior", 0, [
      ...IRON_GUARD_PREREQUISITES,
      "warrior.iron_guard.rempart",
    ]);
    const second = runtime("second", "warrior", 5, [
      ...IRON_GUARD_PREREQUISITES,
      "warrior.iron_guard.rempart",
    ]);
    const ally = runtime("ally", "priest", 40);
    first.guarding = true;
    second.guarding = true;

    expect(
      damageAfterWarriorProtection(
        ally,
        40,
        [first, second, ally],
        1_000,
        () => true,
        () => true,
      ),
    ).toBe(30);
    expect(
      damageAfterWarriorProtection(
        ally,
        40,
        [first, ally],
        1_000,
        () => true,
        () => false,
      ),
    ).toBe(40);
  });

  it("bounds King's Challenge mitigation by the number of enemies actually taunted", () => {
    const warrior = runtime("king", "warrior", 0, [
      "warrior.battle_cry.reach",
      "warrior.battle_cry.readiness",
      "warrior.battle_cry.command",
      "warrior.battle_cry.mastery",
    ]);
    const effect = talentEffect("warrior", warrior.talents, "king_challenge", 4);
    if (!effect) throw new Error("missing King's Challenge effect");
    applyKingsChallenge(warrior, 12, effect, 2_000);

    expect(warrior.challengeReduction).toBe(0.2);
    expect(
      damageAfterWarriorProtection(
        warrior,
        100,
        [warrior],
        2_001,
        () => true,
        () => true,
      ),
    ).toBe(80);
    expect(
      damageAfterWarriorProtection(
        warrior,
        100,
        [warrior],
        5_001,
        () => true,
        () => true,
      ),
    ).toBe(100);
  });

  it("turns Rallying Cry into one refreshable, non-stacking ally power buff", () => {
    const caster = runtime("rally", "warrior", 0, [
      ...BATTLE_CRY_PREREQUISITES,
      "warrior.battle_cry.rallying_cry",
    ]);
    const ally = runtime("rally-ally", "ranger", 130);
    const outside = runtime("rally-outside", "priest", 145);
    const effect = talentEffect("warrior", caster.talents, "rallying_cry", 4);
    if (!effect) throw new Error("missing Rallying Cry effect");
    const radius = skillWithTalents("warrior", caster.talents, 4).radius ?? 0;
    // 118 px * 1.2 was 141.8 px; the tile-unit product at the finer rounding quantum.
    expect(radius).toBe(2.214844);

    expect(
      applyRallyingCry(
        caster,
        [caster, ally, outside],
        effect,
        radius,
        1_000,
        () => true,
        () => true,
      ),
    ).toBe(2);
    expect(activeRallyPowerMultiplier(ally, 1_001)).toBe(0.15);
    expect(activeRallyPowerMultiplier(outside, 1_001)).toBe(0);
    applyRallyingCry(
      caster,
      [ally],
      effect,
      radius,
      2_000,
      () => true,
      () => true,
    );
    expect(activeRallyPowerMultiplier(ally, 2_001)).toBe(0.15);
    expect(activeRallyPowerMultiplier(ally, 6_501)).toBe(0);
  });

  it("lets Colossus Charge cross a bounded ordered enemy line until terrain stops it", () => {
    const effect = talentEffect("warrior", ["warrior.shield_bash.mastery"], "colossus_charge", 3);
    if (!effect) throw new Error("missing Colossus Charge effect");
    const contacts = colossusChargeImpacts(
      [
        { target: { id: "late" }, fraction: 0.8 },
        { target: { id: "z-tie" }, fraction: 0.2 },
        { target: { id: "a-tie" }, fraction: 0.2 },
        { target: { id: "behind-wall" }, fraction: 0.9 },
      ],
      0.85,
      effect,
    );
    expect(contacts).toEqual([
      { target: { id: "a-tie" }, powerRatio: 1 },
      { target: { id: "z-tie" }, powerRatio: 0.7 },
      { target: { id: "late" }, powerRatio: 0.7 },
    ]);
  });

  it("resolves Impact Sismique in stable order without duplicating the direct target", () => {
    const hit = vi.fn();
    const targets = [{ id: "z" }, { id: "direct" }, { id: "blocked" }, { id: "a" }];
    const effect = talentEffect(
      "warrior",
      ["warrior.shield_bash.seismic_impact"],
      "seismic_impact",
      3,
    );
    if (!effect) throw new Error("missing Seismic Impact effect");

    expect(
      applySeismicImpact(
        targets,
        "direct",
        effect,
        (target) => target.id !== "blocked",
        (target, ratio) => hit(target.id, ratio),
      ),
    ).toBe(2);
    expect(hit.mock.calls).toEqual([
      ["a", 0.55],
      ["z", 0.55],
    ]);
  });

  it("ticks Cyclone exactly four times from the server clock and never creates extra strikes", () => {
    const warrior = runtime("cyclone", "warrior", 0, [
      ...WHIRLWIND_PREREQUISITES,
      "warrior.whirlwind.cyclone",
    ]);
    const effect = talentEffect("warrior", warrior.talents, "cyclone", 5);
    if (!effect) throw new Error("missing Cyclone effect");
    const skill = skillWithTalents("warrior", warrior.talents, 5);
    const strike = vi.fn();

    startWarriorCyclone(warrior, "action-1", skill, effect, 1_000);
    advanceWarriorCyclones([warrior], 1_000, strike);
    advanceWarriorCyclones([warrior], 2_000, strike);
    advanceWarriorCyclones([warrior], 3_000, strike);

    expect(strike).toHaveBeenCalledTimes(4);
    expect(strike.mock.calls.every((call) => call[3] === "action-1")).toBe(true);
    expect(warrior.warriorCyclone).toBeNull();
  });

  it("announces the same bounded contact schedule that Cyclone executes", () => {
    const effect = {
      kind: "cyclone",
      ticks: 4,
      intervalMs: 250,
      powerRatio: 0.32,
    } as const;

    expect(cycloneImpactTimes(effect, 1_000)).toEqual([1_000, 1_250, 1_500, 1_750]);
    expect(cycloneImpactTimes({ ...effect, ticks: 99, intervalMs: 10 }, 2_000)).toEqual(
      Array.from({ length: 8 }, (_, index) => 2_000 + index * 50),
    );
  });

  it("stores prevented guard damage with a cap and makes perfect parries charge harder", () => {
    const warrior = runtime("counter", "warrior", 0, [
      ...IRON_GUARD_PREREQUISITES,
      "warrior.iron_guard.riposte",
      "warrior.iron_guard.counter_offensive",
    ]);
    const effect = talentEffect("warrior", warrior.talents, "counter_offensive", 2);
    if (!effect) throw new Error("missing Counteroffensive effect");

    expect(chargeCounterOffensive(warrior, 20, effect, "guard")).toBe(14);
    expect(chargeCounterOffensive(warrior, 20, effect, "parry")).toBe(39);
    chargeCounterOffensive(warrior, 10_000, effect, "parry");
    expect(warrior.warriorCounterReserve).toBe(maxHpForLevel(10) * 0.75);
    expect(consumeCounterOffensive(warrior)).toBeGreaterThan(39);
    expect(warrior.warriorCounterReserve).toBe(0);
  });

  it("stacks War Banner with the initial rally and expires it after six seconds", () => {
    const caster = runtime("banner", "warrior", 0, [
      ...BATTLE_CRY_PREREQUISITES,
      "warrior.battle_cry.rallying_cry",
      "warrior.battle_cry.war_banner",
    ]);
    const ally = runtime("banner-ally", "ranger", 20);
    const rally = talentEffect("warrior", caster.talents, "rallying_cry", 4);
    const banner = talentEffect("warrior", caster.talents, "war_banner", 4);
    if (!rally || !banner) throw new Error("missing War Banner effects");
    applyRallyingCry(
      caster,
      [ally],
      rally,
      100,
      1_000,
      () => true,
      () => true,
    );
    applyWarBanner(
      caster,
      [ally],
      rally,
      undefined,
      banner.durationMs,
      1_000,
      () => true,
      () => true,
    );

    expect(activeRallyPowerMultiplier(ally, 1_001)).toBe(0.3);
    expect(activeRallyPowerMultiplier(ally, 7_001)).toBe(0);
  });

  it("ticks a bounded Eye of the Storm and follows the warrior only when requested", () => {
    const warrior = runtime("vortex", "warrior", 10, [
      ...WHIRLWIND_PREREQUISITES,
      "warrior.whirlwind.cyclone",
      "warrior.whirlwind.eye_of_the_storm",
    ]);
    const effect = talentEffect("warrior", warrior.talents, "eye_of_the_storm", 5);
    if (!effect) throw new Error("missing Eye of the Storm effect");
    const pulse = vi.fn();
    startWarriorVortex(warrior, { x: 10 / 64, y: 0, z: 20 / 64 }, 100 / 64, effect, 1_000, true);
    warrior.x = 40 / 64;
    advanceWarriorVortices([warrior], 1_500, pulse);

    expect(pulse).toHaveBeenCalledTimes(3);
    expect(pulse.mock.calls.every((call) => call[1].x === 40 / 64)).toBe(true);
    advanceWarriorVortices([warrior], 5_000, pulse);
    expect(warrior.warriorVortex).toBeNull();
  });

  it("never persists room-local warrior buffs or an in-flight Cyclone across reconnection", () => {
    const warrior = runtime("transient", "warrior", 0);
    warrior.challengeReductionUntil = 9_000;
    warrior.challengeReduction = 0.2;
    warrior.rallyPowerUntil = 9_000;
    warrior.rallyPowerMultiplier = 0.15;
    warrior.warriorCyclone = {
      actionId: "stale",
      nextTickAt: 2_000,
      ticksRemaining: 3,
      intervalMs: 250,
      radius: 90,
      power: 20,
    };
    warrior.warriorChargeFollowup = { excludedTargetId: "old", expiresAt: 9_000 };
    warrior.warriorCounterReserve = 50;
    warrior.warriorBannerPower.set("old", { multiplier: 0.15, expiresAt: 9_000 });
    warrior.warriorVortex = {
      x: 10 / 64,
      y: 0,
      z: 20 / 64,
      expiresAt: 9_000,
      nextPulseAt: 8_000,
      pulseIntervalMs: 250,
      radius: 100,
      pullDistance: 18,
      slowRatio: 0.6,
      slowDurationMs: 6_000,
      followsOwner: false,
    };

    const persisted = toProfile(warrior);
    expect(JSON.stringify(persisted)).not.toContain("challengeReduction");
    expect(JSON.stringify(persisted)).not.toContain("rallyPower");
    expect(JSON.stringify(persisted)).not.toContain("warriorCyclone");
    expect(JSON.stringify(persisted)).not.toContain("warriorCounterReserve");
    const restored = newPlayer(persisted, "fresh-connection", warrior.roomKey);
    expect(restored).toMatchObject({
      challengeReductionUntil: 0,
      challengeReduction: 0,
      rallyPowerUntil: 0,
      rallyPowerMultiplier: 0,
      warriorCyclone: null,
      warriorChargeFollowup: null,
      warriorCounterReserve: 0,
      warriorVortex: null,
    });
  });
});
