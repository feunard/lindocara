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
    footprint: { x, z, r: Math.max(L, P) * 0.5 },
    seuil,
    atDoor(p) {
      return Math.abs(p.x - x) < 1.0 && p.z > seuil.z - 0.1 && p.z < seuil.z + 1.5;
    },
  };
}
