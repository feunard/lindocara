import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import {
  withWorldEventColliders,
  zoneTerrainFromHeightfield,
} from "@lindocara/engine/terrain-access.js";
import { describe, expect, it } from "vitest";
import { createHeroController } from "@/game/hero-controller.js";

const SIZE = 12;
const FRAME = 1 / 60;

function flatTerrain() {
  const map: MapData = {
    version: 1,
    size: SIZE,
    levelHeight: 0.9,
    waterLevel: -0.05,
    levels: new Array(SIZE * SIZE).fill(0),
    materials: new Array(SIZE * SIZE).fill("herbe"),
    colliders: [],
    spawns: [{ name: "default", x: -2, z: 0 }],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

describe("live authored-event collision", () => {
  const obstacle = [SIZE * 32, (SIZE / 2 - 1) * 64, 64, 128] as const;

  it("adds and removes a harvest footprint without resetting the hero", () => {
    const base = flatTerrain();
    const blocked = withWorldEventColliders(base, [
      { harvest: { collider: [SIZE * 32, (SIZE / 2 - 1) * 64, 64, 128] } },
    ]);
    const hero = createHeroController({
      terrain: blocked,
      spawn: { x: -2, y: 0, z: 0 },
      speed: 4,
    });
    const east = { x: 1, z: 0, jump: false };

    for (let frame = 0; frame < 120; frame += 1) hero.step(east, FRAME);
    expect(hero.state.x).toBeLessThan(0);

    hero.setTerrain(base);
    for (let frame = 0; frame < 60; frame += 1) hero.step(east, FRAME);
    expect(hero.state.x).toBeGreaterThan(0.5);
  });

  it("jumps over a level-one resource but not a level-two wall from flat ground", () => {
    const base = flatTerrain();
    const runAt = (elevation: 1 | 2) => {
      const terrain = withWorldEventColliders(base, [
        { harvest: { collider: [...obstacle, elevation] } },
      ]);
      const hero = createHeroController({
        terrain,
        spawn: { x: -2, y: 0, z: 0 },
        speed: 4,
      });
      for (let frame = 0; frame < 120; frame += 1) {
        hero.step({ x: 1, z: 0, jump: frame < 30 }, FRAME);
      }
      return hero.state;
    };

    expect(runAt(1).x).toBeGreaterThan(0.75);
    expect(runAt(2).x).toBeLessThan(0);
  });

  it.each([
    ["west", { x: -2, z: 0 }, { x: 1, z: 0 }, (x: number, _z: number) => x < -0.2],
    ["east", { x: 3, z: 0 }, { x: -1, z: 0 }, (x: number, _z: number) => x > 1.2],
    ["north", { x: 0.5, z: -3 }, { x: 0, z: 1 }, (_x: number, z: number) => z < -1.05],
    ["south", { x: 0.5, z: 3 }, { x: 0, z: -1 }, (_x: number, z: number) => z > 1.35],
  ] as const)(
    "keeps a level-one prop solid when approached from the %s",
    (_side, spawn, input, stopped) => {
      const terrain = withWorldEventColliders(flatTerrain(), [
        { harvest: { collider: [...obstacle, 1] } },
      ]);
      const hero = createHeroController({ terrain, spawn: { ...spawn, y: 0 }, speed: 4 });

      for (let frame = 0; frame < 120; frame += 1) {
        hero.step({ ...input, jump: false }, FRAME);
      }

      expect(stopped(hero.state.x, hero.state.z), JSON.stringify(hero.state)).toBe(true);
      expect(hero.state.y).toBeCloseTo(0);
    },
  );

  it.each([
    ["west", { x: -0.25, z: 0 }, { x: 1, z: 0 }],
    ["east", { x: 1.25, z: 0 }, { x: -1, z: 0 }],
    ["north", { x: 0.5, z: -1.1 }, { x: 0, z: 1 }],
    ["south", { x: 0.5, z: 1.4 }, { x: 0, z: -1 }],
  ] as const)(
    "lands on a level-one prop after a contact jump from the %s",
    (_side, spawn, input) => {
      const terrain = withWorldEventColliders(flatTerrain(), [
        { harvest: { collider: [...obstacle, 1] } },
      ]);
      const hero = createHeroController({ terrain, spawn: { ...spawn, y: 0 }, speed: 4 });

      for (let frame = 0; frame < 50; frame += 1) {
        hero.step(
          frame < 12 ? { ...input, jump: frame === 0 } : { x: 0, z: 0, jump: false },
          FRAME,
        );
        const footprintZ = hero.state.z - 0.15;
        const overlaps =
          hero.state.x > -0.25 && hero.state.x < 1.25 && footprintZ > -1.25 && footprintZ < 1.25;
        if (overlaps) {
          expect(
            hero.state.y,
            `frame ${frame}: ${JSON.stringify(hero.state)}`,
          ).toBeGreaterThanOrEqual(0.899);
        }
      }

      expect(hero.state.airborne, JSON.stringify(hero.state)).toBe(false);
      expect(hero.state.y).toBeCloseTo(0.9);
      expect(hero.state.x).toBeGreaterThanOrEqual(0);
      expect(hero.state.x).toBeLessThanOrEqual(1);
      expect(hero.state.z - 0.15).toBeGreaterThanOrEqual(-1);
      expect(hero.state.z - 0.15).toBeLessThanOrEqual(1);
    },
  );

  it("keeps bridge rails solid below their top and landable from either bank", () => {
    const map: MapData = {
      version: 1,
      size: SIZE,
      levelHeight: 0.9,
      waterLevel: -0.05,
      levels: new Array(SIZE * SIZE).fill(0),
      materials: new Array(SIZE * SIZE).fill("herbe"),
      colliders: [
        { x: -1.5, z: -0.5, w: 3, h: 1, top: 0 },
        { x: -1.5, z: -0.5, w: 3, h: 0.11, top: 0.9 },
        { x: -1.5, z: 0.39, w: 3, h: 0.11, top: 0.9 },
      ],
      spawns: [{ name: "bridge", x: 0, z: -0.75 }],
      elements: [],
      events: [],
    };
    const terrain = zoneTerrainFromHeightfield(map);

    for (const [spawnZ, direction] of [
      [-0.75, 1],
      [0.9, -1],
    ] as const) {
      const hero = createHeroController({
        terrain,
        spawn: { x: 0, y: 0, z: spawnZ + 0.15 },
        speed: 4,
      });
      for (let frame = 0; frame < 45; frame += 1) {
        hero.step(
          frame < 10 ? { x: 0, z: direction, jump: frame === 0 } : { x: 0, z: 0, jump: false },
          FRAME,
        );
        const footprintZ = hero.state.z - 0.15;
        const overlapsRail =
          (footprintZ > -0.75 && footprintZ < -0.25) || (footprintZ > 0.14 && footprintZ < 0.64);
        if (overlapsRail) {
          expect(
            hero.state.y,
            `frame ${frame}: ${JSON.stringify(hero.state)}`,
          ).toBeGreaterThanOrEqual(0.899);
        }
      }
      expect(hero.state.y).toBeCloseTo(0.9);
      expect(hero.state.airborne).toBe(false);
    }
  });

  it("clears a wide level-one stump when the jump starts at contact", () => {
    const base = flatTerrain();
    const obstacle = [SIZE * 32, (SIZE / 2 - 1) * 64, 96, 128] as const;
    const runAt = (elevation: 1 | 2) => {
      const terrain = withWorldEventColliders(base, [
        { harvest: { collider: [...obstacle, elevation] } },
      ]);
      const hero = createHeroController({
        terrain,
        // BODY_RADIUS is 0.25: this starts tangent to the obstacle, with no run-up at all.
        spawn: { x: -0.25, y: 0, z: 0 },
        speed: 4,
      });
      for (let frame = 0; frame < 120; frame += 1) {
        hero.step({ x: 1, z: 0, jump: frame < 30 }, FRAME);
      }
      return hero.state;
    };

    expect(runAt(1).x).toBeGreaterThan(1.75);
    expect(runAt(2).x).toBeLessThan(0);
  });

  it("keeps the hero on both slopes of a gable roof", () => {
    const map: MapData = {
      version: 1,
      size: SIZE,
      levelHeight: 0.9,
      waterLevel: -0.05,
      levels: new Array(SIZE * SIZE).fill(0),
      materials: new Array(SIZE * SIZE).fill("herbe"),
      colliders: [
        {
          x: -1,
          z: -1,
          w: 2,
          h: 2,
          top: 2,
          surface: { shape: "gable", eave: 1, peak: 2, axis: "x" },
        },
      ],
      spawns: [{ name: "roof", x: -0.5, z: 0.15 }],
      elements: [],
      events: [],
    };
    const hero = createHeroController({
      terrain: zoneTerrainFromHeightfield(map),
      spawn: { x: -0.5, y: 1.5, z: 0.15 },
      speed: 4,
    });

    for (let frame = 0; frame < 14; frame += 1) {
      hero.step({ x: 1, z: 0, jump: false }, FRAME);
      expect(hero.state.airborne, `frame ${frame}: ${JSON.stringify(hero.state)}`).toBe(false);
      expect(hero.state.y).toBeCloseTo(2 - Math.abs(hero.state.x), 2);
    }
    expect(hero.state.x).toBeGreaterThan(0.35);
    expect(hero.state.y).toBeGreaterThan(1.5);
  });

  it.each([
    ["gable", { shape: "gable", eave: 1, peak: 2, axis: "x" } as const, -0.82, 0],
    ["cone", { shape: "cone", eave: 1, peak: 2 } as const, -0.88, 0],
  ])("lands on and follows the edge of a %s roof", (_name, surface, x, z) => {
    const map: MapData = {
      version: 1,
      size: SIZE,
      levelHeight: 0.9,
      waterLevel: -0.05,
      levels: new Array(SIZE * SIZE).fill(0),
      materials: new Array(SIZE * SIZE).fill("herbe"),
      colliders: [{ x: -1, z: -1, w: 2, h: 2, top: 2, surface }],
      spawns: [{ name: "roof", x, z: z + 0.15 }],
      elements: [],
      events: [],
    };
    const hero = createHeroController({
      terrain: zoneTerrainFromHeightfield(map),
      spawn: { x, y: 2.8, z: z + 0.15 },
      speed: 4,
    });
    hero.step({ x: 0, z: 0, jump: true }, FRAME);
    expect(hero.state.airborne).toBe(true);

    for (let frame = 0; frame < 90; frame += 1) {
      hero.step({ x: 0, z: 0, jump: false }, FRAME);
    }
    const landedY = hero.state.y;
    const landedX = hero.state.x;
    for (let frame = 0; frame < 8; frame += 1) {
      hero.step({ x: 1, z: 0, jump: false }, FRAME);
    }

    expect(landedY).toBeGreaterThan(1);
    expect(hero.state.airborne, JSON.stringify(hero.state)).toBe(false);
    expect(hero.state.y).toBeGreaterThan(1);
    expect(hero.state.x).toBeGreaterThan(landedX + 0.1);
  });

  it("keeps a hero walking on the finite top surface", () => {
    const terrain = withWorldEventColliders(flatTerrain(), [
      {
        harvest: {
          collider: [SIZE * 32, (SIZE / 2 - 1) * 64, 64, 128, 1],
        },
      },
    ]);
    const hero = createHeroController({
      terrain,
      spawn: { x: 0, y: 0.9, z: 0 },
      speed: 4,
    });

    for (let frame = 0; frame < 8; frame += 1) {
      hero.step({ x: 0, z: 1, jump: false }, FRAME);
    }

    expect(hero.state.z).toBeGreaterThan(0.1);
    expect(hero.state.y).toBeCloseTo(0.9);
    expect(hero.state.airborne).toBe(false);
  });

  it("adds and removes the solid footprint of an authoritative Peasant camp", () => {
    const base = flatTerrain();
    const blocked = withWorldEventColliders(base, [], [{ x: 0, z: 0 }]);
    const hero = createHeroController({
      terrain: blocked,
      spawn: { x: -2, y: 0, z: 0 },
      speed: 4,
    });
    const east = { x: 1, z: 0, jump: false };

    for (let frame = 0; frame < 120; frame += 1) hero.step(east, FRAME);
    expect(hero.state.x).toBeLessThan(-0.7);

    const rearApproach = createHeroController({
      terrain: blocked,
      spawn: { x: 0, y: 0, z: 2.5 },
      speed: 4,
    });
    for (let frame = 0; frame < 120; frame += 1) {
      rearApproach.step({ x: 0, z: -1, jump: false }, FRAME);
    }
    expect(rearApproach.state.z).toBeGreaterThan(1.2);

    hero.setTerrain(withWorldEventColliders(base, []));
    for (let frame = 0; frame < 60; frame += 1) hero.step(east, FRAME);
    expect(hero.state.x).toBeGreaterThan(0.5);
  });
});
