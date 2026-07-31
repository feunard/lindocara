import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { talentEffect } from "@lindocara/engine/talents.js";
import { isPlayerInvulnerable } from "@lindocara/server/world/combat-system.js";
import {
  applyDamageOverTime,
  type DamageOverTimeRuntime,
  damageOverTimeRemainingPower,
} from "@lindocara/server/world/damage-over-time-system.js";
import {
  activeRogueOpening,
  applyRogueSmokeProtection,
  armRogueExecution,
  armRoguePredatorShiv,
  clearRogueTransientState,
  consumeRogueOpening,
  consumeRoguePredatorShivMultiplier,
  enterRogueStealth,
  exitRogueStealth,
  expireRogueExecution,
  expireRogueOpening,
  expireRogueShadowDanceProtection,
  expireRogueStealth,
  grantRogueOpening,
  isRogueStealthed,
  reduceRogueShadowDanceCooldown,
  resolveRogueExecutionKill,
  rogueOpeningBonusRatio,
  rupturePoisonWithShiv,
} from "@lindocara/server/world/rogue-state-system.js";
import { selfState } from "@lindocara/server/world/snapshot-system.js";
import { newPlayer, toProfile } from "@lindocara/server/world/world-runtime.js";
import { describe, expect, it } from "vitest";

function rogue(talents: readonly string[] = []) {
  return newPlayer(
    {
      id: "rogue",
      nick: "Shade",
      x: 20,
      y: 40,
      level: 10,
      xp: 0,
      hp: 100,
      appearance: { body: "wayfarer", primaryColor: "violet" },
      class: "rogue",
      equipment: starterEquipmentFor("rogue"),
      inventory: { potions: 0, gold: 0, crystals: 0 },
      quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
      zoneId: "verdant-reach",
      instanceId: "main",
      sessionEpoch: 1,
      wardRunExpiresAt: null,
      life: "alive",
      corpse: null,
      talents: [...talents],
    },
    "rogue-connection",
    "verdant-reach:main",
  );
}

describe("Rogue runtime contract", () => {
  it("refreshes one non-stacking Opening and consumes it only through the explicit hit boundary", () => {
    const player = rogue();
    grantRogueOpening(player, "shadow_step", 1_000);
    const first = player.opening;
    expect(first).toMatchObject({
      source: "shadow_step",
      expiresAt: 2_500,
      bonusRatio: 0.4,
    });

    grantRogueOpening(player, "vanish", 1_200);
    expect(player.opening).toMatchObject({
      source: "vanish",
      expiresAt: 2_700,
      bonusRatio: 0.4,
    });
    expect(player.opening).not.toBe(first);
    expect(activeRogueOpening(player, 2_699)).toBe(player.opening);

    const consumed = consumeRogueOpening(player, 2_699);
    expect(consumed?.source).toBe("vanish");
    expect(player.opening).toBeNull();
    expect(consumeRogueOpening(player, 2_699)).toBeNull();
  });

  it("expires Opening without turning a stale deadline into a hit bonus", () => {
    const player = rogue();
    grantRogueOpening(player, "shadow_step", 4_000);
    expect(expireRogueOpening(player, 5_499)).toBe(false);
    expect(expireRogueOpening(player, 5_500)).toBe(true);
    expect(activeRogueOpening(player, 5_500)).toBeNull();
  });

  it("starts Vanish cooldown only on exit and grants Opening only to an offensive exit", () => {
    const player = rogue();
    expect(enterRogueStealth(player, 1_000)).toBe(true);
    expect(player.rogueStealthUntil).toBe(9_000);
    expect(player.skillCooldowns[2]).toBe(0);
    expect(isRogueStealthed(player, 8_999)).toBe(true);

    expect(exitRogueStealth(player, 2_000, { offensive: true })).toBe(true);
    expect(player.rogueStealthUntil).toBe(0);
    expect(player.skillCooldowns[2]).toBe(16_000);
    expect(player.opening).toMatchObject({
      source: "vanish",
      expiresAt: 3_500,
      bonusRatio: 0.4,
    });
    expect(exitRogueStealth(player, 2_100, { offensive: true })).toBe(false);
    expect(player.skillCooldowns[2]).toBe(16_000);
  });

  it("expires Vanish at eight seconds without granting an offensive Opening", () => {
    const player = rogue();
    enterRogueStealth(player, 5_000);
    expect(expireRogueStealth(player, 12_999)).toBe(false);
    expect(expireRogueStealth(player, 13_000)).toBe(true);
    expect(player.rogueStealthUntil).toBe(0);
    expect(player.skillCooldowns[2]).toBe(27_000);
    expect(player.opening).toBeNull();

    const lateAttack = rogue();
    enterRogueStealth(lateAttack, 5_000);
    expect(exitRogueStealth(lateAttack, 13_000, { offensive: true })).toBe(true);
    expect(lateAttack.opening).toBeNull();
  });

  it("arms Executor on the struck target and halves only the bounded remaining cooldown", () => {
    const player = rogue([
      "rogue.shadow_step.ambush",
      "rogue.shadow_step.reach",
      "rogue.shadow_step.readiness",
      "rogue.shadow_step.executor",
    ]);
    const executor = talentEffect(player.class, player.talents, "rogue_executor", 2);
    if (!executor) throw new Error("missing Executor effect");
    expect(rogueOpeningBonusRatio(player, 2, executor.openingBonusRatio)).toBeCloseTo(0.798);

    player.skillCooldowns[1] = 6_000;
    armRogueExecution(player, "target", 1_000, executor);
    expect(resolveRogueExecutionKill(player, "other", 2_000, executor)).toBe(false);
    expect(resolveRogueExecutionKill(player, "target", 2_000, executor)).toBe(true);
    expect(player.skillCooldowns[1]).toBe(4_000);
    expect(player.rogueExecution).toBeNull();

    player.skillCooldowns[1] = 2_050;
    armRogueExecution(player, "target", 2_000, executor);
    expect(resolveRogueExecutionKill(player, "target", 2_050, executor)).toBe(true);
    expect(player.skillCooldowns[1]).toBe(2_050);
    armRogueExecution(player, "late", 3_000, executor);
    expect(expireRogueExecution(player, 5_001)).toBe(true);
  });

  it("applies Smoke Screen protection and consumes one Predator poison boost", () => {
    const smoke = talentEffect("rogue", ["rogue.vanish.smoke_screen"], "rogue_smoke_screen", 3);
    const predator = talentEffect("rogue", ["rogue.vanish.predator"], "rogue_predator", 3);
    if (!smoke || !predator) throw new Error("missing Vanish evolution");

    const protectedRogue = rogue(["rogue.vanish.smoke_screen"]);
    applyRogueSmokeProtection(protectedRogue, 1_000, smoke);
    expect(isPlayerInvulnerable(protectedRogue, 1_749)).toBe(true);
    expect(isPlayerInvulnerable(protectedRogue, 1_750)).toBe(false);

    const hunter = rogue(["rogue.vanish.predator"]);
    armRoguePredatorShiv(hunter, 2_000, predator);
    expect(consumeRoguePredatorShivMultiplier(hunter, 3_999, predator)).toBe(1.5);
    expect(consumeRoguePredatorShivMultiplier(hunter, 3_999, predator)).toBe(1);
  });

  it("makes Poisoned Shiv Rupture consume old poison and add net detonation damage", () => {
    const effect = talentEffect("rogue", ["rogue.poisoned_shiv.rupture"], "rogue_rupture", 4);
    if (!effect) throw new Error("missing Rupture effect");
    const damageOverTime: DamageOverTimeRuntime[] = [];
    const poison = applyDamageOverTime(damageOverTime, {
      kind: "poison",
      sourceId: "rogue",
      sourceSkillId: "poisoned_shiv",
      targetKind: "monster",
      targetId: "boss",
      now: 1_000,
      tickCount: 5,
      tickPower: 6,
      intervalMs: 1_000,
      maxStacks: 1,
    });
    expect(rupturePoisonWithShiv(damageOverTime, "rogue", "boss", effect)).toEqual({
      consumedPower: 18,
      damage: 27,
    });
    expect(damageOverTimeRemainingPower(poison)).toBe(12);
  });

  it("bounds Dark Harvest at the authoritative present even with excessive kills", () => {
    const player = rogue([
      "rogue.shadow_dance.force",
      "rogue.shadow_dance.reach",
      "rogue.shadow_dance.readiness",
      "rogue.shadow_dance.dark_harvest",
    ]);
    const harvest = talentEffect(player.class, player.talents, "rogue_dark_harvest", 5);
    if (!harvest) throw new Error("missing Dark Harvest effect");
    player.skillCooldowns[4] = 12_000;
    expect(reduceRogueShadowDanceCooldown(player, 5_000, 99, harvest)).toBe(5_000);
  });

  it("starts neutral, exposes only local deadlines, and clears every transient window together", () => {
    const player = rogue();
    expect(player).toMatchObject({
      opening: null,
      rogueStealthUntil: 0,
      rogueSmokeProtectionUntil: 0,
      roguePredatorShivUntil: 0,
      rogueShadowDanceInvulnerableUntil: 0,
      rogueShadowReturn: null,
      rogueExecution: null,
      rogueSilhouette: null,
      rogueDanceMarks: [],
    });

    player.opening = { source: "shadow_step", expiresAt: 1_500, bonusRatio: 0.4 };
    player.rogueStealthUntil = 8_000;
    player.rogueSmokeProtectionUntil = 500;
    player.roguePredatorShivUntil = 2_000;
    player.rogueShadowDanceInvulnerableUntil = 1_450;
    player.rogueShadowReturn = { x: 10, y: 12, expiresAt: 2_000 };
    player.rogueExecution = { targetId: "monster", expiresAt: 2_000 };
    expect(isPlayerInvulnerable(player, 1_449)).toBe(true);
    expect(isPlayerInvulnerable(player, 1_450)).toBe(false);
    expect(expireRogueShadowDanceProtection(player, 1_449)).toBe(false);
    expect(expireRogueShadowDanceProtection(player, 1_450)).toBe(true);
    expect(player.rogueShadowDanceInvulnerableUntil).toBe(0);
    player.rogueShadowDanceInvulnerableUntil = 1_450;
    expect(selfState(player).rogue).toEqual({
      openingUntil: 1_500,
      stealthUntil: 8_000,
      smokeProtectionUntil: 500,
      shadowReturnUntil: 2_000,
      danceMarksUntil: 0,
    });

    clearRogueTransientState(player);
    expect(player.rogueShadowDanceInvulnerableUntil).toBe(0);
    expect(selfState(player).rogue).toEqual({
      openingUntil: 0,
      stealthUntil: 0,
      smokeProtectionUntil: 0,
      shadowReturnUntil: 0,
      danceMarksUntil: 0,
    });
  });

  it("never serializes Rogue combat windows into a reconnect profile", () => {
    const player = rogue();
    player.opening = { source: "vanish", expiresAt: 9_000, bonusRatio: 0.4 };
    player.rogueStealthUntil = 8_000;
    player.rogueShadowDanceInvulnerableUntil = 8_450;
    player.rogueShadowReturn = { x: 10, y: 12, expiresAt: 2_000 };
    player.rogueExecution = { targetId: "monster", expiresAt: 2_000 };

    const persisted = toProfile(player);
    const serialized = JSON.stringify(persisted);
    expect(serialized).not.toContain("opening");
    expect(serialized).not.toContain("rogueStealth");
    expect(serialized).not.toContain("rogueShadowDance");
    expect(serialized).not.toContain("rogueShadowReturn");
    expect(serialized).not.toContain("rogueExecution");
    expect(newPlayer(persisted, "reconnected", player.roomKey).opening).toBeNull();
  });
});
