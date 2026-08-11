import { describe, expect, it } from "vitest";
import { foamPlacements } from "../src/terrain/foam.js";
import { fieldFrom } from "./helpers/field.js";

describe("foamPlacements", () => {
  it("centre la tache sur la case de TERRE, jamais sur l'eau", () => {
    // Posée sur l'eau, elle formait des pavés flottant au large. Centrée sur la terre et glissée
    // dessous, le sol la masque partout où il la recouvre : seul son débord dépasse, et le liseré
    // épouse exactement le découpage des cases.
    const f = fieldFrom([".0."]);
    expect(foamPlacements(f)).toEqual([{ i: 1, j: 0 }]);
  });

  it("ne pose rien sur une case de terre entourée de terre", () => {
    // Le bord de carte compte comme de l'eau, sinon le rivage d'une île qui le touche perdrait son
    // liseré : sur un 3x3 plein, la case centrale est donc la seule à n'avoir aucun voisin d'eau.
    const posees = foamPlacements(fieldFrom(["000", "000", "000"]));
    expect(posees).toHaveLength(8);
    expect(posees).not.toContainEqual({ i: 1, j: 1 });
  });

  it("pose une tache au pied d'une falaise qui plonge dans la mer", () => {
    // L'écume est le liseré de TOUT terrain qui touche l'eau, pas seulement du palier 0 : une
    // falaise qui tombe droit dans la mer en porte une, sinon sa base est un trait net posé sur
    // l'eau. La tache reste au niveau de la mer et le volume de l'île la masque (la coque de paroi
    // de `mesh.ts` ferme les découpes) : seul son débord dépasse au pied de la falaise.
    expect(foamPlacements(fieldFrom([".1."]))).toEqual([{ i: 1, j: 0 }]);
  });

  it("pose une tache quel que soit le palier du rivage", () => {
    expect(foamPlacements(fieldFrom(["2"]))).toEqual([{ i: 0, j: 0 }]);
  });

  it("ne pose rien sur une carte sans terre", () => {
    expect(foamPlacements(fieldFrom(["..", ".."]))).toEqual([]);
  });
});
