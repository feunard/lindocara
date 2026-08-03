import { describe, expect, it } from "vitest";
import { createHeroState } from "../src/world/hero-state.js";
import { stepHero } from "../src/world/hero-step.js";
import { createThinIce } from "../src/world/thin-ice.js";
import { depsPlates } from "./helpers/step-deps.js";

const immobile = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false };

function depsGlace() {
  const glace = createThinIce({ seuilCraquement: 0.5, seuilRupture: 1.4, regel: 6 });
  return { ...depsPlates({ matiere: () => "glace-fine" }), glace };
}

describe("stepHero — la glace fine", () => {
  it("craque sous le poids, puis cède", () => {
    const deps = depsGlace();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    const vus: string[] = [];
    for (let i = 0; i < 120; i++) {
      for (const e of stepHero(s, immobile, 1 / 60, deps)) {
        if (e.t === "glace-craque" || e.t === "glace-rompt") vus.push(e.t);
      }
    }
    expect(vus).toEqual(["glace-craque", "glace-rompt"]);
    expect(s.swimming).toBe(true);
  });

  it("ne charge rien quand on saute par-dessus", () => {
    // « Sous le poids » est tout le mécanisme : survoler ne doit rien user.
    const deps = depsGlace();
    const s = createHeroState(0, 3, 0, 10, 2.2);
    s.airborne = true;
    s.vy = 1;
    for (let i = 0; i < 60; i++) stepHero(s, immobile, 1 / 60, deps);
    expect(deps.glace.etat("36,36")).toBe("intacte");
  });

  it("fait tomber celui qui revient à pied sur un trou déjà ouvert", () => {
    const deps = depsGlace();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    for (let i = 0; i < 120; i++) stepHero(s, immobile, 1 / 60, deps);
    // Sorti de l'eau, on remet le pied sur la MÊME case, encore rompue.
    s.swimming = false;
    s.y = 0;
    const evts = stepHero(s, immobile, 1 / 60, deps);
    expect(evts.some((e) => e.t === "entree-eau" && e.rupture)).toBe(true);
  });
});
