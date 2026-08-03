import { describe, expect, it } from "vitest";
import { createColliderIndex } from "../src/world/collider-index.js";

describe("createColliderIndex", () => {
  it("bloque un disque qui chevauche un rectangle, par le point le plus proche", () => {
    const idx = createColliderIndex();
    idx.add({ x: 0, z: 0, w: 2, h: 2 }); // de (0,0) à (2,2)
    // Au coin, la distance au rectangle est celle au point (0,0).
    expect(idx.blocked(-0.2, -0.2, 0.5)).toBe(true);
    // Un rayon 0.2 ne suffit plus : la diagonale du coin vaut ~0.283.
    expect(idx.blocked(-0.2, -0.2, 0.2)).toBe(false);
  });

  it("laisse passer un disque qui frôle le bord sans le toucher", () => {
    const idx = createColliderIndex();
    idx.add({ x: 0, z: 0, w: 2, h: 2 });
    expect(idx.blocked(-0.51, 1, 0.5)).toBe(false);
    expect(idx.blocked(-0.49, 1, 0.5)).toBe(true);
  });

  it("trouve un rectangle plus large que la cellule de l'index", () => {
    // Un mur long est le cas que le cercle ne savait pas modéliser, donc celui qu'aucun test
    // existant ne couvre. Il doit être trouvé depuis n'importe quel point de sa longueur.
    const idx = createColliderIndex();
    idx.add({ x: -20, z: 0, w: 40, h: 0.5 });
    expect(idx.blocked(-18, 0.2, 0.3)).toBe(true);
    expect(idx.blocked(0, 0.2, 0.3)).toBe(true);
    expect(idx.blocked(18, 0.2, 0.3)).toBe(true);
    expect(idx.blocked(0, 5, 0.3)).toBe(false);
  });

  // Les trois tests suivants reprennent la couverture de l'ancien `colliders.test.ts` (cercles),
  // transposée en rectangles : la dégradation d'un grand rayon de requête tient au TEST de
  // recouvrement, pas à la forme du collider, donc les mêmes cas doivent rester vrais.
  it("dégrade proprement au lieu de lever quand r dépasse la marge du chemin rapide", () => {
    const idx = createColliderIndex();
    idx.add({ x: -0.5, z: -0.5, w: 1, h: 1 }); // centré en (0,0), équivalent rayon 0.5
    expect(() => idx.blocked(0, 0, 2)).not.toThrow();
    expect(idx.blocked(0, 0, 2)).toBe(true);
  });

  it("trouve toujours un rectangle chevauché avec un grand rayon, même loin de la case d'origine", () => {
    const idx = createColliderIndex();
    // Rectangle centré en (6, 0) : hors de la case (0,0) (CELL=4), mais un disque de requête de
    // rayon 3 centré en (3, 0) doit quand même le trouver.
    idx.add({ x: 5.6, z: -0.4, w: 0.8, h: 0.8 });
    expect(idx.blocked(3, 0, 3)).toBe(true);
  });

  it("un grand rayon qui ne chevauche vraiment rien reste `false`", () => {
    const idx = createColliderIndex();
    idx.add({ x: 99.5, z: 99.5, w: 1, h: 1 }); // centré en (100, 100)
    expect(idx.blocked(0, 0, 2)).toBe(false);
  });
});
