import type { HeroSettings } from "@lindocara/engine/hd2d/hero-state.js";
import {
  derapage,
  frictionPour,
  pasAmorti,
  sePropulse,
  vitesseMaxPour,
} from "@lindocara/engine/hd2d/locomotion.js";
import { describe, expect, it } from "vitest";

// `frictionPour`/`vitesseMaxPour` take a full `HeroSettings` (`hero-state.ts`) rather than
// importing the lab's `HERO` themselves — this is what let them move into `@lindocara/engine`
// without carrying the lab's settings along. The values below are the lab's `HERO` settings
// (`apps/lab/src/settings.ts`) copied in as plain numbers, since this test no longer has access to
// the lab's `settings.ts` from inside `engine`: `speed`/`radius`/`offset`/`friction`/`vitesseSol`/
// `jump`/`swim` mirror `HERO` exactly, while the four cadence fields
// (`pasTousLes`/`brasseTousLes`/`haleineRepos`/`traceEcart`) get a test value never read by
// `frictionPour`/`vitesseMaxPour`.
const HERO_SPEED = 4.2;
const HERO_STEP: HeroSettings = {
  speed: HERO_SPEED,
  radius: 0.3,
  offset: 0.15,
  friction: { herbe: 80, neige: 130, glace: 0.35 },
  vitesseSol: { herbe: 1, neige: 0.55, glace: 1 },
  jump: { speed: 9, gravity: 30, coyote: 0.12 },
  glide: { fall: 2 },
  swim: { speed: 0.45, breath: 11, climb: 0.5 },
  pasTousLes: 1.2,
  brasseTousLes: 0.85,
  haleineRepos: 2.2,
  traceEcart: 0.14,
};

/** Replays N timesteps at constant input and returns the speed reached. */
function apres(secondes: number, friction: number, accel: number, dt = 1 / 60): number {
  let v = 0;
  for (let t = 0; t < secondes; t += dt) v = pasAmorti(v, 1, accel, friction, dt);
  return v;
}

describe("the friction model", () => {
  it("reaches exactly the hero's speed at steady state, on grass", () => {
    // The equilibrium speed is accel / friction: this is what keeps HERO_SPEED as THE reference
    // speed instead of a number that no longer means anything.
    const f = frictionPour("herbe", HERO_STEP);
    const v = apres(2, f, HERO_SPEED * f);
    expect(v).toBeCloseTo(HERO_SPEED, 3);
  });

  it("on grass, reaches its speed in two frames and stops in two frames", () => {
    // This is the operational definition of "indistinguishable from the old model": the player
    // cannot perceive two frames. Strict equality is impossible — exponential damping only
    // reaches its target asymptotically — so the TIME is pinned, not the trajectory.
    const f = frictionPour("herbe", HERO_STEP);
    const accel = HERO_SPEED * f;
    expect(apres(2 / 60, f, accel)).toBeGreaterThan(HERO_SPEED * 0.9);
    // Then released: speed drops back below 10% within two frames.
    let v = HERO_SPEED;
    for (let i = 0; i < 2; i++) v = pasAmorti(v, 0, accel, f, 1 / 60);
    expect(v).toBeLessThan(HERO_SPEED * 0.1);
  });

  it("on ice, keeps its momentum well after being released", () => {
    const f = frictionPour("glace", HERO_STEP);
    let v = HERO_SPEED;
    for (let i = 0; i < 60; i++) v = pasAmorti(v, 0, HERO_SPEED * f, f, 1 / 60);
    // One second later, still sliding at more than half its speed.
    expect(v).toBeGreaterThan(HERO_SPEED * 0.5);
  });

  it("on snow, caps lower than on grass", () => {
    expect(vitesseMaxPour("neige", HERO_STEP)).toBeLessThan(vitesseMaxPour("herbe", HERO_STEP));
    expect(frictionPour("neige", HERO_STEP)).toBeGreaterThan(frictionPour("herbe", HERO_STEP));
  });

  it("orders the three frictions the way the game needs", () => {
    expect(frictionPour("glace", HERO_STEP)).toBeLessThan(frictionPour("herbe", HERO_STEP));
    expect(frictionPour("herbe", HERO_STEP)).toBeLessThan(frictionPour("neige", HERO_STEP));
  });

  it("never returns an infinite or NaN speed, even at an outlandish dt", () => {
    // The game loop caps dt at 0.05, but a module that lives in `engine` must hold up against a
    // dt the server could pass it.
    for (const dt of [0, 1e-6, 0.05, 1, 10]) {
      const v = pasAmorti(3, 1, 100, 8, dt);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("skidding (the sound of the slide)", () => {
  it("is zero at rest, whatever the input", () => {
    expect(derapage(0, 0, 1, 0, HERO_SPEED)).toBe(0);
    expect(derapage(0, 0, 0, 0, HERO_SPEED)).toBe(0);
  });

  it("is zero when speed follows input exactly, at full speed", () => {
    expect(derapage(HERO_SPEED, 0, 1, 0, HERO_SPEED)).toBeCloseTo(0, 6);
  });

  it("is maximal when speed exactly opposes input, at full speed", () => {
    expect(derapage(HERO_SPEED, 0, -1, 0, HERO_SPEED)).toBeCloseTo(1, 6);
  });

  it("is one half when speed and input are perpendicular", () => {
    expect(derapage(HERO_SPEED, 0, 0, 1, HERO_SPEED)).toBeCloseTo(0.5, 6);
  });

  it(
    "is maximal with input released but speed full: skidding on momentum with no direction " +
      "requested is stopping on ice, not the absence of a skid",
    () => {
      expect(derapage(HERO_SPEED, 0, 0, 0, HERO_SPEED)).toBeCloseTo(1, 6);
    },
  );

  it(
    "decreases with speed: a residual drift at near-zero speed doesn't sound at full intensity, " +
      "even with input released",
    () => {
      const plein = derapage(HERO_SPEED, 0, 0, 0, HERO_SPEED);
      const residuel = derapage(HERO_SPEED * 0.05, 0, 0, 0, HERO_SPEED);
      expect(residuel).toBeLessThan(plein);
      expect(residuel).toBeCloseTo(0.05, 2);
    },
  );

  it("never exceeds 1 even at a speed above the reference", () => {
    expect(derapage(HERO_SPEED * 3, 0, -1, 0, HERO_SPEED)).toBeLessThanOrEqual(1);
  });
});

describe("sePropulse — the footstep cadence must only sound while actually propelling", () => {
  // The origin of this test: the footstep cadence (`hero.ts`) is counted by distance traveled,
  // so it used to fire even while skidding, where the hero advances without taking a single
  // step. The criterion that tells the two apart is NOT the ground material (ice slides for a
  // while once launched — see above — but can also be walked carefully) — it's the DIRECTION
  // MISMATCH between speed and input: propelling when input pushes in the direction of speed,
  // skidding otherwise.
  //
  // `sePropulse` deliberately has NO `vitesseRef` parameter, unlike `derapage` — see its
  // docstring in `locomotion.ts` for the bug (found by replaying the scene, not by reading the
  // code) that reusing `derapage` as is would have let through.

  it("skidding without pressing anything doesn't propel, at full speed", () => {
    // Zero input, full speed: the direction mismatch is 1 by construction — maximal, so never
    // propelling.
    expect(sePropulse(HERO_SPEED, 0, 0, 0)).toBe(false);
  });

  it(
    "skidding without pressing anything doesn't propel at LOW speed either — derapage's speed " +
      "weighting must not influence this decision",
    () => {
      // The real bug found by playing: right at the start of a skid on ice, speed is still far
      // from `HERO_SPEED` (ice barely brakes, but takes several seconds to ACCELERATE). Reusing
      // `derapage(...)` as is for this decision would have weighted the maximal mismatch by that
      // still-low speed, dropping below the 0.5 threshold and letting footsteps sound mid-skid.
      // `sePropulse` has no such parameter: it cannot reproduce this bug by construction.
      expect(sePropulse(HERO_SPEED * 0.1, 0, 0, 0)).toBe(false);
    },
  );

  it("pushing in a direction opposite to speed doesn't propel", () => {
    // Skidding through a hard turn: input exists, but opposes the momentum still present.
    expect(sePropulse(HERO_SPEED, 0, -1, 0)).toBe(false);
  });

  it("pushing exactly in the direction of speed propels, whatever the material", () => {
    // Walking on ice while pushing in the direction of travel must keep sounding footsteps — ice
    // must not go silent at the start of a walk. `sePropulse` doesn't even receive a material:
    // nothing could distinguish it from grass at this level, by construction.
    expect(sePropulse(HERO_SPEED, 0, 1, 0)).toBe(true);
  });

  it("at rest or at the very start of acceleration (near-zero speed), propels by default", () => {
    // The direction mismatch returns 0 under 1e-3 speed: the very first frame of an acceleration
    // must not read as a skid.
    expect(sePropulse(0, 0, 1, 0)).toBe(true);
  });

  it("perpendicular (the exact pivot of the mismatch, 0.5) doesn't propel", () => {
    // The threshold is STRICT below 0.5: at the pivot value itself, the hero is considered no
    // longer squarely in the direction of speed. Checked at full speed, where `derapage`
    // (weighted) and the raw mismatch coincide.
    expect(derapage(HERO_SPEED, 0, 0, 1, HERO_SPEED)).toBeCloseTo(0.5, 6);
    expect(sePropulse(HERO_SPEED, 0, 0, 1)).toBe(false);
  });
});
