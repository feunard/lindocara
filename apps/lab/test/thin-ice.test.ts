import { describe, expect, it } from "vitest";
import { createThinIce } from "../src/world/thin-ice.js";

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
