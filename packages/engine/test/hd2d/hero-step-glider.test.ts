import { createHeroState } from "@lindocara/engine/hd2d/hero-state.js";
import { stepHero } from "@lindocara/engine/hd2d/hero-step.js";
import { describe, expect, it } from "vitest";

import { depsPlates } from "./helpers/step-deps.js";

const immobile = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false };
const jumping = { ...immobile, jump: true };
const DT = 1 / 60;

/** Airborne, high above the ground, canopy still folded: the situation every glide starts from.
 *  The ground is put far below so a test can run for two seconds without landing. */
function falling() {
  const deps = depsPlates({ hauteur: () => -20 });
  const s = createHeroState(0, 0, 0, 10, 2.2);
  stepHero(s, immobile, DT, deps); // the ground gave way: falling
  return { deps, s };
}

describe("stepHero — the glider", () => {
  it("does not open the canopy on the frame the jump starts", () => {
    // The trap this rule exists to avoid: the press that starts a jump is a rising edge on the
    // very frame it sets `airborne`.
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    const evts = stepHero(s, jumping, DT, deps);
    expect(evts.some((e) => e.t === "saut")).toBe(true);
    expect(evts.some((e) => e.t === "glider-open")).toBe(false);
    expect(s.gliding).toBe(false);
  });

  it("never opens the canopy while the jump key is merely held", () => {
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    for (let i = 0; i < 40; i++) {
      expect(stepHero(s, jumping, DT, deps).some((e) => e.t === "glider-open")).toBe(false);
    }
    expect(s.gliding).toBe(false);
  });

  it("opens the canopy on a fresh press while airborne, and pins the descent at once", () => {
    const { deps, s } = falling();
    const evts = stepHero(s, jumping, DT, deps);
    expect(evts.some((e) => e.t === "glider-open")).toBe(true);
    expect(s.gliding).toBe(true);
    expect(s.vy).toBeCloseTo(-deps.hero.glide.fall, 6);
  });

  it("descends at a constant speed and never gains altitude", () => {
    const { deps, s } = falling();
    stepHero(s, jumping, DT, deps);
    let precedent = s.y;
    for (let i = 0; i < 120; i++) {
      stepHero(s, immobile, DT, deps);
      expect(s.vy).toBeCloseTo(-deps.hero.glide.fall, 6);
      expect(s.y).toBeLessThan(precedent);
      precedent = s.y;
    }
  });

  it("folds the canopy on another press, and the fall resumes under gravity", () => {
    const { deps, s } = falling();
    stepHero(s, jumping, DT, deps);
    stepHero(s, immobile, DT, deps); // key released
    const evts = stepHero(s, jumping, DT, deps);
    expect(evts.some((e) => e.t === "glider-close")).toBe(true);
    expect(s.gliding).toBe(false);
    const avant = s.vy;
    stepHero(s, immobile, DT, deps);
    expect(s.vy).toBeLessThan(avant);
  });

  it("folds the canopy on landing", () => {
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    stepHero(s, jumping, DT, deps); // take off
    stepHero(s, immobile, DT, deps); // key released
    stepHero(s, jumping, DT, deps); // canopy open
    expect(s.gliding).toBe(true);

    let ferme = false;
    for (let i = 0; i < 200 && !ferme; i++) {
      for (const e of stepHero(s, immobile, DT, deps)) {
        if (e.t === "glider-close") ferme = true;
      }
    }
    expect(ferme).toBe(true);
    expect(s.gliding).toBe(false);
    expect(s.airborne).toBe(false);
  });

  it("folds the canopy when the hero drops into water", () => {
    const deps = depsPlates({ hauteur: () => null });
    const s = createHeroState(0, 0, 0, 10, 2.2);
    s.airborne = true;
    s.y = 4;
    s.gliding = true;

    let ferme = false;
    for (let i = 0; i < 400 && !ferme; i++) {
      for (const e of stepHero(s, immobile, DT, deps)) {
        if (e.t === "glider-close") ferme = true;
      }
    }
    expect(ferme).toBe(true);
    expect(s.gliding).toBe(false);
    expect(s.swimming).toBe(true);
  });

  it("refuses to open the canopy while swimming", () => {
    const deps = depsPlates({ hauteur: () => null });
    const s = createHeroState(0, 0, 0, 10, 2.2);
    s.swimming = true;
    const evts = stepHero(s, jumping, DT, deps);
    expect(evts.some((e) => e.t === "glider-open")).toBe(false);
    expect(s.gliding).toBe(false);
  });

  it("refuses to open the canopy indoors", () => {
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    s.room = { x0: -5, x1: 5, z0: -5, z1: 5, y: 0, obstacles: [] };
    s.airborne = true;
    const evts = stepHero(s, jumping, DT, deps);
    expect(evts.some((e) => e.t === "glider-open")).toBe(false);
    expect(s.gliding).toBe(false);
  });

  it("folds the canopy when the hero walks into a room mid-glide", () => {
    // The fold invariant's `state.room` clause, alongside `!state.airborne`/`state.swimming`.
    // `s.room` is set directly here, the same way the adapter (`hero.ts`'s `setRoom`) would set
    // it right before calling `stepHero` again after the hero crosses a doorway mid-glide.
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    s.airborne = true;
    s.gliding = true;
    s.room = { x0: -5, x1: 5, z0: -5, z1: 5, y: 0, obstacles: [] };
    const evts = stepHero(s, immobile, DT, deps);
    expect(evts.some((e) => e.t === "glider-close")).toBe(true);
    expect(s.gliding).toBe(false);
  });

  it("does not misread a jump key held across a room visit as a fresh press on exit", () => {
    // The whole reason `jumpPressed`'s latch (`state.jumpHeld`) is updated ONCE, before every
    // branch, rather than only inside the outdoor/airborne branch: a key held the entire time
    // indoors, where no jump/glide branch runs at all, must not look like a brand new press the
    // moment the hero steps back outside.
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    s.room = { x0: -5, x1: 5, z0: -5, z1: 5, y: 0, obstacles: [] };

    // Pressed, then held, for several indoor frames — no jump/glide branch runs indoors, but the
    // latch must still track the key.
    stepHero(s, jumping, DT, deps);
    expect(s.jumpHeld).toBe(true);
    stepHero(s, jumping, DT, deps);
    stepHero(s, jumping, DT, deps);
    expect(s.jumpHeld).toBe(true);

    // Leaves the room with the SAME press still held, already mid-air (as if the hero walked off
    // a ledge right at the doorway) — a fresh press here WOULD open the canopy. If the latch had
    // only updated inside the outdoor branch, `jumpHeld` would still read the stale pre-room
    // value and this step would misread the held key as new.
    s.room = null;
    s.airborne = true;
    const evts = stepHero(s, jumping, DT, deps);
    expect(evts.some((e) => e.t === "glider-open")).toBe(false);
    expect(evts.some((e) => e.t === "saut")).toBe(false);
    expect(s.gliding).toBe(false);
  });
});
