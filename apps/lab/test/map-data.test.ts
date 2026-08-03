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

  it("rejette une matière hors union", () => {
    const boueuse: unknown = { ...carte, materials: ["boue", ...carte.materials.slice(1)] };
    expect(decodeMap(JSON.stringify(boueuse))).toBeNull();
  });

  it("rejette un champ imbriqué mal typé", () => {
    const colliderTexte = { ...carte, colliders: [{ x: "1", z: 1, w: 0.4, h: 0.4 }] };
    expect(decodeMap(JSON.stringify(colliderTexte))).toBeNull();

    const spawnSansNom = { ...carte, spawns: [{ name: 42, x: 0, z: 0 }] };
    expect(decodeMap(JSON.stringify(spawnSansNom))).toBeNull();
  });

  it("rejette un size nul ou fractionnaire", () => {
    expect(decodeMap(JSON.stringify({ ...carte, size: 0 }))).toBeNull();
    expect(decodeMap(JSON.stringify({ ...carte, size: 2.5 }))).toBeNull();
    expect(decodeMap(JSON.stringify({ ...carte, size: -4 }))).toBeNull();
  });

  it("rejette un colliders qui n'est pas un tableau", () => {
    expect(decodeMap(JSON.stringify({ ...carte, colliders: "pas-un-tableau" }))).toBeNull();
  });

  it("écarte silencieusement les clefs en trop d'un collider ou d'un spawn", () => {
    // Même discipline qu'au premier niveau : un objet imbriqué valide mais porteur d'une clef
    // inconnue ne doit pas la faire ressortir du décodage.
    const avecPayload = {
      ...carte,
      colliders: [{ x: 1, z: 1, w: 0.4, h: 0.4, evil: "payload" }],
    };
    const decodee = decodeMap(JSON.stringify(avecPayload));
    expect(decodee).not.toBeNull();
    expect(decodee?.colliders).toEqual([{ x: 1, z: 1, w: 0.4, h: 0.4 }]);
    expect(decodee?.colliders[0]).not.toHaveProperty("evil");
  });
});
