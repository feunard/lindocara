/**
 * Mobility skills, applied by the client (the S3 spec, decision 6).
 *
 * The server still GRANTS: it spent the cooldown, the resource and the class checks before the
 * grant existed, and it withdraws it the moment the action ends. What is proven here is the other
 * half — that the controller performs the displacement, that it performs exactly the one it was
 * granted, and that without a grant a hero cannot phase through anything at all.
 */

import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import {
  BODY_RADIUS,
  canStand,
  groundUnder,
  type ZoneTerrain,
  zoneTerrainFromHeightfield,
} from "@lindocara/engine/terrain-access.js";
import { describe, expect, it } from "vitest";

import { createHeroController, type HeroControllerInput } from "@/game/hero-controller.js";

const SIZE = 12;
const FRAME = 1 / 60;
/** Tiles per second. Round on purpose: a three-tile grant is exactly thirty frames of travel. */
const SPEED = 6;

/** The wall's western face, in world units. The grid centre is the origin. */
const WALL_X = 0;
const WALL_DEPTH = 0.5;

/**
 * A second wall's western face, one tile east of where a single three-tile grant lands (see
 * `doubleWalledTerrain`). Used only by the re-arm test: it turns "did a second grant get spent"
 * into a geometry question — crossed the wall or didn't — instead of a distance comparison that
 * has to out-guess `stepHero`'s own friction ramp-up to stay discriminating.
 */
const SECOND_WALL_X = 2;

/**
 * A flat, entirely walkable grid with one solid wall standing across it — a prop, not relief, so
 * the ordinary movement rule is stopped by its collider while a phased traversal ignores it and the
 * ground on both sides is the same level. Relief would have muddied the assertion: `MAX_STEP` is 0,
 * so a phased hero may not LAND on higher ground either, and a refused landing is a different rule
 * from a refused step.
 */
function walledTerrain(): ZoneTerrain {
  const map: MapData = {
    version: 1,
    size: SIZE,
    levelHeight: 0.9,
    waterLevel: -0.05,
    levels: Array.from({ length: SIZE * SIZE }, () => 0),
    materials: Array.from({ length: SIZE * SIZE }, () => "herbe" as const),
    colliders: [{ x: WALL_X, z: -SIZE / 2, w: WALL_DEPTH, h: SIZE }],
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

/**
 * `walledTerrain` plus a second wall one tile past where a spent three-tile grant lands. Ordinary
 * walking (the correct, non-re-armed path) collides with it like any other prop; `phase()` ignores
 * every collider by design, so a re-armed second grant crosses it — a fact true regardless of how
 * fast `stepHero`'s friction ramps a walking hero up to full speed.
 */
function doubleWalledTerrain(): ZoneTerrain {
  const map: MapData = {
    version: 1,
    size: SIZE,
    levelHeight: 0.9,
    waterLevel: -0.05,
    levels: Array.from({ length: SIZE * SIZE }, () => 0),
    materials: Array.from({ length: SIZE * SIZE }, () => "herbe" as const),
    colliders: [
      { x: WALL_X, z: -SIZE / 2, w: WALL_DEPTH, h: SIZE },
      { x: SECOND_WALL_X, z: -SIZE / 2, w: WALL_DEPTH, h: SIZE },
    ],
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

function controller(terrain = walledTerrain()) {
  return createHeroController({ terrain, spawn: { x: -2, y: 0, z: 0 }, speed: SPEED });
}

function press(overrides: Partial<HeroControllerInput> = {}): HeroControllerInput {
  return { x: 0, z: 0, jump: false, ...overrides };
}

/** Could a body be standing exactly there? Grounded on where the body IS, like every landing. */
function standable(position: { x: number; y: number; z: number }, terrain = walledTerrain()) {
  const groundY = groundUnder(terrain, position.x, position.z, position.y);
  return canStand(terrain, position.x, position.z, BODY_RADIUS, groundY);
}

function grant(distance: number, duration = 2.5) {
  return { actionId: "8b1f4c62-0000-4000-8000-000000000001", distance, duration };
}

describe("a granted mobility skill", () => {
  it("moves the hero by a granted blink and no further", () => {
    const hero = controller();
    const start = hero.state.x;
    hero.setMobility(grant(3));

    // Exactly the budget: three tiles at six tiles a second is half a second of frames.
    for (let frame = 0; frame < 30; frame++) hero.step(press({ x: 1 }), FRAME);

    // It crossed the wall its own movement rule cannot pass — that is the skill.
    expect(hero.state.x).toBeGreaterThan(WALL_X + WALL_DEPTH);
    expect(hero.state.x - start).toBeCloseTo(3, 6);
    // The ground pair is `x`/`z` and `y` is elevation: phasing east moves neither of the other two.
    expect(hero.state.z).toBe(0);
    expect(hero.state.y).toBe(0);

    // The budget is spent, so holding the key buys nothing more than an ordinary walk — and with the
    // key released, nothing at all. A grant that survived its own budget would be a teleport.
    for (let frame = 0; frame < 10; frame++) hero.step(press(), FRAME);
    expect(hero.state.x - start).toBeCloseTo(3, 6);
  });

  it("ends and rematerialises as soon as the granted distance is spent", () => {
    const hero = controller();
    // After 21 frames the body is inside the wall with one tenth of a tile left to spend. That is
    // valid while phased and deliberately invalid as a final position.
    hero.setMobility(grant(2.2));
    for (let frame = 0; frame < 21; frame++) hero.step(press({ x: 1 }), FRAME);
    expect(standable(hero.state)).toBe(false);

    // Spending the last segment must end the grant and call `land()`. A traversal whose remaining
    // bound stopped being enforced would leave the body embedded in the collider here.
    hero.step(press({ x: 1 }), FRAME);
    expect(standable(hero.state)).toBe(true);
  });

  it("ignores a displacement the server never granted", () => {
    const hero = controller();
    for (let frame = 0; frame < 120; frame++) hero.step(press({ x: 1 }), FRAME);

    // Stopped at the wall's face, its disc biting first. No client-side phasing without a grant.
    expect(hero.state.x).toBeLessThan(WALL_X);
  });

  it("does not re-arm a grant it has already spent", () => {
    const hero = controller(doubleWalledTerrain());
    const start = hero.state.x;
    hero.setMobility(grant(3));
    for (let frame = 0; frame < 30; frame++) hero.step(press({ x: 1 }), FRAME);
    // The first grant's exact budget, same as the first test in this file — lands one tile short of
    // the second wall, so what follows tests the second grant alone.
    expect(hero.state.x - start).toBeCloseTo(3, 6);

    // The same action, repeated: every `state` frame during a hold carries the live grant again, and
    // a controller that re-armed on each one would phase for as long as the server kept talking. A
    // distance bound here would have to out-guess `stepHero`'s own friction ramp-up to stay
    // discriminating (a walking hero at full analog input reaches near-full speed almost
    // immediately), so instead this asks a geometry question: the second wall sits one tile past
    // where the hero now stands. Ordinary walking cannot cross it — it is a collider like any other
    // prop. `phase()` ignores every collider by design, so only a re-armed grant crosses it.
    hero.setMobility(grant(3));
    for (let frame = 0; frame < 30; frame++) hero.step(press({ x: 1 }), FRAME);

    expect(hero.state.x).toBeLessThan(SECOND_WALL_X);
  });

  it("lapses when its own window runs out", () => {
    const hero = controller();
    const start = hero.state.x;
    // Ten frames' worth of window against a budget worth thirty.
    hero.setMobility(grant(3, 10 * FRAME));
    for (let frame = 0; frame < 30; frame++) hero.step(press({ x: 1 }), FRAME);

    // Once the window expires this is ordinary walking again, so the wall's western face stops it.
    // Checking only `< 3` let an unbounded phase reach 2.999999... and still pass.
    expect(hero.state.x).toBeLessThan(WALL_X);
    expect(hero.state.x - start).toBeLessThan(2);
  });

  it("rematerialises somewhere the hero can stand", () => {
    const hero = controller();
    // Two point two tiles east of -2 is x = 0.2 — inside the wall, where an ordinary step would
    // leave the hero cemented: every direction refused, no diagnostic, no way out.
    // Released with budget to spare, so the landing is the withdrawal's job rather than the
    // budget's — the ordinary case, since a player lets go of the key long before the 2.5s cap.
    hero.setMobility(grant(3));
    for (let frame = 0; frame < 22; frame++) hero.step(press({ x: 1 }), FRAME);
    expect(standable(hero.state)).toBe(false);

    // The server withdraws the grant by simply not sending one; that is where the landing happens.
    hero.setMobility(null);
    expect(standable(hero.state)).toBe(true);
  });

  it("keeps reporting a unit heading while phasing", () => {
    const hero = controller();
    hero.setMobility(grant(3));
    hero.step(press({ x: 1 }), FRAME);

    expect(Math.hypot(hero.facing.x, hero.facing.z)).toBeCloseTo(1, 6);
  });
});
