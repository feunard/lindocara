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

  it("ne pose rien sur une case en hauteur : l'écume est un liseré de rivage", () => {
    expect(foamPlacements(fieldFrom([".1."]))).toEqual([]);
  });

  it("ne pose rien sur une carte sans terre", () => {
    expect(foamPlacements(fieldFrom(["..", ".."]))).toEqual([]);
  });
});
