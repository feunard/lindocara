import { describe, expect, it } from "vitest";
import { billboardHeight, facingToFlip } from "../src/billboard.js";

const PITCH = (38 * Math.PI) / 180;

describe("billboardHeight", () => {
  it("ne compense rien à stretch 0", () => {
    expect(billboardHeight({ height: 2.6, pitch: PITCH, stretch: 0 })).toBeCloseTo(2.6);
  });

  it("annule complètement l'écrasement à stretch 1", () => {
    // Une caméra qui plonge de 38° écrase un plan vertical d'un facteur cos(38°).
    expect(billboardHeight({ height: 2.6, pitch: PITCH, stretch: 1 })).toBeCloseTo(
      2.6 / Math.cos(PITCH),
    );
  });

  it("interpole entre les deux au réglage par défaut", () => {
    expect(billboardHeight({ height: 2.6, pitch: PITCH, stretch: 0.85 })).toBeCloseTo(
      2.6 * (1 + (1 / Math.cos(PITCH) - 1) * 0.85),
    );
  });

  it("ne compense rien sans plongée", () => {
    expect(billboardHeight({ height: 2.6, pitch: 0, stretch: 1 })).toBeCloseTo(2.6);
  });
});

describe("facingToFlip", () => {
  it("miroite sur l'axe est-ouest", () => {
    expect(facingToFlip("east", false)).toBe(false);
    expect(facingToFlip("west", false)).toBe(true);
  });

  it("laisse le profil courant intact au nord et au sud", () => {
    // Les unités Tiny Swords n'ont que le profil : aucune frame de face, aucune de dos. Se
    // retourner n'a donc rien à jouer, et remettre le sprite d'aplomb serait un saut visible.
    expect(facingToFlip("north", true)).toBe(true);
    expect(facingToFlip("south", false)).toBe(false);
  });
});
