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
import type { TerrainQuery } from "./world/terrain-query.js";

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
// entièrement dans l'île principale (rayon 16) autour du spawn et couvre ce que la caméra voit
// réellement (FOV 22°, distance 40, plongée 38°).
export const BENCH_RADIUS = 14;

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
 * CONSTRUCTION qu'aucun point ne dépasse `radius` (`apps/lab/test/bench.test.ts` vérifie
 * l'invariant sur tous les points renvoyés, pas seulement en moyenne), et ça ne gâche aucun tirage
 * sur les quatre coins hors disque d'un carré. `sqrt(rng())` donne une densité UNIFORME dans le
 * disque — un rayon tiré linéairement entasserait les points près du centre, où les anneaux sont
 * plus étroits.
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
 * `textures`/`query`/`center` s'ajoutent à la signature du brief (`createBench(ctx, scene, opts)`),
 * pour la même raison que `createHero` en Task 11 : `makeBillboard` a besoin d'une texture déjà
 * décodée, un peuplement qui a l'air d'un jeu a besoin de terre ferme sous les pieds, et — depuis le
 * round 1 de revue — la scène ne peut plus être peuplée n'importe où sur la carte : `center` est la
 * position du héros au moment du peuplement (`main.ts` passe `[hero.position.x, hero.position.z]`),
 * le point autour duquel `BENCH_RADIUS` circonscrit tout ce qui est planté. Peupler hors du champ de
 * la caméra/de la shadow map mesurerait une scène partiellement cullée — un chiffre rassurant et
 * faux, précisément le piège que ce harnais existe pour éviter.
 */
export function createBench(
  ctx: Hd2dContext,
  scene: THREE.Scene,
  textures: TextureRegistry,
  query: TerrainQuery,
  center: readonly [number, number],
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

  function scatter(rng: () => number, count: number): readonly (readonly [number, number])[] {
    return scatterOnLand(query, rng, count, center, BENCH_RADIUS);
  }

  function populate(): void {
    // Idempotent : un rechargement de page avec le même `?bench=` ne doit pas accumuler deux
    // peuplements dans la même scène.
    clear();
    if (level === "off") return;

    const pop = POPULATION[level];
    // Graine dédiée, distincte de celle des props (`WORLD.seed + 7`, `props.ts`) : le peuplement du
    // harnais ne doit ni dépendre de l'ordre d'appel des autres générateurs, ni varier d'un
    // rechargement à l'autre — deux mesures prises sur la même page ne seraient plus comparables.
    const rng = mulberry32(WORLD.seed + 613);

    // --- joueurs : le plafond d'une partie ------------------------------------------------------
    for (const [x, z] of scatter(rng, pop.players)) {
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
    for (const [x, z] of scatter(rng, pop.monsters)) {
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
    for (const [x, z] of scatter(rng, pop.guards)) {
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
    for (const [x, z] of scatter(rng, pop.loot)) {
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
    for (const [x, z] of scatter(rng, pop.corpses)) {
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
    for (const [x, z] of scatter(rng, pop.projectiles)) {
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
    for (const [x, z] of scatter(rng, pop.effects)) {
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
    for (const [x, z] of scatter(rng, pop.castingLights)) {
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
