import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { type ZoneTerrain, zoneTerrainFromHeightfield } from "@lindocara/engine/terrain-access.js";
import { describe, expect, it } from "vitest";

import { createHeroController, type HeroControllerInput } from "@/game/hero-controller.js";

const SIZE = 8;
const LEVEL_HEIGHT = 0.9;
const FRAME = 1 / 60;

/**
 * A flat 8x8 grid whose eastern strip (cell column 5 and beyond, i.e. world `x > 1`) is one level
 * up. Grid centre is the origin, so cell `i` spans `i - SIZE/2 .. i + 1 - SIZE/2`: the cliff face
 * stands at `x = 1`.
 */
function plateauTerrain(): ZoneTerrain {
  const levels: (number | null)[] = [];
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) levels.push(i >= 5 ? 1 : 0);
  }
  const map: MapData = {
    version: 1,
    size: SIZE,
    levelHeight: LEVEL_HEIGHT,
    waterLevel: -0.05,
    levels,
    materials: Array.from({ length: SIZE * SIZE }, () => "herbe" as const),
    colliders: [],
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

function flatTerrain(): ZoneTerrain {
  return zoneTerrainFromHeightfield({
    version: 1,
    size: SIZE,
    levelHeight: LEVEL_HEIGHT,
    waterLevel: -0.05,
    levels: Array.from({ length: SIZE * SIZE }, () => 0),
    materials: Array.from({ length: SIZE * SIZE }, () => "herbe" as const),
    colliders: [],
    spawns: [],
    elements: [],
    events: [],
  });
}

function controller() {
  return createHeroController({
    terrain: plateauTerrain(),
    spawn: { x: -1, y: 0, z: 0 },
    speed: 4.2,
  });
}

/** The same grid with its eastern half flooded: cells from column 5 have no ground at all. */
function floodedTerrain(): ZoneTerrain {
  const levels: (number | null)[] = [];
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) levels.push(i >= 5 ? null : 0);
  }
  const map: MapData = {
    version: 1,
    size: SIZE,
    levelHeight: LEVEL_HEIGHT,
    waterLevel: -0.05,
    levels,
    materials: Array.from({ length: SIZE * SIZE }, () => "herbe" as const),
    colliders: [],
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

function frozenFloodedTerrain(): ZoneTerrain {
  const levels: (number | null)[] = [];
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) levels.push(i >= 5 ? null : 0);
  }
  return zoneTerrainFromHeightfield({
    version: 1,
    size: SIZE,
    levelHeight: LEVEL_HEIGHT,
    waterLevel: -0.05,
    levels,
    materials: Array.from({ length: SIZE * SIZE }, () => "neige" as const),
    colliders: [],
    spawns: [],
    elements: [],
    events: [],
  });
}

function press(overrides: Partial<HeroControllerInput> = {}): HeroControllerInput {
  return { x: 0, z: 0, jump: false, ...overrides };
}

describe("the hero controller", () => {
  it("runs stepHero and exposes the resulting state", () => {
    const hero = controller();
    expect(hero.state.x).toBe(-1);
    expect(hero.state.y).toBe(0);
    expect(hero.state.z).toBe(0);
    expect(hero.maxBreath).toBeGreaterThan(0);

    for (let frame = 0; frame < 10; frame++) hero.step(press({ x: 1 }), FRAME);

    expect(hero.state.x).toBeGreaterThan(-1);
    // Elevation is `y` and the second ground axis is `z`: walking east must move neither.
    expect(hero.state.y).toBe(0);
    expect(hero.state.z).toBe(0);
  });

  it("does not let a grounded hero climb a level", () => {
    const hero = controller();
    for (let frame = 0; frame < 120; frame++) hero.step(press({ x: 1 }), FRAME);

    // Stopped by the cliff face at x = 1, its disc biting first, and still on the lower tier.
    expect(hero.state.x).toBeLessThan(1);
    expect(hero.state.y).toBe(0);
    expect(hero.state.airborne).toBe(false);
  });

  it("lets a jumping hero land on the plateau", () => {
    const hero = controller();
    for (let frame = 0; frame < 120; frame++) hero.step(press({ x: 1 }), FRAME);
    const blocked = hero.state.x;
    expect(blocked).toBeLessThan(1);

    // One rising edge on the jump key, then hold east over the cliff and let go before the eastern
    // shore — walking off the grid's edge would put the hero in the sea, not on the plateau.
    hero.step(press({ x: 1, jump: true }), FRAME);
    for (let frame = 0; frame < 25; frame++) hero.step(press({ x: 1 }), FRAME);
    for (let frame = 0; frame < 40; frame++) hero.step(press(), FRAME);

    expect(hero.state.x).toBeGreaterThan(1);
    expect(hero.state.y).toBeCloseTo(LEVEL_HEIGHT, 6);
    expect(hero.state.airborne).toBe(false);
  });

  it("reports the events stepHero emitted, in order", () => {
    const hero = controller();
    for (let frame = 0; frame < 30; frame++) hero.step(press({ x: 1 }), FRAME);

    const events = hero.step(press({ x: 1, jump: true }), FRAME);
    expect(events.map((event) => event.t)).toEqual(["glisse", "saut"]);
  });

  it("uses a granted air jump before opening the glider", () => {
    const hero = controller();
    hero.setMovementModifiers({ gravityMultiplier: 1, extraAirJumps: 1 });

    hero.step(press({ jump: true }), FRAME);
    for (let frame = 0; frame < 10; frame++) hero.step(press(), FRAME);
    const beforeSecondJump = hero.state.y;
    const secondJump = hero.step(press({ jump: true }), FRAME);

    expect(secondJump.some((event) => event.t === "saut")).toBe(true);
    expect(hero.state.y).toBeGreaterThan(beforeSecondJump);
    expect(hero.state.gliding).toBe(false);

    hero.step(press(), FRAME);
    const glider = hero.step(press({ jump: true }), FRAME);
    expect(glider.some((event) => event.t === "glider-open")).toBe(true);
    expect(hero.state.gliding).toBe(true);
  });

  it("applies light and heavy gravity without changing the authored jump impulse", () => {
    const light = controller();
    const heavy = controller();
    light.setMovementModifiers({ gravityMultiplier: 0.55, extraAirJumps: 0 });
    heavy.setMovementModifiers({ gravityMultiplier: 1.65, extraAirJumps: 0 });

    light.step(press({ jump: true }), FRAME);
    heavy.step(press({ jump: true }), FRAME);
    for (let frame = 0; frame < 18; frame++) {
      light.step(press(), FRAME);
      heavy.step(press(), FRAME);
    }

    expect(light.state.y).toBeGreaterThan(heavy.state.y);
  });

  it("reports a unit heading, seeded before the first step and never zero-length", () => {
    const hero = controller();
    expect(Math.hypot(hero.facing.x, hero.facing.z)).toBeCloseTo(1, 6);

    hero.step(press(), FRAME);
    expect(Math.hypot(hero.facing.x, hero.facing.z)).toBeCloseTo(1, 6);

    hero.step(press({ x: 0, z: -1 }), FRAME);
    expect(hero.facing).toEqual({ x: 0, z: -1 });

    // Standing still preserves the last heading rather than collapsing it to zero.
    hero.step(press(), FRAME);
    expect(Math.hypot(hero.facing.x, hero.facing.z)).toBeCloseTo(1, 6);
  });

  it("reports drowning where it happened instead of teleporting home", () => {
    const spawn = { x: -1, y: 0, z: 0 };
    const hero = createHeroController({ terrain: floodedTerrain(), spawn, speed: 4.2 });

    // Swim east until the breath the rule holds (`HERO_PHYSICS.swim.breath`) runs out. Fourteen
    // seconds is comfortably past it and nowhere near the eastern edge at swimming speed.
    let drowned = 0;
    let whereItWentUnder: number | null = null;
    for (let frame = 0; frame < 14 * 60; frame++) {
      for (const event of hero.step(press({ x: 1 }), FRAME)) {
        if (event.t !== "noyade") continue;
        drowned += 1;
        whereItWentUnder ??= hero.state.x;
      }
    }

    expect(drowned).toBeGreaterThan(0);
    // The flooded half starts at world x = 1, and the spawn is at -1. The lab teleports the hero
    // back to `spawn` here, because there it is a debug reset; in the game `spawn` is where the
    // welcome admitted this hero, so the same line is a free ride home past cliffs and monsters —
    // and the landing is in bounds, so nothing downstream refuses it. Drowning is the server's
    // outcome to apply: the client stays exactly where it went under.
    expect(whereItWentUnder).toBeGreaterThan(1);
    expect(hero.state.x).toBeGreaterThan(1);
    expect(hero.state.z).toBe(spawn.z);
  });

  it("emits visible breath on authored cold terrain", () => {
    const hero = createHeroController({
      terrain: frozenFloodedTerrain(),
      spawn: { x: -1, y: 0, z: 0 },
      speed: 4.2,
    });
    const events = [];
    for (let frame = 0; frame < 2.3 * 60; frame++) events.push(...hero.step(press(), FRAME));

    expect(events.some((event) => event.t === "haleine")).toBe(true);
  });

  it("spends breath twice as fast in water beside authored frozen ground", () => {
    const hero = createHeroController({
      terrain: frozenFloodedTerrain(),
      spawn: { x: -1, y: 0, z: 0 },
      speed: 4.2,
    });
    for (let frame = 0; frame < 180 && !hero.state.swimming; frame++) {
      hero.step(press({ x: 1 }), FRAME);
    }
    expect(hero.state.swimming).toBe(true);
    const before = hero.state.breath;
    for (let frame = 0; frame < 60; frame++) hero.step(press({ x: 1 }), FRAME);

    expect(before - hero.state.breath).toBeCloseTo(2, 1);
  });

  it("snaps to a server-authored position, cutting momentum", () => {
    const hero = controller();
    for (let frame = 0; frame < 10; frame++) hero.step(press({ x: 1 }), FRAME);
    expect(hero.state.vx).toBeGreaterThan(0);

    hero.teleport({ x: 2, y: LEVEL_HEIGHT, z: -2 });

    expect(hero.state.x).toBe(2);
    expect(hero.state.z).toBe(-2);
    expect(hero.state.y).toBe(LEVEL_HEIGHT);
    expect(hero.state.vx).toBe(0);
    expect(hero.state.vz).toBe(0);
    expect(hero.state.airborne).toBe(false);
  });

  it("carries a push-trap impulse through a real backward jump", () => {
    const hero = createHeroController({
      terrain: flatTerrain(),
      spawn: { x: 0, y: 0, z: 0 },
      speed: 4.2,
    });

    hero.impulse({ x: -6.25, y: 9, z: 0 });
    let apex = hero.state.y;
    for (let frame = 0; frame < 120 && (frame === 0 || hero.state.airborne); frame++) {
      hero.step(press(), FRAME);
      apex = Math.max(apex, hero.state.y);
    }

    expect(apex).toBeGreaterThan(1.2);
    expect(hero.state.x).toBeLessThan(-2);
    expect(hero.state.y).toBe(0);
    expect(hero.state.airborne).toBe(false);
    expect([hero.state.impulsionX, hero.state.impulsionZ]).toEqual([0, 0]);
  });

  it("launches about three authored elevation levels straight upward", () => {
    const hero = createHeroController({
      terrain: flatTerrain(),
      spawn: { x: 0, y: 0, z: 0 },
      speed: 4.2,
    });

    hero.impulse({ x: 0, y: 13, z: 0 });
    let apex = hero.state.y;
    for (let frame = 0; frame < 180 && (frame === 0 || hero.state.airborne); frame++) {
      hero.step(press(), FRAME);
      apex = Math.max(apex, hero.state.y);
    }

    expect(apex).toBeGreaterThanOrEqual(LEVEL_HEIGHT * 3);
    expect(apex).toBeLessThan(LEVEL_HEIGHT * 3.2);
    expect(hero.state.x).toBe(0);
    expect(hero.state.z).toBe(0);
    expect(hero.state.y).toBe(0);
    expect(hero.state.airborne).toBe(false);
  });
});
