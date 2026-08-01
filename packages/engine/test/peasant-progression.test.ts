import { xpForNextLevel } from "@lindocara/engine/game.js";
import type { HarvestResourceKind } from "@lindocara/engine/harvest.js";
import {
  PEASANT_HARVEST_EXPERIENCE_BASIS_POINTS,
  peasantHarvestExperience,
} from "@lindocara/engine/peasant.js";
import { describe, expect, it } from "vitest";

describe("Peasant harvest progression", () => {
  it("awards a typed resource-specific share of the current level threshold", () => {
    expect(PEASANT_HARVEST_EXPERIENCE_BASIS_POINTS).toEqual({
      wood: 300,
      stone: 400,
      iron: 600,
      gold: 800,
      meat: 500,
    });
    expect(
      Object.fromEntries(
        (Object.keys(PEASANT_HARVEST_EXPERIENCE_BASIS_POINTS) as HarvestResourceKind[]).map(
          (resource) => [resource, peasantHarvestExperience(resource, 1)],
        ),
      ),
    ).toEqual({ wood: 3, stone: 4, iron: 6, gold: 8, meat: 5 });
    expect(
      Object.fromEntries(
        (Object.keys(PEASANT_HARVEST_EXPERIENCE_BASIS_POINTS) as HarvestResourceKind[]).map(
          (resource) => [resource, peasantHarvestExperience(resource, 10)],
        ),
      ),
    ).toEqual({ wood: 19, stone: 26, iron: 38, gold: 51, meat: 32 });
  });

  it("keeps harvesting relevant as the level threshold grows", () => {
    for (const resource of Object.keys(
      PEASANT_HARVEST_EXPERIENCE_BASIS_POINTS,
    ) as HarvestResourceKind[]) {
      expect(peasantHarvestExperience(resource, 20)).toBeGreaterThan(
        peasantHarvestExperience(resource, 1),
      );
      expect(peasantHarvestExperience(resource, 20)).toBe(
        Math.round(
          (xpForNextLevel(20) * PEASANT_HARVEST_EXPERIENCE_BASIS_POINTS[resource]) / 10_000,
        ),
      );
    }
    expect(peasantHarvestExperience("wood", 0)).toBe(peasantHarvestExperience("wood", 1));
  });
});
