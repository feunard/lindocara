import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { clearRogueTransientState } from "@lindocara/server/world/rogue-state-system.js";
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
  it("starts neutral, exposes only local deadlines, and clears every transient window together", () => {
    const player = rogue();
    expect(player).toMatchObject({
      opening: null,
      rogueStealthUntil: 0,
      rogueSmokeProtectionUntil: 0,
      roguePredatorShivUntil: 0,
      rogueShadowReturn: null,
    });

    player.opening = { source: "shadow_step", expiresAt: 1_500, bonusRatio: 0.4 };
    player.rogueStealthUntil = 8_000;
    player.rogueSmokeProtectionUntil = 500;
    player.roguePredatorShivUntil = 2_000;
    player.rogueShadowReturn = { x: 10, y: 12, expiresAt: 2_000 };
    expect(selfState(player).rogue).toEqual({
      openingUntil: 1_500,
      stealthUntil: 8_000,
      smokeProtectionUntil: 500,
      shadowReturnUntil: 2_000,
    });

    clearRogueTransientState(player);
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
    player.rogueShadowReturn = { x: 10, y: 12, expiresAt: 2_000 };

    const persisted = toProfile(player);
    const serialized = JSON.stringify(persisted);
    expect(serialized).not.toContain("opening");
    expect(serialized).not.toContain("rogueStealth");
    expect(serialized).not.toContain("rogueShadowReturn");
    expect(newPlayer(persisted, "reconnected", player.roomKey).opening).toBeNull();
  });
});
