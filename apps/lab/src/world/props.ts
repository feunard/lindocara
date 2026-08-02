import {
  type Clip,
  createAnimator,
  makeBillboard,
  makeFlatSprite,
  makeGlow,
} from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import type { HeightField } from "@lindocara/hd2d/terrain/field.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";
import { CAMERA, WORLD } from "../settings.js";
import type { Colliders } from "./colliders.js";
import { mulberry32 } from "./island.js";
import { createFlock, type Flock } from "./sheep.js";
import type { TerrainQuery } from "./terrain-query.js";

// Chaque entrée décrit une feuille de sprites : découpage, taille monde, où se
// trouvent les "pieds" dans la frame (pour poser l'objet au sol), et le rayon
// de son empreinte de collision — bien plus petit que le sprite : on bute sur
// le tronc de l'arbre, pas sur son feuillage.
interface PropKind {
  url: string;
  cols: number;
  rows: number;
  height: number;
  aspect: number;
  foot: number;
  radius?: number;
  anim?: { row: number; frames: number; fps: number };
  lit?: boolean;
}

const KINDS: Record<"tree" | "rock" | "fire", PropKind> = {
  // L'arbre : seule la ligne 0 est le balancement. Les frames 4 et 5 sont plus
  // étroites — c'est l'arbre qu'on abat — et la 8 est la souche.
  tree: {
    url: "/tex/tree.png",
    cols: 4,
    rows: 3,
    height: 3.6,
    aspect: 1,
    foot: 0.09,
    radius: 0.34,
    anim: { row: 0, frames: 4, fps: 1.6 },
  },
  rock: {
    url: "/tex/rocks.png",
    cols: 8,
    rows: 1,
    height: 1.3,
    aspect: 1,
    foot: 0.35,
    anim: { row: 0, frames: 8, fps: 6 },
  },
  fire: {
    url: "/tex/fire.png",
    cols: 7,
    rows: 1,
    height: 1.5,
    aspect: 1,
    foot: 0.12,
    radius: 0.45,
    anim: { row: 0, frames: 7, fps: 12 },
    lit: false,
  },
};

// Le vent traverse l'île. La phase d'oscillation d'un sprite se déduit de sa
// POSITION : une bourrasque part d'un bord et le balaie, au lieu que chaque
// arbre ondule dans son coin. Une cadence tirée au hasard les décorrélait bien,
// mais elle interdisait justement ce mouvement d'ensemble ; il n'en reste qu'un
// écart de 4 %, assez pour que la vague se délite lentement au lieu de tourner
// en boucle mécanique.
const WIND_DIR = [0.86, 0.51] as const;
const WIND_WAVELENGTH = 13; // unités monde entre deux crêtes de la bourrasque
const windPhase = (x: number, z: number, frames: number): number =>
  ((x * WIND_DIR[0] + z * WIND_DIR[1]) / WIND_WAVELENGTH) * frames;

export interface Props {
  group: THREE.Group;
  flock: Flock;
  fireLight: THREE.PointLight;
  fireGlow: THREE.Mesh;
  fireHalo: THREE.Mesh;
  firePosition: THREE.Vector3;
  update(dt: number, t: number): void;
}

export function populate(
  ctx: Hd2dContext,
  textures: TextureRegistry,
  field: HeightField,
  query: TerrainQuery,
  colliders: Colliders,
  spawn: readonly [number, number],
): Props {
  const rng = mulberry32(WORLD.seed + 7);
  const group = new THREE.Group();
  const animated: { update(dt: number): void }[] = [];

  function spawnProp(
    kind: "tree" | "rock" | "fire",
    wx: number,
    wz: number,
    opts: { scale?: number; flip?: boolean } = {},
  ): void {
    const { scale = 1, flip = false } = opts;
    const k = KINDS[kind];
    const y = query.heightAt(wx, wz);
    if (y === null && kind !== "rock") return;
    if (k.radius) colliders.add(wx, wz, k.radius * scale);

    const billboard = makeBillboard(ctx, {
      texture: textures.get(k.url),
      cols: k.cols,
      rows: k.rows,
      height: k.height * scale,
      aspect: k.aspect,
      foot: k.foot,
      lit: k.lit !== false,
      pitch: CAMERA.pitch,
    });
    billboard.placeAt(wx, y ?? WORLD.waterLevel, wz);
    billboard.setFlip(flip);
    if (k.anim) {
      const souffle = kind === "tree";
      const clip: Clip = {
        row: k.anim.row,
        frames: k.anim.frames,
        fps: k.anim.fps * (souffle ? 0.96 + rng() * 0.08 : 0.8 + rng() * 0.4),
      };
      const a = createAnimator(billboard, clip, k.cols);
      // Les rochers ne subissent pas le vent : leur feuille est un clapot, pas
      // un balancement. Ils gardent donc leur phase tirée au hasard.
      a.setPhase(souffle ? windPhase(wx, wz, k.anim.frames) + rng() * 0.4 : rng() * 40);
      animated.push(a);
    }
    group.add(billboard.mesh);
  }

  // --- répartition sur les cases libres -------------------------------------
  const taken = new Set<string>();
  const key = (i: number, j: number) => `${i},${j}`;
  const size = field.cols;
  const spawnCell: [number, number] = [
    Math.floor(spawn[0] + size / 2),
    Math.floor(spawn[1] + size / 2),
  ];

  // On garde une clairière autour du point d'apparition et du feu.
  for (let dj = -3; dj <= 3; dj++)
    for (let di = -3; di <= 3; di++) taken.add(key(spawnCell[0] + di, spawnCell[1] + dj));

  const freeCells = (levels: readonly number[], count: number, margin = 0): [number, number][] => {
    const out: [number, number][] = [];
    let guard = 0;
    while (out.length < count && guard++ < count * 400) {
      const i = Math.floor(rng() * size);
      const j = Math.floor(rng() * size);
      const h = field.levelAt(i, j);
      if (h === null || !levels.includes(h)) continue;
      if (field.materialAt(i, j) === "sable") continue; // on laisse la plage nue
      if (taken.has(key(i, j))) continue;
      // Pas au bord d'une falaise : le sprite déborderait dans le vide.
      let ok = true;
      for (let dj = -margin; dj <= margin && ok; dj++)
        for (let di = -margin; di <= margin && ok; di++)
          if (field.levelAt(i + di, j + dj) !== h) ok = false;
      if (!ok) continue;
      taken.add(key(i, j));
      out.push([i, j]);
    }
    return out;
  };

  const jitter = (i: number, j: number, amount = 0.3): [number, number] => {
    const [x, z] = query.cellCenter(i, j);
    return [x + (rng() - 0.5) * amount, z + (rng() - 0.5) * amount];
  };

  for (const [i, j] of freeCells([0, 1], 30, 1)) {
    const [x, z] = jitter(i, j, 0.5);
    spawnProp("tree", x, z, { scale: 0.85 + rng() * 0.35, flip: rng() > 0.5 });
  }

  for (const [i, j] of freeCells([0, 1, 2], 46)) {
    const [x, z] = jitter(i, j, 0.7);
    const n = 1 + Math.floor(rng() * 6);
    const url = `/tex/deco-0${n}.png`;
    const billboard = makeBillboard(ctx, {
      texture: textures.get(url),
      height: 0.85,
      foot: 0.12,
      pitch: CAMERA.pitch,
    });
    billboard.placeAt(x, query.heightAt(x, z) ?? 0, z);
    billboard.setFlip(rng() > 0.5);
    group.add(billboard.mesh);
  }

  // Buissons : les feuilles font 8 cases de large, mais les dernières ne sont
  // qu'un rembourrage identique à la première — les jouer ferait un temps mort
  // à chaque tour. Nombre de frames utiles relevé sheet par sheet.
  const BUSH_FRAMES = [7, 6, 8, 7] as const;
  for (const [i, j] of freeCells([0, 1, 2], 22)) {
    const [x, z] = jitter(i, j, 0.6);
    const variant = Math.floor(rng() * 4);
    const billboard = makeBillboard(ctx, {
      texture: textures.get(`/tex/bush-${variant + 1}.png`),
      cols: 8,
      height: 1.5,
      foot: 0.43,
      pitch: CAMERA.pitch,
    });
    billboard.placeAt(x, query.heightAt(x, z) ?? 0, z);
    billboard.setFlip(rng() > 0.5);
    group.add(billboard.mesh);
    const frames = BUSH_FRAMES[variant] ?? 7;
    const a = createAnimator(billboard, { row: 0, frames, fps: 2.6 * (0.96 + rng() * 0.08) }, 8);
    a.setPhase(windPhase(x, z, frames) + rng() * 0.4);
    animated.push(a);
  }

  // Moutons : ils se baladent, donc pas de collider (la grille est statique).
  const flock = createFlock(
    ctx,
    textures,
    query,
    freeCells([0, 1], 6).map(([i, j]) => jitter(i, j, 0.4)),
    rng,
  );
  group.add(flock.group);

  // Rochers dans l'eau, autour de l'île.
  for (let n = 0; n < 14; n++) {
    const a = rng() * Math.PI * 2;
    const r = size * 0.5 + 1.5 + rng() * 4;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (query.heightAt(x, z) !== null) continue;
    spawnProp("rock", x, z, { scale: 0.7 + rng() * 0.6, flip: rng() > 0.5 });
  }

  // --- le feu de camp : sprite non éclairé + vraie lumière ponctuelle -------
  const fx = spawn[0] + 1.8;
  const fz = spawn[1] - 1.4;
  const fy = query.heightAt(fx, fz) ?? 0;
  // Le foyer est posé À PLAT : le modèle l'a dessiné vu de dessus, et un cercle
  // de pierres au sol dressé sur un plan vertical ferait un disque debout.
  const foyer = makeFlatSprite(ctx, {
    texture: textures.get("/tex/campfire-base.png"),
    size: 1.25,
    aspect: 57 / 66,
    alphaTest: 0.5,
  });
  foyer.mesh.position.set(fx, fy + 0.03, fz);
  group.add(foyer.mesh);
  spawnProp("fire", fx, fz);
  // La portée d'une lumière ponctuelle est une COUPURE : l'atténuation atteint
  // zéro pile à `distance`, et avec une décroissance de 1.6 elle y arrive encore
  // vive. D'où le cerne net que le foyer traçait au sol, à seize unités de lui.
  // Portée doublée et décroissance physique (2) : l'intensité tombe en 1/d²,
  // la flaque de lumière s'éteint d'elle-même bien avant la coupure, qui ne se
  // voit plus. Le prix à payer, c'est une intensité nominale plus forte — en
  // 1/d², il ne reste presque rien à trois unités.
  const fireLight = new THREE.PointLight(0xff8c2e, 1, 34, 2);
  fireLight.position.set(fx, fy + 0.62, fz);
  // Une lumière ponctuelle qui projette, c'est SIX rendus de la scène — un par
  // face du cube. C'est le poste le plus cher de la frame, pour une ombre qui
  // ne se lit qu'à quelques unités du foyer. On la réduit à sa portée utile, et
  // `main.ts` la coupe carrément de jour, où elle ne se voit pas.
  fireLight.castShadow = true;
  fireLight.shadow.mapSize.set(256, 256);
  fireLight.shadow.camera.far = 9;
  fireLight.shadow.bias = -0.005;
  group.add(fireLight);

  // L'enveloppe lumineuse du foyer. Le bloom ne fait rayonner que ce qui est
  // peint : la flamme brillait, mais l'air autour d'elle restait vide.
  // DEUX couches, pas une. Une seule tache, si douce soit-elle, garde un rayon
  // dominant que l'oeil retrouve — et c'est ce rayon qu'on lisait comme un rond.
  // Une petite bien marquée sous le foyer, une large très diluée par-dessus,
  // de formes et de phases différentes : leur somme n'a plus de contour.
  const fireGlow = makeGlow(5.4, 0xff8a2e, 0);
  fireGlow.position.set(fx, fy + 0.03, fz);
  group.add(fireGlow);

  const fireHalo = makeGlow(13, 0xff7420, 1);
  fireHalo.position.set(fx, fy + 0.02, fz);
  group.add(fireHalo);

  return {
    group,
    flock,
    fireLight,
    fireGlow,
    fireHalo,
    firePosition: new THREE.Vector3(fx, fy, fz),
    update(dt, t) {
      for (const a of animated) a.update(dt);
      flock.update(dt);
      // Vacillement : deux sinus déphasés, ça suffit à casser la régularité.
      const flicker = 0.82 + 0.12 * Math.sin(t * 11.3) + 0.08 * Math.sin(t * 27.1 + 1.7);
      fireLight.userData.flicker = flicker;
      // La source elle-même tremble de quelques centimètres : les ombres qu'elle
      // porte bougent, et le bord de la flaque cesse d'être une frontière fixe.
      fireLight.position.set(
        fx + Math.sin(t * 3.7) * 0.09,
        fy + 0.62 + Math.sin(t * 5.1 + 0.6) * 0.05,
        fz + Math.cos(t * 4.3 + 1.9) * 0.09,
      );
      // Les deux couches respirent à des rythmes différents : en phase, elles
      // se rappelleraient l'une l'autre et redeviendraient une seule tache.
      fireGlow.scale.setScalar(0.94 + flicker * 0.12);
      fireHalo.scale.setScalar(0.88 + flicker * 0.1 + Math.sin(t * 1.9) * 0.05);
      fireHalo.rotation.y += dt * 0.06;
    },
  };
}
