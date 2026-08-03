import { describe, expect, it } from "vitest";
import { createHeroState } from "../src/world/hero-state.js";
import { stepHero } from "../src/world/hero-step.js";
import { depsPlates } from "./helpers/step-deps.js";

const immobile = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false };
const piece = { x0: -2, x1: 2, z0: -2, z1: 2, y: 5, obstacles: [{ x: 0, z: 1, r: 0.5 }] };

describe("stepHero — en intérieur", () => {
  // `it.fails` — et NON une assertion ajustée à ce que le code fait (interdit par le brief de
  // cette task) : `state.room` n'aplatit la verticale qu'AU DÉBUT du bloc (`hero-step.ts`,
  // `if (state.room) { state.y = state.room.y; airborne = false; … }`), mais le réarmement du
  // saut par le coyote-time juste en dessous n'est jamais gardé par `!state.room`. Sur CE tick
  // (coyote initial à 0, donc fraîchement remis à `hero.jump.coyote` par la branche `else` du sol),
  // `input.jump` arme quand même : `state.y` finit à 5.095 au lieu de 5, `airborne` à `true`, et un
  // événement "saut" est rendu — en pièce, où aucun des trois ne devrait se produire.
  //
  // Vérifié sur git history : CE N'EST PAS une régression des Tasks 2/3. La même structure —
  // aplatissement du bloc `if (piece)` SANS garde sur le réarmement du saut juste après — existe
  // déjà telle quelle dans `hero.ts` au commit `8295f200`, avant même le premier commit de ce
  // chantier (`daf0a41e`) : un bug latent du PoC original, jamais couvert par un test avant cette
  // task, que l'extraction a fidèlement porté (l'objectif affiché du chantier), pas introduit.
  // Voir task-6-report.md pour le détail. Laissé en l'état plutôt que corrigé : la correction
  // (garder le réarmement du saut derrière `!state.room`) change un comportement de jeu déjà validé
  // task par task, hors du périmètre de cet audit.
  it.fails("garde le plancher plat : ni gravité, ni nage, ni saut", () => {
    const deps = depsPlates({ hauteur: () => null });
    const s = createHeroState(0, 0, 0, 10, 2.2);
    s.room = piece;
    const evts = stepHero(s, { ...immobile, jump: true }, 1 / 60, deps);
    expect(s.y).toBe(5);
    expect(s.airborne).toBe(false);
    expect(s.swimming).toBe(false);
    expect(evts.some((e) => e.t === "saut")).toBe(false);
  });

  it("ne sort pas du rectangle et contourne les meubles", () => {
    const deps = depsPlates();
    // (x, z, y, breath, reposHaleine) — PAS (x, y, z). Le brief donnait `createHeroState(0, 5, 0, …)`,
    // ce qui place en réalité le héros à z=5, hors du rectangle (z1=2) : le test resterait vert même
    // la règle de bornage entièrement retirée, puisque `canEnter` refuserait alors TOUT mouvement
    // (z toujours hors pièce), pas seulement celui qui dépasse x1. On place ici le héros à l'intérieur,
    // au niveau du plancher (y=5, la hauteur de `piece`), pour que le test prouve bien ce qu'il nomme.
    const s = createHeroState(0, 0, 5, 10, 2.2);
    s.room = piece;
    for (let i = 0; i < 300; i++) stepHero(s, { ...immobile, x: 1 }, 1 / 60, deps);
    // Assertion sur l'état plutôt que de le supposer (voir plus haut) : le plancher de pièce doit
    // rester actif tout du long, pas seulement au premier pas.
    expect(s.airborne).toBe(false);
    expect(s.x).toBeLessThan(2);
  });

  it("laisse ressortir celui qui chevauche déjà un meuble", () => {
    // L'échappatoire : sans elle, un héros posé sur un meuble est cimenté sur place.
    const deps = depsPlates();
    // Même correction d'ordre que ci-dessus : z=1 pose le héros PILE sur l'obstacle
    // (x:0, z:1, r:0.5) de `piece`, y=5 au niveau du plancher.
    const s = createHeroState(0, 1, 5, 10, 2.2);
    s.room = piece;
    for (let i = 0; i < 60; i++) stepHero(s, { ...immobile, z: -1 }, 1 / 60, deps);
    expect(s.z).toBeLessThan(1);
  });
});
