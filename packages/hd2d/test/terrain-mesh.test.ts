import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createHd2dContext } from "../src/context.js";
import type { TerrainAtlas } from "../src/terrain/atlas.js";
import type { HeightField } from "../src/terrain/field.js";
import { meshTerrain } from "../src/terrain/mesh.js";

function atlas(): TerrainAtlas {
  return { texture: new THREE.Texture(), cols: 9, rows: 6, block: "cliff-edge", wallRow: 4 };
}

function flat(cols: number, rows: number, level: number): HeightField {
  return {
    cols,
    rows,
    levelAt: (i, j) => (i < 0 || j < 0 || i >= cols || j >= rows ? null : level),
    materialAt: (i, j) => (i < 0 || j < 0 || i >= cols || j >= rows ? null : "herbe"),
  };
}

describe("meshTerrain", () => {
  it("émet un quad de dessus par case praticable", () => {
    const ctx = createHd2dContext();
    const { group } = meshTerrain(ctx, flat(4, 3, 0), {
      atlases: { herbe: atlas() },
      levelHeight: 0.9,
    });
    const positions = group.children
      .filter((c): c is THREE.Mesh => c instanceof THREE.Mesh)
      .reduce((n, m) => n + (m.geometry.getAttribute("position")?.count ?? 0), 0);
    // 12 cases plates, aucun dénivelé donc aucune paroi : 4 sommets chacune.
    expect(positions).toBe(12 * 4);
  });

  it("place le dessus à la hauteur de son palier", () => {
    const ctx = createHd2dContext();
    const { group } = meshTerrain(ctx, flat(1, 1, 2), {
      atlases: { herbe: atlas() },
      levelHeight: 0.9,
    });
    const mesh = group.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    const pos = mesh?.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) expect(pos.getY(k)).toBeCloseTo(1.8);
  });

  it("porte une couleur de sommet pour l'occlusion de contact", () => {
    const ctx = createHd2dContext();
    const { group } = meshTerrain(ctx, flat(2, 2, 0), {
      atlases: { herbe: atlas() },
      levelHeight: 0.9,
    });
    const mesh = group.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    expect(mesh?.geometry.getAttribute("color")).toBeDefined();
  });

  it("libère ses géométries au dispose", () => {
    const ctx = createHd2dContext();
    const built = meshTerrain(ctx, flat(2, 2, 0), {
      atlases: { herbe: atlas() },
      levelHeight: 0.9,
    });
    built.dispose();
    expect(built.group.children).toHaveLength(0);
  });
});
