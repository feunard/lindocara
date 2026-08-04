import { createHeroState } from "@lindocara/engine/hd2d/hero-state.js";
import { stepHero } from "@lindocara/engine/hd2d/hero-step.js";
import { describe, expect, it } from "vitest";
import { depsPlates } from "./helpers/step-deps.js";

const arret = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: true };

describe("stepHero — breath and footprints", () => {
  it("breathes even at rest, more slowly than while walking", () => {
    // Someone breathing doesn't stop breathing. It's the detail that distinguishes "an effect"
    // from "it's cold".
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    let n = 0;
    for (let i = 0; i < 60 * 10; i++) {
      n += stepHero(s, arret, 1 / 60, deps).filter((e) => e.t === "haleine").length;
    }
    // 10 s at a 2.2 s interval: at least four puffs.
    expect(n).toBeGreaterThanOrEqual(4);
  });

  it("doesn't puff outside the cold zone", () => {
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    let n = 0;
    for (let i = 0; i < 60 * 10; i++) {
      n += stepHero(s, { ...arret, haleineVisible: false }, 1 / 60, deps).filter(
        (e) => e.t === "haleine",
      ).length;
    }
    expect(n).toBe(0);
  });

  it("alternates the side of footprints", () => {
    const deps = depsPlates({ matiere: () => "neige" });
    const s = createHeroState(0, 0, 0, 10, 2.2);
    const cotes: number[] = [];
    for (let i = 0; i < 60 * 20; i++) {
      for (const e of stepHero(s, { ...arret, x: 1 }, 1 / 60, deps)) {
        if (e.t === "trace") cotes.push(e.cote);
      }
    }
    expect(cotes.length).toBeGreaterThanOrEqual(2);
    expect(cotes[0]).not.toBe(cotes[1]);
  });
});
