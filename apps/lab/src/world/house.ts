import type { TerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";

// Une vraie boîte 3D texturée, pas un sprite : c'est ainsi que le HD-2D traite
// ses bâtiments. Le décor du jeu est déjà de la géométrie ; une maison plate y
// aurait détonné dès qu'on pivote la caméra.
//
// Les textures sont des élévations à plat générées face par face. Leur liseré
// sombre d'origine fait l'arête des murs — inutile d'en ajouter un.
const MURS = { largeur: 2.5, profondeur: 1.95, hauteur: 1.36 };
const TOIT = { debord: 0.24, hauteur: 1.05 };

// Exportée : `scripts/build-map.ts` (Task 10, et sa suite : la maison n'avait pas de collider
// dans la carte) doit poser exactement le même rectangle que `createHouse` ci-dessous sans jamais
// instancier une vraie `House` — ça exigerait des textures, donc un navigateur, ce qu'un script
// Node n'a pas. Recopier la formule à la main l'aurait laissée diverger sans qu'aucun test ne le
// voie.
export const HOUSE_FOOTPRINT_RADIUS = Math.max(MURS.largeur, MURS.profondeur) * 0.5;

/**
 * Où la maison se pose : un plateau plat (palier 0, un voisinage 5x5 tout au palier 0) cherché en
 * anneaux depuis (25, -2). MOVED from `main.ts`'s inline `placeMaison` IIFE — pur vis-à-vis de
 * `query`, donc appelable aussi bien par `main.ts` (à l'assemblage de la scène) que par
 * `scripts/build-map.ts` (pour sérialiser le collider de la maison sans jamais construire un seul
 * billboard) : les deux DOIVENT trouver la même position, sous peine de désynchroniser le rendu et
 * la carte.
 */
export function decideHousePlacement(query: TerrainQuery): readonly [number, number] | null {
  for (let r = 0; r < 6; r++) {
    for (const [ox, oz] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
    ] as const) {
      const x = 25 + ox * r;
      const z = -2 + oz * r;
      if (query.levelAt(x, z) !== 0) continue;
      let plat = true;
      for (let dx = -2; dx <= 2 && plat; dx++)
        for (let dz = -2; dz <= 2 && plat; dz++)
          if (query.levelAt(x + dx, z + dz) !== 0) plat = false;
      if (plat) return [x, z];
    }
  }
  return null;
}

// Le cerisier devant la maison : décalé de 2.5 unités vers l'est, sinon son tronc se plante dans
// un buisson au point pile devant la porte (les buissons et décors au sol ne posent pas de
// collider — voir `world/props.ts` — donc aucune recherche de place ne peut les éviter, et le
// seul recours était de choisir ce décalage à l'oeil). Exportées comme `HOUSE_FOOTPRINT_RADIUS`
// ci-dessus, pour la même raison : `build-map.ts` doit poser le même collider que `main.ts` sans
// dupliquer ces deux constantes à la main.
export const SAKURA_DECALAGE_X = 2.5;
export const SAKURA_RADIUS = 0.42; // même rayon qu'avant Task 8, en rectangle (côté 0.84)

/**
 * Où le cerisier se pose, relatif à la maison — MOVED from `main.ts`'s inline sakura IIFE. `null`
 * si la maison elle-même n'a pas trouvé de place (le cerisier n'existe QUE devant une maison), ou
 * si le point décalé tombe hors du palier 0 (une falaise, l'eau).
 */
export function decideSakuraPlacement(
  house: readonly [number, number] | null,
  query: TerrainQuery,
): readonly [number, number] | null {
  if (!house) return null;
  const x = house[0] + SAKURA_DECALAGE_X;
  const z = house[1] + 7.5;
  if (query.levelAt(x, z) !== 0) return null;
  return [x, z];
}

type Point3 = readonly [number, number, number];
type UV = readonly [number, number];

/** Ajoute un quad (4 sommets, 2 triangles) à des tableaux d'attributs. */
function quad(
  pos: number[],
  uv: number[],
  idx: number[],
  a: Point3,
  b: Point3,
  c: Point3,
  d: Point3,
  uvs: readonly UV[],
): void {
  const o = pos.length / 3;
  for (const v of [a, b, c, d]) pos.push(v[0], v[1], v[2]);
  for (const t of uvs) uv.push(t[0], t[1]);
  idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
}

type QuadDesc = readonly [Point3, Point3, Point3, Point3, readonly UV[]];

function geometrieDeQuads(quads: readonly QuadDesc[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const q of quads) quad(pos, uv, idx, q[0], q[1], q[2], q[3], q[4]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const CARRE: readonly UV[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

export interface House {
  group: THREE.Group;
  footprint: { x: number; z: number; r: number };
  seuil: THREE.Vector3;
  /** À portée de la porte, et du bon côté de la maison. */
  atDoor(p: THREE.Vector3): boolean;
}

export function createHouse(textures: TextureRegistry, x: number, y: number, z: number): House {
  const group = new THREE.Group();
  const { largeur: L, profondeur: P, hauteur: H } = MURS;
  const [dx, dz] = [L / 2, P / 2];

  const materiau = (url: string, opts: THREE.MeshLambertMaterialParameters = {}) =>
    new THREE.MeshLambertMaterial({
      map: textures.get(url),
      shadowSide: THREE.DoubleSide,
      ...opts,
    });

  // --- murs : façade devant et derrière, pignons sur les côtés -------------
  // Chaque paire de faces partage sa texture, donc son matériau : deux draw
  // calls pour les quatre murs.
  const faces: readonly (readonly QuadDesc[])[] = [
    // sud (vers la caméra) et nord
    [
      [[-dx, 0, dz], [dx, 0, dz], [dx, H, dz], [-dx, H, dz], CARRE],
      [[dx, 0, -dz], [-dx, 0, -dz], [-dx, H, -dz], [dx, H, -dz], CARRE],
    ],
    // est et ouest
    [
      [[dx, 0, dz], [dx, 0, -dz], [dx, H, -dz], [dx, H, dz], CARRE],
      [[-dx, 0, -dz], [-dx, 0, dz], [-dx, H, dz], [-dx, H, -dz], CARRE],
    ],
  ];
  const urls = ["/tex/house-front.png", "/tex/house-side.png"];
  faces.forEach((paire, i) => {
    const url = urls[i];
    if (!url) return;
    const mesh = new THREE.Mesh(geometrieDeQuads(paire), materiau(url));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });

  // --- toit : quatre pans qui montent vers un faîte -----------------------
  // Une croupe plutôt qu'un pignon : quatre triangles suffiraient, mais le
  // faîtage réduit à une arête donnerait des UV dégénérés. On garde donc deux
  // grands pans trapézoïdaux et deux croupes triangulaires, décrites comme des
  // quads dont deux sommets se confondent.
  const [rx, rz] = [dx + TOIT.debord, dz + TOIT.debord];
  const cime = H + TOIT.hauteur;
  const faite = rx - rz; // demi-longueur du faîtage, pour une pente régulière
  const pans: readonly QuadDesc[] = [
    // pan sud, pan nord
    [
      [-rx, H, rz],
      [rx, H, rz],
      [faite, cime, 0],
      [-faite, cime, 0],
      [
        [0, 0],
        [2.2, 0],
        [1.7, 1],
        [0.5, 1],
      ],
    ],
    [
      [rx, H, -rz],
      [-rx, H, -rz],
      [-faite, cime, 0],
      [faite, cime, 0],
      [
        [0, 0],
        [2.2, 0],
        [1.7, 1],
        [0.5, 1],
      ],
    ],
    // croupes est et ouest
    [
      [rx, H, rz],
      [rx, H, -rz],
      [faite, cime, 0],
      [faite, cime, 0],
      [
        [0, 0],
        [1.6, 0],
        [0.8, 1],
        [0.8, 1],
      ],
    ],
    [
      [-rx, H, -rz],
      [-rx, H, rz],
      [-faite, cime, 0],
      [-faite, cime, 0],
      [
        [0, 0],
        [1.6, 0],
        [0.8, 1],
        [0.8, 1],
      ],
    ],
  ];
  const toitTex = textures.get("/tex/house-roof.png", { repeat: true });
  const toit = new THREE.Mesh(
    geometrieDeQuads(pans),
    new THREE.MeshLambertMaterial({
      map: toitTex,
      shadowSide: THREE.DoubleSide,
      side: THREE.DoubleSide,
    }),
  );
  toit.castShadow = true;
  toit.receiveShadow = true;
  group.add(toit);

  group.position.set(x, y, z);
  // Le seuil, devant la façade sud : c'est là qu'on ouvre.
  const seuil = new THREE.Vector3(x, y, z + P / 2);
  return {
    group,
    footprint: { x, z, r: HOUSE_FOOTPRINT_RADIUS },
    seuil,
    atDoor(p) {
      return Math.abs(p.x - x) < 1.0 && p.z > seuil.z - 0.1 && p.z < seuil.z + 1.5;
    },
  };
}
