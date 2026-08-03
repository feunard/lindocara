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
  crack,
  land,
  plunge,
  setSkid,
  shatter,
  attack as sonAttaque,
  enterWater as sonEntreeEau,
  jump as sonSaut,
  leaveWater as sonSortieEau,
  step,
  swimStroke,
} from "../core/audio.js";
import { CAMERA, GLACE_FINE, HALEINE, HERO, TRACES, WORLD } from "../settings.js";
import type { Colliders } from "./colliders.js";
import {
  createHeroState,
  type HeroInput,
  type HeroSettings,
  type HeroState,
  type Room,
  type StepDeps,
} from "./hero-state.js";
import { stepHero } from "./hero-step.js";
import type { TerrainQuery } from "./terrain-query.js";
import { createThinIce } from "./thin-ice.js";

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
  colliders: Colliders,
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

  const anim = createAnimator(billboard, HERO.anims.idle, HERO.frame.cols);

  // Tout ce qui n'est pas le héros lui-même : les éclaboussures et le disque qui le signale à la
  // surface quand il est passé dessous.
  const effects = new THREE.Group();
  const disc = makeSurfaceDisc(1.1);
  effects.add(disc);
  const splashes: Splash[] = [];

  // Glace fine (Task 7) : visuel FACULTATIF du craquement — un simple décalque givré sous les
  // pieds, réutilisant `makeSurfaceDisc` comme le disque de nage juste au-dessus plutôt qu'un
  // système de rendu par case (hors périmètre, voir le brief). Il ne suit que la case ACTUELLEMENT
  // sous le poids : une case craquelée qu'on vient de quitter perd son décalque, mais garde son
  // état réel (`thinIce`) — le son prévient déjà que ça craque, ce décalque n'est qu'un appoint.
  // 1.4 : plus large que le héros lui-même. Vérifié à l'écran (voir le rapport de la task) —
  // à sa taille initiale (0.85, sous l'empreinte du personnage) le décalque restait quasi
  // entièrement caché par son propre sprite vu de l'angle isométrique du jeu ; il doit DÉBORDER
  // pour se voir, comme une flaque plus large que les pieds qui la font. Teinte sombre plutôt que
  // givrée : sur une glace déjà pâle (`tileset-glace.png`), un décalque clair s'y noyait aussi.
  const crackDisc = makeSurfaceDisc(1.4);
  (crackDisc.material as THREE.MeshBasicMaterial).color.set(0x1c3a4a);
  (crackDisc.material as THREE.MeshBasicMaterial).opacity = 0.8;
  effects.add(crackDisc);

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
  // Décompte du souffle AU REPOS (arrêt, l'air, glisse) — jamais réarmé à moins de ce délai : tant
  // qu'on enchaîne des pas, chaque pas le réarme (voir la cadence des pas plus bas). Vit maintenant
  // sur `state.reposHaleine` (`HeroState`) : c'est une variable qui doit survivre d'une image à
  // l'autre, exactement ce que `state` existe pour porter.

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
  // Le côté (gauche/droit) alterné vit sur `state.coteTrace` (`HeroState`) — même raison que
  // `reposHaleine` ci-dessus.

  // TOUT ce qui doit survivre d'une image à l'autre vit maintenant dans `state` (`hero-state.ts`),
  // muté en place par `stepHero` (déplacement horizontal) et par les sections encore résidentes
  // ci-dessous (vertical, nage, glace — Tasks 3 à 7 les extrairont à leur tour). `pos`
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

  // Glace fine (Task 7) : un état par case, tenu par un module pur (`world/thin-ice.ts`) — le
  // héros ne fait que lui donner le `dt` et lire l'état en retour, jamais sa propre horloge.
  // `state.glaceCase` retient la case actuellement chargée (pour savoir QUAND relâcher l'ancienne
  // en changeant de case), `state.glaceEtat` le dernier état lu dessus (pour ne déclencher son et
  // visuel qu'à la TRANSITION, pas à chaque image où on reste craquelé).
  const thinIce = createThinIce(GLACE_FINE);

  // Les dépendances que `stepHero` (règle pure) consomme — construites une fois, pas par image :
  // `query`/`colliders` sont déjà les interfaces attendues, `thinIce` EST le `ThinIce` réel.
  const deps: StepDeps = { query, colliders, hero: HERO_STEP, world: WORLD, glace: thinIce };

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
   *  courant, pas dans celui du déplacement (au repos il n'y a pas de déplacement à lire). */
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

  /** Pose une empreinte de pas sous les pieds, décalée perpendiculairement à la vitesse pour
   *  alterner pied gauche/pied droit — sans ce décalage, deux pas consécutifs se superposent et
   *  se lisent comme une seule tache plutôt qu'une trace. */
  function poserTrace(): void {
    const tr = traces[traceSuivante];
    if (!tr) return;
    traceSuivante = (traceSuivante + 1) % TRACES.count;
    state.coteTrace = -state.coteTrace;
    const norme = Math.hypot(state.vx, state.vz) || 1;
    const px = (-state.vz / norme) * TRACES.ecart * state.coteTrace;
    const pz = (state.vx / norme) * TRACES.ecart * state.coteTrace;
    tr.t = 0;
    tr.sprite.mesh.position.set(state.x + px, state.y + 0.015, state.z + pz);
    // Orientée dans le sens du pas : une empreinte alignée sur le déplacement se lit comme un pas,
    // une empreinte à plat toujours dans le même sens se lit comme un tampon.
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
    update(dt, input) {
      // Glace fine (Task 7) : le regel doit avancer au TEMPS RÉEL écoulé, pas seulement quand le
      // héros est dessus, dessous (nage) ou ailleurs (pièce) — sinon tomber à l'eau y GÈLERAIT le
      // compte à rebours de la case qu'on vient de quitter, tant qu'on reste submergé. Appelé
      // inconditionnellement, une fois par image, avant tout le reste.
      thinIce.update(dt);

      // --- déplacement, verticale ET nage comprises (Tasks 2-4 : extraites en règle pure,
      // `hero-step.ts`) - `stepHero` mute `state` en place (position et vitesse horizontales ET
      // verticales, plancher de pièce, saut/gravité/coyote/réception, entrée/sortie d'eau
      // ordinaire, noyade, cadence des pas ET des brasses, glace fine) et RACONTE ce qu'il s'est
      // produit ; on joue ces événements ici, sur l'unique frontière encore en fermeture sur
      // `settings.ts`/`core/audio.ts`. Le bundle joué sur "pas" (réarmer le repos d'haleine, poser
      // une trace) reproduit exactement l'ancien bloc `distanceDepuisLePas >= PAS_TOUS_LES` — seul
      // son DÉCLENCHEUR a bougé, pas ce qu'il fait. Idem pour "entree-eau"/"sortie-eau"/"noyade"/
      // "glace-craque"/"glace-rompt" : seul le SPLASH + le SON a bougé de place, la mécanique
      // (reset vitesse/souffle, position au niveau de l'eau, charge/rupture d'une case) est
      // désormais dans `enterWater`/`leaveWater`/`drown`/`rompre` de `hero-step.ts`.
      //
      // Plus d'instantané de `state.swimming` pris AVANT cet appel (l'ancien `nageaitDejaCeTick`,
      // devenu inutile depuis que le suivi de la glace fine vit DANS `stepHero` — voir sa docstring
      // pour où, dans la séquence, ce suivi lit encore `swimming` de DÉBUT de tick sans avoir besoin
      // d'une valeur mise de côté par l'appelant).
      const evts = stepHero(state, input, dt, deps);
      for (const e of evts) {
        if (e.t === "glisse") {
          setSkid(e.intensite);
        } else if (e.t === "pas") {
          step(e.matiere);
          if (input.haleineVisible) emitHaleine();
          state.reposHaleine = HALEINE.reposInterval;
          if (e.matiere === "neige") poserTrace();
        } else if (e.t === "saut") {
          sonSaut();
        } else if (e.t === "reception") {
          // Le poids de la réception suit la vitesse de chute — calculé par `stepHero` (Task 3),
          // ici seulement joué (son + secousse de caméra lue par `takeImpact()`).
          impact = e.force;
          land(impact);
        } else if (e.t === "glace-craque") {
          crack();
        } else if (e.t === "glace-rompt") {
          shatter();
        } else if (e.t === "entree-eau") {
          splash(e.x, e.y, e.z);
          // `rupture` distingue le plouf ordinaire du `plunge` de la glace qui cède (`rompre`,
          // `hero-step.ts`, Task 5) — SEUL le son change, la mécanique d'entrée dans l'eau est la
          // même dans les deux cas (voir `enterWater`).
          if (e.rupture) plunge();
          else sonEntreeEau();
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

      // Glace fine (Task 5) : le décalque de craquelure suit l'état COURANT tenu par `state`
      // (`glaceCase`/`glaceEtat`, maintenant maintenus par `stepHero` lui-même, plus par ce
      // fichier) — il doit rester visible tant qu'on reste plantés sur une case craquelée, pas
      // clignoter une image, et s'éteindre dès qu'on la quitte. `state.glaceCase` n'est non-null
      // QUE pendant qu'on est effectivement sous le poids d'une case suivie : `stepHero` le remet à
      // `null` dès qu'on saute, entre en pièce, change de case ou fait céder celle-ci (voir sa
      // docstring) — cette lecture n'a donc plus besoin de reconstruire `surGlaceFine` elle-même,
      // qui n'existe plus qu'à l'intérieur de la règle pure.
      crackDisc.visible = state.glaceCase !== null && state.glaceEtat === "craquelee";
      if (crackDisc.visible) crackDisc.position.set(state.x, state.y + 0.02, state.z);

      // Souffle au repos (Task 8) : hors du branchement ci-dessus (arrêt, en l'air, en train de
      // glisser sur la glace) — quelqu'un qui respire ne s'arrête pas de respirer. `!swimming`
      // seul : on continue de respirer en sautant ou en dérapant, seule la nage (souffle retenu,
      // Task 7) le coupe.
      if (input.haleineVisible && !state.swimming) {
        state.reposHaleine -= dt;
        if (state.reposHaleine <= 0) {
          emitHaleine();
          state.reposHaleine = HALEINE.reposInterval;
        }
      }

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
      // zone polaire) : le drapeau ne coupe QUE l'ÉMISSION plus haut, jamais l'animation d'une
      // bouffée déjà en vol — sinon quitter la zone la ferait disparaître d'un coup en plein vol.
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
