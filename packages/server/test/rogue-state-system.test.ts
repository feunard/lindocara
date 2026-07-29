import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { isPlayerInvulnerable } from "@lindocara/server/world/combat-system.js";
import {
  activeRogueOpening,
  clearRogueTransientState,
  consumeRogueOpening,
  enterRogueStealth,
  exitRogueStealth,
  expireRogueOpening,
  expireRogueShadowDanceProtection,
  expireRogueStealth,
  grantRogueOpening,
  isRogueStealthed,
} from "@lindocara/server/world/rogue-state-system.js";
import { selfState } from "@lindocara/server/world/snapshot-system.js";
import { newPlayer, toProfile } from "@lindocara/server/world/world-runtime.js";
import { describe, expect, it } from "vitest";

function rogue() {
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
    },
    "rogue-connection",
    "verdant-reach:main",
  );
}

describe("hidden Rogue runtime contract", () => {
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

  it("starts neutral, exposes only local deadlines, and clears every transient window together", () => {
    const player = rogue();
    expect(player).toMatchObject({
      opening: null,
      rogueStealthUntil: 0,
      rogueSmokeProtectionUntil: 0,
      roguePredatorShivUntil: 0,
      rogueShadowDanceInvulnerableUntil: 0,
      rogueShadowReturn: null,
    });

    player.opening = { source: "shadow_step", expiresAt: 1_500, bonusRatio: 0.4 };
    player.rogueStealthUntil = 8_000;
    player.rogueSmokeProtectionUntil = 500;
    player.roguePredatorShivUntil = 2_000;
    player.rogueShadowDanceInvulnerableUntil = 1_450;
    player.rogueShadowReturn = { x: 10, y: 12, expiresAt: 2_000 };
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
    });

    clearRogueTransientState(player);
    expect(player.rogueShadowDanceInvulnerableUntil).toBe(0);
    expect(selfState(player).rogue).toEqual({
      openingUntil: 0,
      stealthUntil: 0,
      smokeProtectionUntil: 0,
      shadowReturnUntil: 0,
    });
  });

  it("never serializes Rogue combat windows into a reconnect profile", () => {
    const player = rogue();
    player.opening = { source: "vanish", expiresAt: 9_000, bonusRatio: 0.4 };
    player.rogueStealthUntil = 8_000;
    player.rogueShadowDanceInvulnerableUntil = 8_450;
    player.rogueShadowReturn = { x: 10, y: 12, expiresAt: 2_000 };

    const persisted = toProfile(player);
    const serialized = JSON.stringify(persisted);
    expect(serialized).not.toContain("opening");
    expect(serialized).not.toContain("rogueStealth");
    expect(serialized).not.toContain("rogueShadowDance");
    expect(serialized).not.toContain("rogueShadowReturn");
    expect(newPlayer(persisted, "reconnected", player.roomKey).opening).toBeNull();
  });
});
