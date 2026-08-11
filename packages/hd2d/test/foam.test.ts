import { describe, expect, it } from "vitest";
import type { HeightField } from "../src/terrain/field.js";
import { foamPlacements } from "../src/terrain/foam.js";
import { fieldFrom } from "./helpers/field.js";

describe("foamPlacements", () => {
  it("centre la tache sur la case de TERRE, jamais sur l'eau", () => {
    // Posée sur l'eau, elle formait des pavés flottant au large. Centrée sur la terre et glissée
    // dessous, le sol la masque partout où il la recouvre : seul son débord dépasse, et le liseré
    // épouse exactement le découpage des cases.
    const f = fieldFrom([".0."]);
    expect(foamPlacements(f)).toMatchObject([{ i: 1, j: 0, water: null }]);
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
    expect(foamPlacements(fieldFrom([".1."]))).toMatchObject([{ i: 1, j: 0, water: null }]);
  });

  it("pose une tache quel que soit le palier du rivage", () => {
    expect(foamPlacements(fieldFrom(["2"]))).toMatchObject([{ i: 0, j: 0, water: null }]);
  });

  it("ne pose rien sur une carte sans terre", () => {
    expect(foamPlacements(fieldFrom(["..", ".."]))).toEqual([]);
  });
});

describe("foam beside water at elevation", () => {
  // `water` is the LEVEL of the water a shore cell touches, `null` for the sea. A cell beside an
  // elevated pool needs its foam drawn at THAT pool's surface: at sea level it would be buried
  // inside the mountain, several units below the water it is supposed to be lapping.
  // Five across, so the pool's own neighbours are interior: the outer ring touches the grid edge,
  // which counts as sea, and correctly reports `null`.
  const summit = (): HeightField => {
    const grid = fieldFrom(["44444", "44444", "44.44", "44444", "44444"]);
    return { ...grid, waterAt: (i, j) => (i === 2 && j === 2 ? 4 : null) };
  };

  it("reports the elevated pool's level for the cells around it", () => {
    const places = foamPlacements(summit());
    for (const [i, j] of [
      [1, 2],
      [3, 2],
      [2, 1],
      [2, 3],
    ]) {
      expect(places.find((p) => p.i === i && p.j === j)?.water).toBe(4);
    }
  });

  it("still reports null beside the sea, so the global water level keeps being used", () => {
    for (const p of foamPlacements(fieldFrom(["1."]))) expect(p.water).toBeNull();
  });

  // A cell touching BOTH takes the sea: it is the lower surface, and the one whose foam belongs at
  // the cell's foot rather than floating at its head.
  it("prefers the sea when a cell touches both", () => {
    const grid = fieldFrom([".4.", ".4.", "..."]);
    const field: HeightField = { ...grid, waterAt: (i, j) => (i === 0 && j === 0 ? 4 : null) };
    const corner = foamPlacements(field).find((p) => p.i === 1 && p.j === 0);
    expect(corner?.water).toBeNull();
  });
});

describe("an elevated rim is continuous", () => {
  const summit = (): HeightField => {
    const grid = fieldFrom(["44444", "44444", "44.44", "44444", "44444"]);
    return { ...grid, waterAt: (i, j) => (i === 2 && j === 2 ? 4 : null) };
  };

  // One strip per land/water EDGE, not per cell. Per cell leaves a notch at every corner: a cell
  // touching the pool on two sides can only be oriented along one of them, and a corner is where a
  // rim most obviously breaks.
  it("emits one strip per wet edge, so corners are covered too", () => {
    const places = foamPlacements(summit()).filter((p) => p.water === 4);
    expect(places).toHaveLength(4);
    const dirs = places.map((p) => `${p.toWater[0]},${p.toWater[1]}`).sort();
    expect(dirs).toEqual(["-1,0", "0,-1", "0,1", "1,0"]);
  });

  it("points each strip at the water it borders", () => {
    for (const p of foamPlacements(summit()).filter((x) => x.water === 4)) {
      // The neighbour in that direction is the pool itself.
      expect(p.i + p.toWater[0]).toBe(2);
      expect(p.j + p.toWater[1]).toBe(2);
    }
  });

  // The sea path is untouched: exactly one placement per shore cell, as it has always been.
  it("still emits one placement per shore cell for the sea", () => {
    expect(foamPlacements(fieldFrom(["1."]))).toHaveLength(1);
  });
});
