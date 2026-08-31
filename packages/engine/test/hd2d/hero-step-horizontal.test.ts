import { createColliderIndex } from "@lindocara/engine/hd2d/collider-index.js";
import { createHeroState } from "@lindocara/engine/hd2d/hero-state.js";
import { stepHero } from "@lindocara/engine/hd2d/hero-step.js";
import { describe, expect, it } from "vitest";

import { depsPlates } from "./helpers/step-deps.js";

describe("stepHero — horizontal movement", () => {
  it("accelerates toward the material's speed and settles there", () => {
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    for (let i = 0; i < 300; i++) {
      stepHero(
        s,
        { x: 1, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false },
        1 / 60,
        deps,
      );
    }
    // Steady state = `accel / friction` = the material's speed, to machine error.
    expect(s.vx).toBeCloseTo(deps.hero.speed, 3);
    expect(s.vz).toBeCloseTo(0, 6);
  });

  it("covers the same ground on the diagonal as on either axis", () => {
    const entree = (x: number, z: number) =>
      ({ x, z, jump: false, attack: false, souffleTaux: 1, haleineVisible: false }) as const;
    const parcours = (x: number, z: number): number => {
      const deps = depsPlates();
      const s = createHeroState(0, 0, 0, 10, 2.2);
      for (let i = 0; i < 300; i++) stepHero(s, entree(x, z), 1 / 60, deps);
      return Math.hypot(s.x, s.z);
    };

    // Each axis converges to `accel / friction`, so two axes held at once used to reach the full
    // speed on BOTH and travel √2 times as far. The input is a vector; its length is the throttle.
    expect(parcours(1, 1)).toBeCloseTo(parcours(1, 0), 3);
    expect(parcours(-1, 1)).toBeCloseTo(parcours(0, 1), 3);
  });

  it("leaves a short analog vector at its own magnitude", () => {
    // Clamped, not normalised: a gentle stick push must stay gentle. Half input, half the distance.
    const entree = (x: number, z: number) =>
      ({ x, z, jump: false, attack: false, souffleTaux: 1, haleineVisible: false }) as const;
    const parcours = (x: number, z: number): number => {
      const deps = depsPlates();
      const s = createHeroState(0, 0, 0, 10, 2.2);
      for (let i = 0; i < 300; i++) stepHero(s, entree(x, z), 1 / 60, deps);
      return Math.hypot(s.x, s.z);
    };
    expect(parcours(0.5, 0)).toBeLessThan(parcours(1, 0));
    expect(parcours(0.3, 0.4)).toBeCloseTo(parcours(0.5, 0), 3);
  });

  it("cancels speed on the refused axis, not on the other", () => {
    // A wall on x: sliding along it must continue, in z. That's what the axis-by-axis test buys,
    // and it's exactly what switching colliders from circles to rectangles must not break.
    const deps = depsPlates({ bloque: (x) => x > 1 });
    const s = createHeroState(0, 0, 0, 10, 2.2);
    s.vx = 5;
    s.vz = 5;
    s.x = 1;
    stepHero(
      s,
      { x: 1, z: 1, jump: false, attack: false, souffleTaux: 1, haleineVisible: false },
      1 / 60,
      deps,
    );
    expect(s.vx).toBe(0);
    expect(s.x).toBe(1);
    expect(s.vz).toBeGreaterThan(0);
    expect(s.z).toBeGreaterThan(0);
  });

  it("cannot tunnel through a basement wall during a strong airborne push", () => {
    const deps = depsPlates({ hauteur: () => -2.4, surface: () => -2.4 });
    const colliders = createColliderIndex();
    colliders.add({ x: 0, z: -1, w: 0.16, h: 2, bottom: -2.4, top: 0 });
    deps.colliders = colliders;
    const state = createHeroState(-0.7, 0.35, -2.4, 10, 2.2);
    state.airborne = true;
    state.vy = 1;
    state.impulsionX = 14;

    stepHero(
      state,
      { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false },
      0.1,
      deps,
    );

    expect(state.x).toBeCloseTo(-0.7);
    expect(state.impulsionX).toBe(0);
  });

  it("emits a footstep while propelling, never while skidding", () => {
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    // Launched with no input at all: this is a skid, not a walk.
    s.vx = deps.hero.speed;
    let pas = 0;
    for (let i = 0; i < 120; i++) {
      const evts = stepHero(
        s,
        { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false },
        1 / 60,
        deps,
      );
      pas += evts.filter((e) => e.t === "pas").length;
    }
    expect(pas).toBe(0);
  });
});
