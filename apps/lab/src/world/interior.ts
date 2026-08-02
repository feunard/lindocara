import { createAnimator, makeBillboard, makeFlatSprite } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";
import { CAMERA } from "../settings.js";
import type { Room } from "./hero.js";

// L'intérieur est une pièce à ciel ouvert, posée très loin de la carte. Rien
// n'y est visible d'autre : ni île, ni plan d'eau — celui-ci ne s'étend qu'au
// triple de la carte, on est bien au-delà. La caméra plonge dedans comme dans
// n'importe quelle scène vue de dessus, les murs cachent l'horizon.
const ORIGINE = new THREE.Vector3(400, 0, 400);
const PIECE = { largeur: 7, profondeur: 5.5, hauteur: 2.4 };
const EPAISSEUR_MUR = 0.35; // marge laissée au héros pour ne pas traverser

// Le mobilier, décrit une fois : taille monde, pose au sol, et rayon d'appui
// pour qu'on ne le traverse pas. Le rayon est plus petit que le meuble — on
// bute sur son volume, pas sur son ombre.
const MEUBLES = [
  { url: "/tex/hearth.png", px: [80, 94], hauteur: 1.95, x: -2.35, z: -2.0, r: 0.55 },
  { url: "/tex/cupboard.png", px: [49, 78], hauteur: 1.4, x: 2.5, z: -2.15, r: 0.4 },
  { url: "/tex/bed.png", px: [70, 60], hauteur: 1.4, x: -2.3, z: 1.5, r: 0.85 },
  { url: "/tex/table.png", px: [58, 54], hauteur: 0.82, x: 1.75, z: 0.95, r: 0.5 },
] as const;

type Vertex = readonly [number, number, number];
type UV = readonly [number, number];

function quad(
  pos: number[],
  uv: number[],
  idx: number[],
  sommets: readonly Vertex[],
  uvs: readonly UV[],
): void {
  const o = pos.length / 3;
  for (const v of sommets) pos.push(v[0], v[1], v[2]);
  for (const t of uvs) uv.push(t[0], t[1]);
  idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
}

function maille(
  quads: readonly (readonly [readonly Vertex[], readonly UV[]])[],
  materiau: THREE.Material,
): THREE.Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const [s, u] of quads) quad(pos, uv, idx, s, u);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, materiau);
  m.receiveShadow = true;
  m.castShadow = true;
  return m;
}

export interface Interior {
  group: THREE.Group;
  /** Rectangle où le héros peut marcher, plancher, et meubles à contourner. */
  bounds: Room;
  /** Où l'on arrive en entrant : juste devant la porte, dos à elle — on vient
   *  de la franchir, on ne se téléporte pas au fond de la pièce. */
  spawn: THREE.Vector3;
  /** À portée de la porte du fond ? */
  nearExit(p: THREE.Vector3): boolean;
  update(dt: number, t: number): void;
}

export function createInterior(ctx: Hd2dContext, textures: TextureRegistry): Interior {
  const group = new THREE.Group();
  group.visible = false;
  const { largeur: L, profondeur: P, hauteur: H } = PIECE;
  const [dx, dz] = [L / 2, P / 2];

  // --- plancher et murs -----------------------------------------------------
  const sol = textures.get("/tex/interior-floor.png", { repeat: true });
  sol.repeat.set(L / 2, P / 2);
  group.add(
    maille(
      [
        [
          [
            [-dx, 0, -dz],
            [-dx, 0, dz],
            [dx, 0, dz],
            [dx, 0, -dz],
          ],
          [
            [0, 1],
            [0, 0],
            [1, 0],
            [1, 1],
          ],
        ],
      ],
      new THREE.MeshLambertMaterial({ map: sol }),
    ),
  );

  // Murs vus de l'INTÉRIEUR : leurs normales rentrent, d'où les sommets
  // enroulés dans l'autre sens que pour la maison.
  const mur = (a: readonly [number, number], b: readonly [number, number], repet: number) =>
    [
      [
        [a[0], 0, a[1]],
        [b[0], 0, b[1]],
        [b[0], H, b[1]],
        [a[0], H, a[1]],
      ],
      [
        [0, 0],
        [repet, 0],
        [repet, 1],
        [0, 1],
      ],
    ] as const;
  // TROIS murs seulement : celui qui ferait face à la caméra est omis. Avec une
  // caméra qui plonge, il se dresserait entre l'oeil et le héros et cacherait
  // toute la pièce. Le rectangle de déplacement, lui, ferme bien les quatre
  // côtés — on ne sort pas par là.
  const paroi = textures.get("/tex/interior-wall.png", { repeat: true });
  group.add(
    maille(
      [
        mur([dx, -dz], [-dx, -dz], L / 1.75), // nord, celui de la porte
        mur([-dx, -dz], [-dx, dz], P / 1.75), // ouest
        mur([dx, dz], [dx, -dz], P / 1.75), // est
      ],
      new THREE.MeshLambertMaterial({ map: paroi, side: THREE.DoubleSide }),
    ),
  );

  // La porte, plaquée sur le mur du fond : c'est la façade extérieure recadrée
  // sur sa porte, ce qui la place au bon endroit sans texture supplémentaire.
  // Au fond plutôt que devant, elle reste visible en permanence.
  group.add(
    maille(
      [
        [
          [
            [0.62, 0, -dz + 0.02],
            [-0.62, 0, -dz + 0.02],
            [-0.62, 1.5, -dz + 0.02],
            [0.62, 1.5, -dz + 0.02],
          ],
          [
            [0.68, 0],
            [0.32, 0],
            [0.32, 0.92],
            [0.68, 0.92],
          ],
        ],
      ],
      new THREE.MeshLambertMaterial({
        map: textures.get("/tex/house-front.png"),
        side: THREE.DoubleSide,
      }),
    ),
  );

  // --- tapis : à plat, comme l'écume et le foyer extérieur -------------------
  const tapis = makeFlatSprite(ctx, {
    texture: textures.get("/tex/rug.png"),
    size: 2.3,
    aspect: 98 / 99,
    alphaTest: 0.5,
  });
  tapis.mesh.position.set(-0.2, 0.02, 0.35);
  group.add(tapis.mesh);

  // --- mobilier -------------------------------------------------------------
  const obstacles: { x: number; z: number; r: number }[] = [];
  for (const m of MEUBLES) {
    const billboard = makeBillboard(ctx, {
      texture: textures.get(m.url),
      height: m.hauteur,
      aspect: m.px[0] / m.px[1],
      foot: 0.02,
      pitch: CAMERA.pitch,
    });
    billboard.placeAt(m.x, 0, m.z);
    group.add(billboard.mesh);
    obstacles.push({ x: ORIGINE.x + m.x, z: ORIGINE.z + m.z, r: m.r });
  }

  // --- feu dans l'âtre : la flamme du pack, et sa lumière --------------------
  // L'ouverture de l'âtre est centrée sur son sprite (mesuré) et occupe le bas
  // du foyer : la flamme prend donc son x, et une hauteur qui y tient. Elle est
  // avancée de 7 cm pour se dessiner devant la pierre sans z-fighting.
  const flamme = makeBillboard(ctx, {
    texture: textures.get("/tex/fire.png"),
    cols: 7,
    height: 0.62,
    aspect: 1,
    foot: 0.12,
    lit: false,
    pitch: CAMERA.pitch,
  });
  // Un peu au-dessus du plancher : le foyer de l'âtre est surélevé, une flamme
  // posée au ras du sol semblait déborder devant lui.
  flamme.placeAt(-2.35, 0.13, -1.93);
  group.add(flamme.mesh);
  const anim = createAnimator(flamme, { row: 0, frames: 7, fps: 12 }, 7);

  // Deux sources chaudes : l'âtre, et la bougie posée sur la table. C'est ce
  // qui fait basculer la pièce du "extérieur sous un toit" à l'intérieur.
  const feu = new THREE.PointLight(0xffa04a, 3.2, 9, 1.7);
  feu.position.set(-2.35, 0.55, -1.8);
  group.add(feu);

  const bougie = new THREE.PointLight(0xffd08a, 0.9, 3.2, 1.8);
  bougie.position.set(1.75, 0.95, 0.95);
  group.add(bougie);

  // Appoint diffus : la pièce n'était éclairée que par le soleil du dehors, et
  // ses murs crème viraient au bleu nuit. Faible, chaud, juste de quoi rendre
  // aux textures leur couleur sans effacer les deux foyers.
  const appoint = new THREE.HemisphereLight(0xffe4c4, 0x4a3826, 1.05);
  group.add(appoint);

  group.position.copy(ORIGINE);

  const marge = EPAISSEUR_MUR;
  const bounds: Room = {
    x0: ORIGINE.x - dx + marge,
    x1: ORIGINE.x + dx - marge,
    z0: ORIGINE.z - dz + marge,
    z1: ORIGINE.z + dz - marge,
    y: ORIGINE.y,
    obstacles,
  };

  return {
    group,
    bounds,
    spawn: new THREE.Vector3(ORIGINE.x, ORIGINE.y, ORIGINE.z - dz + 1.35),
    nearExit(p) {
      return Math.abs(p.x - ORIGINE.x) < 1.2 && p.z < ORIGINE.z - dz + 1.9;
    },
    update(dt, t) {
      if (!group.visible) return;
      anim.update(dt);
      // Même vacillement que le feu de camp : deux sinus déphasés.
      feu.intensity = 3.2 * (0.84 + 0.11 * Math.sin(t * 11.3) + 0.07 * Math.sin(t * 27.1 + 1.7));
    },
  };
}
