import type { TerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import { type Billboard, makeBillboard } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";
import { CAMERA, HERO, WORLD } from "./settings.js";
import { FOOT as CHEST_FOOT, TAILLE as CHEST_HEIGHT } from "./world/chest.js";
import { mulberry32 } from "./world/island.js";
import { DECO_SHEET, KINDS } from "./world/props.js";
import {
  BLAST as EFFECT_BLAST,
  IDLE as MONSTER_IDLE,
  SHEET as MONSTER_SHEET,
} from "./world/sheep.js";

// Task 13 : le harnais de charge. C'est le vrai inconnu du chantier — le PoC affiche un héros, une
// trentaine de props et une île ; le jeu affiche quatre joueurs, des monstres, des projectiles, des
// effets de combat, du butin et une carte entière. Découvrir un budget GPU insuffisant en S3, après
// avoir réécrit tout le renderer, coûterait très cher. C'est ce fichier qui répond à la question
// maintenant, pendant que la réponse est encore bon marché.

export type BenchLevel = "off" | "game" | "heavy";

export interface Bench {
  populate(): void;
  clear(): void;
  measure(render: () => void, gl: WebGL2RenderingContext): Promise<number>;
}

// Rayon de peuplement, en unités monde (1 case = 1 unité). Round 1 de revue : un harnais qui tire
// sur TOUTE la carte mesure une scène partiellement CULLÉE — hors du tronc de vue caméra et hors de
// la passe d'ombre, une part réelle de la population coûte alors zéro, et le chiffre annoncé est
// rassurant et FAUX. Dérivé des rayons d'intérêt réels du jeu (`TILE_SIZE = 64` px) : joueurs
// 900 px ≈ 14 unités, monstres 850 px ≈ 13, butin 650 px ≈ 10. 14, le plus large des trois, tient
// entièrement dans l'île principale (rayon 16) autour du spawn — et, une fois le disque RECENTRÉ
// (voir `cameraGroundFootprint`/`BENCH_CENTER_OFFSET` ci-dessous), sa demi-longueur (≈14.12) couvre
// la profondeur réellement visible le long de l'axe de visée. Le disque reste un CERCLE, la vraie
// empreinte au sol un trapèze plus large au loin qu'au près — un cercle ne peut pas épouser un
// trapèze exactement, mais recentré il reste entièrement DANS la profondeur visible, ce qui élimine
// le débordement dominant que le round 2 de revue a trouvé (le disque centré sur le héros, lui,
// débordait d'environ 5 unités côté caméra).
export const BENCH_RADIUS = 14;

/**
 * Aspect de référence (largeur/hauteur) sous lequel le harnais garantit que le disque tient dans
 * le tronc de vue, latéralement comme en profondeur — round 3 de revue : `camera.fov` de three est
 * VERTICAL, et la demi-largeur horizontale réelle vaut `atan(tan(fov/2) * aspect)`. En dessous
 * d'un aspect ≈ 1.66, les flancs du disque commencent à sortir du cadre avec les réglages actuels
 * de `CAMERA` (voir `cameraGroundFootprint.halfWidthAt` ci-dessous) — 16:9 (1.778) tient avec
 * environ 7 % de marge, un MacBook en plein écran ou une fenêtre avec les devtools ancrés à droite
 * (souvent ≈1.6) commence à culler les flancs. `apps/lab/AGENTS.md` documente cette hypothèse pour
 * l'appelant.
 */
export const BENCH_REFERENCE_ASPECT = 16 / 9;

/**
 * Empreinte au sol réellement visible à l'écran, le long de l'axe de visée ET latéralement :
 * intersection des deux rayons haut/bas du frustum vertical (± FOV/2 de part et d'autre du pitch)
 * avec le plan y=0. `near` est la distance du bord PROCHE (côté caméra) au point visé, `far` celle
 * du bord LOINTAIN (côté opposé) — voir `updateCamera` (`main.ts`) pour la géométrie caméra dont
 * ceci n'est qu'une lecture.
 *
 * Round 2 de revue : `BENCH_RADIUS` est correct, mais un disque centré sur le héros déborde quand
 * même du cadre côté caméra, parce que cette empreinte n'est PAS symétrique autour du héros — une
 * caméra qui plonge voit plus loin qu'elle ne voit près. Avec les réglages actuels de `CAMERA`
 * (fov 22°, distance 40, pitch 38°, height 1.2) : `near ≈ 9.07`, `far ≈ 19.17`. `apps/lab/test/
 * bench.test.ts` pin ces deux chiffres pour qu'un futur réglage de caméra fausse le test avant de
 * fausser silencieusement le harnais.
 *
 * Round 3 de revue : `near`/`far` ne modélisent que l'axe VERTICAL du FOV ; l'axe latéral n'était
 * couvert par aucun calcul ni aucun test. `halfWidthAt(depth)` comble ce trou : demi-largeur du
 * tronc de vue au sol, à une profondeur `depth` donnée le long de l'axe de visée (même convention
 * signée que `near`/`far` : positif = à l'opposé de la caméra). Dérivation : un point du sol à la
 * profondeur `depth` est à distance oblique `slant = hypot(elevation, offset + depth)` de la
 * caméra, sur un rayon qui plonge de l'angle `theta = atan2(elevation, offset + depth)` sous
 * l'horizontale — la profondeur de CE point le long de l'axe de visée central (celui à l'angle
 * `pitch`) est `slant * cos(theta - pitch)`, et c'est SEULEMENT à cette profondeur-là (pas à
 * `slant` lui-même) que le FOV horizontal s'applique linéairement, exactement comme `near`/`far`
 * appliquent le FOV vertical à une profondeur le long de l'axe de visée plutôt qu'à une distance
 * oblique.
 */
export function cameraGroundFootprint(
  camera: {
    fov: number;
    distance: number;
    pitch: number;
    height: number;
  },
  aspect: number,
): { near: number; far: number; halfWidthAt(depth: number): number } {
  const halfFov = (camera.fov * Math.PI) / 360; // FOV/2 en radians (`camera.fov` est en degrés)
  // Élévation de la caméra au-dessus du plan y=0, et son décalage horizontal par rapport au point
  // visé — exactement les deux termes qu'`updateCamera` ajoute à `camTarget` pour yaw=0.
  const elevation = camera.height + Math.sin(camera.pitch) * camera.distance;
  const offset = Math.cos(camera.pitch) * camera.distance;
  // `camera.fov` (vertical, three) -> demi-FOV horizontal réel, via l'aspect de l'image.
  const halfFovH = Math.atan(Math.tan(halfFov) * aspect);
  return {
    // Bord proche : la caméra plonge plus fort (pitch + FOV/2) ; bord lointain : plus rasant
    // (pitch - FOV/2), donc plus loin avant de toucher le sol.
    near: offset - elevation / Math.tan(camera.pitch + halfFov),
    far: elevation / Math.tan(camera.pitch - halfFov) - offset,
    halfWidthAt(depth) {
      const groundDistFromCamera = offset + depth;
      const slant = Math.hypot(elevation, groundDistFromCamera);
      const theta = Math.atan2(elevation, groundDistFromCamera);
      const forwardDepth = slant * Math.cos(theta - camera.pitch);
      return forwardDepth * Math.tan(halfFovH);
    },
  };
}

const FOOTPRINT = cameraGroundFootprint(CAMERA, BENCH_REFERENCE_ASPECT);

/**
 * Décalage du centre de peuplement, en unités monde, le long de l'axe de visée et dans le sens
 * OPPOSÉ à la caméra (voir `main.ts`, qui l'applique au bon axe selon sa propre convention de yaw).
 * C'est le milieu de `cameraGroundFootprint` : `(far - near) / 2`, ≈5.05 avec les réglages actuels.
 */
export const BENCH_CENTER_OFFSET = (FOOTPRINT.far - FOOTPRINT.near) / 2;

/**
 * Tolérance de dérive, en unités monde pour la position et en unités de distance caméra pour le
 * zoom, avant qu'une mesure ne soit jugée invalide (round 3 de revue). Volontairement PETITE :
 * au-delà de la gigue flottante d'un `updateCamera` d'amorçage, tout déplacement ou zoom réel doit
 * invalider la mesure plutôt que de la laisser paraître bonne — `scheduleBenchMeasure` (`main.ts`)
 * se redéclenche à CHAQUE bascule jour/nuit (`N`), longtemps après `Bench.populate()`, et le héros
 * a pu marcher (la caméra le suit) ou le joueur zoomer entre-temps.
 */
export const BENCH_DRIFT_TOLERANCE = 0.05;

/** L'état de la scène qui décide si un peuplement est encore ce que `measure()` s'apprête à
 *  rendre : la position du héros (la caméra le suit) et la distance de caméra courante (bornée à
 *  `CAMERA.zoom`). */
export interface BenchSnapshot {
  readonly heroX: number;
  readonly heroZ: number;
  readonly cameraDistance: number;
}

/**
 * `true` si la scène est toujours dans l'état où `Bench.populate()` l'a peuplée. Round 3 de
 * revue : un peuplement circonscrit à `BENCH_RADIUS` autour d'un centre (rounds 1-2) ne veut plus
 * rien dire une fois que le héros a marché ou que la caméra a zoomé — une part croissante de la
 * population sort du cadre, exactement le piège que `scatterOnLand`/`cameraGroundFootprint`
 * existent déjà pour éviter sur l'axe de l'ESPACE, réintroduit ici sur l'axe du TEMPS. Le HUD ne
 * doit jamais afficher un chiffre pris dans cet état comme s'il était une mesure valide.
 */
export function benchStillValid(current: BenchSnapshot, populatedAt: BenchSnapshot): boolean {
  const moved = Math.hypot(current.heroX - populatedAt.heroX, current.heroZ - populatedAt.heroZ);
  const zoomed = Math.abs(current.cameraDistance - populatedAt.cameraDistance);
  return moved <= BENCH_DRIFT_TOLERANCE && zoomed <= BENCH_DRIFT_TOLERANCE;
}

interface Population {
  players: number;
  monsters: number;
  guards: number;
  loot: number;
  corpses: number;
  projectiles: number;
  effects: number;
  /** Sources ponctuelles qui PROJETTENT une ombre — le poste le plus cher de la frame (six rendus
   *  de scène chacune, voir `props.ts`, le foyer). */
  castingLights: number;
}

// Le peuplement du JEU, pas celui du PoC : 4 joueurs (le plafond d'une partie), des monstres au
// rayon d'intérêt 850 px (~13 cases), des gardes de patrouille de zone sûre, du butin au rayon
// 650 px, un corps par joueur avec de la marge, des projectiles et effets de combat en vol. Le
// détail de chaque chiffre est dans `task-13-brief.md`.
export const POPULATION: Record<"game" | "heavy", Population> = {
  game: {
    players: 4,
    monsters: 40,
    guards: 8,
    loot: 30,
    corpses: 4,
    projectiles: 12,
    effects: 6,
    castingLights: 1,
  },
  heavy: {
    players: 4,
    monsters: 90,
    guards: 16,
    loot: 70,
    corpses: 12,
    projectiles: 30,
    effects: 20,
    castingLights: 4,
  },
};

/**
 * Répartit `count` points dans le DISQUE de rayon `radius` centré sur `center`, en rejetant l'eau
 * (`levelAt === null`) — même principe que `props.ts` (`freeCells`), en coordonnées MONDE plutôt
 * qu'indices de cellule, pour ne dépendre que de `TerrainQuery` et pas de `HeightField`. Le harnais
 * n'a pas besoin d'éviter les autres props (contrairement à `freeCells`) : un chevauchement visuel
 * ne fausse pas une mesure de coût GPU, et s'en soucier ferait de ce fichier un second `props.ts`.
 *
 * Tirage POLAIRE, jamais un carré englobant suivi d'un rejet hors-disque : ça garantit PAR
 * CONSTRUCTION qu'aucun point ne dépasse `radius` DE `center` (`apps/lab/test/bench.test.ts`
 * vérifie l'invariant sur tous les points renvoyés, pas seulement en moyenne), et ça ne gâche aucun
 * tirage sur les quatre coins hors disque d'un carré. `sqrt(rng())` donne une densité UNIFORME dans
 * le disque — un rayon tiré linéairement entasserait les points près du centre, où les anneaux sont
 * plus étroits.
 *
 * Cette garantie porte sur le DISQUE, pas sur le champ de la caméra : un disque n'est pas un
 * trapèze, et `center`/`radius` doivent être choisis pour que le disque tienne dans ce que la
 * caméra voit — c'est le rôle de `BENCH_CENTER_OFFSET`/`BENCH_RADIUS` et de `main.ts`, pas de
 * cette fonction, qui reste une primitive géométrique aveugle à la caméra.
 */
export function scatterOnLand(
  query: TerrainQuery,
  rng: () => number,
  count: number,
  center: readonly [number, number],
  radius: number,
): readonly (readonly [number, number])[] {
  const [cx, cz] = center;
  const out: [number, number][] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 400) {
    const angle = rng() * Math.PI * 2;
    const r = radius * Math.sqrt(rng());
    const x = cx + Math.cos(angle) * r;
    const z = cz + Math.sin(angle) * r;
    if (query.levelAt(x, z) === null) continue;
    out.push([x, z]);
  }
  return out;
}

interface FrozenSpriteOptions {
  url: string;
  cols?: number;
  rows?: number;
  height: number;
  foot: number;
  frameStart?: number;
  frameCount?: number;
  lit?: boolean;
}

/**
 * Un billboard qui ne bougera plus : `Bench.measure()` prend 40 instantanés du MÊME état (voir la
 * méthode du CLAUDE.md du PoC) — aucun rendu n'appelle `update(dt)` entre eux, et l'interface
 * `Bench` n'expose d'ailleurs aucun point d'entrée pour ça. Une frame FIGÉE au hasard dans le cycle
 * de la feuille suffit à varier les silhouettes sans avoir besoin d'un ticker que personne
 * n'appellerait.
 */
function frozenSprite(
  ctx: Hd2dContext,
  textures: TextureRegistry,
  rng: () => number,
  opts: FrozenSpriteOptions,
): Billboard {
  const {
    url,
    cols = 1,
    rows = 1,
    height,
    foot,
    frameStart = 0,
    frameCount = 1,
    lit = true,
  } = opts;
  const billboard = makeBillboard(ctx, {
    texture: textures.get(url),
    cols,
    rows,
    height,
    foot,
    lit,
    pitch: CAMERA.pitch,
  });
  if (frameCount > 1) billboard.setFrame(frameStart + Math.floor(rng() * frameCount));
  billboard.setFlip(rng() > 0.5);
  return billboard;
}

/**
 * Peuple la scène au niveau du jeu, en billboards PARTAGEANT les textures déjà décodées par
 * `main.ts` (`textures`, la même instance que le reste du labo) : le but est de mesurer le coût de
 * RENDU d'une population réaliste, pas celui d'un chargement — charger quoi que ce soit de neuf ici
 * fausserait la mesure avec un temps de décodage qui n'a rien à voir avec le GPU.
 *
 * `textures`/`query`/`getCenter` s'ajoutent à la signature du brief (`createBench(ctx, scene,
 * opts)`), pour la même raison que `createHero` en Task 11 : `makeBillboard` a besoin d'une texture
 * déjà décodée, un peuplement qui a l'air d'un jeu a besoin de terre ferme sous les pieds, et —
 * depuis le round 1 de revue — la scène ne peut plus être peuplée n'importe où sur la carte : le
 * centre du disque est le MILIEU de l'empreinte au sol réellement visible (round 2 : PAS la
 * position du héros elle-même, qui n'en est pas le centre — voir `cameraGroundFootprint`).
 *
 * Round 4 de revue : `getCenter` est un ACCESSEUR, relu à chaque `populate()`, et non plus une
 * valeur figée à la construction. Une valeur figée verrouillait le peuplement sur la position du
 * héros au moment où `main.ts` construit le harnais — c'est-à-dire toujours au spawn, puisque
 * `createBench` est appelé une seule fois avant la boucle. Mesurer `?bench=` depuis l'île polaire
 * (en marchant, ou en téléportant le héros depuis la console puis en rappelant `populate()`)
 * peuplait alors une scène centrée loin du cadre réel — hors tronc de vue, hors passe d'ombre — et
 * le chiffre relevé était plus bas qu'au spawn alors que trois effets de particules tournaient en
 * plus : « moins cher là où il y a plus », exactement le piège que ce harnais existe pour éviter.
 * `main.ts` fournit un accesseur qui relit `hero.position` à l'appel et applique le même décalage de
 * `BENCH_CENTER_OFFSET` le long de l'axe de visée qu'au premier peuplement — au spawn, rien ne
 * change (le héros n'a pas bougé avant le premier `populate()`), ce qui est la garantie qui rend
 * une mesure au spawn comparable avant/après ce correctif. Peupler hors du champ de la caméra/de la
 * shadow map mesurerait une scène partiellement cullée — un chiffre rassurant et faux.
 */
export function createBench(
  ctx: Hd2dContext,
  scene: THREE.Scene,
  textures: TextureRegistry,
  query: TerrainQuery,
  getCenter: () => readonly [number, number],
  opts: { level: BenchLevel },
): Bench {
  const { level } = opts;
  const group = new THREE.Group();
  group.name = "bench";
  scene.add(group);

  const billboards: Billboard[] = [];
  const lights: THREE.PointLight[] = [];

  function clear(): void {
    for (const b of billboards) {
      group.remove(b.mesh);
      b.dispose();
    }
    billboards.length = 0;
    for (const l of lights) {
      group.remove(l);
      l.shadow.map?.dispose();
      l.dispose();
    }
    lights.length = 0;
  }

  function place(b: Billboard, x: number, y: number, z: number): void {
    b.placeAt(x, y, z);
    group.add(b.mesh);
    billboards.push(b);
  }

  function scatter(
    rng: () => number,
    count: number,
    center: readonly [number, number],
  ): readonly (readonly [number, number])[] {
    return scatterOnLand(query, rng, count, center, BENCH_RADIUS);
  }

  function populate(): void {
    // Idempotent : un rechargement de page avec le même `?bench=` ne doit pas accumuler deux
    // peuplements dans la même scène.
    clear();
    if (level === "off") return;

    // Relu ICI, à chaque appel — pas une seule fois à la construction du harnais (round 4 de
    // revue) : c'est ce qui permet de réarmer le peuplement là où le héros/la caméra se trouve
    // VRAIMENT au moment de l'appel (spawn au premier chargement, île polaire après un
    // déplacement suivi d'un `bench.populate()` manuel), plutôt que de le laisser figé sur le
    // spawn pour toute la durée de la page.
    const center = getCenter();
    const pop = POPULATION[level];
    // Graine dédiée, distincte de celle des props (`WORLD.seed + 7`, `props.ts`) : le peuplement du
    // harnais ne doit ni dépendre de l'ordre d'appel des autres générateurs, ni varier d'un
    // rechargement à l'autre — deux mesures prises sur la même page ne seraient plus comparables.
    const rng = mulberry32(WORLD.seed + 613);

    // --- joueurs : le plafond d'une partie ------------------------------------------------------
    for (const [x, z] of scatter(rng, pop.players, center)) {
      const y = query.heightAt(x, z) ?? 0;
      const b = frozenSprite(ctx, textures, rng, {
        url: "/tex/warrior.png",
        cols: HERO.frame.cols,
        rows: HERO.frame.rows,
        height: HERO.size,
        foot: HERO.foot,
        frameStart: HERO.anims.idle.row * HERO.frame.cols,
        frameCount: HERO.anims.idle.frames,
      });
      place(b, x, y, z);
    }

    // --- monstres : rayon d'intérêt monstres, 850 px ≈ 13 cases --------------------------------
    for (const [x, z] of scatter(rng, pop.monsters, center)) {
      const y = query.heightAt(x, z) ?? 0;
      const b = frozenSprite(ctx, textures, rng, {
        url: "/tex/sheep.png",
        cols: MONSTER_SHEET.cols,
        rows: MONSTER_SHEET.rows,
        height: MONSTER_SHEET.height,
        foot: MONSTER_SHEET.foot,
        frameStart: MONSTER_IDLE.row * MONSTER_SHEET.cols,
        frameCount: MONSTER_IDLE.frames,
      });
      place(b, x, y, z);
    }

    // --- gardes : patrouilles de zone sûre -------------------------------------------------------
    // Même feuille que les joueurs — aucun sprite de garde dédié n'est chargé au labo, et ce qui
    // compte pour la mesure GPU est le coût MATÉRIEL d'un billboard éclairé, pas sa peau. Teinte
    // bleutée pour rester lisible sur les captures.
    for (const [x, z] of scatter(rng, pop.guards, center)) {
      const y = query.heightAt(x, z) ?? 0;
      const b = frozenSprite(ctx, textures, rng, {
        url: "/tex/warrior.png",
        cols: HERO.frame.cols,
        rows: HERO.frame.rows,
        height: HERO.size,
        foot: HERO.foot,
        frameStart: HERO.anims.idle.row * HERO.frame.cols,
        frameCount: HERO.anims.idle.frames,
      });
      (b.mesh.material as THREE.MeshLambertMaterial).color.set(0x9fc8ff);
      place(b, x, y, z);
    }

    // --- butin au sol : rayon butin, 650 px -----------------------------------------------------
    // Un tiers de coffres fermés (le seul sprite de loot du labo), le reste de la décoration déjà
    // chargée (`deco-0N.png`) : la variété d'un vrai tas de butin sans rien charger de neuf.
    for (const [x, z] of scatter(rng, pop.loot, center)) {
      const y = query.heightAt(x, z) ?? 0;
      const b =
        rng() < 0.34
          ? frozenSprite(ctx, textures, rng, {
              url: "/tex/chest-closed.png",
              height: CHEST_HEIGHT,
              foot: CHEST_FOOT,
            })
          : frozenSprite(ctx, textures, rng, {
              url: `/tex/deco-0${1 + Math.floor(rng() * 6)}.png`,
              height: DECO_SHEET.height,
              foot: DECO_SHEET.foot,
            });
      place(b, x, y, z);
    }

    // --- corps : un par joueur, plus la marge -----------------------------------------------------
    // Même matériau qu'un joueur (alphaTest, ombre reçue ET portée) — c'est ce coût-là qui compte —
    // aplati et assombri pour se lire comme un corps au sol plutôt qu'un joueur debout.
    for (const [x, z] of scatter(rng, pop.corpses, center)) {
      const y = query.heightAt(x, z) ?? 0;
      const b = frozenSprite(ctx, textures, rng, {
        url: "/tex/warrior.png",
        cols: HERO.frame.cols,
        rows: HERO.frame.rows,
        height: HERO.size,
        foot: HERO.foot,
        frameStart: HERO.anims.idle.row * HERO.frame.cols,
        frameCount: HERO.anims.idle.frames,
      });
      b.mesh.scale.y = 0.32;
      (b.mesh.material as THREE.MeshLambertMaterial).color.set(0x666666);
      place(b, x, y, z);
    }

    // --- projectiles : flèches et sorts en vol ---------------------------------------------------
    // Suspendus à mi-hauteur plutôt que posés au sol : un projectile réel est en l'air, pas planté
    // dans l'herbe. Cadrage (cols/rows/foot) repris du rocher de `props.ts` — seule la hauteur monde
    // est réduite, un choix de contenu qui reste valide à n'importe quelle échelle du plan.
    for (const [x, z] of scatter(rng, pop.projectiles, center)) {
      const y = (query.heightAt(x, z) ?? 0) + 1 + rng() * 0.6;
      const b = frozenSprite(ctx, textures, rng, {
        url: "/tex/rocks.png",
        cols: KINDS.rock.cols,
        rows: KINDS.rock.rows,
        height: 0.4,
        foot: KINDS.rock.foot,
        frameCount: KINDS.rock.cols,
      });
      place(b, x, y, z);
    }

    // --- effets de combat : impacts, soins, portails ---------------------------------------------
    // Non éclairés (comme l'explosion des moutons, `sheep.ts`) : un impact/soin/portail est sa
    // propre source visuelle, il ne reçoit pas la lumière de la scène.
    for (const [x, z] of scatter(rng, pop.effects, center)) {
      const y = query.heightAt(x, z) ?? 0;
      const b = frozenSprite(ctx, textures, rng, {
        url: "/tex/explosion.png",
        cols: EFFECT_BLAST.cols,
        height: EFFECT_BLAST.height,
        foot: EFFECT_BLAST.foot,
        frameCount: EFFECT_BLAST.cols,
        lit: false,
      });
      place(b, x, y, z);
    }

    // --- sources ponctuelles projetant : le poste le plus cher de la frame -----------------------
    // Une lumière ponctuelle qui projette, c'est SIX rendus de la scène (`props.ts`, le foyer).
    // Celles-ci restent TOUJOURS actives — contrairement au foyer, coupé de jour — parce qu'elles
    // représentent des torches ou des effets de combat, qui n'attendent pas la tombée de la nuit :
    // c'est la mesure de NUIT qui cumule les deux (voir `task-13-report.md`).
    for (const [x, z] of scatter(rng, pop.castingLights, center)) {
      const y = (query.heightAt(x, z) ?? 0) + 1.4;
      const light = new THREE.PointLight(0xfff2c8, 3, 18, 2);
      light.position.set(x, y, z);
      light.castShadow = true;
      light.shadow.mapSize.set(256, 256);
      light.shadow.camera.far = 9;
      light.shadow.bias = -0.005;
      group.add(light);
      lights.push(light);
    }
  }

  async function measure(render: () => void, gl: WebGL2RenderingContext): Promise<number> {
    // Méthode du CLAUDE.md du PoC, verbatim : un rendu d'amorçage, un `readPixels` pour vider le
    // pipe (compilation de shaders, premiers uploads GPU), puis N rendus encadrés par un second
    // `readPixels` qui BLOQUE jusqu'à ce que le GPU ait fini. Sans ce blocage, `performance.now()`
    // mesurerait la vitesse à laquelle le CPU soumet des commandes, pas celle à laquelle le GPU les
    // exécute — three empile les commandes bien plus vite qu'un GPU ne les consomme, et une boucle
    // rAF ordinaire ne force jamais cette synchro.
    const pixel = new Uint8Array(4);
    render();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

    const FRAMES = 40;
    const t0 = performance.now();
    for (let i = 0; i < FRAMES; i++) render();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

    return (performance.now() - t0) / FRAMES;
  }

  return { populate, clear, measure };
}
