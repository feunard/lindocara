import type { ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import type { TerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import {
  type Billboard,
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
import { CAMERA, NORD, VAPEUR_SOURCE, WORLD } from "../settings.js";
import { mulberry32 } from "./island.js";
import { createFlock, type Flock } from "./sheep.js";

// --- texture procédurale de la vapeur (Task 10 de l'île de neige) --------------------------------
// Même motif que `textureHaleine`/`textureTrace` du héros (`world/hero.ts`) : un dégradé radial
// calculé une seule fois en canvas, jamais reconstruit d'une bouffée à l'autre. Ni l'une ni l'autre
// n'a d'artefact généré au plan (voir le spec, section « Les assets générés » : la liste ne prévoit
// que les tilesets, le sapin, la stalagmite et le PNJ — rien pour la source), donc construite ici
// en canvas comme les deux autres. Teintée chaud plutôt que blanc-bleuté (contraste avec
// `textureHaleine`, qui est le souffle FROID du héros) : la vapeur porte la couleur de la source
// qui l'exhale.
let vapeurTex: THREE.CanvasTexture | undefined;
function textureVapeur(): THREE.CanvasTexture {
  if (vapeurTex) return vapeurTex;
  const S = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const cx = canvas.getContext("2d");
  if (!cx) throw new Error("Contexte 2D indisponible");
  const g = cx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,238,210,0.85)");
  g.addColorStop(0.5, "rgba(255,224,190,0.4)");
  g.addColorStop(1, "rgba(255,224,190,0)");
  cx.fillStyle = g;
  cx.fillRect(0, 0, S, S);
  vapeurTex = new THREE.CanvasTexture(canvas);
  return vapeurTex;
}

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

// Exportée : `bench.ts` (Task 13) réutilise `rocks.png` comme projectile générique et doit poser
// le même cadrage que le prop rocher — recopier ces mesures à la main les aurait laissées diverger
// sans qu'aucun test ne le voie.
export const KINDS: Record<"tree" | "rock" | "fire" | "sapin" | "stalagmite", PropKind> = {
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
  // Les deux props enneigés (Task 11 de l'île de neige) : générés puis découpés par
  // `scripts/sprite.py` (détourage/recadrage/densité), une seule frame chacun — pas de feuille
  // à poses multiples comme `tree`, donc pas de balancement au vent, comme `campfire-base`/
  // `chest-*`. Hauteur choisie pour retomber sur la même densité de pixels à l'écran que
  // `tree.png` (~48 px/unité monde, voir le rapport de la task) : une source à 94x142/58x92 px
  // affichée trop grande aurait l'air floue à côté d'un pin du pack d'origine.
  sapin: {
    url: "/tex/sapin-neige.png",
    cols: 1,
    rows: 1,
    height: 2.9,
    aspect: 94 / 142,
    foot: 0.03,
    // Collider au TRONC, pas à la ramure — la règle de tous les props du labo. Le sapin généré
    // n'a pas de tronc visible distinct (contrairement à `tree.png`, qui en peint un), donc le
    // rayon vise le centre du bas de la silhouette plutôt qu'un tronc repérable au pixel.
    radius: 0.22,
  },
  stalagmite: {
    url: "/tex/stalagmite.png",
    cols: 1,
    rows: 1,
    height: 1.7,
    aspect: 58 / 92,
    foot: 0.03,
    // Même principe : le collider tient lieu de "tronc" — le socle où le pic touche le sol,
    // pas la pointe qui domine au-dessus.
    radius: 0.24,
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
// Exportée : le pulse de blizzard (Task 9 de l'île de neige, `main.ts`) réutilise EXACTEMENT cette
// même phase spatiale pour que la rafale de brouillard traverse la zone comme le vent traverse les
// arbres, au lieu de resserrer la visibilité partout à la fois. Avec `frames = 1`, le résultat est
// la phase spatiale en CYCLES : `main.ts` la combine avec le temps (`phase - t / période`) pour en
// faire une onde qui voyage, exactement l'équation d'une onde progressive.
export const windPhase = (x: number, z: number, frames: number): number =>
  ((x * WIND_DIR[0] + z * WIND_DIR[1]) / WIND_WAVELENGTH) * frames;

// Cadrage des `deco-0N.png` : une seule frame, posées au sol. Exportée pour la même raison que
// `KINDS` ci-dessus — `bench.ts` (Task 13) réutilise ces sprites comme butin au sol générique.
export const DECO_SHEET = { height: 0.85, foot: 0.12 };

export interface Props {
  group: THREE.Group;
  flock: Flock;
  fireLight: THREE.PointLight;
  fireGlow: THREE.Mesh;
  fireHalo: THREE.Mesh;
  firePosition: THREE.Vector3;
  /** La source chaude (Task 10 de l'île de neige) : le pendant exact du feu, sur l'île du nord —
   *  mêmes trois champs, mêmes usages dans `main.ts` (ambiance, ombre nocturne, appoint de
   *  lumière). */
  springLight: THREE.PointLight;
  springGlow: THREE.Mesh;
  springHalo: THREE.Mesh;
  springPosition: THREE.Vector3;
  update(dt: number, t: number): void;
}

// Buissons : les feuilles font 8 cases de large, mais les dernières ne sont
// qu'un rembourrage identique à la première — les jouer ferait un temps mort
// à chaque tour. Nombre de frames utiles relevé sheet par sheet. Exportée : `decidePlacements` ET
// `populate` en ont désormais chacun besoin (tirage pour l'une, rendu pour l'autre).
export const BUSH_FRAMES = [7, 6, 8, 7] as const;

/**
 * Ce que `populate` DÉCIDE avant d'avoir rien créé — position, échelle, retournement, empreinte de
 * collision — pour les cinq props RÉPARTIS AU HASARD (arbre, décor, buisson, sapin, stalagmite).
 * Pur, donc appelable depuis un script Node (`scripts/build-map.ts`) comme depuis le navigateur :
 * c'est ce qui permet de sérialiser les colliders sans jamais construire un seul billboard.
 *
 * `variant` choisit la texture (`deco-0N.png`, 1..6 ; `bush-N.png`/`BUSH_FRAMES`, 0..3) — sans
 * objet pour tree/sapin/stalagmite (une seule feuille chacun). `animFps`/`animPhase` sont la
 * cadence et la phase de balancement déjà tirées : `populate` ne doit plus piocher dans le hasard
 * à la création, sous peine de désynchroniser le tirage qui suit (buissons, arbres... tout ce qui
 * vient après dans le même flux). 0 pour un décor sans animation (`deco`).
 */
export interface Placement {
  kind: "tree" | "sapin" | "stalagmite" | "deco" | "bush";
  x: number;
  z: number;
  scale: number;
  flip: boolean;
  variant: number;
  animFps: number;
  animPhase: number;
  /** `null` pour un décor traversable — buisson, décoration au sol. */
  collider: ColliderRect | null;
}

export interface PlacementPlan {
  placements: readonly Placement[];
  /** Positions du troupeau : jamais de collider (la grille est statique, les moutons bougent), donc
   *  pas des `Placement` — juste de quoi nourrir `createFlock`. */
  sheep: readonly (readonly [number, number])[];
  /** Le feu et la source ne sont pas TIRÉS (position fixe, dérivée de `spawn`/`NORD`) : ils
   *  sortent de `placements`, qui ne modélise que les tirages au hasard. `fire.collider` est
   *  `null` dans le même cas que l'ancien `spawnProp` le laissait sans collider : sa position
   *  tombe hors carte / dans l'eau (jamais le cas avec `SPAWN` actuel, mais rien ne l'impose au
   *  niveau du type). La source, elle, a toujours son collider (l'original l'ajoutait sans garde). */
  fire: { x: number; z: number; collider: ColliderRect | null };
  spring: { x: number; z: number; collider: ColliderRect };
  /**
   * Le flux continue APRÈS ces décisions. `populate` le réutilise TEL QUEL pour tout ce qui suit
   * dans l'ORDRE D'ORIGINE et n'a aucun collider à sérialiser : le tirage propre au troupeau à sa
   * création (`createFlock`), les rochers du large, la cadence/phase du feu. L'exposer ainsi,
   * plutôt que de couper le tirage en deux graines indépendantes, est ce qui garde `populate` bit
   * à bit identique à avant cette task pour tout ce qui n'a pas de collider à sérialiser — et donc
   * inutile de reproduire ici (le script de production, lui, n'en a jamais besoin).
   */
  rng: () => number;
}

/** Cadence et phase d'un clip animé, DÉJÀ TIRÉES — la même formule que l'ancien `spawnProp` : le
 *  vent (`souffle`) garde une cadence resserrée (±4 %) et une phase spatiale (`windPhase`) qui
 *  balaie l'île comme une bourrasque ; sans lui (rochers, feu), cadence et phase restent
 *  décorrélées (±20 %, phase aléatoire). `undefined` (pas d'animation dans `KINDS`) ne consomme
 *  RIEN au hasard — sapin/stalagmite n'en ont jamais tiré, et il ne faut pas commencer maintenant. */
function animDraw(
  rng: () => number,
  anim: { frames: number; fps: number } | undefined,
  x: number,
  z: number,
  souffle: boolean,
): { fps: number; phase: number } {
  if (!anim) return { fps: 0, phase: 0 };
  const fps = anim.fps * (souffle ? 0.96 + rng() * 0.08 : 0.8 + rng() * 0.4);
  const phase = souffle ? windPhase(x, z, anim.frames) + rng() * 0.4 : rng() * 40;
  return { fps, phase };
}

export function decidePlacements(
  field: HeightField,
  query: TerrainQuery,
  seed: number,
  spawn: readonly [number, number],
): PlacementPlan {
  const rng = mulberry32(seed);
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

  // Position de la source chaude (Task 10, île de neige) : construite plus bas (section dédiée,
  // après les tirages de `freeCells`), mais réservée ICI — trop tard une fois les arbres/buissons
  // tirés, un tirage aurait pu tomber en plein dans son halo. Choisie au débarcadère SUD du lac
  // gelé (voir `settings.ts`, `NORD`, et `world/island.ts` pour le tracé des matières) : c'est là
  // qu'on pose pied après avoir nagé depuis le sud, essoufflé — le point de repos le plus logique
  // de la zone. `NORD.x - 2, NORD.z + 5` place la source à ~5.4 unités du centre du lac, largement
  // au-delà de la couronne de glace fine (rayon 3.4) et à bonne distance du monticule de saut
  // (`NORD.x + 4.5, NORD.z - 3.5`, rayon 2) — vérifié hors-écran contre la même formule que
  // `island.ts` avant de s'y fier à l'écran (voir le rapport de la task).
  const sourceX = NORD.x - 2;
  const sourceZ = NORD.z + 5;
  const sourceCell: [number, number] = [
    Math.floor(sourceX + size / 2),
    Math.floor(sourceZ + size / 2),
  ];
  for (let dj = -2; dj <= 2; dj++)
    for (let di = -2; di <= 2; di++) taken.add(key(sourceCell[0] + di, sourceCell[1] + dj));

  // `materials`, quand fourni, est une liste D'AUTORISATION exclusive : seules ces matières
  // passent. Sans elle, le tirage garde son comportement d'origine (la plage reste nue) ET
  // exclut désormais aussi l'île du nord (`neige`/`glace`) — avant la Task 11, rien ne
  // distinguait cette île des autres pour ce tirage générique, et un pin tempéré (`tree.png`)
  // ou un buisson pouvait y atterrir par hasard (vérifié à l'écran avant cette task : c'était
  // bien le cas). Les props polaires ont leur propre tirage plus bas, avec `materials: ["neige"]`.
  const freeCells = (
    levels: readonly number[],
    count: number,
    margin = 0,
    materials?: readonly string[],
  ): [number, number][] => {
    const out: [number, number][] = [];
    let guard = 0;
    while (out.length < count && guard++ < count * 400) {
      const i = Math.floor(rng() * size);
      const j = Math.floor(rng() * size);
      const h = field.levelAt(i, j);
      if (h === null || !levels.includes(h)) continue;
      const m = field.materialAt(i, j) ?? "";
      const exclu = materials
        ? !materials.includes(m)
        : m === "sable" || m === "neige" || m === "glace";
      if (exclu) continue;
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

  const placements: Placement[] = [];

  for (const [i, j] of freeCells([0, 1], 30, 1)) {
    const [x, z] = jitter(i, j, 0.5);
    const scale = 0.85 + rng() * 0.35;
    const flip = rng() > 0.5;
    // Garde héritée de l'ancien `spawnProp` : avec `margin = 1`, les 8 voisins de la case sont
    // garantis du même palier (jamais d'eau), donc jamais atteinte en pratique — reproduite pour
    // ne pas dépendre silencieusement de cette propriété si `margin` change un jour.
    if (query.heightAt(x, z) === null) continue;
    const r = (KINDS.tree.radius ?? 0) * scale;
    const { fps, phase } = animDraw(rng, KINDS.tree.anim, x, z, true);
    placements.push({
      kind: "tree",
      x,
      z,
      scale,
      flip,
      variant: 0,
      animFps: fps,
      animPhase: phase,
      collider: { x: x - r, z: z - r, w: 2 * r, h: 2 * r },
    });
  }

  for (const [i, j] of freeCells([0, 1, 2], 46)) {
    const [x, z] = jitter(i, j, 0.7);
    const variant = 1 + Math.floor(rng() * 6);
    const flip = rng() > 0.5;
    placements.push({
      kind: "deco",
      x,
      z,
      scale: 1,
      flip,
      variant,
      animFps: 0,
      animPhase: 0,
      collider: null,
    });
  }

  for (const [i, j] of freeCells([0, 1, 2], 22)) {
    const [x, z] = jitter(i, j, 0.6);
    const variant = Math.floor(rng() * 4);
    const flip = rng() > 0.5;
    const frames = BUSH_FRAMES[variant] ?? 7;
    // Les buissons se balancent au vent comme les arbres — toujours `souffle = true`, quel que
    // soit `variant` : ce n'est pas la même condition que `KINDS`, qui ne connaît pas les buissons.
    const { fps, phase } = animDraw(rng, { frames, fps: 2.6 }, x, z, true);
    placements.push({
      kind: "bush",
      x,
      z,
      scale: 1,
      flip,
      variant,
      animFps: fps,
      animPhase: phase,
      collider: null,
    });
  }

  // --- les props enneigés (Task 11 de l'île de neige) : uniquement sur `neige`, jamais sur la
  // glace du lac ni sa couronne de glace fine (matière RÈGLE, `field.materialAt` la renvoie comme
  // "glace" — voir `island.ts`). `materials: ["neige"]` rend ce tirage exclusif à cette seule
  // matière, à l'inverse de tous les tirages ci-dessus qui viennent d'en être fermés à l'île
  // (voir le commentaire de `freeCells`). La réservation de la clairière de la source chaude,
  // plus haut, s'applique ici comme partout : ces cases sont déjà dans `taken`.
  for (const [i, j] of freeCells([0, 1], 16, 1, ["neige"])) {
    const [x, z] = jitter(i, j, 0.5);
    const scale = 0.85 + rng() * 0.3;
    const flip = rng() > 0.5;
    if (query.heightAt(x, z) === null) continue; // garde, voir plus haut (jamais atteinte)
    const r = (KINDS.sapin.radius ?? 0) * scale;
    const { fps, phase } = animDraw(rng, KINDS.sapin.anim, x, z, false);
    placements.push({
      kind: "sapin",
      x,
      z,
      scale,
      flip,
      variant: 0,
      animFps: fps,
      animPhase: phase,
      collider: { x: x - r, z: z - r, w: 2 * r, h: 2 * r },
    });
  }
  for (const [i, j] of freeCells([0, 1], 9, 1, ["neige"])) {
    const [x, z] = jitter(i, j, 0.4);
    const scale = 0.8 + rng() * 0.35;
    const flip = rng() > 0.5;
    if (query.heightAt(x, z) === null) continue; // garde, voir plus haut (jamais atteinte)
    const r = (KINDS.stalagmite.radius ?? 0) * scale;
    const { fps, phase } = animDraw(rng, KINDS.stalagmite.anim, x, z, false);
    placements.push({
      kind: "stalagmite",
      x,
      z,
      scale,
      flip,
      variant: 0,
      animFps: fps,
      animPhase: phase,
      collider: { x: x - r, z: z - r, w: 2 * r, h: 2 * r },
    });
  }

  // Positions du troupeau — moutons SEULS, jamais de collider (ils bougent). `createFlock` tire
  // encore, à sa construction, quatre valeurs par mouton (phase/minuteur/orientation/voix) : ce
  // ne sont plus des DÉCISIONS DE PLACEMENT (aucun collider, aucun impact sur le rendu du reste de
  // la carte), donc elles restent dans `populate`, via `rng` exposé ci-dessous.
  const sheep = freeCells([0, 1], 6).map(([i, j]) => jitter(i, j, 0.4));

  const fx = spawn[0] + 1.8;
  const fz = spawn[1] - 1.4;
  const fr = KINDS.fire.radius ?? 0;
  // Même garde que l'ancien `spawnProp` : `y === null` (position hors carte / dans l'eau) le
  // laissait sans collider ET sans billboard. `populate` referme la garde côté billboard ; celle-ci
  // en est le pendant côté collider.
  const fireCollider: ColliderRect | null =
    query.heightAt(fx, fz) === null ? null : { x: fx - fr, z: fz - fr, w: 2 * fr, h: 2 * fr };

  return {
    placements,
    sheep,
    fire: { x: fx, z: fz, collider: fireCollider },
    // La source, elle, n'a jamais eu cette garde dans l'original — son collider était ajouté
    // inconditionnellement (voir le rapport de la task).
    spring: {
      x: sourceX,
      z: sourceZ,
      collider: { x: sourceX - 0.7, z: sourceZ - 0.7, w: 1.4, h: 1.4 },
    },
    rng,
  };
}

export function populate(
  ctx: Hd2dContext,
  textures: TextureRegistry,
  field: HeightField,
  query: TerrainQuery,
  spawn: readonly [number, number],
): Props {
  const plan = decidePlacements(field, query, WORLD.seed + 7, spawn);
  const group = new THREE.Group();
  const animated: { update(dt: number): void }[] = [];

  // Un seul billboard animé par KIND — reprend ce que faisait `spawnProp`, MOINS le collider (il
  // vient désormais de la carte, jamais d'ici) et MOINS le tirage au hasard (déjà fait, voir
  // `decidePlacements`/`plan`).
  function placeKindBillboard(
    kind: "tree" | "rock" | "fire" | "sapin" | "stalagmite",
    x: number,
    y: number,
    z: number,
    scale: number,
    flip: boolean,
    animFps: number,
    animPhase: number,
  ): void {
    const k = KINDS[kind];
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
    billboard.placeAt(x, y, z);
    billboard.setFlip(flip);
    if (k.anim) {
      const clip: Clip = { row: k.anim.row, frames: k.anim.frames, fps: animFps };
      const a = createAnimator(billboard, clip, k.cols);
      a.setPhase(animPhase);
      animated.push(a);
    }
    group.add(billboard.mesh);
  }

  for (const p of plan.placements) {
    if (p.kind === "deco") {
      // Jamais de garde `y === null` ici : l'original posait la décoration à `?? 0` plutôt que de
      // la sauter (elle n'a pas de collider à perdre si elle tombe un peu à côté).
      const y = query.heightAt(p.x, p.z) ?? 0;
      const billboard = makeBillboard(ctx, {
        texture: textures.get(`/tex/deco-0${p.variant}.png`),
        height: DECO_SHEET.height,
        foot: DECO_SHEET.foot,
        pitch: CAMERA.pitch,
      });
      billboard.placeAt(p.x, y, p.z);
      billboard.setFlip(p.flip);
      group.add(billboard.mesh);
      continue;
    }
    if (p.kind === "bush") {
      const y = query.heightAt(p.x, p.z) ?? 0;
      const billboard = makeBillboard(ctx, {
        texture: textures.get(`/tex/bush-${p.variant + 1}.png`),
        cols: 8,
        height: 1.5,
        foot: 0.43,
        pitch: CAMERA.pitch,
      });
      billboard.placeAt(p.x, y, p.z);
      billboard.setFlip(p.flip);
      group.add(billboard.mesh);
      const frames = BUSH_FRAMES[p.variant] ?? 7;
      const a = createAnimator(billboard, { row: 0, frames, fps: p.animFps }, 8);
      a.setPhase(p.animPhase);
      animated.push(a);
      continue;
    }
    // tree / sapin / stalagmite : même garde que `decidePlacements` (jamais atteinte en pratique,
    // voir son commentaire), reproduite ici parce que c'est `populate`, pas `decidePlacements`,
    // qui construit le billboard.
    const y = query.heightAt(p.x, p.z);
    if (y === null) continue;
    placeKindBillboard(p.kind, p.x, y, p.z, p.scale, p.flip, p.animFps, p.animPhase);
  }

  // Moutons : ils se baladent, donc pas de collider (la grille est statique).
  const flock = createFlock(ctx, textures, query, plan.sheep, plan.rng);
  group.add(flock.group);

  // Rochers dans l'eau, autour de l'île.
  for (let n = 0; n < 14; n++) {
    const a = plan.rng() * Math.PI * 2;
    const r = field.cols * 0.5 + 1.5 + plan.rng() * 4;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (query.heightAt(x, z) !== null) continue;
    const scale = 0.7 + plan.rng() * 0.6;
    const flip = plan.rng() > 0.5;
    const { fps, phase } = animDraw(plan.rng, KINDS.rock.anim, x, z, false);
    placeKindBillboard("rock", x, WORLD.waterLevel, z, scale, flip, fps, phase);
  }

  // --- le feu de camp : sprite non éclairé + vraie lumière ponctuelle -------
  // Position décidée par `decidePlacements` (`plan.fire`) — jamais recalculée ici, pour que
  // `populate` et le script de production ne puissent jamais en dériver deux valeurs différentes.
  const { x: fx, z: fz } = plan.fire;
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
  // Même garde que `decidePlacements` (`plan.fire.collider`) : si le point tombait hors carte, ni
  // billboard ni collider. Cadence/phase tirées ICI, au même point du flux qu'avant cette task
  // (après les rochers du large) — `plan.rng` continue le MÊME tirage, la flamme n'a donc pas
  // changé d'un chiffre.
  const fireY = query.heightAt(fx, fz);
  if (fireY !== null) {
    const { fps, phase } = animDraw(plan.rng, KINDS.fire.anim, fx, fz, false);
    placeKindBillboard("fire", fx, fireY, fz, 1, false, fps, phase);
  }
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

  // --- la source chaude : le point de repos de la zone polaire, pendant exact du feu ----------
  // Position décidée par `decidePlacements` (`plan.spring`), pour la même raison que `plan.fire`
  // plus haut. Son collider (rayon 0.7, comme avant Task 8) vient désormais de la carte — cette
  // section ne construit plus que la lumière et la vapeur, jamais de collider.
  const { x: sourceX, z: sourceZ } = plan.spring;
  const sy = query.heightAt(sourceX, sourceZ) ?? 0;

  // Même couleur de base que le feu (chaude), teinte ambrée plutôt qu'orange franc : les deux
  // landmarks ne doivent jamais se confondre au premier regard malgré la même mécanique.
  const springLight = new THREE.PointLight(0xffb066, 1, 34, 2);
  springLight.position.set(sourceX, sy + 0.4, sourceZ);
  // Piège n°2 : une lumière ponctuelle qui projette coûte SIX rendus de la scène, et l'ombre ne se
  // lit pas en plein jour. `castShadow` reste activé sur l'objet — c'est `pushMood` (`main.ts`) qui
  // le coupe le jour, exactement comme pour `fireLight`.
  springLight.castShadow = true;
  springLight.shadow.mapSize.set(256, 256);
  springLight.shadow.camera.far = 9;
  springLight.shadow.bias = -0.005;
  group.add(springLight);

  // Piège n°1 : DEUX couches à POIDS ÉGAL, comme `fireGlow`/`fireHalo` ci-dessus. Donner le dessus
  // à la petite lui rendrait aussitôt son statut de tache principale, et le « gros rond » reviendrait.
  // Rayons plus PETITS que ceux du feu (5.4/13 là-bas) : jugé à l'écran, la neige — bien plus
  // réfléchissante que l'herbe du camp sud — renvoie tellement de `springLight` que les mêmes
  // rayons noyaient toute la petite île sous le halo, au lieu d'y laisser une flaque contenue.
  const springGlow = makeGlow(4, 0xffa64d, 0);
  springGlow.position.set(sourceX, sy + 0.03, sourceZ);
  group.add(springGlow);

  const springHalo = makeGlow(9, 0xff9640, 1);
  springHalo.position.set(sourceX, sy + 0.02, sourceZ);
  group.add(springHalo);

  // --- la vapeur : un lot recyclé en rond, même motif que le souffle du héros (`world/hero.ts`,
  // `haleines`) — mais une émission CONTINUE plutôt que cadencée sur les pas, la source fume tout
  // le temps.
  interface Puff {
    billboard: Billboard;
    material: THREE.MeshBasicMaterial;
    t: number;
    seed: number;
  }
  const puffs: Puff[] = Array.from({ length: VAPEUR_SOURCE.count }, () => {
    const billboard = makeBillboard(ctx, {
      texture: textureVapeur(),
      height: VAPEUR_SOURCE.taille,
      aspect: 1,
      foot: 0.5, // pivot au centre : une bouffée de vapeur ne "pose" rien au sol, elle flotte
      // Non éclairée, comme la bouffée de souffle du héros (`HALEINE`) : à l'ambiance nocturne,
      // l'hémisphère et le contre-jour sont quasi noirs — une bouffée ÉCLAIRÉE y serait invisible
      // pile au moment où on a le plus besoin de la voir.
      lit: false,
    });
    billboard.mesh.visible = false;
    group.add(billboard.mesh);
    return {
      billboard,
      material: billboard.mesh.material as THREE.MeshBasicMaterial,
      t: Number.POSITIVE_INFINITY,
      seed: 0,
    };
  });
  let puffSuivant = 0;
  let prochaineVapeur = 0;

  function emitVapeur(): void {
    const p = puffs[puffSuivant];
    if (!p) return;
    puffSuivant = (puffSuivant + 1) % VAPEUR_SOURCE.count;
    // Toujours le MÊME générateur que `decidePlacements`/`populate` — il continue simplement de
    // tourner pendant toute la vie de la scène, exactement comme avant cette task (`rng` était un
    // seul flux partagé pour toute la durée de `populate`, décisions de placement comprises).
    const a = plan.rng() * Math.PI * 2;
    const r = plan.rng() * VAPEUR_SOURCE.rayon;
    p.t = 0;
    p.seed = plan.rng() * Math.PI * 2;
    p.billboard.mesh.position.set(sourceX + Math.cos(a) * r, sy + 0.12, sourceZ + Math.sin(a) * r);
    p.billboard.mesh.scale.setScalar(1);
    p.material.opacity = VAPEUR_SOURCE.opaciteInitiale;
    p.billboard.mesh.visible = true;
  }

  return {
    group,
    flock,
    fireLight,
    fireGlow,
    fireHalo,
    firePosition: new THREE.Vector3(fx, fy, fz),
    springLight,
    springGlow,
    springHalo,
    springPosition: new THREE.Vector3(sourceX, sy, sourceZ),
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

      // --- la source chaude : même mécanique que le feu ci-dessus, phases différentes -----------
      // Des sinus déphasés DIFFÉREMMENT de ceux du feu : les deux sources sont à des dizaines
      // d'unités l'une de l'autre et ne sont jamais co-visibles, mais réutiliser exactement les
      // mêmes arguments les ferait "respirer" en cadence si elles l'étaient un jour.
      const springFlicker = 0.85 + 0.1 * Math.sin(t * 8.9 + 2.3) + 0.07 * Math.sin(t * 19.4 + 0.4);
      springLight.userData.flicker = springFlicker;
      springLight.position.set(
        sourceX + Math.sin(t * 2.9 + 1.1) * 0.07,
        sy + 0.4 + Math.sin(t * 4.4 + 0.2) * 0.04,
        sourceZ + Math.cos(t * 3.3 + 0.8) * 0.07,
      );
      springGlow.scale.setScalar(0.94 + springFlicker * 0.12);
      springHalo.scale.setScalar(0.88 + springFlicker * 0.1 + Math.sin(t * 1.4 + 3) * 0.05);
      // Tourne dans le sens OPPOSÉ au halo du feu (`-=` contre `+=`) : un repère de plus qui
      // distingue les deux landmarks, même figés sur une capture.
      springHalo.rotation.y -= dt * 0.045;

      // Vapeur : émission continue, INDÉPENDANTE de l'ambiance jour/nuit — contrairement à la
      // flaque de lumière, qui suit `mood.value.fire` et s'éteint de jour (`main.ts`, `pushMood`),
      // la buée d'une source chaude se voit à toute heure.
      prochaineVapeur -= dt;
      if (prochaineVapeur <= 0) {
        emitVapeur();
        prochaineVapeur = VAPEUR_SOURCE.emission;
      }
      for (const p of puffs) {
        if (p.t > VAPEUR_SOURCE.vie) {
          p.billboard.mesh.visible = false;
          continue;
        }
        p.t += dt;
        const k = Math.min(1, p.t / VAPEUR_SOURCE.vie);
        p.billboard.mesh.position.y += VAPEUR_SOURCE.montee * dt;
        // Une légère dérive latérale : de la vapeur qui monte parfaitement droite se lit comme un
        // jeu de particules, pas comme un phénomène physique.
        p.billboard.mesh.position.x += Math.sin(p.t * 2.1 + p.seed) * 0.05 * dt;
        p.billboard.mesh.position.z += Math.cos(p.t * 1.7 + p.seed) * 0.05 * dt;
        p.billboard.mesh.scale.setScalar(1 + k * VAPEUR_SOURCE.expansion);
        p.material.opacity = (1 - k) * VAPEUR_SOURCE.opaciteInitiale;
      }
    },
  };
}
