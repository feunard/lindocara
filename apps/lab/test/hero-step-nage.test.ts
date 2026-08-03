import { describe, expect, it } from "vitest";
import { createHeroState } from "../src/world/hero-state.js";
import { stepHero } from "../src/world/hero-step.js";
import { depsPlates } from "./helpers/step-deps.js";

const immobile = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false };

describe("stepHero — la nage", () => {
  it("entre à l'eau en tombant du bord, et l'annonce une seule fois", () => {
    const deps = depsPlates({ hauteur: (x) => (x < 0 ? 0 : null) });
    const s = createHeroState(-0.05, 0, 0, 10, 2.2);
    let entrees = 0;
    for (let i = 0; i < 120; i++) {
      const evts = stepHero(s, { ...immobile, x: 1 }, 1 / 60, deps);
      entrees += evts.filter((e) => e.t === "entree-eau").length;
    }
    expect(s.swimming).toBe(true);
    expect(entrees).toBe(1);
  });

  it("consomme le souffle au taux fourni par la zone, puis se noie", () => {
    const deps = depsPlates({ hauteur: () => null });
    const s = createHeroState(0, 0, 0, 2, 2.2);
    s.swimming = true;
    // Taux 2 : l'eau polaire consomme deux fois plus vite. Un souffle de 2 s doit donc tenir 1 s.
    let noyades = 0;
    for (let i = 0; i < 90; i++) {
      noyades += stepHero(s, { ...immobile, souffleTaux: 2 }, 1 / 60, deps).filter(
        (e) => e.t === "noyade",
      ).length;
    }
    expect(noyades).toBe(1);
  });

  it("se hisse sur une rive de plain-pied, jamais sur une falaise", () => {
    const hauteM = depsPlates({ hauteur: (x) => (x > 0 ? 5 : null) });
    const s = createHeroState(-0.01, 0, 0, 10, 2.2);
    s.swimming = true;
    for (let i = 0; i < 60; i++) stepHero(s, { ...immobile, x: 1 }, 1 / 60, hauteM);
    expect(s.swimming).toBe(true);
  });

  // Le piège découvert par l'île de neige (voir le brief de la Task 4, et la docstring de
  // `compteCommeEau` dans `thin-ice.ts`) : une case de glace fine ROMPUE garde la hauteur réelle,
  // non nulle, du terrain qu'elle recouvre — seule sa MATIÈRE change (`kindAt`), jamais son champ
  // de hauteur (`heightAt`). Sans le garde `compteCommeEau`, `sol !== null` suffirait à lui seul à
  // faire ressortir le héros de l'eau une image après y être tombé à travers la glace, avant même
  // que le souffle ait eu le temps de baisser. Le correctif (le garde en `&&` avec `sol !== null`)
  // est déjà dans le code transposé — ce test le couvre, ce qu'aucune lecture de code n'avait fait.
  it("ne remonte pas toute seule sur une case de glace rompue posée sur un terrain de hauteur non nulle", () => {
    const rompue = {
      charge: () => "rompue" as const,
      relache: () => {},
      update: () => {},
      etat: () => "rompue" as const,
      taille: () => 0,
    };
    // Hauteur non nulle PARTOUT : reproduit une case de glace fine posée sur un terrain élevé —
    // le trou qu'elle a laissé garde la même hauteur de terrain que le reste de l'île.
    const deps = { ...depsPlates({ hauteur: () => 5 }), glace: rompue };
    const s = createHeroState(0, 0, 0, 10, 2.2);
    s.swimming = true;
    const evts = stepHero(s, immobile, 1 / 60, deps);
    expect(s.swimming).toBe(true);
    expect(evts.some((e) => e.t === "sortie-eau")).toBe(false);
  });
});
