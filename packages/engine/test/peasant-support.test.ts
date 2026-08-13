import {
  canAffordPeasantSupportSkill,
  PEASANT_SUPPORT_SKILLS,
  peasantSupportSkill,
} from "@lindocara/engine/peasant-support.js";
import { CLASS_SKILLS } from "@lindocara/engine/skills.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { describe, expect, it } from "vitest";

describe("Peasant support contract", () => {
  it("centralizes modest camp and bomb costs and effect parameters", () => {
    expect(PEASANT_SUPPORT_SKILLS).toEqual({
      4: {
        id: "makeshift_camp",
        slot: 4,
        cost: { wood: 1, stone: 1, meat: 1 },
        radius: 96 / TILE_SIZE,
        durationMs: 30_000,
        power: 60,
      },
      5: {
        id: "homemade_bomb",
        slot: 5,
        cost: { iron: 1, stone: 1 },
        radius: 110 / TILE_SIZE,
        durationMs: 650,
        power: 85,
      },
    });
  });

  it("keeps the class skill definitions sourced from the support contract", () => {
    for (const slot of [4, 5] as const) {
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
    const exactCamp = { wood: 1, stone: 1, iron: 0, meat: 1 };
    const exactBomb = { wood: 0, stone: 1, iron: 1, meat: 0 };
    expect(canAffordPeasantSupportSkill(exactCamp, 4)).toBe(true);
    expect(canAffordPeasantSupportSkill({ ...exactCamp, meat: 0 }, 4)).toBe(false);
    expect(canAffordPeasantSupportSkill(exactBomb, 5)).toBe(true);
    expect(canAffordPeasantSupportSkill({ ...exactBomb, iron: 0 }, 5)).toBe(false);
    expect(exactCamp).toEqual({ wood: 1, stone: 1, iron: 0, meat: 1 });
  });

  it("rejects missing snapshots and non-support slots", () => {
    expect(canAffordPeasantSupportSkill(undefined, 4)).toBe(false);
    expect(peasantSupportSkill(3)).toBeNull();
    expect(peasantSupportSkill(4)?.id).toBe("makeshift_camp");
    expect(peasantSupportSkill(5)?.id).toBe("homemade_bomb");
  });
});
