import { createHeroState } from "@lindocara/engine/hd2d/hero-state.js";
import { stepHero } from "@lindocara/engine/hd2d/hero-step.js";
import { describe, expect, it } from "vitest";

import { depsPlates } from "./helpers/step-deps.js";

const immobile = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false };

describe("stepHero — swimming", () => {
  it("enters the water falling off an edge, and announces it exactly once", () => {
    const deps = depsPlates({ hauteur: (x) => (x < 0 ? 0 : null) });
    const s = createHeroState(-0.05, 0, 0, 10, 2.2);
    let entrees = 0;
    for (let i = 0; i < 120; i++) {
      const evts = stepHero(s, { ...immobile, x: 1 }, 1 / 60, deps);
      entrees += evts.filter((e) => e.t === "entree-eau").length;
    }
    expect(s.swimming).toBe(true);
    expect(entrees).toBe(1);
  });

  it("drains breath at the rate the zone supplies, then drowns", () => {
    const deps = depsPlates({ hauteur: () => null });
    const s = createHeroState(0, 0, 0, 2, 2.2);
    s.swimming = true;
    // Rate 2: polar water drains twice as fast. A 2 s breath must therefore last 1 s.
    let noyades = 0;
    for (let i = 0; i < 90; i++) {
      noyades += stepHero(s, { ...immobile, souffleTaux: 2 }, 1 / 60, deps).filter(
        (e) => e.t === "noyade",
      ).length;
    }
    expect(noyades).toBe(1);
  });

  it("climbs onto a level shore, never a cliff", () => {
    const hauteM = depsPlates({ hauteur: (x) => (x > 0 ? 5 : null) });
    const s = createHeroState(-0.01, 0, 0, 10, 2.2);
    s.swimming = true;
    for (let i = 0; i < 60; i++) stepHero(s, { ...immobile, x: 1 }, 1 / 60, hauteM);
    expect(s.swimming).toBe(true);
  });

  // The cadence debt this rule closed (see its originating task's report): the footstep gate is
  // evaluated INSIDE `stepHero`, AFTER the swim resolution — never before. Before that fix, the
  // gate still read `swimming === false` (the value from the START of the tick) right on the frame
  // water was just reached, and a footstep sound could fire on that same frame. Nothing pinned
  // this closure: this test does, in both directions (entry AND exit).
  it("never announces a footstep on the exact frame of a water entry or exit", () => {
    // Entry: land to the left (height 0), water to the right (null height) — an ordinary edge.
    const entreeDeps = depsPlates({ hauteur: (x) => (x < 0 ? 0 : null) });
    const s1 = createHeroState(-0.05, 0, 0, 10, 2.2);
    let vuEntree = false;
    for (let i = 0; i < 120; i++) {
      const evts = stepHero(s1, { ...immobile, x: 1 }, 1 / 60, entreeDeps);
      if (evts.some((e) => e.t === "entree-eau")) {
        vuEntree = true;
        expect(evts.some((e) => e.t === "pas")).toBe(false);
      }
    }
    expect(vuEntree).toBe(true);

    // Exit: level shore on both sides (height 0 everywhere, never null) — `sortie-eau` fires on
    // the very first frame; `input.x` propels the hero so the cadence has something to count if
    // it picked the wrong branch (footstep instead of stroke).
    const sortieDeps = depsPlates({ hauteur: () => 0 });
    const s2 = createHeroState(0, 0, 0, 10, 2.2);
    s2.swimming = true;
    const evts2 = stepHero(s2, { ...immobile, x: 1 }, 1 / 60, sortieDeps);
    expect(evts2.some((e) => e.t === "sortie-eau")).toBe(true);
    expect(evts2.some((e) => e.t === "pas")).toBe(false);
  });
});

describe("stepHero — water at elevation", () => {
  // The rule used to read ONE global water level, so a pool on a summit would have put the hero
  // swimming at sea level inside the mountain. It now asks the terrain where the surface is at the
  // point it is testing, which is what lets a spring exist 3.6 units up and still behave as water.
  const HIGH = 3.6;

  /** A summit plateau at 3.6 with a pool cut into it, whose surface sits at the plateau's height. */
  const summit = () =>
    depsPlates({
      hauteur: (x) => (Math.abs(x) < 1 ? null : HIGH),
      eau: (x) => (Math.abs(x) < 1 ? HIGH : 0),
    });

  it("enters the elevated pool at ITS surface, not at sea level", () => {
    const deps = summit();
    const state = createHeroState(-1.6, 0, HIGH, 10, 2.2);
    const events: string[] = [];
    for (let k = 0; k < 40; k++) {
      for (const e of stepHero(state, { ...immobile, x: 1 }, 1 / 60, deps)) events.push(e.t);
      if (state.swimming) break;
    }
    expect(state.swimming).toBe(true);
    expect(events).toContain("entree-eau");
    // The whole point: it floats at the summit's height, not at the sea 3.6 units below.
    expect(state.y).toBeCloseTo(HIGH, 5);
  });

  // Being able to get OUT matters as much as being able to get in: a pool you can only leave by
  // going over the fall is a trap, not a pool. The climb-out is measured against the surface the
  // swimmer floats on — sampling a water level at the destination instead reads the bank as a
  // 3.65-unit cliff, because a bank is LAND and the lookup answers the distant sea.
  it("climbs out of an elevated pool onto its own bank", () => {
    const deps = summit();
    const state = createHeroState(0, 0, HIGH, 10, 2.2);
    state.swimming = true;
    for (let k = 0; k < 200 && state.swimming; k++) {
      stepHero(state, { ...immobile, x: 1 }, 1 / 60, deps);
    }
    expect(state.swimming).toBe(false);
    expect(state.y).toBeCloseTo(HIGH, 5);
    expect(state.x).toBeGreaterThan(1);
  });

  it("still uses the sea's level where there is no elevated water", () => {
    const deps = depsPlates({ hauteur: (x) => (Math.abs(x) < 1 ? null : 0) });
    const state = createHeroState(-1.6, 0, 0, 10, 2.2);
    for (let k = 0; k < 40 && !state.swimming; k++) {
      stepHero(state, { ...immobile, x: 1 }, 1 / 60, deps);
    }
    expect(state.swimming).toBe(true);
    expect(state.y).toBeCloseTo(0, 5);
  });
});

describe("stepHero — going over the lip", () => {
  const HIGH = 3.6;

  /** A pool at 3.6 that ends at x = 0, with water far below beyond it: the top of a waterfall. */
  const lip = () =>
    depsPlates({
      hauteur: () => null,
      eau: (x) => (x < 0 ? HIGH : 0),
    });

  it("falls off the lip instead of teleporting down to the water below", () => {
    const deps = lip();
    const state = createHeroState(-1, 0, HIGH, 10, 2.2);
    state.swimming = true;
    const ys: number[] = [];
    for (let k = 0; k < 90; k++) {
      stepHero(state, { ...immobile, x: 1 }, 1 / 60, deps);
      ys.push(state.y);
      if (state.swimming && state.x > 0) break;
    }
    // It left the water at the lip rather than snapping straight to the surface below...
    expect(Math.min(...ys)).toBeGreaterThan(-0.01);
    // ...and came down through the intervening heights instead of jumping over them.
    const between = ys.filter((y) => y < HIGH - 0.5 && y > 0.5);
    expect(between.length).toBeGreaterThan(3);
  });

  it("is airborne while it falls, and swims again once it lands", () => {
    const deps = lip();
    const state = createHeroState(-1, 0, HIGH, 10, 2.2);
    state.swimming = true;
    let sawAirborne = false;
    for (let k = 0; k < 200; k++) {
      stepHero(state, { ...immobile, x: 1 }, 1 / 60, deps);
      if (state.airborne) sawAirborne = true;
      if (sawAirborne && state.swimming) break;
    }
    expect(sawAirborne).toBe(true);
    expect(state.swimming).toBe(true);
    expect(state.y).toBeCloseTo(0, 2);
  });

  it("keeps swimming on water that does not fall away", () => {
    const deps = depsPlates({ hauteur: () => null, eau: () => HIGH });
    const state = createHeroState(-1, 0, HIGH, 10, 2.2);
    state.swimming = true;
    for (let k = 0; k < 60; k++) stepHero(state, { ...immobile, x: 1 }, 1 / 60, deps);
    expect(state.swimming).toBe(true);
    expect(state.airborne).toBe(false);
    expect(state.y).toBeCloseTo(HIGH, 5);
  });
});
