import type { ColliderIndex } from "@lindocara/engine/hd2d/collider-index.js";
import {
  createHeroState,
  type HeroEvent,
  type HeroInput,
  type HeroSettings,
  type HeroState,
  type Room,
  type StepDeps,
} from "@lindocara/engine/hd2d/hero-state.js";
import { stepHero } from "@lindocara/engine/hd2d/hero-step.js";
import type { TerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import {
  type Billboard,
  createAnimator,
  makeBillboard,
  makeFlatSprite,
  makeRipple,
  makeSurfaceDisc,
  type Sprite,
} from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";
import {
  gliderOpen,
  land,
  setSkid,
  attack as sonAttaque,
  enterWater as sonEntreeEau,
  jump as sonSaut,
  leaveWater as sonSortieEau,
  step,
  swimStroke,
} from "../core/audio.js";
import { CAMERA, GLIDER, HALEINE, HERO, TRACES, WORLD } from "../settings.js";

// Water Splash : 9 frames de 192px, jouées une fois.
const SPLASH = { cols: 9, frames: 9, fps: 20, height: 1.7, foot: 0.32 };

// Un pas tous les 1.2 unité parcourue : la cadence suit donc la vitesse, elle
// ne se dérègle pas si on ralentit.
const PAS_TOUS_LES = 1.2;
const BRASSE_TOUTES_LES = 0.85; // secondes, à la nage

// Les réglages que `stepHero` (règle pure, `hero-step.ts`) consomme, assemblés depuis `HERO` et
// les constantes ci-dessus — c'est la SEULE dépendance de la règle pure à `settings.ts`, et elle
// vit ici, adaptateur, pas dans la règle. `HERO` porte des champs de plus (frame, anims, size,
// foot…) qu'un objet littéral laisserait passer par typage structurel sur une RÉFÉRENCE — mais
// `pasTousLes`/`brasseTousLes`/`haleineRepos`/`traceEcart` n'existent nulle part dans `settings.ts`
// (ce sont des constantes de `hero.ts` ou des champs d'autres réglages), d'où l'objet assemblé
// plutôt qu'un simple alias de `HERO`.
const HERO_STEP: HeroSettings = {
  speed: HERO.speed,
  radius: HERO.radius,
  offset: HERO.offset,
  friction: HERO.friction,
  vitesseSol: HERO.vitesseSol,
  jump: HERO.jump,
  glide: HERO.glide,
  swim: HERO.swim,
  pasTousLes: PAS_TOUS_LES,
  brasseTousLes: BRASSE_TOUTES_LES,
  haleineRepos: HALEINE.reposInterval,
  traceEcart: TRACES.ecart,
};

// L'attaque se joue une fois, image par image, hors de l'animateur en boucle : elle a un début et
// une fin, pas un cycle.
const ATTAQUE = HERO.anims.attack;
const ATTAQUE_DUREE = ATTAQUE.frames / ATTAQUE.fps;
const ATTAQUE_FRAPPE = ATTAQUE.strike / ATTAQUE.fps; // instant où la lame part
// Les sifflements du pack n'ont pas d'attaque : ils ENFLENT pendant 170 ms jusqu'à une crête, et
// c'est cette crête que l'oreille prend pour le coup. Le son doit donc partir AVANT la frappe, pas
// dessus : sa montée couvre alors l'armement et culmine sur l'image où la lame sort. Calé dessus,
// il culminait 170 ms après la fin du geste — audible, et c'est bien ce qu'on entendait. Les
// 170 ms sont mesurées, et `scripts/sync-assets.sh` aligne les trois échantillons dessus.
const SIFFLEMENT_MONTEE = 0.17;
const ATTAQUE_SON = Math.max(0, ATTAQUE_FRAPPE - SIFFLEMENT_MONTEE);

// --- textures procédurales : bouffée de souffle et empreinte de pas (Task 8, île de neige) --------
// Ni l'une ni l'autre n'a d'artefact généré au plan (voir le spec, section « Les assets générés » :
// la liste ne prévoit que les tilesets, le sapin, la stalagmite et le PNJ) — construites ici en
// canvas, même motif que les caches de MODULE paresseux de `billboard.ts`
// (`radialDisc`/`ringTexture`/`diffuseGlow`) : une image immuable, calculée une seule fois, jamais
// reconstruite d'un héros à l'autre.
let haleineTex: THREE.CanvasTexture | undefined;
function textureHaleine(): THREE.CanvasTexture {
  if (haleineTex) return haleineTex;
  const S = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const cx = canvas.getContext("2d");
  if (!cx) throw new Error("Contexte 2D indisponible");
  const g = cx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.45, "rgba(240,248,255,0.55)");
  g.addColorStop(1, "rgba(240,248,255,0)");
  cx.fillStyle = g;
  cx.fillRect(0, 0, S, S);
  haleineTex = new THREE.CanvasTexture(canvas);
  return haleineTex;
}

let traceTex: THREE.CanvasTexture | undefined;
function textureTrace(): THREE.CanvasTexture {
  if (traceTex) return traceTex;
  const S = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const cx = canvas.getContext("2d");
  if (!cx) throw new Error("Contexte 2D indisponible");
  const g = cx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, (S / 2) * 0.92);
  g.addColorStop(0, "rgba(28,58,74,0.55)");
  g.addColorStop(0.65, "rgba(28,58,74,0.3)");
  g.addColorStop(1, "rgba(28,58,74,0)");
  cx.fillStyle = g;
  cx.fillRect(0, 0, S, S);
  traceTex = new THREE.CanvasTexture(canvas);
  return traceTex;
}

interface Splash {
  billboard: Billboard;
  t: number;
}

interface Ripple {
  mesh: THREE.Mesh;
  t: number;
}

/** Une bouffée de souffle visible (Task 8) : un billboard non éclairé (voir plus bas pourquoi),
 *  recyclé en rond. */
interface Bouffee {
  billboard: Billboard;
  material: THREE.MeshBasicMaterial;
  t: number;
}

/** Une empreinte de pas (Task 8) : un décalque plat, recyclé en rond. */
interface Trace {
  sprite: Sprite;
  material: THREE.MeshLambertMaterial;
  t: number;
}

// HeroInput et Room sont déplacés vers hero-state.ts et ré-exportés d'ici
export type { HeroInput, Room };

export interface Hero {
  readonly object: THREE.Mesh;
  readonly effects: THREE.Group;
  readonly position: THREE.Vector3;
  readonly airborne: boolean;
  readonly swimming: boolean;
  /** `true` une fois entré dans une pièce (voir `setRoom`). */
  readonly indoors: boolean;
  /** Souffle restant, de 1 à 0. */
  readonly breath: number;
  /** Force de la dernière réception, remise à zéro dès qu'on la lit. */
  takeImpact(): number;
  /** Entre dans une pièce (rectangle + hauteur de plancher), ou en ressort (`null`). */
  setRoom(room: Room | null, position?: THREE.Vector3): void;
  /**
   * Téléportation de DEBUG — aucune mécanique de jeu ne l'appelle, seule la poignée exposée sur
   * `globalThis` par `main.ts` (voir son commentaire : trois implémenteurs successifs n'ont pas pu
   * vérifier leur travail sur l'île du nord, la traversée à la nage étant juste assez essoufflante
   * pour s'y noyer avant d'accoster). Pose le héros à `(x, z)`, hors eau et hors pièce, la vitesse
   * coupée — voir l'implémentation, qui réutilise `setRoom` plutôt que d'écrire ces champs à la
   * main pour ne pas en oublier un.
   */
  teleport(x: number, z: number): void;
  update(dt: number, input: HeroInput): void;
}

/**
 * Port de `hero.js` du PoC : marcher, sauter, tomber, nager, se noyer, entrer
 * dans une pièce (`setRoom`, la maison de Task 12) et le son qui accompagne chaque geste
 * (`core/audio.ts`).
 *
 * `ctx`/`textures` s'ajoutent à la signature du brief (`createHero(query, colliders, spawn)`) :
 * `makeBillboard` du package a besoin du contexte hd2d (yaw, registre de billboards) et d'une
 * texture déjà décodée, que ni `query` ni `colliders` ne peuvent fournir.
 */
export function createHero(
  ctx: Hd2dContext,
  textures: TextureRegistry,
  query: TerrainQuery,
  colliders: ColliderIndex,
  spawn: readonly [number, number],
): Hero {
  const [sx, sz] = spawn;
  const billboard = makeBillboard(ctx, {
    texture: textures.get("/tex/warrior.png"),
    cols: HERO.frame.cols,
    rows: HERO.frame.rows,
    height: HERO.size,
    aspect: 1,
    foot: HERO.foot,
    pitch: CAMERA.pitch,
  });

  // The canopy: one more billboard, not one more system. Hidden until deployed, and never
  // recreated — opening it allocates nothing.
  const glider = makeBillboard(ctx, {
    texture: textures.get("/tex/glider.png"),
    height: GLIDER.size,
    aspect: GLIDER.aspect,
    // Pivot at the bottom of the plane: `placeAt` then takes the height at which the canopy
    // starts directly, with no "feet" offset to subtract.
    foot: 0,
    pitch: CAMERA.pitch,
  });
  glider.mesh.visible = false;

  const anim = createAnimator(billboard, HERO.anims.idle, HERO.frame.cols);

  // Tout ce qui n'est pas le héros lui-même : les éclaboussures et le disque qui le signale à la
  // surface quand il est passé dessous.
  const effects = new THREE.Group();
  const disc = makeSurfaceDisc(1.1);
  effects.add(disc);
  // The glider's mesh joins the same group as every other secondary billboard here: `makeBillboard`
  // registers it with `ctx` for yaw/lighting but never adds it to a scene graph — without this it
  // would stay invisible regardless of `mesh.visible` or `placeAt`.
  effects.add(glider.mesh);
  const splashes: Splash[] = [];

  // Ondes de nage : un petit lot recyclé en rond, jamais rien à allouer en cours de partie. Le
  // disque sombre disait où était le nageur, pas qu'il avançait — sous lui, la surface restait un
  // miroir immobile.
  const ONDES = 4;
  const ONDE_VIE = 2.4; // secondes d'expansion
  const ONDE_TOUTES_LES = 0.55;
  const ondes: Ripple[] = Array.from({ length: ONDES }, () => {
    const mesh = makeRipple();
    mesh.visible = false;
    effects.add(mesh);
    return { mesh, t: Number.POSITIVE_INFINITY };
  });
  let prochaineOnde = 0;
  let ondeSuivante = 0;

  // Souffle visible (Task 8) : même motif que les ondes ci-dessus, un lot recyclé en rond. Non
  // éclairé (`lit: false`) délibérément : à l'ambiance nocturne (`MOODS.night`, `settings.ts`),
  // l'hémisphère et le contre-jour sont quasi noirs — une bouffée ÉCLAIRÉE y serait invisible pile
  // au moment où on a le plus besoin de la voir (le spec demande explicitement qu'elle se lise de
  // jour ET de nuit).
  const haleines: Bouffee[] = Array.from({ length: HALEINE.count }, () => {
    const billboard = makeBillboard(ctx, {
      texture: textureHaleine(),
      height: HALEINE.taille,
      aspect: 1,
      foot: 0.5, // pivot au centre : une bouffée ne "pose" rien au sol, elle flotte à hauteur de tête
      lit: false,
    });
    billboard.mesh.visible = false;
    effects.add(billboard.mesh);
    return {
      billboard,
      material: billboard.mesh.material as THREE.MeshBasicMaterial,
      t: Number.POSITIVE_INFINITY,
    };
  });
  let haleineSuivante = 0;
  // Décompte du souffle AU REPOS (arrêt, l'air, glisse), et cadence sur les pas en marchant : les
  // deux vivent maintenant dans `stepHero` (Task 7, règle pure) — `state.reposHaleine` (survit
  // d'une image à l'autre) y est lu ET écrit, cet adaptateur ne fait plus que JOUER l'événement
  // "haleine" qu'elle rend (voir `emitHaleine` et la boucle d'événements dans `update()`).

  // Traces de pas (Task 8) : même motif, un lot recyclé en rond de décalques posés à plat.
  const traces: Trace[] = Array.from({ length: TRACES.count }, () => {
    const sprite = makeFlatSprite(ctx, {
      texture: textureTrace(),
      size: TRACES.taille,
      aspect: 1.6, // ovale : plus proche d'une empreinte de botte qu'un rond
    });
    sprite.mesh.visible = false;
    effects.add(sprite.mesh);
    return {
      sprite,
      material: sprite.mesh.material as THREE.MeshLambertMaterial,
      t: Number.POSITIVE_INFINITY,
    };
  });
  let traceSuivante = 0;
  // Le côté (gauche/droit) alterné vit sur `state.coteTrace` (`HeroState`), et l'alternance elle-
  // même — comme le décalage perpendiculaire à la vitesse qui l'accompagne — est calculée par
  // `stepHero` (Task 7) : l'événement "trace" qu'il rend porte déjà la position posée, cet
  // adaptateur ne fait plus que POSER le décalque (billboard recyclé, orientation, durée de vie).

  // TOUT ce qui doit survivre d'une image à l'autre vit maintenant dans `state` (`hero-state.ts`),
  // muté en place par `stepHero` (déplacement horizontal) et par les sections encore résidentes
  // ci-dessous (vertical, nage — Tasks 3 à 7 les extrairont à leur tour). `pos`
  // (`THREE.Vector3`) reste l'accesseur PUBLIC exposé par `Hero.position` : il est resynchronisé
  // depuis `state` en fin d'image (et dans `setRoom`, hors boucle), jamais lu ni écrit ailleurs
  // dans cette fonction — sinon on aurait deux vérités de position qui pourraient diverger.
  const state: HeroState = createHeroState(
    sx,
    sz,
    query.heightAt(sx, sz) ?? 0,
    HERO.swim.breath,
    HALEINE.reposInterval,
  );
  const pos = new THREE.Vector3(state.x, state.y, state.z);
  // Force de la dernière réception, remise à zéro dès qu'on la lit (`takeImpact`) — pas un champ
  // de `HeroState` : rien ne s'y propulse à partir de la valeur d'avant, contrairement à tout ce
  // que `state` porte, donc rien n'oblige la règle pure à la connaître.
  let impact = 0;

  // Les dépendances que `stepHero` (règle pure) consomme — construites une fois, pas par image :
  const deps: StepDeps = { query, colliders, hero: HERO_STEP, world: WORLD };

  function splash(x: number, y: number, z: number): void {
    const s = makeBillboard(ctx, {
      texture: textures.get("/tex/splash.png"),
      cols: SPLASH.cols,
      rows: 1,
      height: SPLASH.height,
      aspect: 1,
      foot: SPLASH.foot,
      lit: false,
      pitch: CAMERA.pitch,
    });
    s.placeAt(x, y, z);
    effects.add(s.mesh);
    splashes.push({ billboard: s, t: 0 });
  }

  /** Émet une bouffée de souffle à hauteur de tête, devant le visage — dans le sens `facing`
   *  courant, pas dans celui du déplacement (au repos il n'y a pas de déplacement à lire). Appelée
   *  depuis la boucle d'événements de `update()`, sur l'événement "haleine" rendu par `stepHero`
   *  (Task 7) — donc AVANT que `facing` soit remis à jour plus bas dans `update()` : elle lit
   *  toujours la valeur de l'image PRÉCÉDENTE (voir la docstring de `HeroState.facing`, raison 2),
   *  peu importe que le déclencheur soit un pas ou le timer de repos. */
  function emitHaleine(): void {
    const b = haleines[haleineSuivante];
    if (!b) return;
    haleineSuivante = (haleineSuivante + 1) % HALEINE.count;
    b.t = 0;
    b.billboard.mesh.position.set(
      state.x + state.facing * HALEINE.avant,
      state.y + HALEINE.hauteurTete,
      state.z,
    );
    b.billboard.mesh.scale.setScalar(1);
    b.material.opacity = HALEINE.opaciteInitiale;
    b.billboard.mesh.visible = true;
  }

  /** Pose une empreinte de pas à la position que `stepHero` (Task 7) a déjà décalée
   *  perpendiculairement à la vitesse et alternée gauche/droite (`e.x`/`e.z`, événement "trace") —
   *  cet adaptateur ne recalcule plus l'écart ni le côté, il ne fait que POSER le décalque. */
  function poserTrace(e: Extract<HeroEvent, { t: "trace" }>): void {
    const tr = traces[traceSuivante];
    if (!tr) return;
    traceSuivante = (traceSuivante + 1) % TRACES.count;
    tr.t = 0;
    tr.sprite.mesh.position.set(e.x, state.y + 0.015, e.z);
    // Orientée dans le sens du pas : une empreinte alignée sur le déplacement se lit comme un pas,
    // une empreinte à plat toujours dans le même sens se lit comme un tampon. `state.vx`/`state.vz`
    // n'ont pas bougé depuis que `stepHero` a rendu cet événement (rien, dans la règle, ne les
    // touche plus après la cadence des pas) : les relire ici donne la même valeur qu'au moment du
    // calcul de la trace.
    tr.sprite.mesh.rotation.y = Math.atan2(state.vx, state.vz);
    tr.material.opacity = TRACES.opaciteInitiale;
    tr.sprite.mesh.visible = true;
  }

  return {
    object: billboard.mesh,
    effects,
    position: pos,
    get airborne() {
      return state.airborne;
    },
    get swimming() {
      return state.swimming;
    },
    get indoors() {
      return state.room !== null;
    },
    get breath() {
      return state.breath / HERO.swim.breath;
    },
    takeImpact() {
      const v = impact;
      impact = 0;
      return v;
    },
    setRoom(room, position) {
      state.room = room;
      if (position) {
        state.x = position.x;
        state.y = position.y;
        state.z = position.z;
      }
      state.groundY = room ? room.y : (query.heightAt(state.x, state.z) ?? 0);
      state.y = state.groundY;
      state.airborne = false;
      state.swimming = false;
      state.vy = 0;
      // Entrée ET sortie de pièce sont des téléportations logiques, à l'instar des transitions
      // d'eau : l'élan qu'on avait avant ne veut rien dire de l'autre côté.
      state.vx = 0;
      state.vz = 0;
      // `setRoom` peut être appelé HORS boucle (`main.ts`, en entrant/sortant de la maison) — `pos`
      // n'est resynchronisé qu'en fin de `update()`, donc sans cette ligne `hero.position` resterait
      // périmé jusqu'à la prochaine image si quelque chose le lit entre-temps.
      pos.set(state.x, state.y, state.z);
    },
    teleport(x, z) {
      // Réutilise `setRoom(null, ...)` plutôt que d'écrire `state.x`/`z`/`y`/vitesses à la main :
      // c'est EXACTEMENT la même remise à zéro qu'une sortie de pièce (hauteur relue sur le
      // terrain via `query.heightAt`, vitesses coupées, `airborne`/`swimming` retombés, `pos`
      // resynchronisé) — la dupliquer ici serait la façon la plus sûre d'en oublier un champ le
      // jour où `setRoom` en gagne un nouveau. `y` du vecteur passé n'a pas d'importance : `setRoom`
      // le recalcule aussitôt depuis le terrain à `(x, z)`, jamais depuis la valeur fournie.
      this.setRoom(null, new THREE.Vector3(x, 0, z));
      // `setRoom` ne touche pas au souffle : sans cette ligne, se téléporter hors d'une nage
      // entamée arriverait à pied sec déjà à moitié essoufflé — une incohérence qu'aucun joueur ne
      // verrait jamais en vrai (on ne quitte l'eau qu'en ayant regagné une rive, souffle plein).
      state.breath = HERO.swim.breath;
    },
    update(dt, input) {
      // --- déplacement, verticale ET nage comprises (Tasks 2-4 : extraites en règle pure,
      // `hero-step.ts`) - `stepHero` mute `state` en place (position et vitesse horizontales ET
      // verticales, plancher de pièce, saut/gravité/coyote/réception, entrée/sortie d'eau
      // ordinaire, noyade, cadence des pas ET des brasses, souffle visible et traces —
      // Task 7) et RACONTE ce qu'il s'est produit ; on joue ces événements ici, sur l'unique
      // frontière encore en fermeture sur `settings.ts`/`core/audio.ts`/`three`. "haleine" et
      // "trace" reproduisent exactement les anciens blocs `e.t === "pas"` (réarmer le repos
      // d'haleine, poser une trace sur neige) et le décompte de repos hors marche — seul leur
      // DÉCLENCHEUR a bougé de fichier, pas ce qu'ils font : voir `emitHaleine`/`poserTrace`
      // ci-dessus. Idem pour "entree-eau"/"sortie-eau"/"noyade" : seul le SPLASH + le SON a bougé
      // de place, la mécanique (reset vitesse/souffle, position au niveau de l'eau) est désormais
      // dans `enterWater`/`leaveWater`/`drown` de `hero-step.ts`.
      //
      const evts = stepHero(state, input, dt, deps);
      for (const e of evts) {
        if (e.t === "glisse") {
          setSkid(e.intensite);
        } else if (e.t === "pas") {
          step(e.matiere);
        } else if (e.t === "haleine") {
          emitHaleine();
        } else if (e.t === "trace") {
          poserTrace(e);
        } else if (e.t === "saut") {
          sonSaut();
        } else if (e.t === "glider-open") {
          glider.mesh.visible = true;
          gliderOpen();
        } else if (e.t === "glider-close") {
          glider.mesh.visible = false;
        } else if (e.t === "reception") {
          // Le poids de la réception suit la vitesse de chute — calculé par `stepHero` (Task 3),
          // ici seulement joué (son + secousse de caméra lue par `takeImpact()`).
          impact = e.force;
          land(impact);
        } else if (e.t === "entree-eau") {
          splash(e.x, e.y, e.z);
          sonEntreeEau();
        } else if (e.t === "sortie-eau") {
          splash(e.x, e.y, e.z);
          sonSortieEau();
        } else if (e.t === "noyade") {
          splash(e.x, e.y, e.z);
          sonEntreeEau();
          // Le renvoi au point d'apparition reste ICI : `stepHero` ne connaît pas `spawn` (voir sa
          // docstring de `drown`) — seul l'adaptateur, qui l'a reçu à la construction, le peut.
          state.x = spawn[0];
          state.y = query.heightAt(spawn[0], spawn[1]) ?? 0;
          state.z = spawn[1];
          state.groundY = state.y;
        } else if (e.t === "brasse") {
          swimStroke();
        }
      }

      // Le décompte du souffle AU REPOS (arrêt, l'air, glisse) vit désormais dans `stepHero`
      // (Task 7) : il rend son propre événement "haleine" quand le timer expire, déjà joué par la
      // boucle d'événements ci-dessus — rien à faire ici.

      // --- attaque ------------------------------------------------------------------------------
      // On ne frappe pas en nageant, et un coup va jusqu'au bout : réappuyer pendant qu'il se joue
      // ne le relance pas, sinon la lame repart en arrière à chaque martèlement de la touche.
      if (state.attaque >= 0) {
        const avantAttaque = state.attaque;
        state.attaque += dt;
        if (avantAttaque < ATTAQUE_SON && state.attaque >= ATTAQUE_SON) sonAttaque();
        if (state.attaque >= ATTAQUE_DUREE) state.attaque = -1;
      } else if (input.attack && !state.swimming) {
        state.attaque = 0;
      }

      // Piloté par `input.x` telle quelle, PAS par `state.vx` : c'était déjà le cas avant cette
      // task (le PoC d'origine ne connaissait même pas de vitesse persistante), et le garder ainsi
      // évite qu'un flip attende que la vitesse ait fini de changer de signe sur la glace — un
      // comportement que le jeu n'a jamais eu.
      if (input.x !== 0) state.facing = input.x > 0 ? 1 : -1;
      billboard.setFlip(state.facing < 0);

      if (state.attaque >= 0) {
        // Déroulée à la main plutôt que par l'animateur : lui boucle, et il reprendrait le coup
        // au début au lieu de rendre la main à la course.
        const frame = Math.min(ATTAQUE.frames - 1, Math.floor(state.attaque * ATTAQUE.fps));
        billboard.setFrame(ATTAQUE.row * HERO.frame.cols + frame);
      } else if (state.airborne) {
        billboard.setFrame(HERO.anims.air.row * HERO.frame.cols + HERO.anims.air.frame);
      } else {
        anim.play(input.x !== 0 || input.z !== 0 ? HERO.anims.run : HERO.anims.idle);
        anim.update(dt);
      }

      // Étirement à la montée, écrasement à la chute. Le pivot du sprite est à ses pieds, donc il
      // reste planté au sol.
      const stretch = THREE.MathUtils.clamp(state.vy * 0.018, -0.1, 0.13);
      billboard.mesh.scale.set(1 - stretch * 0.6, 1 + stretch, 1);

      // En nage, le héros est descendu sous le plan d'eau : c'est lui qui le masque, et le
      // disque à la surface dit où il se trouve.
      billboard.placeAt(state.x, state.swimming ? state.y - HERO.swim.depth : state.y, state.z);
      // The canopy follows the SAME `state.facing` as the body — one source for the orientation,
      // so the two cannot contradict each other. Placed only while deployed: a hidden billboard
      // has no need to be up to date.
      if (state.gliding) {
        glider.setFlip(state.facing < 0);
        glider.placeAt(state.x, state.y + GLIDER.lift, state.z);
      }
      disc.visible = state.swimming;
      if (state.swimming) disc.position.set(state.x, WORLD.waterLevel + 0.03, state.z);

      // --- ondes de surface ----------------------------------------------------------------------
      prochaineOnde -= dt;
      if (state.swimming && prochaineOnde <= 0) {
        const o = ondes[ondeSuivante];
        if (o) {
          ondeSuivante = (ondeSuivante + 1) % ONDES;
          o.t = 0;
          o.mesh.position.set(state.x, WORLD.waterLevel + 0.02, state.z);
        }
        prochaineOnde = ONDE_TOUTES_LES;
      }
      for (const o of ondes) {
        if (o.t > ONDE_VIE) {
          o.mesh.visible = false;
          continue;
        }
        o.t += dt;
        const k = Math.min(1, o.t / ONDE_VIE);
        o.mesh.visible = true;
        // Elle s'ouvre vite puis ralentit, et s'efface avant d'avoir fini : une onde qui garde
        // son intensité jusqu'au bout se lit comme un cerceau.
        o.mesh.scale.setScalar(0.5 + Math.sqrt(k) * 2.6);
        (o.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.55;
      }

      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i];
        if (!s) continue;
        s.t += dt * SPLASH.fps;
        if (s.t >= SPLASH.frames) {
          effects.remove(s.billboard.mesh);
          s.billboard.dispose();
          splashes.splice(i, 1);
        } else {
          s.billboard.setFrame(Math.floor(s.t));
        }
      }

      // --- souffle visible ------------------------------------------------------------------
      // Toujours animées, MÊME quand `input.haleineVisible` est retombé à faux (en quittant la
      // zone polaire) : le drapeau ne coupe QUE l'ÉMISSION, dans `stepHero`, jamais l'animation
      // d'une bouffée déjà en vol — sinon quitter la zone la ferait disparaître d'un coup en plein
      // vol.
      for (const b of haleines) {
        if (b.t > HALEINE.vie) {
          b.billboard.mesh.visible = false;
          continue;
        }
        b.t += dt;
        const k = Math.min(1, b.t / HALEINE.vie);
        b.billboard.mesh.visible = true;
        b.billboard.mesh.position.y += HALEINE.montee * dt;
        b.billboard.mesh.scale.setScalar(1 + k * HALEINE.expansion);
        b.material.opacity = (1 - k) * HALEINE.opaciteInitiale;
      }

      // --- traces de pas ----------------------------------------------------------------------
      for (const tr of traces) {
        if (tr.t > TRACES.vie) {
          tr.sprite.mesh.visible = false;
          continue;
        }
        tr.t += dt;
        tr.material.opacity = (1 - tr.t / TRACES.vie) * TRACES.opaciteInitiale;
      }

      // `pos` (l'accesseur PUBLIC de `Hero.position`) n'est lu ni écrit nulle part ailleurs dans
      // cette fonction — `state` est la seule vérité pendant l'image. Une seule resynchronisation,
      // ici, à la toute fin : `main.ts` lit `hero.position` aussi bien juste avant `update()`
      // (position de fin d'image précédente) que juste après (position de fin de CETTE image), et
      // les deux doivent rester exactes.
      pos.set(state.x, state.y, state.z);
    },
  };
}
