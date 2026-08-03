import { describe, expect, it } from "vitest";
import { decodeMap, encodeMap, type MapData } from "../src/world/map-data.js";

const carte: MapData = {
  version: 1,
  size: 4,
  levelHeight: 0.9,
  waterLevel: 0,
  levels: [null, 0, 0, null, 0, 1, 1, 0, 0, 1, 2, 0, null, 0, 0, null],
  materials: [
    "herbe",
    "herbe",
    "herbe",
    "herbe",
    "herbe",
    "neige",
    "glace",
    "herbe",
    "herbe",
    "neige",
    "neige",
    "herbe",
    "herbe",
    "herbe",
    "herbe",
    "herbe",
  ],
  colliders: [{ x: 1, z: 1, w: 0.4, h: 0.4 }],
  spawns: [{ name: "depart", x: 0, z: 0 }],
};

describe("le codec de carte", () => {
  it("fait un aller-retour sans rien perdre", () => {
    expect(decodeMap(encodeMap(carte))).toEqual(carte);
  });

  it("ne jette jamais sur une entrée malformée", () => {
    // Le serveur lira ce format un jour : un `throw` sur une carte corrompue abattrait une salle.
    for (const mauvais of ["", "{}", "null", "[1,2,3]", '{"version":99}', "pas du json"]) {
      expect(() => decodeMap(mauvais)).not.toThrow();
      expect(decodeMap(mauvais)).toBeNull();
    }
  });

  it("rejette une carte dont la grille ne fait pas size²", () => {
    const tronquee = { ...carte, levels: carte.levels.slice(0, 5) };
    expect(decodeMap(JSON.stringify(tronquee))).toBeNull();
  });
});
