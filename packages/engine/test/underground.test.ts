import { createTerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import {
  parseUnderground,
  undergroundColliders,
  undergroundFloorHeight,
  undergroundRamp,
} from "@lindocara/engine/underground.js";
import { describe, expect, it } from "vitest";

const underground = {
  levels: [
    { depth: 1, style: "cave" as const, cells: [{ col: 2, row: 2, length: 4 }] },
    { depth: 2, style: "castle" as const, cells: [{ col: 2, row: 2, length: 4 }] },
  ],
  stairs: [
    { depth: 1, col: 2, row: 2, direction: "east" as const, length: 3, width: 1 },
    { depth: 2, col: 2, row: 2, direction: "west" as const, length: 3, width: 1 },
  ],
};

describe("multi-storey underground", () => {
  it("strictly validates depths, runs and stair footprints", () => {
    expect(parseUnderground(underground, 8)).toEqual(underground);
    expect(
      parseUnderground({ ...underground, levels: [{ ...underground.levels[0], depth: 17 }] }, 8),
    ).toBeNull();
    expect(
      parseUnderground({ ...underground, stairs: [{ ...underground.stairs[0], col: 7 }] }, 8),
    ).toBeNull();
  });

  it("keeps surface terrain above a reachable underground floor", () => {
    const platforms = undergroundColliders(underground, 8);
    const query = createTerrainQuery({
      size: 8,
      levelHeight: 0.9,
      waterLevel: -0.05,
      at: () => 0,
      kindAt: () => "herbe",
      ramps: underground.stairs.map((stair) => undergroundRamp(stair, 8)),
      platforms,
    });
    const x = 5.5 - 4;
    const z = 2.5 - 4;
    expect(query.surfaceAt?.(x, z, 0.02)).toBeCloseTo(0);
    expect(query.surfaceAt?.(x, z, undergroundFloorHeight(1) + 0.02)).toBeCloseTo(
      undergroundFloorHeight(1),
    );
    expect(query.surfaceAt?.(x, z, undergroundFloorHeight(2) + 0.02)).toBeCloseTo(
      undergroundFloorHeight(2),
    );
  });

  it("samples a continuous 2.4-unit stair instead of one terrain tier", () => {
    const stair = underground.stairs[0];
    if (!stair) throw new Error("fixture stair missing");
    const ramp = undergroundRamp(stair, 8);
    const query = createTerrainQuery({
      size: 8,
      levelHeight: 0.9,
      waterLevel: -0.05,
      at: () => 0,
      kindAt: () => "herbe",
      ramps: [ramp],
    });
    expect(query.rampAt(ramp.x, ramp.z)?.height).toBeCloseTo(undergroundFloorHeight(1));
    expect(query.rampAt(ramp.x + ramp.width / 2, ramp.z)?.height).toBeCloseTo(-1.2);
    expect(query.rampAt(ramp.x + ramp.width, ramp.z)?.height).toBeCloseTo(0);
  });
});
