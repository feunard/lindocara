import { clientCooldownDeadlines } from "@lindocara/client/game/cooldown-sync.js";
import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { emptyCombatCooldowns, normalizeCombatCooldowns } from "@lindocara/engine/cooldowns.js";
import { ServerClock } from "@lindocara/renderer/server-clock.js";
import { combatCooldownsFromPlayer, newPlayer } from "@lindocara/server/world/world-runtime.js";
import { describe, expect, it } from "vitest";

const NOW = 1_000_000;

function profile() {
  return {
    id: "cooldown-player",
    nick: "Mira",
    x: 100,
    y: 100,
    level: 10,
    xp: 0,
    hp: 100,
    appearance: { body: "wayfarer" as const, primaryColor: "azure" as const },
    class: "priest" as const,
    equipment: starterEquipmentFor("priest"),
    inventory: { potions: 2, gold: 0, crystals: 0 },
    quest: {
      chapter: "three_offerings" as const,
      status: "available" as const,
      progress: 0,
      target: 3,
    },
    zoneId: "verdant-reach",
    instanceId: "main",
    sessionEpoch: 1,
    wardRunExpiresAt: null,
    life: "alive" as const,
    corpse: null,
  };
}

describe("authoritative combat cooldown state", () => {
  it("drops expired, negative, non-finite and implausibly-future durable values", () => {
    expect(
      normalizeCombatCooldowns(
        {
          attackUntil: NOW - 1,
          healUntil: Number.POSITIVE_INFINITY,
          skillCooldowns: [NOW + 326, -1, Number.NaN, NOW + 60_000, NOW + 10_001],
          guardUntil: NOW + 3_501,
          resurrectUntil: NOW + 20_001,
        },
        NOW,
      ),
    ).toEqual(emptyCombatCooldowns());
  });

  it("restores the same remaining time and converts it to the browser monotonic clock", () => {
    const state = normalizeCombatCooldowns(
      {
        attackUntil: NOW + 300,
        healUntil: NOW + 1_250,
        skillCooldowns: [0, 0, 0, 0, NOW + 10_000],
        guardUntil: 0,
        resurrectUntil: NOW + 19_000,
      },
      NOW,
    );
    const clock = new ServerClock();
    clock.sample(NOW + 250, 40_000);
    const local = clientCooldownDeadlines(state, clock);
    expect(local.attackUntil).toBe(40_050);
    expect(local.healUntil).toBe(41_000);
    expect(local.skills[5]).toBe(49_750);

    clock.sample(NOW + 500, 40_400);
    const refreshed = clientCooldownDeadlines(
      {
        ...state,
        attackUntil: NOW + 800,
        skillCooldowns: [0, NOW + 2_000, 0, 0, NOW + 10_000],
      },
      clock,
    );
    expect(refreshed.attackUntil).toBe(40_700);
    expect(refreshed.skills[2]).toBe(41_900);
    expect(refreshed.skills[5]).toBe(49_900);
  });

  it("gives new characters available skills and restores a ten-second skill deadline", () => {
    const fresh = newPlayer(
      profile(),
      "fresh-connection",
      "verdant-reach:main",
      0,
      0,
      undefined,
      undefined,
      NOW,
    );
    expect(combatCooldownsFromPlayer(fresh, NOW)).toEqual(emptyCombatCooldowns());

    const restored = newPlayer(
      profile(),
      "restored-connection",
      "verdant-reach:main",
      0,
      0,
      undefined,
      {
        ...emptyCombatCooldowns(),
        skillCooldowns: [0, 0, 0, 0, NOW + 10_000],
      },
      NOW,
    );
    expect(restored.skillCooldowns[4]).toBe(NOW + 10_000);
    expect(combatCooldownsFromPlayer(restored, NOW + 250).skillCooldowns[4]).toBe(NOW + 10_000);
  });
});
