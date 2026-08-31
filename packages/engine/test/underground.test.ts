import { createHeroState } from "@lindocara/engine/hd2d/hero-state.js";
import { stepHero } from "@lindocara/engine/hd2d/hero-step.js";
import { createTerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import {
  canStand,
  groundUnder,
  withWorldEventColliders,
  worldEventColliderRect,
} from "@lindocara/engine/terrain-access.js";
import {
  MAX_UNDERGROUND_DEPTH,
  parseUnderground,
  undergroundAccessVisibleDepths,
  undergroundColliders,
  undergroundDepthAtElevation,
  undergroundFloorHeight,
  undergroundRamp,
  undergroundShaftCell,
  undergroundStairMouth,
  undergroundSurfaceOpenings,
  undergroundTerrainElevationCells,
  undergroundTerrainHeightAt,
  undergroundTransitionAt,
  undergroundVisibleDepthsAtElevation,
  withUndergroundStairSideColliders,
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
    expect(
      parseUnderground(
        { ...underground, stairs: [{ ...underground.stairs[0], fromDepth: 2, depth: 2 }] },
        8,
      ),
    ).toBeNull();
  });

  it("round-trips the single safe raised tier and rejects ceiling-blocking terrain", () => {
    const first = underground.levels[0];
    const second = underground.levels[1];
    if (!first || !second) throw new Error("underground fixture is incomplete");
    const raised = {
      ...underground,
      levels: [
        {
          ...first,
          terrain: [
            { col: 2, row: 2, length: 2, material: "volcan" as const, elevation: 1 as const },
          ],
        },
        second,
      ],
    };
    expect(parseUnderground(raised, 8)).toEqual(raised);
    expect(undergroundTerrainElevationCells(raised.levels[0], 8)[2 * 8 + 3]).toBe(1);
    expect(undergroundTerrainHeightAt(raised, 1, 3, 2, 0.9)).toBeCloseTo(-1.5);
    expect(
      parseUnderground(
        {
          ...raised,
          levels: [
            {
              ...raised.levels[0],
              terrain: [{ col: 2, row: 2, length: 2, material: "volcan", elevation: 2 }],
            },
          ],
        },
        8,
      ),
    ).toBeNull();
  });

  it("connects an explicit surface departure to any authored destination depth", () => {
    const stair = {
      depth: 16,
      fromDepth: 0,
      col: 2,
      row: 2,
      direction: "east" as const,
      length: 4,
      width: 1,
    };
    const parsed = parseUnderground(
      {
        levels: Array.from({ length: 16 }, (_unused, index) => ({
          depth: index + 1,
          style: "cave" as const,
          cells: [{ col: 2, row: 2, length: 4 }],
        })),
        stairs: [stair],
        shafts: [],
      },
      8,
    );
    expect(parsed?.stairs).toEqual([stair]);
    expect(undergroundRamp(stair, 8)).toMatchObject({
      lowHeight: undergroundFloorHeight(16),
      highHeight: 0,
    });
    expect(undergroundAccessVisibleDepths(parsed ?? undefined, null)).toEqual(
      Array.from({ length: 16 }, (_unused, index) => index + 1),
    );
    expect(undergroundAccessVisibleDepths(parsed ?? undefined, 8)).toEqual(
      Array.from({ length: 9 }, (_unused, index) => index + 8),
    );
  });

  it("keeps a basement-to-basement shaft closed at the surface", () => {
    const lowerShaft = {
      ...underground,
      stairs: [],
      shafts: [{ col: 6, row: 5, width: 1, length: 1, fromDepth: 1, depth: 2 }],
    };
    expect(parseUnderground(lowerShaft, 8)).toEqual(lowerShaft);
    expect(
      parseUnderground({ ...lowerShaft, shafts: [{ ...lowerShaft.shafts[0], fromDepth: 2 }] }, 8),
    ).toBeNull();
    expect(undergroundSurfaceOpenings(lowerShaft, 8)[5 * 8 + 6]).toBe(0);
    expect(undergroundShaftCell(lowerShaft.shafts, 6, 5, 1)).toBe(false);
    expect(undergroundShaftCell(lowerShaft.shafts, 6, 5, 2)).toBe(true);
    expect(undergroundShaftCell(lowerShaft.shafts, 6, 5, 3)).toBe(false);
    expect(undergroundAccessVisibleDepths(lowerShaft, null)).toEqual([]);
    expect(undergroundAccessVisibleDepths(lowerShaft, 1)).toEqual([1, 2]);
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

  it("keeps the ground floor and an upper floor independently solid at the same cell", () => {
    const upper = {
      levels: [
        {
          depth: -1,
          style: "timber" as const,
          cells: [{ col: 2, row: 2, length: 3 }],
        },
      ],
      stairs: [],
    };
    const platforms = undergroundColliders(upper, 8);
    const query = createTerrainQuery({
      size: 8,
      levelHeight: 0.9,
      waterLevel: -0.05,
      at: () => 0,
      kindAt: () => "herbe",
      platforms,
    });
    const colliders = createColliderIndex();
    for (const collider of platforms) colliders.add(collider);
    const x = 3.5 - 4;
    const z = 2.5 - 4;

    expect(query.surfaceAt?.(x, z, 0.02)).toBeCloseTo(0);
    expect(query.surfaceAt?.(x, z, undergroundFloorHeight(-1) + 0.02)).toBeCloseTo(
      undergroundFloorHeight(-1),
    );
    const groundHero = createHeroState(x, z + 0.35, 0, 10, 2.2);
    const upperHero = createHeroState(x, z + 0.35, undergroundFloorHeight(-1), 10, 2.2);
    stepHero(groundHero, immobile, 1 / 60, { ...depsPlates(), query, colliders });
    stepHero(upperHero, immobile, 1 / 60, { ...depsPlates(), query, colliders });
    expect(groundHero.y).toBeCloseTo(0);
    expect(upperHero.y).toBeCloseTo(undergroundFloorHeight(-1));
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

  it("lets an underground floor extend beneath surface water", () => {
    const platforms = undergroundColliders(underground, 8);
    const query = createTerrainQuery({
      size: 8,
      levelHeight: 0.9,
      waterLevel: -0.05,
      at: () => null,
      kindAt: () => null,
      liquidAt: () => "water",
      liquidAtElevation: (_col, _row, elevation) => (elevation < -0.6 ? null : "water"),
      platforms,
    });
    const colliders = createColliderIndex();
    for (const collider of platforms) colliders.add(collider);
    const floorY = undergroundFloorHeight(1);
    const terrain = { query, colliders, size: 8, levelHeight: 0.9, waterLevel: -0.05 };

    expect(query.surfaceAt?.(1.5, -1.5, floorY + 0.02)).toBeCloseTo(floorY);
    expect(canStand(terrain, 1.5, -1.5, 0.2, floorY)).toBe(true);
    expect(canStand(terrain, 1.5, -1.5, 0.2, 0)).toBe(false);
    expect(groundUnder(terrain, 1.5, -1.5)).toBeCloseTo(-0.05);
  });

  it("keeps an elevated liquid as the entry surface above a basement", () => {
    const platforms = undergroundColliders(underground, 8);
    const query = createTerrainQuery({
      size: 8,
      levelHeight: 0.9,
      waterLevel: -0.05,
      at: () => null,
      kindAt: () => null,
      liquidAt: () => "water",
      liquidLevelAt: () => 3,
      liquidAtElevation: (_col, _row, elevation) => (elevation < -0.6 ? null : "water"),
      platforms,
    });
    const colliders = createColliderIndex();
    for (const collider of platforms) colliders.add(collider);
    const terrain = { query, colliders, size: 8, levelHeight: 0.9, waterLevel: -0.05 };

    expect(groundUnder(terrain, 1.5, -1.5)).toBeCloseTo(2.7);
    const state = createHeroState(1.5, -1.15, 3.5, 10, 2.2);
    state.airborne = true;
    for (let index = 0; index < 120 && !state.swimming; index += 1) {
      stepHero(state, immobile, 1 / 60, { ...depsPlates(), query, colliders });
    }
    expect(state.swimming).toBe(true);
    expect(state.y).toBeCloseTo(2.7);
  });

  it("enters elevated water from its bank without falling toward the sea below", () => {
    const platforms = undergroundColliders(
      {
        levels: [{ depth: 1, style: "cave" as const, cells: [{ col: 2, row: 3, length: 4 }] }],
        stairs: [],
        shafts: [],
      },
      8,
    );
    const query = createTerrainQuery({
      size: 8,
      levelHeight: 0.9,
      waterLevel: -0.05,
      at: (_col, row) => (row === 3 ? null : 3),
      kindAt: (_col, row) => (row === 3 ? null : "herbe"),
      liquidAt: (_col, row) => (row === 3 ? "water" : null),
      liquidLevelAt: (_col, row) => (row === 3 ? 3 : null),
      liquidAtElevation: (_col, row, elevation) =>
        elevation >= -0.6 && row === 3 ? "water" : null,
      platforms,
    });
    const colliders = createColliderIndex();
    for (const collider of platforms) colliders.add(collider);

    // The collision footprint has crossed into row 3 while the sprite centre is still over the
    // dry bank in row 4. Both liquid detection and surface lookup must sample that same point.
    const state = createHeroState(0.5, 0.2, 2.7, 10, 2.2);
    const minimumY = state.y;
    stepHero(state, immobile, 1 / 60, { ...depsPlates(), query, colliders });

    expect(state.swimming).toBe(true);
    expect(state.y).toBeCloseTo(2.7);
    expect(state.y).toBeGreaterThanOrEqual(minimumY);
  });

  it("ignores elevated surface terrain and lava while walking on the storey below", () => {
    const platforms = undergroundColliders(underground, 8);
    const query = createTerrainQuery({
      size: 8,
      levelHeight: 0.9,
      waterLevel: -0.05,
      at: () => 3,
      kindAt: () => "lave",
      liquidAt: () => "lava",
      liquidAtElevation: (_col, _row, elevation) => (elevation < -0.6 ? null : "lava"),
      platforms,
    });
    const colliders = createColliderIndex();
    for (const collider of platforms) colliders.add(collider);
    const floorY = undergroundFloorHeight(1);
    const terrain = { query, colliders, size: 8, levelHeight: 0.9, waterLevel: -0.05 };

    expect(query.surfaceAt?.(1.5, -1.5, floorY + 0.02)).toBeCloseTo(floorY);
    expect(canStand(terrain, 1.5, -1.5, 0.2, floorY)).toBe(true);

    const state = createHeroState(1.5, -1.15, floorY, 10, 2.2);
    stepHero(state, immobile, 1 / 60, { ...depsPlates(), query, colliders });
    expect(state.y).toBeCloseTo(floorY);
    expect(state.swimming).toBe(false);
    expect(state.liquid).toBeNull();
  });

  it("keeps a surface event collider out of the basement below it", () => {
    const platforms = undergroundColliders(underground, 8);
    const query = createTerrainQuery({
      size: 8,
      levelHeight: 0.9,
      waterLevel: -0.05,
      at: () => 0,
      kindAt: () => "herbe",
      liquidAt: () => null,
      platforms,
    });
    const colliders = createColliderIndex();
    for (const collider of platforms) colliders.add(collider);
    const terrain = { query, colliders, size: 8, levelHeight: 0.9, waterLevel: -0.05 };
    const tuple = [5.2 * 64, 2.2 * 64, 0.6 * 64, 0.6 * 64, 2] as const;
    const eventCollider = worldEventColliderRect(terrain, tuple, 0);

    expect(eventCollider).toMatchObject({ bottom: 0, top: 1.8 });
    const liveTerrain = withWorldEventColliders(terrain, [{ y: 0, collider: tuple }]);
    expect(liveTerrain.colliders.blocked(1.5, -1.5, 0.2, 0)).toBe(true);
    expect(liveTerrain.colliders.blocked(1.5, -1.5, 0.2, undergroundFloorHeight(1))).toBe(false);
    expect(canStand(liveTerrain, 1.5, -1.5, 0.2, undergroundFloorHeight(1))).toBe(true);
  });

  it("opens the visual and collision wall at both ends of a stair flight", () => {
    expect(undergroundStairMouth(underground.stairs, 1, 2, 2, -1, 0)).toBe(true);
    expect(undergroundStairMouth(underground.stairs, 1, 4, 2, 1, 0)).toBe(true);
    expect(undergroundStairMouth(underground.stairs, 1, 3, 2, 0, -1)).toBe(false);
  });

  it.each([1, 2, 8, 15])("opens an adjacent-storey flight on both level %i mouths", (fromDepth) => {
    const stair = {
      depth: fromDepth + 1,
      fromDepth,
      col: 2,
      row: 2,
      direction: "east" as const,
      length: 3,
      width: 1,
    };

    // East is the high mouth of an east-facing flight; west is its low mouth.
    expect(undergroundStairMouth([stair], fromDepth, 4, 2, 1, 0)).toBe(true);
    expect(undergroundStairMouth([stair], fromDepth + 1, 2, 2, -1, 0)).toBe(true);
    expect(undergroundStairMouth([stair], fromDepth + 1, 4, 2, 1, 0)).toBe(false);
    expect(undergroundStairMouth([stair], fromDepth, 2, 2, -1, 0)).toBe(false);
  });

  it("distinguishes a real vertical access from a jump elsewhere in the room", () => {
    expect(undergroundTransitionAt(underground, 8, -1.5, -1.5)).toBe(true);
    expect(undergroundTransitionAt(underground, 8, 2.5, 1.5)).toBe(true);
    expect(undergroundTransitionAt(underground, 8, 1.5, -1.5)).toBe(false);
  });

  it("samples a continuous 2.4-unit stair with a flush upper landing", () => {
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
    const slopeSpan = ramp.width - (ramp.highLanding ?? 0);
    const middleProgress = ramp.width / 2 / slopeSpan;
    expect(query.rampAt(ramp.x + ramp.width / 2, ramp.z)?.height).toBeCloseTo(
      undergroundFloorHeight(1) * (1 - middleProgress),
    );
    expect(query.rampAt(ramp.x + slopeSpan, ramp.z)?.height).toBeCloseTo(0);
    expect(query.rampAt(ramp.x + ramp.width, ramp.z)?.height).toBeCloseTo(0);
    expect(undergroundVisibleDepthsAtElevation(0)).toEqual([null]);
    expect(undergroundVisibleDepthsAtElevation(-0.05)).toEqual([null]);
    expect(undergroundVisibleDepthsAtElevation(-0.59)).toEqual([null]);
    expect(undergroundVisibleDepthsAtElevation(-1.2)).toEqual([null, 1]);
    expect(undergroundVisibleDepthsAtElevation(-2.4)).toEqual([1]);
    expect(undergroundVisibleDepthsAtElevation(-3.6)).toEqual([1, 2]);
    expect(undergroundVisibleDepthsAtElevation(1.2)).toEqual([-1, null]);
    expect(undergroundVisibleDepthsAtElevation(2.4)).toEqual([-1]);
    expect(undergroundVisibleDepthsAtElevation(3.6)).toEqual([-2, -1]);
  });

  it("descends onto the excavated landing without snapping back to the surface", () => {
    const stair = underground.stairs[0];
    if (!stair) throw new Error("fixture stair missing");
    const accessible = {
      levels: [
        {
          depth: 1,
          style: "cave" as const,
          cells: [{ col: 1, row: 2, length: 5 }],
        },
      ],
      stairs: [stair],
    };
    const platforms = undergroundColliders(accessible, 8);
    const query = createTerrainQuery({
      size: 8,
      levelHeight: 0.9,
      waterLevel: -0.05,
      at: () => 0,
      kindAt: () => "herbe",
      ramps: [undergroundRamp(stair, 8)],
      platforms,
    });
    const colliders = createColliderIndex();
    for (const collider of platforms) colliders.add(collider);
    // The foot collision point is 0.35 cells north of the sprite anchor.
    const state = createHeroState(0.95, -1.15, -0.04, 10, 2.2);
    state.groundY = state.y;
    const deps = { ...depsPlates(), query, colliders };
    const west = { ...immobile, x: -1 };
    const elevations = [state.y];
    for (let frame = 0; frame < 360; frame += 1) {
      stepHero(state, west, 1 / 60, deps);
      elevations.push(state.y);
    }

    expect(state.x).toBeLessThan(-2);
    expect(state.airborne).toBe(false);
    expect({ x: state.x, y: state.y, minimum: Math.min(...elevations) }).toEqual({
      x: expect.any(Number),
      y: expect.closeTo(undergroundFloorHeight(1)),
      minimum: expect.closeTo(undergroundFloorHeight(1)),
    });
  });

  it("walks down from basement -2 to -3 and back up without jumping", () => {
    const size = 30;
    const stair = {
      depth: 3,
      fromDepth: 2,
      col: 18,
      row: 19,
      direction: "east" as const,
      length: 6,
      width: 3,
    };
    const levels = [
      {
        depth: 2,
        style: "timber" as const,
        cells: Array.from({ length: 16 }, (_unused, row) => ({
          col: 6,
          row: row + 8,
          length: 20,
        })),
      },
      {
        depth: 3,
        style: "timber" as const,
        cells: Array.from({ length: 20 }, (_unused, row) => ({
          col: 4,
          row: row + 6,
          length: 24,
        })),
      },
    ];
    const authored = { levels, stairs: [stair] };
    const platforms = undergroundColliders(authored, size);
    const legacyPlatforms = platforms.slice(0, -2);
    expect(withUndergroundStairSideColliders(legacyPlatforms, authored, size)).toHaveLength(
      platforms.length,
    );
    expect(withUndergroundStairSideColliders(platforms, authored, size)).toHaveLength(
      platforms.length,
    );
    const ramp = undergroundRamp(stair, size);
    const query = createTerrainQuery({
      size,
      levelHeight: 0.9,
      waterLevel: -0.05,
      at: () => 0,
      kindAt: () => "herbe",
      ramps: [ramp],
      platforms,
    });
    const colliders = createColliderIndex();
    for (const collider of platforms) colliders.add(collider);
    const state = createHeroState(
      ramp.x + ramp.width + 1.58,
      ramp.z + 1.31,
      undergroundFloorHeight(2),
      10,
      2.2,
    );
    state.groundY = state.y;
    const entranceX = ramp.x + ramp.width - 0.02;
    const footprintZ = state.z - 0.35;
    expect(
      query.canTraverseRamp(ramp.x + ramp.width + 0.013, footprintZ, entranceX, footprintZ, 0.3),
    ).toBe(true);
    expect(query.surfaceAt?.(entranceX, footprintZ, -4.78)).toBeCloseTo(
      undergroundFloorHeight(2),
      1,
    );
    expect(query.maxHeightAround(entranceX, footprintZ, 0.3, -4.78)).toBeCloseTo(
      undergroundFloorHeight(2),
    );
    expect(colliders.blocked(entranceX, footprintZ, 0.3, undergroundFloorHeight(2))).toBe(false);
    const elevations = [state.y];
    for (let frame = 0; frame < 360; frame += 1) {
      stepHero(state, { ...immobile, x: -1 }, 1 / 60, {
        ...depsPlates(),
        query,
        colliders,
      });
      elevations.push(state.y);
    }

    expect(state.x).toBeLessThan(ramp.x);
    expect(state.y).toBeCloseTo(undergroundFloorHeight(3));
    expect(Math.min(...elevations)).toBeCloseTo(undergroundFloorHeight(3));

    for (let frame = 0; frame < 360; frame += 1) {
      stepHero(state, { ...immobile, x: 1 }, 1 / 60, {
        ...depsPlates(),
        query,
        colliders,
      });
    }

    expect(state.x).toBeGreaterThan(ramp.x + ramp.width);
    expect(state.y).toBeCloseTo(undergroundFloorHeight(2));
    expect(state.airborne).toBe(false);
  });

  it("keeps a jumping hero inside the lateral walls of a descending stair", () => {
    const size = 12;
    const stair = {
      depth: 2,
      fromDepth: 1,
      col: 3,
      row: 5,
      direction: "east" as const,
      length: 6,
      width: 1,
    };
    const authored = {
      levels: [1, 2].map((depth) => ({
        depth,
        style: "cave" as const,
        cells: Array.from({ length: 5 }, (_unused, row) => ({
          col: 2,
          row: row + 3,
          length: 8,
        })),
      })),
      stairs: [stair],
    };
    const platforms = undergroundColliders(authored, size);
    const ramp = undergroundRamp(stair, size);
    const query = createTerrainQuery({
      size,
      levelHeight: 0.9,
      waterLevel: -0.05,
      at: () => 0,
      kindAt: () => "herbe",
      ramps: [ramp],
      platforms,
    });
    const colliders = createColliderIndex();
    for (const collider of platforms) colliders.add(collider);
    const footprintZ = ramp.z + ramp.depth / 2;
    const rampProgress = 0.8;
    const state = createHeroState(
      ramp.x + ramp.width * rampProgress,
      footprintZ + 0.35,
      undergroundFloorHeight(2) +
        rampProgress * (undergroundFloorHeight(1) - undergroundFloorHeight(2)),
      10,
      2.2,
    );
    state.groundY = state.y;
    for (let frame = 0; frame < 120; frame += 1) {
      stepHero(state, { ...immobile, z: -1, jump: frame === 0 }, 1 / 60, {
        ...depsPlates(),
        query,
        colliders,
      });
    }

    expect(state.z - 0.35).toBeGreaterThanOrEqual(ramp.z + 0.16 + 0.3 - 0.02);
    expect(state.y).toBeGreaterThanOrEqual(undergroundFloorHeight(2));
  });

  it.each([2, 6, 16])(
    "walks continuously down a proportional surface flight to depth %i",
    (depth) => {
      const size = 56;
      const length = depth * 3;
      const stair = {
        depth,
        fromDepth: 0,
        col: 3,
        row: 20,
        direction: "east" as const,
        length,
        width: 2,
      };
      const deep = {
        levels: Array.from({ length: depth }, (_unused, index) => ({
          depth: index + 1,
          style: "cave" as const,
          cells: [
            { col: 2, row: 20, length: length + 2 },
            { col: 2, row: 21, length: length + 2 },
          ],
        })),
        stairs: [stair],
      };
      const platforms = undergroundColliders(deep, size);
      const ramp = undergroundRamp(stair, size);
      const query = createTerrainQuery({
        size,
        levelHeight: 0.9,
        waterLevel: -0.05,
        at: () => 0,
        kindAt: () => "herbe",
        ramps: [ramp],
        platforms,
      });
      const colliders = createColliderIndex();
      for (const collider of platforms) colliders.add(collider);
      // The sprite anchor sits 0.35 cells north of its collision foot.
      const state = createHeroState(ramp.x + ramp.width - 0.05, ramp.z + 0.65, 0, 10, 2.2);
      state.groundY = state.y;
      const elevations = [state.y];
      const west = { ...immobile, x: -1 };
      for (let frame = 0; frame < length * 45 + 240; frame += 1) {
        stepHero(state, west, 1 / 60, { ...depsPlates(), query, colliders });
        elevations.push(state.y);
      }

      expect(state.x).toBeLessThan(ramp.x);
      expect(state.airborne).toBe(false);
      expect(state.y).toBeCloseTo(undergroundFloorHeight(depth));
      expect(
        Math.max(
          ...elevations
            .slice(1)
            .map((elevation, index) => Math.abs(elevation - (elevations[index] ?? elevation))),
        ),
      ).toBeLessThan(0.15);
    },
  );

  it.each([
    ["east", 1],
    ["west", 2],
    ["south", 6],
    ["north", 16],
  ] as const)(
    "walks up a %s-facing surface flight from depth %i without jumping",
    (direction, depth) => {
      const size = 64;
      const length = depth * 3;
      const alongX = direction === "east" || direction === "west";
      const stair = {
        depth,
        fromDepth: 0,
        col: 6,
        row: 6,
        direction,
        length,
        width: 2,
      };
      const footprintCols = alongX ? length : 2;
      const footprintRows = alongX ? 2 : length;
      const authored = {
        levels: Array.from({ length: depth }, (_unused, index) => ({
          depth: index + 1,
          style: "cave" as const,
          cells: Array.from({ length: footprintRows + 2 }, (_row, row) => ({
            col: stair.col - 1,
            row: stair.row - 1 + row,
            length: footprintCols + 2,
          })),
        })),
        stairs: [stair],
      };
      const platforms = undergroundColliders(authored, size);
      const ramp = undergroundRamp(stair, size);
      const query = createTerrainQuery({
        size,
        levelHeight: 0.9,
        waterLevel: -0.05,
        at: () => 0,
        kindAt: () => "herbe",
        ramps: [ramp],
        platforms,
      });
      const colliders = createColliderIndex();
      for (const collider of platforms) colliders.add(collider);
      const climbsPositive = direction === "east" || direction === "south";
      const footX = alongX
        ? climbsPositive
          ? ramp.x + 0.05
          : ramp.x + ramp.width - 0.05
        : ramp.x + ramp.width / 2;
      const footZ = alongX
        ? ramp.z + ramp.depth / 2
        : climbsPositive
          ? ramp.z + 0.05
          : ramp.z + ramp.depth - 0.05;
      const state = createHeroState(footX, footZ + 0.35, undergroundFloorHeight(depth), 10, 2.2);
      state.groundY = state.y;
      const input = {
        ...immobile,
        x: alongX ? (climbsPositive ? 1 : -1) : 0,
        z: alongX ? 0 : climbsPositive ? 1 : -1,
      };
      for (let frame = 0; frame < length * 45 + 240; frame += 1) {
        stepHero(state, input, 1 / 60, { ...depsPlates(), query, colliders });
      }

      const along = alongX ? state.x : state.z - 0.35;
      const highEdge = alongX
        ? climbsPositive
          ? ramp.x + ramp.width
          : ramp.x
        : climbsPositive
          ? ramp.z + ramp.depth
          : ramp.z;
      expect({
        clearedLanding: climbsPositive ? along > highEdge + 0.5 : along < highEdge - 0.5,
        airborne: state.airborne,
        y: state.y,
        along,
        highEdge,
      }).toEqual({
        clearedLanding: true,
        airborne: false,
        y: expect.closeTo(0),
        along: expect.any(Number),
        highEdge: expect.any(Number),
      });
    },
  );

  it.each(["east", "west", "south", "north"] as const)(
    "walks both ways on a %s-facing interior stair from floor 0 to +1",
    (direction) => {
      const size = 16;
      const alongX = direction === "east" || direction === "west";
      const stair = {
        depth: 0,
        fromDepth: -1,
        col: 5,
        row: 5,
        direction,
        length: 3,
        width: 2,
      };
      const authored = {
        levels: [
          {
            depth: -1,
            style: "timber" as const,
            cells: Array.from({ length: alongX ? 4 : 5 }, (_unused, row) => ({
              col: 4,
              row: 4 + row,
              length: alongX ? 5 : 4,
            })),
          },
        ],
        stairs: [stair],
      };
      const platforms = undergroundColliders(authored, size);
      const ramp = undergroundRamp(stair, size);
      const query = createTerrainQuery({
        size,
        levelHeight: 0.9,
        waterLevel: -0.05,
        at: () => 0,
        kindAt: () => "herbe",
        ramps: [ramp],
        platforms,
      });
      const colliders = createColliderIndex();
      for (const collider of platforms) colliders.add(collider);
      const climbsPositive = direction === "east" || direction === "south";
      const lowFootX = alongX
        ? climbsPositive
          ? ramp.x + 0.05
          : ramp.x + ramp.width - 0.05
        : ramp.x + ramp.width / 2;
      const lowFootZ = alongX
        ? ramp.z + ramp.depth / 2
        : climbsPositive
          ? ramp.z + 0.05
          : ramp.z + ramp.depth - 0.05;
      const state = createHeroState(lowFootX, lowFootZ + 0.35, 0, 10, 2.2);
      state.groundY = 0;
      const climb = {
        ...immobile,
        x: alongX ? (climbsPositive ? 1 : -1) : 0,
        z: alongX ? 0 : climbsPositive ? 1 : -1,
      };
      for (let frame = 0; frame < 360; frame += 1) {
        stepHero(state, climb, 1 / 60, { ...depsPlates(), query, colliders });
      }

      expect(state.y).toBeCloseTo(undergroundFloorHeight(-1));
      expect(state.airborne).toBe(false);
      expect(undergroundDepthAtElevation(state.y)).toBe(-1);

      const descend = { ...climb, x: -climb.x, z: -climb.z };
      for (let frame = 0; frame < 360; frame += 1) {
        stepHero(state, descend, 1 / 60, { ...depsPlates(), query, colliders });
      }

      expect(state.y).toBeCloseTo(0);
      expect(state.airborne).toBe(false);
      expect(undergroundDepthAtElevation(state.y)).toBeNull();
    },
  );

  it.each([1, 2, 6, 16])(
    "climbs continuously from the ground floor to interior floor +%i without jumping",
    (storeys) => {
      const size = 64;
      const length = storeys * 3;
      const stair = {
        depth: 0,
        fromDepth: -storeys,
        col: 6,
        row: 10,
        direction: "east" as const,
        length,
        width: 2,
      };
      const authored = {
        levels: Array.from({ length: storeys }, (_unused, index) => ({
          depth: -(index + 1),
          style: "timber" as const,
          cells: [
            { col: 5, row: 9, length: length + 2 },
            { col: 5, row: 10, length: length + 2 },
            { col: 5, row: 11, length: length + 2 },
            { col: 5, row: 12, length: length + 2 },
          ],
        })),
        stairs: [stair],
      };
      const platforms = undergroundColliders(authored, size);
      const ramp = undergroundRamp(stair, size);
      const query = createTerrainQuery({
        size,
        levelHeight: 0.9,
        waterLevel: -0.05,
        at: () => 0,
        kindAt: () => "herbe",
        ramps: [ramp],
        platforms,
      });
      const colliders = createColliderIndex();
      for (const collider of platforms) colliders.add(collider);
      const state = createHeroState(ramp.x + 0.05, ramp.z + 1.35, 0, 10, 2.2);
      state.groundY = 0;
      const elevations = [state.y];
      for (let frame = 0; frame < length * 45 + 240; frame += 1) {
        stepHero(state, { ...immobile, x: 1 }, 1 / 60, {
          ...depsPlates(),
          query,
          colliders,
        });
        elevations.push(state.y);
      }

      expect({
        clearedLanding: state.x > ramp.x + ramp.width,
        x: state.x,
        highEdge: ramp.x + ramp.width,
        y: state.y,
        airborne: state.airborne,
      }).toEqual({
        clearedLanding: true,
        x: expect.any(Number),
        highEdge: expect.any(Number),
        y: expect.closeTo(undergroundFloorHeight(-storeys)),
        airborne: false,
      });
      expect(
        Math.max(
          ...elevations
            .slice(1)
            .map((elevation, index) => Math.abs(elevation - (elevations[index] ?? elevation))),
        ),
      ).toBeLessThan(0.15);
    },
  );

  it("walks between two adjacent upper floors without an invisible wall", () => {
    const size = 20;
    const stair = {
      depth: -1,
      fromDepth: -2,
      col: 6,
      row: 7,
      direction: "east" as const,
      length: 3,
      width: 2,
    };
    const authored = {
      levels: [-1, -2].map((depth) => ({
        depth,
        style: "timber" as const,
        cells: Array.from({ length: 4 }, (_unused, row) => ({
          col: 5,
          row: 6 + row,
          length: 6,
        })),
      })),
      stairs: [stair],
    };
    const platforms = undergroundColliders(authored, size);
    const ramp = undergroundRamp(stair, size);
    const query = createTerrainQuery({
      size,
      levelHeight: 0.9,
      waterLevel: -0.05,
      at: () => 0,
      kindAt: () => "herbe",
      ramps: [ramp],
      platforms,
    });
    const colliders = createColliderIndex();
    for (const collider of platforms) colliders.add(collider);
    const state = createHeroState(
      ramp.x + 0.05,
      ramp.z + ramp.depth / 2 + 0.35,
      undergroundFloorHeight(-1),
      10,
      2.2,
    );
    state.groundY = state.y;
    for (let frame = 0; frame < 360; frame += 1) {
      stepHero(state, { ...immobile, x: 1 }, 1 / 60, {
        ...depsPlates(),
        query,
        colliders,
      });
    }

    expect(state.x).toBeGreaterThan(ramp.x + ramp.width);
    expect(state.y).toBeCloseTo(undergroundFloorHeight(-2));
    expect(state.airborne).toBe(false);
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
        ...elevations
          .slice(1)
          .map((elevation, index) => Math.abs(elevation - (elevations[index] ?? elevation))),
      ),
    ).toBeLessThan(1);
    expect(undergroundDepthAtElevation(state.y)).toBe(MAX_UNDERGROUND_DEPTH);
  });
});
