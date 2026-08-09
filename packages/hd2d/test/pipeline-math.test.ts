import { describe, expect, it } from "vitest";
import { pipelineViewport, tiltShiftRadius } from "../src/pipeline.js";

describe("tiltShiftRadius", () => {
  it("ne change rien à la distance de référence", () => {
    // À k = 1, la vue par défaut doit être exactement inchangée : le zoom ne doit rien coûter
    // tant qu'on n'a pas zoomé.
    expect(tiltShiftRadius(5.5, 0.7, 1)).toBeCloseTo(5.5);
  });

  it("renforce l'effet maquette quand on recule", () => {
    // Reculer doit renforcer l'effet maquette, pas l'aplatir.
    expect(tiltShiftRadius(5.5, 0.7, 2)).toBeCloseTo(5.5 * 1.7);
    expect(tiltShiftRadius(5.5, 0.7, 0.5)).toBeCloseTo(5.5 * 0.65);
  });

  it("ne descend jamais sous zéro", () => {
    // Un rayon négatif ferait un flou à taps inversés — l'image part en miroir par bandes.
    expect(tiltShiftRadius(5.5, 3, 0.1)).toBe(0);
  });
});

describe("pipelineViewport", () => {
  it("utilise la taille CSS du canvas embarque plutot que celle de la fenetre", () => {
    expect(
      pipelineViewport({
        clientWidth: 640,
        clientHeight: 360,
        fallbackWidth: 1920,
        fallbackHeight: 1080,
        devicePixelRatio: 3,
      }),
    ).toEqual({ width: 640, height: 360, pixelRatio: 2 });
  });

  it("retombe sur une taille valide avant la premiere mise en page", () => {
    expect(
      pipelineViewport({
        clientWidth: 0,
        clientHeight: 0,
        fallbackWidth: 800,
        fallbackHeight: 600,
        devicePixelRatio: 0,
      }),
    ).toEqual({ width: 800, height: 600, pixelRatio: 1 });
  });
});
