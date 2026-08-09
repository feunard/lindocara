import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createHd2dContext } from "../src/context.js";
import type { TerrainAtlas } from "../src/terrain/atlas.js";
import type { HeightField } from "../src/terrain/field.js";
import { AO_WALL, AO_WALL_HEIGHT, cornerOcclusion } from "../src/terrain/field.js";
import { meshTerrain, tintAt } from "../src/terrain/mesh.js";

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

function vertexCount(group: THREE.Group): number {
  return group.children
    .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
    .reduce((count, child) => count + child.geometry.getAttribute("position").count, 0);
}

/**
 * Couleur du premier sommet trouvé à cette position monde, tous meshes du groupe confondus.
 * Localiser par POSITION plutôt que par index de buffer : ça survit à un réordonnancement interne
 * de l'accumulateur, et deux quads adjacents qui partagent un coin retombent de toute façon sur la
 * même valeur attendue (même teinte, même occlusion), donc le premier trouvé suffit.
 */
function colorAt(
  group: THREE.Group,
  x: number,
  y: number,
  z: number,
): [number, number, number] | undefined {
  const eps = 1e-3;
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    const pos = child.geometry.getAttribute("position");
    const col = child.geometry.getAttribute("color");
    for (let k = 0; k < pos.count; k++) {
      if (
        Math.abs(pos.getX(k) - x) < eps &&
        Math.abs(pos.getY(k) - y) < eps &&
        Math.abs(pos.getZ(k) - z) < eps
      ) {
        return [col.getX(k), col.getY(k), col.getZ(k)];
      }
    }
  }
  return undefined;
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

  it("construit une seule façade continue quelle que soit la hauteur du plateau", () => {
    const ctx = createHd2dContext();
    const low = meshTerrain(ctx, flat(1, 1, 1), {
      atlases: { herbe: atlas() },
      levelHeight: 0.9,
    });
    const high = meshTerrain(ctx, flat(1, 1, 3), {
      atlases: { herbe: atlas() },
      levelHeight: 0.9,
    });
    expect(vertexCount(high.group)).toBe(vertexCount(low.group));
    expect(Math.max(...allY(high.group))).toBeCloseTo(2.7);
  });

  it("ferme les découpes transparentes des falaises avec une coque continue reculée", () => {
    const ctx = createHd2dContext();
    const { group } = meshTerrain(ctx, flat(1, 1, 3), {
      atlases: { herbe: atlas() },
      levelHeight: 0.9,
    });
    const meshes = group.children.filter(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh,
    );
    const shell = meshes.find((mesh) => (mesh.material as THREE.Material).polygonOffset);
    expect(shell).toBeDefined();
    if (!shell) throw new Error("expected a cliff shell mesh");
    expect((shell.material as THREE.MeshLambertMaterial).alphaTest).toBe(0);
    const positions = shell.geometry.getAttribute("position");
    expect(positions.count).toBe(16);
    const ys = Array.from({ length: positions.count }, (_, index) => positions.getY(index));
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBeCloseTo(2.7);
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

  describe("couleur de sommet — valeurs, pas seulement présence", () => {
    // Un palier isolé à deux niveaux exerce la façade continue sur une hauteur supérieure à la
    // distance de dissipation de l'occlusion, sans réintroduire de bande intermédiaire.
    const field = flat(1, 1, 2);
    const levelHeight = AO_WALL_HEIGHT;

    it("tintAt reproduit la formule du PoC (pin indépendant, pas recalculé via mesh.ts)", () => {
      // Les trois tests suivants appellent `tintAt(...)` pour calculer LEUR PROPRE attendu — ils
      // vérifient donc le BRANCHEMENT (occlusion correctement multipliée, bon sommet localisé),
      // pas `tintAt` elle-même : une régression qui la ramènerait à une constante (le risque
      // explicitement signalé) passerait les trois sans être vue, puisque l'attendu et le produit
      // viendraient alors de la MÊME fonction cassée. Ce test-ci ferme ce trou : les deux valeurs
      // ci-dessous sont un pin de la sortie réelle (calculées indépendamment, `node -e` avec la
      // formule du PoC recopiée UNE FOIS pour produire ces deux nombres, jamais dans le code
      // source), pas une seconde implémentation qui dériverait de mesh.ts en silence.
      const a = tintAt(-0.5, -0.5);
      expect(a[0]).toBeCloseTo(0.902720988495213);
      expect(a[1]).toBeCloseTo(0.933120679590459);
      expect(a[2]).toBeCloseTo(0.8905611120571146);
      const b = tintAt(0.5, 0.5);
      expect(b[0]).toBeCloseTo(0.9372790115047869);
      expect(b[1]).toBeCloseTo(0.956879320409541);
      expect(b[2]).toBeCloseTo(0.9294388879428853);
    });

    it("un sommet de dessus non occlus ne porte que la teinte procédurale", () => {
      const ctx = createHd2dContext();
      const { group } = meshTerrain(ctx, field, { atlases: { herbe: atlas() }, levelHeight });
      // Coin nord-ouest de l'unique case : ses trois voisins sont hors carte, donc aucun n'est
      // "plus haut" — l'occlusion vaut exactement 1, ce sommet ne pin donc que `tintAt`.
      const occlusion = cornerOcclusion(field, 0, 0, -1, -1);
      expect(occlusion).toBe(1);
      const [tr, tg, tb] = tintAt(-0.5, -0.5);
      const color = colorAt(group, -0.5, 2 * levelHeight, -0.5);
      expect(color).toBeDefined();
      expect(color?.[0]).toBeCloseTo(tr * occlusion);
      expect(color?.[1]).toBeCloseTo(tg * occlusion);
      expect(color?.[2]).toBeCloseTo(tb * occlusion);
    });

    it("le pied d'une paroi retombe à 1 - AO_WALL", () => {
      const ctx = createHd2dContext();
      const { group } = meshTerrain(ctx, field, { atlases: { herbe: atlas() }, levelHeight });
      const occlusion = 1 - AO_WALL;
      const [tr, tg, tb] = tintAt(0.5, 0.5);
      const color = colorAt(group, 0.5, 0, 0.5);
      expect(color).toBeDefined();
      expect(color?.[0]).toBeCloseTo(tr * occlusion);
      expect(color?.[1]).toBeCloseTo(tg * occlusion);
      expect(color?.[2]).toBeCloseTo(tb * occlusion);
    });

    it("l'occlusion de paroi est totalement dissipée au sommet de la façade", () => {
      const ctx = createHd2dContext();
      const { group } = meshTerrain(ctx, field, { atlases: { herbe: atlas() }, levelHeight });
      // Même (x,z) que le test du pied, seul le Y change : isole la hauteur de dissipation de
      // tout le reste (teinte, position).
      const [tr, tg, tb] = tintAt(0.5, 0.5);
      const color = colorAt(group, 0.5, 2 * levelHeight, 0.5);
      expect(color).toBeDefined();
      expect(color?.[0]).toBeCloseTo(tr); // occlusion = 1
      expect(color?.[1]).toBeCloseTo(tg);
      expect(color?.[2]).toBeCloseTo(tb);
    });
  });
});
