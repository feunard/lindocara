import { describe, expect, it } from "vitest";
import { HERO } from "../src/settings.js";
import { derapage, frictionPour, pasAmorti, vitesseMaxPour } from "../src/world/locomotion.js";

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
    const f = frictionPour("herbe");
    const v = apres(2, f, HERO.speed * f);
    expect(v).toBeCloseTo(HERO.speed, 3);
  });

  it("sur l'herbe, atteint sa vitesse en deux images et s'arrête en deux images", () => {
    // C'est la définition opérationnelle d'« indiscernable de l'ancien modèle » : le joueur ne
    // peut pas percevoir deux images. Une égalité stricte est impossible — un amorti exponentiel
    // n'atteint sa cible qu'asymptotiquement — donc on pin le TEMPS, pas la trajectoire.
    const f = frictionPour("herbe");
    const accel = HERO.speed * f;
    expect(apres(2 / 60, f, accel)).toBeGreaterThan(HERO.speed * 0.9);
    // Puis relâché : la vitesse retombe sous 10 % en deux images.
    let v = HERO.speed;
    for (let i = 0; i < 2; i++) v = pasAmorti(v, 0, accel, f, 1 / 60);
    expect(v).toBeLessThan(HERO.speed * 0.1);
  });

  it("sur la glace, garde son élan bien après le relâchement", () => {
    const f = frictionPour("glace");
    let v = HERO.speed;
    for (let i = 0; i < 60; i++) v = pasAmorti(v, 0, HERO.speed * f, f, 1 / 60);
    // Une seconde plus tard, il glisse encore à plus de la moitié de sa vitesse.
    expect(v).toBeGreaterThan(HERO.speed * 0.5);
  });

  it("sur la neige, plafonne plus bas que sur l'herbe", () => {
    expect(vitesseMaxPour("neige")).toBeLessThan(vitesseMaxPour("herbe"));
    expect(frictionPour("neige")).toBeGreaterThan(frictionPour("herbe"));
  });

  it("ordonne les trois frictions dans le sens qui fait le jeu", () => {
    expect(frictionPour("glace")).toBeLessThan(frictionPour("herbe"));
    expect(frictionPour("herbe")).toBeLessThan(frictionPour("neige"));
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
