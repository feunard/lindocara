import { describe, expect, it } from "vitest";
import { createHeroState } from "../src/world/hero-state.js";
import { stepHero } from "../src/world/hero-step.js";
import { depsPlates } from "./helpers/step-deps.js";

const immobile = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false };

describe("stepHero — la verticale", () => {
  it("saute, retombe, et annonce sa réception", () => {
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

  it("pardonne le saut quelques images après avoir quitté le bord", () => {
    // Le coyote time : sans lui, sauter au bord exact d'une falaise rate une fois sur deux.
    const deps = depsPlates({ hauteur: (x) => (x < 1 ? 0 : null) });
    const s = createHeroState(0.99, 0, 0, 10, 2.2);
    s.airborne = true;
    s.coyote = deps.hero.jump.coyote;
    const evts = stepHero(s, { ...immobile, jump: true }, 1 / 60, deps);
    expect(evts.some((e) => e.t === "saut")).toBe(true);
  });

  it("ne saute plus une fois le coyote épuisé", () => {
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    s.airborne = true;
    s.coyote = 0;
    const evts = stepHero(s, { ...immobile, jump: true }, 1 / 60, deps);
    expect(evts.some((e) => e.t === "saut")).toBe(false);
  });
});
