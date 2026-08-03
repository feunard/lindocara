import { describe, expect, it } from "vitest";
import { HERO } from "../src/settings.js";
import type { HeroSettings } from "../src/world/hero-state.js";
import {
  derapage,
  frictionPour,
  pasAmorti,
  sePropulse,
  vitesseMaxPour,
} from "../src/world/locomotion.js";

// `frictionPour`/`vitesseMaxPour` prennent désormais un `HeroSettings` (`hero-state.ts`) complet
// plutôt que d'importer `HERO` eux-mêmes (Task 2) — c'est ce qui leur permet de partir dans
// `@lindocara/engine` sans emporter les réglages du labo. `HERO` (`settings.ts`) n'a pas les
// quatre champs de cadence de `HeroSettings` (ils n'existaient pas avant cette task) : ce fixture
// leur donne une valeur de test, jamais lue par `frictionPour`/`vitesseMaxPour`.
const HERO_STEP: HeroSettings = {
  speed: HERO.speed,
  radius: HERO.radius,
  offset: HERO.offset,
  friction: HERO.friction,
  vitesseSol: HERO.vitesseSol,
  jump: HERO.jump,
  swim: HERO.swim,
  pasTousLes: 1.2,
  brasseTousLes: 0.85,
  haleineRepos: 2.2,
  traceEcart: 0.14,
};

/** Rejoue N pas de temps à entrée constante et rend la vitesse atteinte. */
function apres(secondes: number, friction: number, accel: number, dt = 1 / 60): number {
  let v = 0;
  for (let t = 0; t < secondes; t += dt) v = pasAmorti(v, 1, accel, friction, dt);
  return v;
}

describe("le modèle à friction", () => {
  it("atteint exactement la vitesse du héros en régime établi, sur l'herbe", () => {
    // La vitesse d'équilibre vaut accel / friction : c'est ce qui permet de garder HERO.speed
    // comme LA vitesse de référence au lieu d'un nombre qui ne veut plus rien dire.
    const f = frictionPour("herbe", HERO_STEP);
    const v = apres(2, f, HERO.speed * f);
    expect(v).toBeCloseTo(HERO.speed, 3);
  });

  it("sur l'herbe, atteint sa vitesse en deux images et s'arrête en deux images", () => {
    // C'est la définition opérationnelle d'« indiscernable de l'ancien modèle » : le joueur ne
    // peut pas percevoir deux images. Une égalité stricte est impossible — un amorti exponentiel
    // n'atteint sa cible qu'asymptotiquement — donc on pin le TEMPS, pas la trajectoire.
    const f = frictionPour("herbe", HERO_STEP);
    const accel = HERO.speed * f;
    expect(apres(2 / 60, f, accel)).toBeGreaterThan(HERO.speed * 0.9);
    // Puis relâché : la vitesse retombe sous 10 % en deux images.
    let v = HERO.speed;
    for (let i = 0; i < 2; i++) v = pasAmorti(v, 0, accel, f, 1 / 60);
    expect(v).toBeLessThan(HERO.speed * 0.1);
  });

  it("sur la glace, garde son élan bien après le relâchement", () => {
    const f = frictionPour("glace", HERO_STEP);
    let v = HERO.speed;
    for (let i = 0; i < 60; i++) v = pasAmorti(v, 0, HERO.speed * f, f, 1 / 60);
    // Une seconde plus tard, il glisse encore à plus de la moitié de sa vitesse.
    expect(v).toBeGreaterThan(HERO.speed * 0.5);
  });

  it("sur la neige, plafonne plus bas que sur l'herbe", () => {
    expect(vitesseMaxPour("neige", HERO_STEP)).toBeLessThan(vitesseMaxPour("herbe", HERO_STEP));
    expect(frictionPour("neige", HERO_STEP)).toBeGreaterThan(frictionPour("herbe", HERO_STEP));
  });

  it("ordonne les trois frictions dans le sens qui fait le jeu", () => {
    expect(frictionPour("glace", HERO_STEP)).toBeLessThan(frictionPour("herbe", HERO_STEP));
    expect(frictionPour("herbe", HERO_STEP)).toBeLessThan(frictionPour("neige", HERO_STEP));
  });

  it("ne rend jamais une vitesse infinie ni NaN, même à dt aberrant", () => {
    // La boucle plafonne dt à 0.05, mais un module qui partira dans `engine` doit tenir un dt
    // que le serveur pourrait lui passer.
    for (const dt of [0, 1e-6, 0.05, 1, 10]) {
      const v = pasAmorti(3, 1, 100, 8, dt);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("le dérapage (le son de la glisse, Task 6)", () => {
  it("est nul à l'arrêt, quelle que soit l'entrée", () => {
    expect(derapage(0, 0, 1, 0, HERO.speed)).toBe(0);
    expect(derapage(0, 0, 0, 0, HERO.speed)).toBe(0);
  });

  it("est nul quand la vitesse suit exactement l'entrée, à pleine vitesse", () => {
    expect(derapage(HERO.speed, 0, 1, 0, HERO.speed)).toBeCloseTo(0, 6);
  });

  it("est maximal quand la vitesse s'oppose exactement à l'entrée, à pleine vitesse", () => {
    expect(derapage(HERO.speed, 0, -1, 0, HERO.speed)).toBeCloseTo(1, 6);
  });

  it("vaut la moitié quand vitesse et entrée sont perpendiculaires", () => {
    expect(derapage(HERO.speed, 0, 0, 1, HERO.speed)).toBeCloseTo(0.5, 6);
  });

  it(
    "est maximal entrée relâchée mais vitesse pleine : glisser sur son élan sans direction " +
      "demandée est l'arrêt sur la glace, pas une absence de dérapage",
    () => {
      expect(derapage(HERO.speed, 0, 0, 0, HERO.speed)).toBeCloseTo(1, 6);
    },
  );

  it(
    "descend avec la vitesse : un résidu de dérive à vitesse quasi nulle ne sonne pas à pleine " +
      "intensité, même entrée relâchée",
    () => {
      const plein = derapage(HERO.speed, 0, 0, 0, HERO.speed);
      const residuel = derapage(HERO.speed * 0.05, 0, 0, 0, HERO.speed);
      expect(residuel).toBeLessThan(plein);
      expect(residuel).toBeCloseTo(0.05, 2);
    },
  );

  it("ne dépasse jamais 1 même à vitesse supérieure à la référence", () => {
    expect(derapage(HERO.speed * 3, 0, -1, 0, HERO.speed)).toBeLessThanOrEqual(1);
  });
});

describe("sePropulse — la cadence des pas ne doit sonner que si on se propulse", () => {
  // Le retour d'un pas de glisse sonore (voir le rapport) : la cadence des pas (`hero.ts`) est
  // comptée à la distance parcourue, donc elle se déclenche même en glissant, où le héros avance
  // sans faire un seul pas. Le critère qui distingue les deux n'est PAS la matière du sol (la
  // glace glisse un temps, une fois lancée — voir plus haut — mais on peut aussi y marcher
  // prudemment), c'est le DÉSACCORD DE DIRECTION entre vitesse et entrée : on se propulse quand
  // l'entrée pousse dans le sens de la vitesse, on glisse sinon.
  //
  // `sePropulse` n'a délibérément PAS de paramètre `vitesseRef`, contrairement à `derapage` —
  // voir sa docstring dans `locomotion.ts` pour le bug (trouvé en rejouant la scène, pas en
  // lisant le code) que réutiliser `derapage` telle quelle aurait laissé passer.

  it("glisser sans appuyer sur rien ne propulse pas, à pleine vitesse (cas 1 du rapport)", () => {
    // Entrée nulle, vitesse pleine : le désaccord de direction vaut 1 par construction — maximal,
    // donc jamais de propulsion.
    expect(sePropulse(HERO.speed, 0, 0, 0)).toBe(false);
  });

  it(
    "glisser sans appuyer sur rien ne propulse pas non plus à vitesse FAIBLE — la pondération " +
      "par la vitesse de `derapage` ne doit pas influencer cette décision",
    () => {
      // Le bug réel trouvé en jouant : au tout début d'une glisse sur la glace, la vitesse est
      // encore loin de `HERO.speed` (la glace freine à peine, mais met plusieurs secondes à
      // ACCÉLÉRER). Réutiliser `derapage(...)` telle quelle pour cette décision aurait pondéré le
      // désaccord maximal par cette vitesse encore faible, retombant sous le seuil de 0.5 et
      // laissant sonner des pas en pleine glisse. `sePropulse` n'a pas ce paramètre : il ne peut
      // pas reproduire ce bug par construction.
      expect(sePropulse(HERO.speed * 0.1, 0, 0, 0)).toBe(false);
    },
  );

  it("pousser dans une direction opposée à sa vitesse ne propulse pas (cas 2 du rapport)", () => {
    // On dérape en tournant fort : l'entrée existe, mais elle s'oppose à l'élan encore présent.
    expect(sePropulse(HERO.speed, 0, -1, 0)).toBe(false);
  });

  it("pousser exactement dans le sens de sa vitesse propulse, quelle que soit la matière", () => {
    // C'est le cas 4 du rapport : marcher sur la glace en poussant dans sa direction de
    // déplacement doit continuer à sonner des pas — la glace ne doit pas devenir muette au
    // démarrage. `sePropulse` ne reçoit d'ailleurs aucune matière : rien ne pourrait la
    // distinguer de l'herbe (cas 3) à ce niveau, par construction.
    expect(sePropulse(HERO.speed, 0, 1, 0)).toBe(true);
  });

  it("à l'arrêt ou en tout début d'accélération (vitesse quasi nulle), propulse par défaut", () => {
    // Le désaccord de direction rend 0 sous 1e-3 de vitesse : la toute première image d'une
    // accélération ne doit pas être lue comme un dérapage.
    expect(sePropulse(0, 0, 1, 0)).toBe(true);
  });

  it("perpendiculaire (le pivot exact du désaccord, 0.5) ne propulse pas", () => {
    // Le seuil est STRICT sous 0.5 : à la valeur pivot elle-même, on considère qu'on n'est plus
    // franchement dans le sens de la vitesse. Vérifié à vitesse pleine, où `derapage` (pondéré)
    // et le désaccord nu coïncident.
    expect(derapage(HERO.speed, 0, 0, 1, HERO.speed)).toBeCloseTo(0.5, 6);
    expect(sePropulse(HERO.speed, 0, 0, 1)).toBe(false);
  });
});
