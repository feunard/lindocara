import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createHd2dContext } from "../src/context.js";
import type { TerrainAtlas } from "../src/terrain/atlas.js";
import type { HeightField } from "../src/terrain/field.js";
import { meshTerrain } from "../src/terrain/mesh.js";

function atlas(): TerrainAtlas {
  return {
    texture: new THREE.Texture(),
    cols: 9,
    rows: 6,
    block: "cliff-edge",
    wallRow: 4,
    tilePx: 64,
  };
}

function flat(cols: number, rows: number, level: number): HeightField {
  return {
    cols,
    rows,
    levelAt: (i, j) => (i < 0 || j < 0 || i >= cols || j >= rows ? null : level),
    materialAt: (i, j) => (i < 0 || j < 0 || i >= cols || j >= rows ? null : "herbe"),
  };
}

/** Un plateau SANS BORD : `levelAt` répond partout, donc aucune paroi n'est émise et la
 *  géométrie ne contient que des dessus. C'est ce qui rend l'assertion sur Y lisible — un champ
 *  borné entouré de vide porte forcément des parois, dont les sommets descendent. */
function endlessPlateau(cols: number, rows: number, level: number): HeightField {
  return { cols, rows, levelAt: () => level, materialAt: () => "herbe" };
}

/** Tous les Y de tous les meshes du groupe, quel que soit le découpage en accumulateurs. */
function allY(group: THREE.Group): number[] {
  const ys: number[] = [];
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    const pos = child.geometry.getAttribute("position");
    for (let k = 0; k < pos.count; k++) ys.push(pos.getY(k));
  }
  return ys;
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
    const { group } = meshTerrain(ctx, endlessPlateau(2, 2, 2), {
      atlases: { herbe: atlas() },
      levelHeight: 0.9,
    });
    for (const y of allY(group)) expect(y).toBeCloseTo(1.8);
  });

  it("descend la paroi de tous ses paliers sur un côté exposé au vide", () => {
    const ctx = createHd2dContext();
    const { group } = meshTerrain(ctx, flat(1, 1, 2), {
      atlases: { herbe: atlas() },
      levelHeight: 0.9,
    });
    const ys = allY(group);
    // Le dessus au palier 2, et le pied des parois au ras de l'eau.
    expect(Math.max(...ys)).toBeCloseTo(1.8);
    expect(Math.min(...ys)).toBeCloseTo(0);
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
