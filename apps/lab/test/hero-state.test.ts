import { describe, expect, it } from "vitest";
import { createHeroState } from "../src/world/hero-state.js";

describe("createHeroState", () => {
  it("part immobile, au sol, avec son souffle plein", () => {
    const s = createHeroState(3, -4, 1.8, 12, 2.2);
    expect([s.x, s.y, s.z]).toEqual([3, 1.8, -4]);
    expect([s.vx, s.vz, s.vy]).toEqual([0, 0, 0]);
    expect(s.airborne).toBe(false);
    expect(s.swimming).toBe(false);
    expect(s.breath).toBe(12);
    // `groundY` DOIT valoir `y` au départ : c'est la référence de `maxStep`, et la laisser à 0
    // ferait croire au premier pas qu'on descend d'une falaise dès qu'on démarre en hauteur.
    expect(s.groundY).toBe(1.8);
    // `reposHaleine` détermine quand la première bouffée souffle : il doit être initialized au
    // paramètre passé, sinon un héros créé à la spawn soufflerait presque immédiatement au lieu
    // d'attendre l'intervalle authoré.
    expect(s.reposHaleine).toBe(2.2);
  });

  it("ne partage aucune structure entre deux états", () => {
    // Un `createHeroState` qui rendrait un objet figé partagé ferait diverger deux héros en
    // silence. Bon marché à vérifier, très cher à découvrir plus tard.
    const a = createHeroState(0, 0, 0, 10, 2.2);
    const b = createHeroState(0, 0, 0, 10, 2.2);
    a.vx = 5;
    expect(b.vx).toBe(0);
  });
});
