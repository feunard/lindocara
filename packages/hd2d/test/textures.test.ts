import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { textureFiltering } from "../src/textures.js";

describe("textureFiltering", () => {
  it("désactive les mipmaps des atlas", () => {
    // Les atlas sont échantillonnés par sous-rectangles : leurs mipmaps mélangeraient les tuiles
    // voisines et feraient baver les bordures. L'écume relève du même cas — huit frames dans une
    // bande — et personne ne l'avait vue : les niveaux inférieurs moyennaient les huit frames
    // ENTRE ELLES, l'alpha moyenné rongeait la découpe, d'où des bavures le long du rivage.
    const a = textureFiltering(true);
    expect(a.generateMipmaps).toBe(false);
    expect(a.minFilter).toBe(THREE.LinearFilter);
    expect(a.magFilter).toBe(THREE.NearestFilter);
  });

  it("garde mipmaps et anisotropie pour les sprites", () => {
    // Pixel art en 3D : nearest en magnification (pixels francs), mipmaps en minification, sinon
    // le sprite grésille dès qu'il s'éloigne.
    const s = textureFiltering(false);
    expect(s.generateMipmaps).toBe(true);
    expect(s.minFilter).toBe(THREE.NearestMipmapLinearFilter);
    expect(s.magFilter).toBe(THREE.NearestFilter);
    expect(s.anisotropy).toBe(8);
  });
});
