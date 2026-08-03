import { describe, expect, it } from "vitest";
import { createHeroState } from "../src/world/hero-state.js";
import { stepHero } from "../src/world/hero-step.js";
import { depsPlates } from "./helpers/step-deps.js";

describe("stepHero — déplacement horizontal", () => {
  it("accélère vers la vitesse de la matière et s'y stabilise", () => {
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
    // Régime établi = `accel / friction` = la vitesse de la matière, à l'erreur machine près.
    expect(s.vx).toBeCloseTo(deps.hero.speed, 3);
    expect(s.vz).toBeCloseTo(0, 6);
  });

  it("annule la vitesse sur l'axe refusé, pas sur l'autre", () => {
    // Un mur en x : on doit continuer de glisser le long, en z. C'est ce que le test axe par axe
    // achète, et c'est exactement ce que la Task 8 ne doit pas casser en passant aux rectangles.
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

  it("émet un pas quand on se propulse, jamais quand on glisse", () => {
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    // Lancé sans aucune entrée : c'est une glisse, pas une marche.
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
