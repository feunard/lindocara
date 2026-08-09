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
});
