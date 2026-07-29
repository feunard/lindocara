import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { talentEffect } from "@lindocara/engine/talents.js";
import {
  advanceSanctuaries,
  applyCleanseableNegativeEffect,
  cleanseNegativeEffect,
  emergencyMendPower,
  novaSpecializationMultipliers,
  type SanctuaryRuntime,
  sacredPassageTargets,
  startSanctuary,
} from "@lindocara/server/world/priest-variant-system.js";
import { newPlayer, type PlayerRuntime, toProfile } from "@lindocara/server/world/world-runtime.js";
import { describe, expect, it, vi } from "vitest";

function priest(id = "priest"): PlayerRuntime {
  return newPlayer(
    {
      id,
      nick: id,
      x: 0,
      y: 0,
      level: 10,
      xp: 0,
      hp: 100,
      appearance: { body: "wayfarer", primaryColor: "azure" },
      class: "priest",
      equipment: starterEquipmentFor("priest"),
      inventory: { potions: 0, gold: 0, crystals: 0 },
      quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
      zoneId: "verdant-reach",
      instanceId: "main",
      sessionEpoch: 1,
      wardRunExpiresAt: null,
      life: "alive",
      corpse: null,
    },
    `${id}-connection`,
    "verdant-reach:main",
  );
}

describe("authoritative priest evolution systems", () => {
  it("amplifies Secours d'urgence only at or below the bounded health threshold", () => {
    const effect = talentEffect("priest", ["priest.mend.emergency"], "emergency_mend", 2);
    if (!effect) throw new Error("missing Emergency Aid effect");
    expect(emergencyMendPower(40, 30, 100, effect)).toBe(70);
    expect(emergencyMendPower(40, 31, 100, effect)).toBe(40);
  });

  it("heals each crossed Passage sacré ally once and none without a real path crossing", () => {
    const healedIds = new Set<string>();
    const targets = [{ id: "z" }, { id: "blocked" }, { id: "a" }];
    const crossed = sacredPassageTargets(targets, healedIds, (target) => target.id !== "blocked");
    expect(crossed.map((target) => target.id)).toEqual(["a", "z"]);
    expect(sacredPassageTargets(targets, healedIds, () => true)).toEqual([{ id: "blocked" }]);
    expect(sacredPassageTargets(targets, healedIds, () => true)).toEqual([]);
    expect(sacredPassageTargets([{ id: "still" }], new Set(), () => false)).toEqual([]);
  });

  it("keeps Sanctuaire vivant fixed and advances exactly three server-tick heals", () => {
    const effect = talentEffect("priest", ["priest.prayer.mastery"], "sanctuary", 4);
    if (!effect) throw new Error("missing Living Sanctuary effect");
    const sanctuaries: SanctuaryRuntime[] = [];
    const sanctuary = startSanctuary(sanctuaries, {
      ownerId: "priest",
      x: 40,
      y: 80,
      radius: 120,
      power: 32,
      effect,
      now: 1_000,
    });
    const tick = vi.fn();
    advanceSanctuaries(sanctuaries, 1_999, () => true, tick);
    advanceSanctuaries(sanctuaries, 4_000, () => true, tick);
    advanceSanctuaries(sanctuaries, 5_000, () => true, tick);

    expect(tick).toHaveBeenCalledTimes(3);
    expect(tick.mock.calls.every((call) => call[0] === sanctuary)).toBe(true);
    expect(sanctuary).toMatchObject({ x: 40, y: 80, radius: 120 });
    expect(sanctuaries).toEqual([]);
  });

  it("limits Absolution to the supported poison effect and never persists it", () => {
    const target = priest("poisoned");
    applyCleanseableNegativeEffect(target, {
      kind: "poison",
      sourceId: "rogue",
      expiresAt: 9_000,
    });
    expect(cleanseNegativeEffect(target, "poison")).toBe(true);
    expect(cleanseNegativeEffect(target, "poison")).toBe(false);
    applyCleanseableNegativeEffect(target, {
      kind: "poison",
      sourceId: "rogue",
      expiresAt: 9_000,
    });

    const persisted = toProfile(target);
    expect(JSON.stringify(persisted)).not.toContain("negativeEffects");
    expect(newPlayer(persisted, "fresh-connection", target.roomKey).negativeEffects.size).toBe(0);
  });

  it("makes Jugement and Miséricorde exact opposite Nova specializations", () => {
    const judgment = talentEffect("priest", ["priest.divine_nova.mastery"], "nova_judgment", 5);
    const mercy = talentEffect("priest", ["priest.divine_nova.mercy"], "nova_mercy", 5);
    expect(novaSpecializationMultipliers(judgment, undefined)).toEqual({
      damage: 1.4,
      healing: 0.6,
    });
    expect(novaSpecializationMultipliers(undefined, mercy)).toEqual({
      damage: 0.6,
      healing: 1.4,
    });
    expect(novaSpecializationMultipliers(undefined, undefined)).toEqual({
      damage: 1,
      healing: 1,
    });
  });
});
