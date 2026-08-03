import { describe, expect, it } from "vitest";
import { createHeroState } from "../src/world/hero-state.js";
import { stepHero } from "../src/world/hero-step.js";
import { depsPlates } from "./helpers/step-deps.js";

const arret = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: true };

describe("stepHero — souffle et traces", () => {
  it("souffle même à l'arrêt, plus lentement qu'en marchant", () => {
    // Quelqu'un qui respire ne s'arrête pas de respirer. C'est le détail qui distingue « un
    // effet » de « il fait froid ».
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    let n = 0;
    for (let i = 0; i < 60 * 10; i++) {
      n += stepHero(s, arret, 1 / 60, deps).filter((e) => e.t === "haleine").length;
    }
    // 10 s à un intervalle de 2,2 s : quatre bouffées au moins.
    expect(n).toBeGreaterThanOrEqual(4);
  });

  it("ne souffle pas hors de la zone froide", () => {
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

  it("alterne le côté des traces", () => {
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
