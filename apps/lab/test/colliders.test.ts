import { describe, expect, it } from "vitest";
import { createColliders } from "../src/world/colliders.js";

describe("Colliders.blocked", () => {
  it("détecte un chevauchement, dans le cas rapide (r <= QUERY_PAD)", () => {
    const colliders = createColliders();
    colliders.add(0, 0, 0.5);
    expect(colliders.blocked(0.3, 0, 0.3)).toBe(true);
    expect(colliders.blocked(5, 5, 0.3)).toBe(false);
  });

  // Revue finale (point C2) : un rayon de requête plus grand que `QUERY_PAD` (0.6) levait une
  // exception. Sur un tick serveur autoritatif (S2), un rayon d'entité mal réglé abattrait alors
  // le tick au lieu de dégrader — `blocked()` doit élargir sa recherche plutôt que lever.
  it("dégrade proprement au lieu de lever quand r dépasse QUERY_PAD", () => {
    const colliders = createColliders();
    colliders.add(0, 0, 0.5);
    expect(() => colliders.blocked(0, 0, 2)).not.toThrow();
    expect(colliders.blocked(0, 0, 2)).toBe(true);
  });

  it("trouve toujours un collider chevauché avec un grand rayon, même loin de la case d'origine", () => {
    const colliders = createColliders();
    // Collider à x=6 : hors de la case (0,0) (CELL=4), mais un disque de requête de rayon 3 centré
    // en (3, 0) doit quand même le trouver — c'est précisément ce que l'élargissement de fenêtre
    // doit couvrir, alors que l'ancien lookup mono-cellule ne l'aurait jamais atteint.
    colliders.add(6, 0, 0.4);
    expect(colliders.blocked(3, 0, 3)).toBe(true);
  });

  it("un grand rayon qui ne chevauche vraiment rien reste `false`", () => {
    const colliders = createColliders();
    colliders.add(100, 100, 0.5);
    expect(colliders.blocked(0, 0, 2)).toBe(false);
  });
});
