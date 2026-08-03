import { describe, expect, it } from "vitest";
import { compteCommeEau, createThinIce, tombeEnArrivant } from "../src/world/thin-ice.js";

const REGLAGES = { seuilCraquement: 0.4, seuilRupture: 1.2, regel: 5 } as const;

describe("la glace fine", () => {
  it("craque avant de rompre : on doit pouvoir partir à temps", () => {
    // Tout l'intérêt de la mécanique est là. Une glace qui rompt sans prévenir n'est pas un
    // danger, c'est un piège.
    const g = createThinIce(REGLAGES);
    expect(g.charge("3,4", 0.3)).toBe("intacte");
    expect(g.charge("3,4", 0.2)).toBe("craquelee");
    expect(g.charge("3,4", 0.8)).toBe("rompue");
  });

  it("oublie la charge quand on s'en va, mais garde la craquelure", () => {
    const g = createThinIce(REGLAGES);
    g.charge("3,4", 0.5);
    g.relache("3,4");
    g.update(0.5);
    // On est reparti à temps : elle reste craquelée, pas rompue.
    expect(g.etat("3,4")).toBe("craquelee");
  });

  it("regèle après le délai, pour qu'on puisse réessayer", () => {
    // Dans un labo, un trou définitif empêche de réessayer — et réessayer est tout ce qu'on y fait.
    const g = createThinIce(REGLAGES);
    g.charge("3,4", 1.5);
    expect(g.etat("3,4")).toBe("rompue");
    g.relache("3,4");
    g.update(REGLAGES.regel + 0.1);
    expect(g.etat("3,4")).toBe("intacte");
  });

  it("tient plusieurs cases indépendamment", () => {
    const g = createThinIce(REGLAGES);
    g.charge("1,1", 1.5);
    expect(g.etat("1,1")).toBe("rompue");
    expect(g.etat("2,2")).toBe("intacte");
  });

  it("ne garde pas d'entrée pour une case revenue intacte", () => {
    // Sinon la table grossit sans borne au fil d'une session — le même défaut que les registres
    // de billboards de S1.
    const g = createThinIce(REGLAGES);
    g.charge("1,1", 0.5);
    g.relache("1,1");
    g.update(REGLAGES.regel + 0.1);
    expect(g.taille()).toBe(0);
  });
});

// Les deux règles ci-dessous sont nées d'un bug trouvé en JOUANT (voir le rapport de la task), pas
// en lisant le code : `apps/lab/test/` n'exerce nulle part `createHero().update()`, donc rien ne
// les protégeait d'une régression silencieuse — exactement les résolutions de nage que S2 rendra
// autoritatives côté serveur. Extraites ici en fonctions pures pour être testables sans monter un
// héros complet.
describe("compteCommeEau — une case rompue doit être traitée comme de l'eau", () => {
  it("une case rompue compte comme de l'eau, malgré un terrain de hauteur non nulle", () => {
    // C'est la règle qui empêche `hero.ts` de faire remonter le héros une image après
    // `enterWater(plunge)` : le champ de hauteur ne sait rien du trou (voir `island.ts`), seule
    // cette question — posée à l'état de la glace, pas au terrain — le sait.
    expect(compteCommeEau("rompue")).toBe(true);
  });

  it("une case intacte ou craquelée ne compte pas comme de l'eau", () => {
    expect(compteCommeEau("intacte")).toBe(false);
    expect(compteCommeEau("craquelee")).toBe(false);
  });
});

describe("tombeEnArrivant — poser le pied sur un trou déjà ouvert fait tomber sans délai", () => {
  it("arriver sur une case rompue fait tomber immédiatement", () => {
    // Sans elle, un héros qui revient à pied sur un trou qu'il a lui-même ouvert (et dont il
    // s'est échappé à la nage) resterait planté sur du vide : la collision ne connaît que le
    // relief, toujours solide, et jamais l'état de la glace.
    expect(tombeEnArrivant("rompue")).toBe(true);
  });

  it("arriver sur une case intacte ou craquelée ne fait pas tomber", () => {
    // Une case craquelée reste franchissable : c'est justement l'avertissement qui laisse le
    // temps de partir, pas une chute immédiate.
    expect(tombeEnArrivant("intacte")).toBe(false);
    expect(tombeEnArrivant("craquelee")).toBe(false);
  });
});
