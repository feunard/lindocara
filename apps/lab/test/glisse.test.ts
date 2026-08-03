import { describe, expect, it } from "vitest";
import { type Glissement, glissementSuivant } from "../src/world/locomotion.js";

const AVANT: { x: number; z: number } = { x: 1, z: 0 };
const RIEN: { x: number; z: number } = { x: 0, z: 0 };

// La règle de Pokémon Argent (Task 7b) : entrer sur la glace verrouille la direction, l'entrée est
// ignorée pendant la glisse, et on file tout droit jusqu'à la dernière case de glace. Pure —
// aucune de ces cases n'a de coordonnées, de héros ni de collider : seulement des matières et une
// entrée (voir la docstring de `glissementSuivant`, `world/locomotion.ts`, pour le POURQUOI).
describe("glissementSuivant — la glisse verrouillée (règle Pokémon)", () => {
  it("verrouille dans la direction de l'entrée une fois SUR la glace", () => {
    // Sous les pieds ET devant de la glace : c'est le moment précis où la règle verrouille — on
    // vient d'y poser le pied (voir le test suivant pour le pas d'avant, où ça ne verrouille pas
    // encore).
    expect(glissementSuivant(null, AVANT, "glace", "glace")).toEqual({ dirX: 1, dirZ: 0 });
  });

  it("verrouille aussi sur la glace fine — elle glisse EXACTEMENT comme la glace pour cette règle", () => {
    expect(glissementSuivant(null, { x: 0, z: 1 }, "glace-fine", "glace-fine")).toEqual({
      dirX: 0,
      dirZ: 1,
    });
  });

  it("ne verrouille pas tant qu'on n'est pas encore SUR la glace, même en s'en approchant", () => {
    // Sous les pieds encore de la neige : la case DEVANT a beau être de la glace, verrouiller ici
    // partirait un pas trop tôt. La matière du sol se lit AVANT de bouger, comme partout ailleurs
    // dans ce module (voir `frictionPour`/`vitesseMaxPour`, appelés sur la matière AVANT le pas de
    // cette image) — un décalage d'une image, imperceptible, jamais plus.
    expect(glissementSuivant(null, AVANT, "neige", "glace")).toBeNull();
  });

  it("ne verrouille pas non plus si la case devant n'est pas glissante", () => {
    // Cas d'une case de glace isolée : si on s'apprête à en ressortir tout de suite (rien de
    // glissant devant), verrouiller enverrait un pas à vitesse de glace vers la matière qui aurait
    // dû arrêter la glisse — exactement le débordement que « on s'arrête sur la dernière case de
    // glace » interdit.
    expect(glissementSuivant(null, AVANT, "glace", "neige")).toBeNull();
  });

  it("pendant la glisse, l'entrée est ignorée — une direction opposée ne fait rien", () => {
    const verrou: Glissement = { dirX: 1, dirZ: 0 };
    expect(glissementSuivant(verrou, { x: -1, z: 0 }, "glace", "glace")).toEqual(verrou);
  });

  it("continue tant que la case suivante est glissante, quelle que soit l'entrée (même nulle)", () => {
    const verrou: Glissement = { dirX: 0, dirZ: 1 };
    expect(glissementSuivant(verrou, RIEN, "glace", "glace-fine")).toEqual(verrou);
  });

  it("s'arrête quand la case suivante n'est plus glissante", () => {
    const verrou: Glissement = { dirX: 1, dirZ: 0 };
    expect(glissementSuivant(verrou, AVANT, "glace", "neige")).toBeNull();
    expect(glissementSuivant(verrou, AVANT, "glace", "herbe")).toBeNull();
    expect(glissementSuivant(verrou, AVANT, "glace", "sable")).toBeNull();
    expect(glissementSuivant(verrou, AVANT, "glace", null)).toBeNull();
  });

  it("ne rend jamais null au milieu d'une étendue glissante — invariant, pas un cas isolé", () => {
    const verrou: Glissement = { dirX: 1, dirZ: 0 };
    for (const devant of ["glace", "glace-fine"] as const) {
      expect(glissementSuivant(verrou, RIEN, "glace", devant)).not.toBeNull();
      expect(glissementSuivant(verrou, { x: -1, z: 0 }, "glace-fine", devant)).not.toBeNull();
    }
  });

  it("entrer sur la glace sans direction ne verrouille rien — ni poussé à l'arrêt, ni tombé dessus", () => {
    expect(glissementSuivant(null, RIEN, "glace", "glace")).toBeNull();
    expect(glissementSuivant(null, RIEN, "glace-fine", "glace-fine")).toBeNull();
  });

  it("herbe/neige/sable ne verrouillent jamais, quelle que soit l'entrée", () => {
    for (const m of ["herbe", "neige", "sable", null] as const) {
      expect(glissementSuivant(null, AVANT, m, m)).toBeNull();
    }
  });

  it("normalise la direction verrouillée, même pour une entrée diagonale non unitaire", () => {
    const g = glissementSuivant(null, { x: 1, z: 1 }, "glace", "glace");
    expect(g).not.toBeNull();
    if (g) {
      expect(Math.hypot(g.dirX, g.dirZ)).toBeCloseTo(1, 6);
      expect(g.dirX).toBeCloseTo(g.dirZ, 6);
    }
  });
});
