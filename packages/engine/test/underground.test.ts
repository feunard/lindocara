import { createHeroState } from "@lindocara/engine/hd2d/hero-state.js";
import { stepHero } from "@lindocara/engine/hd2d/hero-step.js";
import { createTerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import {
  MAX_UNDERGROUND_DEPTH,
  parseUnderground,
  undergroundColliders,
  undergroundDepthAtElevation,
  undergroundFloorHeight,
  undergroundRamp,
  undergroundStairMouth,
} from "@lindocara/engine/underground.js";
import { describe, expect, it } from "vitest";

import { createColliderIndex } from "../src/hd2d/collider-index.js";
import { depsPlates } from "./hd2d/helpers/step-deps.js";

const immobile = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false };

const underground = {
  levels: [
    { depth: 1, style: "cave" as const, cells: [{ col: 2, row: 2, length: 4 }] },
    { depth: 2, style: "castle" as const, cells: [{ col: 2, row: 2, length: 4 }] },
  ],
  stairs: [
    { depth: 1, col: 2, row: 2, direction: "east" as const, length: 3, width: 1 },
    { depth: 2, col: 2, row: 2, direction: "west" as const, length: 3, width: 1 },
  ],
  shafts: [{ col: 6, row: 5, width: 1, length: 2, depth: 2 }],
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

  it("makes a direct shaft dry, removes its surface support and keeps its bottom floor", () => {
    const shaftUnderground = {
      ...underground,
      levels: underground.levels.map((level) => ({
        ...level,
        cells: [...level.cells, { col: 6, row: 5, length: 1 }],
      })),
    };
    const platforms = undergroundColliders(shaftUnderground, 8);
    const query = createTerrainQuery({
      size: 8,
      levelHeight: 0.9,
      waterLevel: -0.05,
      at: () => 0,
      kindAt: () => "herbe",
      voidAt: (col, row) => col === 6 && (row === 5 || row === 6),
      platforms,
    });
    const x = 6.5 - 4;
    const z = 5.5 - 4;
    expect(query.heightAt(x, z)).toBeNull();
    expect(query.liquidAt(x, z)).toBeNull();
    expect(query.surfaceAt?.(x, z, 0.02)).toBeCloseTo(undergroundFloorHeight(2));
  });

  it("keeps authored water above an excavation and underground collision below the surface", () => {
    const platforms = undergroundColliders(underground, 8);
    const query = createTerrainQuery({
      size: 8,
      levelHeight: 0.9,
      waterLevel: -0.05,
      at: () => null,
      kindAt: () => null,
      liquidAt: () => "water",
      liquidLevelAt: () => 0,
      voidAt: () => true,
      platforms,
    });
    const x = 5.5 - 4;
    const z = 2.5 - 4;
    expect(query.heightAt(x, z)).toBeNull();
    expect(query.liquidAt(x, z)).toBe("water");

    const colliders = createColliderIndex();
    for (const collider of platforms) colliders.add(collider);
    expect(colliders.blocked(x, 2 - 4, 0.2, -0.05)).toBe(false);
    expect(colliders.blocked(x, 2 - 4, 0.2, -0.4)).toBe(true);

    const state = createHeroState(x, z, -0.05, 10, 2.2);
    const deps = { ...depsPlates(), query, colliders };
    stepHero(state, immobile, 1 / 60, deps);
    expect(state.swimming).toBe(true);
    expect(state.y).toBeCloseTo(0);
  });

  it("opens the visual and collision wall at both ends of a stair flight", () => {
    expect(undergroundStairMouth(underground.stairs, 1, 2, 2, -1, 0)).toBe(true);
    expect(undergroundStairMouth(underground.stairs, 1, 4, 2, 1, 0)).toBe(true);
    expect(undergroundStairMouth(underground.stairs, 1, 3, 2, 0, -1)).toBe(false);
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

  it("falls continuously through every elevation down to depth 16", () => {
    const deep = {
      levels: Array.from({ length: MAX_UNDERGROUND_DEPTH }, (_unused, index) => ({
        depth: index + 1,
        style: "cave" as const,
        cells: [
          { col: 2, row: 2, length: 3 },
          { col: 2, row: 3, length: 3 },
          { col: 2, row: 4, length: 3 },
        ],
      })),
      stairs: [],
      shafts: [{ col: 3, row: 3, width: 1, length: 1, depth: MAX_UNDERGROUND_DEPTH }],
    };
    const platforms = undergroundColliders(deep, 8);
    const query = createTerrainQuery({
      size: 8,
      levelHeight: 0.9,
      waterLevel: -0.05,
      at: () => 0,
      kindAt: () => "herbe",
      voidAt: (col, row) => col === 3 && row === 3,
      platforms,
    });
    const colliders = createColliderIndex();
    for (const collider of platforms) colliders.add(collider);
    // HeroState.z is the sprite anchor; collision is offset 0.35 toward its feet.
    const state = createHeroState(-0.5, -0.15, 0, 10, 2.2);
    const deps = { ...depsPlates(), query, colliders };
    const elevations = [state.y];
    for (let frame = 0; frame < 600 && !(!state.airborne && state.y < -1); frame += 1) {
      stepHero(state, immobile, 1 / 60, deps);
      elevations.push(state.y);
    }

    expect(state.airborne).toBe(false);
    expect(state.y).toBeCloseTo(undergroundFloorHeight(MAX_UNDERGROUND_DEPTH));
    expect(elevations.some((elevation) => elevation < -8 && elevation > -9)).toBe(true);
    expect(elevations.some((elevation) => elevation < -20 && elevation > -21)).toBe(true);
    expect(
      Math.max(
        ...elevations.slice(1).map((elevation, index) => Math.abs(elevation - elevations[index])),
      ),
    ).toBeLessThan(1);
    expect(undergroundDepthAtElevation(state.y)).toBe(MAX_UNDERGROUND_DEPTH);
  });
});
