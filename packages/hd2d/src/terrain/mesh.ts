import * as THREE from "three";
import { applyCloudShadow } from "../clouds.js";
import type { Hd2dContext } from "../context.js";
import type { TerrainAtlas } from "./atlas.js";
import { tileUV } from "./atlas.js";
import type { HeightField } from "./field.js";
import { autotileAxis, cornerOcclusion, openEdge, wallDrop } from "./field.js";

// Colonne d'origine du bloc 4x4 dans le tileset, selon ce que la bordure regarde (voir
// `atlas.ts`, `TerrainAtlas.block`) : 0 pour le bloc bordé d'EAU (le liseré d'écume y est déjà
// peint), 5 pour le bloc bordé de VIDE (bordure touffue, faite pour coiffer une paroi — les
// parois elles-mêmes s'y raccordent toujours, quel que soit le bloc du dessus).
const WATER_EDGE_COL = 0;
const CLIFF_EDGE_COL = 5;

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];

/**
 * Accumulateur de quads : on fabrique la géométrie à la main pour contrôler les UV face par face
 * et empaqueter plusieurs cases dans un seul `BufferGeometry`, comme le PoC.
 */
function quadBuilder() {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  return {
    quad(
      a: Vec3,
      b: Vec3,
      c: Vec3,
      d: Vec3,
      normal: Vec3,
      uvs: readonly [Vec2, Vec2, Vec2, Vec2],
      grey: readonly [number, number, number, number],
    ): void {
      const o = pos.length / 3;
      for (const v of [a, b, c, d]) {
        pos.push(v[0], v[1], v[2]);
        nor.push(normal[0], normal[1], normal[2]);
      }
      for (const t of uvs) uv.push(t[0], t[1]);
      for (const k of grey) col.push(k, k, k);
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    },
    build(): THREE.BufferGeometry {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      return geo;
    },
    get empty(): boolean {
      return pos.length === 0;
    },
  };
}
type QuadBuilder = ReturnType<typeof quadBuilder>;

function into(map: Map<string, QuadBuilder>, key: string): QuadBuilder {
  let builder = map.get(key);
  if (!builder) {
    builder = quadBuilder();
    map.set(key, builder);
  }
  return builder;
}

/** Colonne de base du bloc 4x4 selon ce que porte cet atlas, ou `null` pour `"flat"` — une seule
 *  tuile, sans autotiling. */
function blockOrigin(atlas: TerrainAtlas): number | null {
  if (atlas.block === "water-edge") return WATER_EDGE_COL;
  if (atlas.block === "cliff-edge") return CLIFF_EDGE_COL;
  return null;
}

/**
 * Une paroi existe sur le côté (di,dj) d'une case de hauteur h si le voisin est plus bas. Sert à
 * savoir si la paroi voisine continue, donc si CE côté-ci de la paroi courante a besoin d'un about
 * (bord de la bande) ou reste un morceau courant (centre de la bande).
 */
function wallContinues(
  field: HeightField,
  i: number,
  j: number,
  di: number,
  dj: number,
  h: number,
): boolean {
  if (field.levelAt(i, j) !== h) return false;
  const n = field.levelAt(i + di, j + dj);
  return n === null || n < h;
}

export interface MeshTerrainOptions {
  /** Un atlas par clé de matière — la clé est exactement ce que `HeightField.materialAt` répond
   *  pour une case (voir `field.ts`) : c'est l'appelant qui décide si une matière porte un tileset
   *  par palier ("herbe0"/"herbe1"/...) ou un seul pour toute son étendue. */
  atlases: Record<string, TerrainAtlas>;
  levelHeight: number;
}

/**
 * Maille un `HeightField` : un quad de dessus par case (tuile d'autotile choisie par les arêtes
 * ouvertes, quatre couleurs de coin pour l'occlusion de contact) et, sur chaque côté qui domine un
 * voisin plus bas ou le vide, une paroi découpée en un quad par palier franchi.
 *
 * Le dessus et les parois de CHAQUE atlas sont accumulés dans deux `BufferGeometry` séparées
 * (plutôt que fondues comme dans le PoC) : un consommateur — l'aperçu de l'éditeur, ce test —
 * doit pouvoir lire le plateau sans avoir à trier un buffer où dessus et falaise sont mélangés.
 * Le nombre de meshes reste borné par le nombre d'atlas × 2 (dessus, parois), jamais par case :
 * c'est ce qui tient les 60 fps, comme dans le PoC.
 */
export function meshTerrain(
  ctx: Hd2dContext,
  field: HeightField,
  opts: MeshTerrainOptions,
): { group: THREE.Group; dispose(): void } {
  const cx = field.cols / 2;
  const cz = field.rows / 2;
  const tops = new Map<string, QuadBuilder>();
  const walls = new Map<string, QuadBuilder>();

  for (let j = 0; j < field.rows; j++) {
    for (let i = 0; i < field.cols; i++) {
      const h = field.levelAt(i, j);
      if (h === null) continue;
      const material = field.materialAt(i, j);
      if (material === null) continue;
      const atlas = opts.atlases[material];
      if (!atlas) throw new Error(`Aucun atlas de terrain pour la matière "${material}"`);

      const y = h * opts.levelHeight;
      const x0 = i - cx;
      const x1 = x0 + 1;
      const z0 = j - cz;
      const z1 = z0 + 1;

      // --- dessus : la tuile d'autotile qui correspond aux arêtes ouvertes -------------------
      const base = blockOrigin(atlas);
      const col =
        base === null
          ? 0
          : base + autotileAxis(openEdge(field, i, j, -1, 0), openEdge(field, i, j, 1, 0));
      const row =
        base === null ? 0 : autotileAxis(openEdge(field, i, j, 0, -1), openEdge(field, i, j, 0, 1));
      const uvTop = tileUV(atlas, col, row);

      into(tops, material).quad(
        [x0, y, z0],
        [x0, y, z1],
        [x1, y, z1],
        [x1, y, z0],
        [0, 1, 0],
        [
          [uvTop.u0, uvTop.v1],
          [uvTop.u0, uvTop.v0],
          [uvTop.u1, uvTop.v0],
          [uvTop.u1, uvTop.v1],
        ],
        [
          cornerOcclusion(field, i, j, -1, -1),
          cornerOcclusion(field, i, j, -1, 1),
          cornerOcclusion(field, i, j, 1, 1),
          cornerOcclusion(field, i, j, 1, -1),
        ],
      );

      // --- parois : un quad par palier franchi, côté par côté --------------------------------
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const drop = wallDrop(field, i, j, di, dj);
        if (drop === 0) continue;
        const bottomY = (h - drop) * opts.levelHeight;

        // Arête orientée pour que la normale pointe vers le voisin. Le vecteur U de la paroi vaut
        // (dj, -di) : les cases qui la prolongent sont donc à (i-dj, j+di) côté u=0 et
        // (i+dj, j-di) côté u=1.
        let p0: Vec2;
        let p1: Vec2;
        if (di === 1) {
          p0 = [x1, z1];
          p1 = [x1, z0];
        } else if (di === -1) {
          p0 = [x0, z0];
          p1 = [x0, z1];
        } else if (dj === 1) {
          p0 = [x0, z1];
          p1 = [x1, z1];
        } else {
          p0 = [x1, z0];
          p1 = [x0, z0];
        }

        const wallCol =
          CLIFF_EDGE_COL +
          autotileAxis(
            !wallContinues(field, i - dj, j + di, di, dj, h),
            !wallContinues(field, i + dj, j - di, di, dj, h),
          );

        let top = y;
        let band = 0;
        while (top > bottomY + 1e-4) {
          const bottom = Math.max(bottomY, top - opts.levelHeight);
          const w = tileUV(atlas, wallCol, band === 0 ? atlas.wallRow : atlas.wallRow + 1);
          into(walls, material).quad(
            [p0[0], bottom, p0[1]],
            [p1[0], bottom, p1[1]],
            [p1[0], top, p1[1]],
            [p0[0], top, p0[1]],
            [di, 0, dj],
            [
              [w.u0, w.v0],
              [w.u1, w.v0],
              [w.u1, w.v1],
              [w.u0, w.v1],
            ],
            [1, 1, 1, 1],
          );
          top = bottom;
          band++;
        }
      }
    }
  }

  const group = new THREE.Group();
  const addMeshes = (map: Map<string, QuadBuilder>) => {
    for (const [key, builder] of map) {
      if (builder.empty) continue;
      const atlas = opts.atlases[key];
      if (!atlas) throw new Error(`Atlas de terrain "${key}" disparu entre les deux passes`);
      const material = new THREE.MeshLambertMaterial({
        map: atlas.texture,
        // Sans ça, le sol et les falaises — des quads simples, sans face arrière — ne
        // projettent rien dans la shadow map.
        shadowSide: THREE.DoubleSide,
        vertexColors: true,
        alphaTest: 0.5, // les tuiles de bordure ont des découpes transparentes
      });
      // Posé à plat : la carte de nuages doit s'échantillonner dans le plan du sol, jamais à
      // l'origine de l'objet (`atOrigin` sert aux billboards verticaux, voir `applyCloudShadow`).
      applyCloudShadow(ctx, material);
      const mesh = new THREE.Mesh(builder.build(), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  };
  // Le dessus d'abord : un consommateur qui ne veut que le plateau (aperçu, ce test) prend le
  // premier mesh du groupe et s'arrête là, sans avoir à filtrer les parois.
  addMeshes(tops);
  addMeshes(walls);

  return {
    group,
    dispose() {
      for (const child of group.children) {
        if (!(child instanceof THREE.Mesh)) continue;
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
      group.clear();
    },
  };
}
