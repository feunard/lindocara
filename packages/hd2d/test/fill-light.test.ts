import { describe, expect, it } from "vitest";
import { fillAmount } from "../src/fill-light.js";

describe("fillAmount", () => {
  it("ne donne rien à un sprite qui fait face à la source", () => {
    // L'appoint est proportionnel à ce que la VRAIE lumière rate. Face à la flamme, elle ne rate
    // rien : c'est la lumière ponctuelle qui joue, avec ses ombres portées.
    expect(fillAmount({ dot: 1, intensity: 13, distance: 3 })).toBe(0);
  });

  it("donne le maximum à un sprite qui lui tourne le dos", () => {
    // Un plan qui regarde la caméra ne peut rien recevoir d'une source placée derrière lui : son
    // produit scalaire vaut -0.97 et aucun réglage de lumière n'y change quoi que ce soit. C'est
    // pourtant là qu'on attend de voir le héros éclairé.
    expect(fillAmount({ dot: -1, intensity: 13, distance: 3 })).toBeCloseTo((13 / 9) * 0.42);
  });

  it("ne dépend plus que de la distance une fois les deux termes additionnés", () => {
    // dot + manque = 1 partout : le total ne dépend plus de l'orientation.
    const d = 4;
    for (const dot of [-1, -0.3, 0, 0.5, 1]) {
      const manque = 1 - Math.max(0, dot);
      expect(fillAmount({ dot, intensity: 10, distance: d })).toBeCloseTo(
        Math.min(1.6, (10 / (d * d)) * manque * 0.42),
      );
    }
  });

  it("s'éteint avec la source", () => {
    expect(fillAmount({ dot: -1, intensity: 0, distance: 2 })).toBe(0);
  });

  it("plafonne, pour qu'un sprite collé au foyer ne parte pas au blanc", () => {
    expect(fillAmount({ dot: -1, intensity: 400, distance: 0.1 })).toBe(1.6);
  });

  it("plancher de distance à 0.6 : un sprite au contact ne divise pas par zéro", () => {
    expect(fillAmount({ dot: -1, intensity: 1, distance: 0 })).toBeCloseTo(
      Math.min(1.6, (1 / 0.36) * 0.42),
    );
  });
});
