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
