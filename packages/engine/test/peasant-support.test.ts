import {
  canAffordPeasantSupportSkill,
  PEASANT_SUPPORT_SKILLS,
  peasantSupportSkill,
} from "@lindocara/engine/peasant-support.js";
import { CLASS_SKILLS } from "@lindocara/engine/skills.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { describe, expect, it } from "vitest";

describe("Peasant support contract", () => {
  it("centralizes ration, camp and bomb costs and effect parameters", () => {
    expect(PEASANT_SUPPORT_SKILLS).toEqual({
      3: {
        id: "butchers_cut",
        slot: 3,
        cost: { meat: 3 },
        radius: 20,
        durationMs: 30_000,
        power: 10,
      },
      4: {
        id: "makeshift_camp",
        slot: 4,
        cost: { wood: 1, stone: 1, meat: 1 },
        radius: 10,
        durationMs: 30_000,
        power: 60,
      },
      5: {
        id: "homemade_bomb",
        slot: 5,
        cost: { stone: 2 },
        radius: 110 / TILE_SIZE,
        durationMs: 650,
        power: 85,
      },
    });
  });

  it("keeps the class skill definitions sourced from the support contract", () => {
    for (const slot of [3, 4, 5] as const) {
      const skill = CLASS_SKILLS.peasant[slot - 1];
      const support = PEASANT_SUPPORT_SKILLS[slot];
      expect(skill).toMatchObject({
        id: support.id,
        slot,
        radius: support.radius,
        durationMs: support.durationMs,
        power: support.power,
      });
    }
  });

  it("reports affordability at exact thresholds without mutating authoritative stock", () => {
    const exactCamp = { wood: 1, stone: 1, meat: 1 };
    const exactBomb = { wood: 0, stone: 2, meat: 0 };
    expect(canAffordPeasantSupportSkill({ ...exactCamp, meat: 3 }, 3)).toBe(true);
    expect(canAffordPeasantSupportSkill({ ...exactCamp, meat: 2 }, 3)).toBe(false);
    expect(canAffordPeasantSupportSkill(exactCamp, 4)).toBe(true);
    expect(canAffordPeasantSupportSkill({ ...exactCamp, meat: 0 }, 4)).toBe(false);
    expect(canAffordPeasantSupportSkill(exactBomb, 5)).toBe(true);
    expect(canAffordPeasantSupportSkill({ ...exactBomb, stone: 1 }, 5)).toBe(false);
    expect(exactCamp).toEqual({ wood: 1, stone: 1, meat: 1 });
  });

  it("rejects missing snapshots and non-support slots", () => {
    expect(canAffordPeasantSupportSkill(undefined, 4)).toBe(false);
    expect(peasantSupportSkill(2)).toBeNull();
    expect(peasantSupportSkill(3)?.id).toBe("butchers_cut");
    expect(peasantSupportSkill(4)?.id).toBe("makeshift_camp");
    expect(peasantSupportSkill(5)?.id).toBe("homemade_bomb");
  });
});
