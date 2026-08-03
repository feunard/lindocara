import { describe, expect, it } from "vitest";
import type { HeroState, StepDeps } from "../src/world/hero-state.js";
import { createHeroState } from "../src/world/hero-state.js";
import { stepHero } from "../src/world/hero-step.js";
import { createThinIce } from "../src/world/thin-ice.js";
import { depsPlates } from "./helpers/step-deps.js";

const immobile = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false };

function depsGlace() {
  const glace = createThinIce({ seuilCraquement: 0.5, seuilRupture: 1.4, regel: 6 });
  return { ...depsPlates({ matiere: () => "glace-fine" }), glace };
}

/** Même formule que `caseDe`, interne à `hero-step.ts` (duplication à dessein, comme le fichier
 *  source lui-même le documente) — reproduite ici pour dériver la clef de case depuis la position
 *  RÉELLE du héros après le pas, plutôt que de la coder en dur : c'est exactement ce codage en dur
 *  qui a laissé passer un test qui ne prouvait rien (voir task-5-report.md). */
function caseAttendue(s: HeroState, deps: StepDeps): string {
  const demiGrille = deps.world.size / 2;
  const zPied = s.z - deps.hero.offset;
  return `${Math.floor(s.x + demiGrille)},${Math.floor(zPied + demiGrille)}`;
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
    // « Sous le poids » est tout le mécanisme : survoler ne doit rien user. Le héros doit être
    // RÉELLEMENT en l'air — une vraie chute depuis une hauteur, `vy` posé à 0 pour laisser la
    // gravité seule décider, jamais un `airborne = true` maquillé au niveau du sol — et la case
    // interrogée doit être celle qu'il occupe VRAIMENT, dérivée de sa position après le pas
    // (`caseAttendue`, plus bas), jamais codée en dur. Une clef en dur peut rester « intacte »
    // pour une tout autre raison qu'un héros ne traverse jamais réellement (revue de ce test :
    // avec la signature `createHeroState(x, z, y, …)`, l'ancienne version posait le héros AU SOL
    // et interrogeait une case qu'il n'occupait jamais).
    const deps = depsGlace();
    const s = createHeroState(0, 0, 6, 10, 2.2);
    s.airborne = true;
    // 40 images à 60 Hz (~0,67 s) : encore loin des ~65 images que prendrait la chute continue
    // depuis y=6 avec cette gravité — large marge pour ne jamais toucher le sol pendant la
    // fenêtre observée, tout en dépassant largement le seuil de craquement (0,5 s) SI le garde
    // `!state.airborne` était retiré (voir la preuve par sabotage, task-5-report.md).
    for (let i = 0; i < 40; i++) stepHero(s, immobile, 1 / 60, deps);
    expect(s.airborne).toBe(true);
    expect(deps.glace.etat(caseAttendue(s, deps))).toBe("intacte");
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
