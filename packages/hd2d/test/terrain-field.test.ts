import { describe, expect, it } from "vitest";
import {
  AO_CORNER,
  autotileAxis,
  cornerOcclusion,
  openEdge,
  wallDrop,
} from "../src/terrain/field.js";
import { fieldFrom } from "./helpers/field.js";

describe("openEdge", () => {
  const f = fieldFrom(["01", "0."]);

  it("s'ouvre face au vide", () => {
    // (1,0) est au palier 1, son voisin sud (1,1) est de l'eau.
    expect(openEdge(f, 1, 0, 0, 1)).toBe(true);
    // (0,1) au palier 0, voisin est (1,1) : de l'eau.
    expect(openEdge(f, 0, 1, 1, 0)).toBe(true);
  });

  it("s'ouvre face à un voisin PLUS BAS", () => {
    expect(openEdge(f, 1, 0, -1, 0)).toBe(true); // palier 1 vers palier 0
  });

  it("ne s'ouvre PAS face à un voisin plus haut", () => {
    // On est au pied de sa falaise : c'est elle qui porte la bordure, pas nous.
    expect(openEdge(f, 0, 0, 1, 0)).toBe(false);
  });

  it("ne s'ouvre pas face à un voisin de même niveau et même matière", () => {
    expect(openEdge(fieldFrom(["00"]), 0, 0, 1, 0)).toBe(false);
  });

  it("le sable se borde contre l'herbe, et l'herbe le subit", () => {
    // C'est le sable qui dessine le trait de plage.
    const plage = fieldFrom(["s0"]);
    expect(openEdge(plage, 0, 0, 1, 0)).toBe(true);
    expect(openEdge(plage, 1, 0, -1, 0)).toBe(false);
  });

  it("sort de la carte comme sur du vide", () => {
    expect(openEdge(fieldFrom(["0"]), 0, 0, -1, 0)).toBe(true);
  });
});

describe("autotileAxis", () => {
  it("choisit la colonne sur les deux seules arêtes de son axe", () => {
    // Chaque bloc est un autotile 4x4 : un carré 3x3 (coins, bords, centre) plus une colonne et
    // une ligne pour les bandes d'une seule case de large. Le choix est SÉPARABLE.
    expect(autotileAxis(false, false)).toBe(1); // centre
    expect(autotileAxis(true, false)).toBe(0); // bord côté a
    expect(autotileAxis(false, true)).toBe(2); // bord côté b
    expect(autotileAxis(true, true)).toBe(3); // bande d'une seule case
  });
});

describe("cornerOcclusion", () => {
  it("assombrit un coin une fois par voisin plus haut qui le touche", () => {
    // Un coin est occlus par chacun des TROIS voisins qui le touchent : les deux d'arête et le
    // diagonal. C'est ce qui creuse le pied des falaises et le creux des marches.
    const f = fieldFrom(["11", "10"]);
    // Coin nord-ouest de (1,1) : ses trois voisins (0,1), (1,0) et (0,0) sont au palier 1.
    expect(cornerOcclusion(f, 1, 1, -1, -1)).toBeCloseTo(1 - AO_CORNER * 3);
  });

  it("laisse un coin dégagé en pleine clarté", () => {
    expect(cornerOcclusion(fieldFrom(["00", "00"]), 0, 0, 1, 1)).toBe(1);
  });

  it("ignore l'eau et le hors-carte", () => {
    expect(cornerOcclusion(fieldFrom(["0.", ".."]), 0, 0, 1, 1)).toBe(1);
  });
});

describe("wallDrop", () => {
  it("compte les paliers franchis jusqu'au voisin", () => {
    // La paroi est découpée en un quad par palier franchi : le premier porte la retombée sous
    // l'arête, les suivants une bande répétable.
    expect(wallDrop(fieldFrom(["20"]), 0, 0, 1, 0)).toBe(2);
    expect(wallDrop(fieldFrom(["21"]), 0, 0, 1, 0)).toBe(1);
  });

  it("ne rend rien face à un voisin de même niveau ou plus haut", () => {
    expect(wallDrop(fieldFrom(["11"]), 0, 0, 1, 0)).toBe(0);
    expect(wallDrop(fieldFrom(["12"]), 0, 0, 1, 0)).toBe(0);
  });

  it("descend jusqu'à l'eau face au vide", () => {
    // Une falsaise qui donne sur la mer retombe de tous ses paliers, sinon il reste une bande
    // apparemment vide mais inaccessible au ras de l'eau.
    expect(wallDrop(fieldFrom(["2."]), 0, 0, 1, 0)).toBe(2);
  });
});
