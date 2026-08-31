import { BODY_CLEARANCE, createColliderIndex } from "@lindocara/engine/hd2d/collider-index.js";
import { createHeroState } from "@lindocara/engine/hd2d/hero-state.js";
import { stepHero } from "@lindocara/engine/hd2d/hero-step.js";
import { describe, expect, it } from "vitest";

import { depsPlates } from "./helpers/step-deps.js";

const immobile = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false };

describe("stepHero — the vertical axis", () => {
  it("jumps, falls back down, and announces its landing", () => {
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    const saut = stepHero(s, { ...immobile, jump: true }, 1 / 60, deps);
    expect(saut.some((e) => e.t === "saut")).toBe(true);
    expect(s.airborne).toBe(true);

    let recu: number | null = null;
    for (let i = 0; i < 200 && recu === null; i++) {
      for (const e of stepHero(s, immobile, 1 / 60, deps)) {
        if (e.t === "reception") recu = e.force;
      }
    }
    expect(recu).not.toBeNull();
    expect(s.airborne).toBe(false);
    expect(s.y).toBeCloseTo(0, 6);
  });

  it("forgives a jump a few frames after leaving an edge", () => {
    // Coyote time: without it, jumping right at a cliff's exact edge misses half the time.
    const deps = depsPlates({ hauteur: (x) => (x < 1 ? 0 : null) });
    const s = createHeroState(0.99, 0, 0, 10, 2.2);
    s.airborne = true;
    s.coyote = deps.hero.jump.coyote;
    const evts = stepHero(s, { ...immobile, jump: true }, 1 / 60, deps);
    expect(evts.some((e) => e.t === "saut")).toBe(true);
  });

  it("no longer jumps once coyote time is exhausted", () => {
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    s.airborne = true;
    s.coyote = 0;
    const evts = stepHero(s, { ...immobile, jump: true }, 1 / 60, deps);
    expect(evts.some((e) => e.t === "saut")).toBe(false);
  });

  it("lands on a building roof after crossing it on the descending arc", () => {
    const top = 0.9;
    const deps = depsPlates({
      surface: (x, _z, ceilingY) => (Math.abs(x) <= 0.8 && ceilingY >= top ? top : 0),
      bloque: (x, _z, y) => Math.abs(x) <= 0.8 && (y ?? 0) < top,
    });
    const s = createHeroState(0, 0, 1.05, 10, 2.2);
    s.airborne = true;
    s.vy = -2;

    let landed = false;
    for (let i = 0; i < 20 && !landed; i++) {
      landed = stepHero(s, immobile, 1 / 60, deps).some((event) => event.t === "reception");
    }
    expect(landed).toBe(true);
    expect(s.airborne).toBe(false);
    expect(s.y).toBeCloseTo(top, 6);
  });
  it("walks under a raised deck instead of being lifted onto it", () => {
    // A bridge two levels up over a gorge: `blocksAt` lets a body pass beneath it (quest #12), so
    // the vertical resolution is now the only thing standing between the bank and the deck. With
    // an unbounded ceiling it read the planking as the ground under the hero's feet and TELEPORTED
    // it up there on the first frame.
    const deck = 1.8;
    const deps = depsPlates({
      surface: (x, _z, ceilingY) => (Math.abs(x) <= 1 && ceilingY >= deck ? deck : 0),
    });
    const s = createHeroState(-1.5, 0, 0, 10, 2.2);
    for (let i = 0; i < 20; i++) stepHero(s, { ...immobile, x: 1 }, 1 / 60, deps);

    expect(Math.abs(s.x)).toBeLessThanOrEqual(1); // actually under the planking
    expect(s.y).toBeCloseTo(0, 6);
    expect(s.groundY).toBeCloseTo(0, 6);
    expect(s.airborne).toBe(false);
  });

  it("climbs stairs under a bridge without snapping onto the deck", () => {
    const ramp = {
      x: -0.5,
      z: -0.5,
      width: 1,
      depth: 1,
      direction: "east" as const,
      lowLevel: 0,
      progress: 0.5,
      lowHeight: 0,
      highHeight: 0.9,
      height: 0.45,
    };
    const deps = depsPlates({
      surface: (_x, _z, ceilingY) => (ceilingY >= 1.8 ? 1.8 : ramp.height),
      rampe: () => ramp,
      franchit: () => true,
    });
    const state = createHeroState(0, 0, ramp.height, 10, 2.2);
    state.groundY = ramp.height;
    for (let index = 0; index < 8; index++) {
      stepHero(state, { ...immobile, x: 1 }, 1 / 60, deps);
    }
    expect(state.y).toBeCloseTo(ramp.height, 6);
    expect(state.y).toBeLessThan(1.8);
    expect(state.airborne).toBe(false);
  });

  it("still stands on a deck it is already walking along", () => {
    // The other half of the same rule: bounding the ceiling must not drop a hero THROUGH the deck
    // it is on. Its own surface is at its feet, so it stays within one step of its ground.
    const deck = 1.8;
    const deps = depsPlates({
      surface: (x, _z, ceilingY) => (Math.abs(x) <= 1 && ceilingY >= deck ? deck : 0),
    });
    const s = createHeroState(-0.5, 0, deck, 10, 2.2);
    s.groundY = deck;
    for (let i = 0; i < 20; i++) stepHero(s, { ...immobile, x: 1 }, 1 / 60, deps);

    expect(s.y).toBeCloseTo(deck, 6);
    expect(s.airborne).toBe(false);
  });

  it("hits a basement ceiling instead of tunnelling through its slab in one strong launch", () => {
    const deps = depsPlates({ hauteur: () => -2.4, surface: () => -2.4 });
    const colliders = createColliderIndex();
    colliders.add({ x: -1, z: -1, w: 2, h: 2, bottom: -0.12, top: 0 });
    deps.colliders = colliders;
    const state = createHeroState(0, 0, -2.4, 10, 2.2);
    state.airborne = true;
    state.vy = 20;

    stepHero(state, immobile, 0.2, deps);

    expect(state.y).toBeCloseTo(-0.12 - BODY_CLEARANCE, 6);
    expect(state.y).toBeLessThan(-0.12);
    expect(state.vy).toBe(0);
    expect(state.airborne).toBe(true);
  });

  it("stops at the nearest ceiling even when a launch could cross several storeys", () => {
    const deps = depsPlates({ hauteur: () => -4.8, surface: () => -4.8 });
    const colliders = createColliderIndex();
    colliders.add({ x: -1, z: -1, w: 2, h: 2, bottom: -2.52, top: -2.4 });
    colliders.add({ x: -1, z: -1, w: 2, h: 2, bottom: -0.12, top: 0 });
    deps.colliders = colliders;
    const state = createHeroState(0, 0, -4.8, 10, 2.2);
    state.airborne = true;
    state.vy = 40;

    stepHero(state, immobile, 0.2, deps);

    expect(state.y).toBeCloseTo(-2.52 - BODY_CLEARANCE, 6);
    expect(state.vy).toBe(0);
  });

  it("keeps a real opening traversable when no ceiling slab covers it", () => {
    const deps = depsPlates({ hauteur: () => -2.4, surface: () => -2.4 });
    deps.colliders = createColliderIndex();
    const state = createHeroState(0, 0, -2.4, 10, 2.2);
    state.airborne = true;
    state.vy = 20;

    stepHero(state, immobile, 0.2, deps);

    expect(state.y).toBeGreaterThan(-0.12);
    expect(state.vy).toBeGreaterThan(0);
  });
});
