import {
  type Billboard,
  createAnimator,
  makeBillboard,
  makeRipple,
  makeSurfaceDisc,
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
import { CAMERA, GLACE_FINE, HERO, WORLD } from "../settings.js";
import type { Colliders } from "./colliders.js";
import { derapage, frictionPour, pasAmorti, vitesseMaxPour } from "./locomotion.js";
import type { TerrainMaterial, TerrainQuery } from "./terrain-query.js";
import { createThinIce, type EtatGlace } from "./thin-ice.js";

// Water Splash : 9 frames de 192px, jouées une fois.
const SPLASH = { cols: 9, frames: 9, fps: 20, height: 1.7, foot: 0.32 };

// Un pas tous les 1.2 unité parcourue : la cadence suit donc la vitesse, elle
// ne se dérègle pas si on ralentit.
const PAS_TOUS_LES = 1.2;
const BRASSE_TOUTES_LES = 0.85; // secondes, à la nage

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

interface Splash {
  billboard: Billboard;
  t: number;
}

interface Ripple {
  mesh: THREE.Mesh;
  t: number;
}

export interface HeroInput {
  x: number;
  z: number;
  jump: boolean;
  attack: boolean;
  /** Multiplicateur de consommation du souffle en nage — la zone le fournit à chaque image (Task 4
   *  de l'île de neige, `world/zones.ts`, `Zone.souffle`) : 1 en temps normal, 2 dans l'eau
   *  polaire (Task 7, la glace fine). Un TAUX lu chaque image plutôt qu'une constante figée ici :
   *  c'est ce qui permettra à Task 7 de le faire varier sans revenir toucher le héros. */
  souffleTaux: number;
}

/** Rectangle où le héros peut marcher, quand il est en intérieur — plancher plat, ni gravité ni
 *  nage ni saut, meubles à contourner. */
export interface Room {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
  obstacles: readonly { x: number; z: number; r: number }[];
}

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

  const pos = new THREE.Vector3(sx, query.heightAt(sx, sz) ?? 0, sz);
  let groundY = pos.y;
  // Vitesse HORIZONTALE persistante (Task 3 : le modèle à friction) — distincte de `vy`, qui reste
  // la chute/le saut, inchangés. Remise à zéro à chaque transition d'état (eau, pièce, noyade) :
  // sans ça on entrerait dans l'eau, ou dans une pièce, avec l'élan de la glace qu'on vient de
  // quitter.
  let vx = 0;
  let vz = 0;
  let vy = 0;
  let airborne = false;
  let swimming = false;
  let breath = HERO.swim.breath;
  let coyote = 0;
  let facing = 1;
  let piece: Room | null = null; // rectangle de la pièce quand on est à l'intérieur
  let distanceDepuisLePas = 0;
  let brasse = 0;
  let impact = 0;
  let attaque = -1; // temps écoulé dans le coup en cours ; négatif = pas d'attaque

  // Glace fine (Task 7) : un état par case, tenu par un module pur (`world/thin-ice.ts`) — le
  // héros ne fait que lui donner le `dt` et lire l'état en retour, jamais sa propre horloge.
  // `glaceCase` retient la case actuellement chargée (pour savoir QUAND relâcher l'ancienne en
  // changeant de case), `glaceEtat` le dernier état lu dessus (pour ne déclencher son et visuel
  // qu'à la TRANSITION, pas à chaque image où on reste craquelé).
  const thinIce = createThinIce(GLACE_FINE);
  let glaceCase: string | null = null;
  let glaceEtat: EtatGlace = "intacte";

  const maxStep = WORLD.maxStep * WORLD.levelHeight + 1e-3;
  // Depuis l'eau on se hisse sur une rive de plain-pied, jamais sur une falaise.
  const climb = WORLD.levelHeight * HERO.swim.climb;

  /** Surface sous un point : le sol, ou le plan d'eau là où il n'y a pas de sol. */
  const surfaceAt = (x: number, z: number) => query.heightAt(x, z) ?? WORLD.waterLevel;

  /** Centre de l'empreinte de collision, décalé sous le corps du sprite. */
  const empreinte = (z: number) => z - HERO.offset;

  /** Matière du sol sous les pieds, pour le son du pas — les cinq matières (Task 6), plus
   *  réduites à deux. `null` (hors carte / eau) retombe sur "herbe" : `step()` n'est de toute
   *  façon jamais appelée en nageant (voir plus bas, la cadence des pas et brasses). */
  const solSous = (): TerrainMaterial => query.kindAt(pos.x, empreinte(pos.z)) ?? "herbe";

  // Glace fine (Task 7) : clef de la case sous un point monde, dans le même quadrillage que
  // `TerrainQuery` (voir `terrain-query.ts`, sa fonction interne `toCell`) — non exposée par son
  // interface, donc reconstruite ici avec la même formule plutôt que d'élargir `TerrainQuery`
  // pour ce seul appelant.
  const demiGrille = WORLD.size / 2;
  const caseDe = (x: number, z: number): string =>
    `${Math.floor(x + demiGrille)},${Math.floor(z + demiGrille)}`;

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

  // Le sol sous le CENTRE décide où l'on peut poser le pied. Règle dure : elle n'est jamais
  // assouplie, sinon on gravirait une falaise en la poussant.
  const centreOk = (x: number, z: number): boolean => {
    const h = surfaceAt(x, empreinte(z));
    if (swimming) return h - WORLD.waterLevel <= climb;
    return airborne ? h <= pos.y + 0.02 : h - groundY <= maxStep;
  };

  const canEnter = (x: number, z: number): boolean => {
    // En intérieur, le relief et les props ne s'appliquent plus : la pièce est un simple
    // rectangle, posée hors de la grille de terrain.
    if (piece) {
      const p = piece;
      if (!(x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1)) return false;
      // Les meubles s'évitent, avec la même échappatoire qu'au dehors : si on en chevauche déjà
      // un, on doit pouvoir en sortir.
      const dans = (px: number, pz: number) =>
        p.obstacles.some((o) => (o.x - px) ** 2 + (o.z - pz) ** 2 < (o.r + HERO.radius) ** 2);
      return !dans(x, z) || dans(pos.x, pos.z);
    }
    if (!centreOk(x, z)) return false;

    // Le relief est testé sur le disque du héros, pas sur son centre : sinon il enfonce la
    // moitié de son corps dans la paroi avant d'être arrêté.
    const h = query.maxHeightAround(x, empreinte(z), HERO.radius);
    const plafond = swimming
      ? WORLD.waterLevel + climb
      : airborne
        ? pos.y + 0.02
        : groundY + maxStep;
    if (h > plafond) {
      // On chevauche déjà quelque chose de trop haut — c'est le cas juste après avoir chuté au
      // pied d'une falaise, le disque mordant encore la case du dessus. Sans cette échappatoire,
      // plus AUCUN déplacement n'est autorisé, même pour s'en éloigner, et le héros reste cimenté
      // sur place.
      const ici = query.maxHeightAround(pos.x, empreinte(pos.z), HERO.radius);
      if (!(ici > plafond && h <= ici)) return false;
    }

    if (!colliders.blocked(x, empreinte(z), HERO.radius)) return true;
    // Même échappatoire face aux props (spawn malheureux, prop ajouté dessous).
    return colliders.blocked(pos.x, empreinte(pos.z), HERO.radius);
  };

  /** Entre dans l'eau : position, souffle, vitesse remis à zéro, éclaboussure. `sonSplash` reste
   *  `sonEntreeEau` par défaut (le plouf ordinaire, en marchant/tombant dans l'eau) — la glace fine
   *  (Task 7) passe `plunge` à la place pour le SEUL son qui change quand on tombe à travers la
   *  glace plutôt que d'y entrer par un bord. Toute la mécanique (splash, reset de vitesse, souffle
   *  plein) reste ICI, une seule fois : la rupture doit y MENER, pas la réimplémenter. */
  function enterWater(sonSplash: () => void = sonEntreeEau): void {
    swimming = true;
    airborne = false;
    vy = 0;
    vx = 0;
    vz = 0;
    breath = HERO.swim.breath;
    pos.y = WORLD.waterLevel;
    groundY = WORLD.waterLevel;
    splash(pos.x, WORLD.waterLevel, pos.z);
    sonSplash();
  }

  function leaveWater(y: number): void {
    swimming = false;
    vx = 0;
    vz = 0;
    breath = HERO.swim.breath;
    pos.y = y;
    groundY = y;
    splash(pos.x, WORLD.waterLevel, pos.z);
    sonSortieEau();
  }

  function drown(): void {
    splash(pos.x, WORLD.waterLevel, pos.z);
    sonEntreeEau();
    swimming = false;
    airborne = false;
    vy = 0;
    vx = 0;
    vz = 0;
    breath = HERO.swim.breath;
    pos.set(spawn[0], query.heightAt(spawn[0], spawn[1]) ?? 0, spawn[1]);
    groundY = pos.y;
  }

  /** Glace fine (Task 7) : la case `cle` cède sous le poids — qu'elle vienne tout juste de finir
   *  de charger, ou qu'on l'ait retrouvée déjà rompue en y remarchant. Le poids QUITTE la case en
   *  cédant : on relâche nous-mêmes, tout de suite — sinon le regel n'aurait plus jamais
   *  l'occasion de démarrer, `thinIce.update()` (dans `update()`, plus bas) ne touchant que les
   *  cases déjà relâchées, et le bloc qui appelle `tomber` ne s'exécute plus une fois `swimming`
   *  devenu vrai (voir `enterWater`, juste au-dessus). La chute réutilise `enterWater` telle
   *  quelle — position, souffle plein, vitesse coupée, éclaboussure — SEUL le son change
   *  (`plunge` plutôt que le plouf générique `sonEntreeEau`) : la rupture doit MENER à l'entrée
   *  dans l'eau, pas la réimplémenter. Le taux de souffle de la zone (`input.souffleTaux`)
   *  s'applique ensuite exactement comme pour toute autre entrée dans l'eau. */
  function tomber(cle: string): void {
    shatter();
    thinIce.relache(cle);
    glaceCase = null;
    enterWater(plunge);
  }

  return {
    object: billboard.mesh,
    effects,
    position: pos,
    get airborne() {
      return airborne;
    },
    get swimming() {
      return swimming;
    },
    get indoors() {
      return piece !== null;
    },
    get breath() {
      return breath / HERO.swim.breath;
    },
    takeImpact() {
      const v = impact;
      impact = 0;
      return v;
    },
    setRoom(room, position) {
      piece = room;
      if (position) pos.copy(position);
      groundY = room ? room.y : (query.heightAt(pos.x, pos.z) ?? 0);
      pos.y = groundY;
      airborne = false;
      swimming = false;
      vy = 0;
      // Entrée ET sortie de pièce sont des téléportations logiques, à l'instar des transitions
      // d'eau : l'élan qu'on avait avant ne veut rien dire de l'autre côté.
      vx = 0;
      vz = 0;
    },
    update(dt, input) {
      // Glace fine (Task 7) : le regel doit avancer au TEMPS RÉEL écoulé, pas seulement quand le
      // héros est dessus, dessous (nage) ou ailleurs (pièce) — sinon tomber à l'eau y GÈLERAIT le
      // compte à rebours de la case qu'on vient de quitter, tant qu'on reste submergé. Appelé
      // inconditionnellement, une fois par image, avant tout le reste.
      thinIce.update(dt);

      const avantX = pos.x;
      const avantZ = pos.z;

      // La matière SOUS LES PIEDS, avant de bouger (même principe que `centreOk`), choisit la
      // friction et le plafond de vitesse de cette image. En pièce ou à la nage, la matière réelle
      // du terrain sous les coordonnées virtuelles/le fond marin n'a aucun sens physique : on
      // retombe sur `null` (= herbe) pour la friction — ce qui redonne le ressenti quasi
      // instantané qu'avait l'ancien modèle en intérieur et à la nage, amorti sur seulement
      // 2 images (imperceptible, voir `world/locomotion.ts`). La nage garde son propre plafond de
      // vitesse (`HERO.swim.speed`) : ce n'est pas une matière de sol, juste un milieu plus lent.
      const matiere = swimming || piece ? null : query.kindAt(pos.x, empreinte(pos.z));
      const friction = frictionPour(matiere);
      const vmax = swimming ? HERO.speed * HERO.swim.speed : vitesseMaxPour(matiere);
      const accel = vmax * friction;

      vx = pasAmorti(vx, input.x, accel, friction, dt);
      vz = pasAmorti(vz, input.z, accel, friction, dt);

      // --- glisse (son tenu) ----------------------------------------------------------------
      // `derapage` (`world/locomotion.ts`) ne regarde jamais la matière — coupée ici seulement
      // en l'air et à la nage, où le dérapage au sol n'a pas de sens.
      setSkid(airborne || swimming ? 0 : derapage(vx, vz, input.x, input.z, HERO.speed));

      // Un axe à la fois : buter sur un obstacle en diagonale fait glisser le long — inchangé,
      // seule la façon de calculer `nx`/`nz` change. Sur l'axe refusé, la vitesse retombe à zéro :
      // sinon on resterait collé au mur à pleine vitesse et on repartirait d'un coup dès qu'on
      // s'en écarte (voir le rapport de la Task 3 pour ce choix).
      const nx = pos.x + vx * dt;
      if (canEnter(nx, pos.z)) pos.x = nx;
      else vx = 0;
      const nz = pos.z + vz * dt;
      if (canEnter(pos.x, nz)) pos.z = nz;
      else vz = 0;

      if (piece) {
        // Plancher plat : ni gravité, ni nage, ni saut. On garde les pas.
        pos.y = piece.y;
        airborne = false;
        swimming = false;
        vy = 0;
      }
      const sol = piece ? piece.y : query.heightAt(pos.x, empreinte(pos.z));
      const eau = !piece && sol === null;

      if (swimming) {
        // Glace fine (Task 7) : le champ de hauteur ignore tout du trou qu'on vient de creuser —
        // la banquise reste un sol plein à cet endroit (`kindAt` en change la MATIÈRE, jamais la
        // hauteur, voir `island.ts`), donc `sol` y est un nombre bien réel, jamais `null`. Sans
        // cette garde, le héros remonterait tout seul UNE IMAGE après `enterWater(plunge)` — pile
        // là où il vient de s'enfoncer, ce qui viderait la mécanique de tout enjeu. Tant que LA
        // CASE SOUS LUI reste "rompue" (pas encore regelée), on force la lecture "encore de
        // l'eau" ; nager jusqu'à une case voisine — regelée ou jamais rompue — ressort normalement
        // par la branche `sol !== null` ci-dessous, sans changement.
        const dansUnTrou = thinIce.etat(caseDe(pos.x, empreinte(pos.z))) === "rompue";
        if (sol !== null && !dansUnTrou) {
          leaveWater(sol);
        } else {
          pos.y = WORLD.waterLevel;
          // Le taux vient de la zone (voir `HeroInput.souffleTaux`) : le héros n'a plus à savoir
          // QUELLE eau consomme plus vite, seulement lire ce qu'on lui donne.
          breath -= dt * input.souffleTaux;
          if (breath <= 0) drown();
        }
      } else {
        const ground = sol ?? WORLD.waterLevel;
        if (airborne) {
          coyote -= dt;
        } else if (ground < pos.y - 1e-3) {
          airborne = true; // le sol s'est dérobé : on tombe, on ne glisse pas
          vy = 0;
        } else {
          pos.y = ground;
          groundY = ground;
          coyote = HERO.jump.coyote;
        }

        // Pas de saut depuis l'eau, et coyote time : on pardonne quelques frames après avoir
        // quitté le bord.
        if (input.jump && coyote > 0) {
          vy = HERO.jump.speed;
          airborne = true;
          coyote = 0;
          sonSaut();
        }

        if (airborne) {
          vy -= HERO.jump.gravity * dt;
          pos.y += vy * dt;
          if (vy <= 0 && pos.y <= ground) {
            pos.y = ground;
            groundY = ground;
            // Le poids de la réception suit la vitesse de chute — pour le son comme pour la
            // secousse de caméra.
            impact = THREE.MathUtils.clamp(-vy / HERO.jump.speed, 0.35, 1.4);
            land(impact);
            vy = 0;
            airborne = false;
            distanceDepuisLePas = 0;
          }
        }

        // --- glace fine (Task 7) ----------------------------------------------------------------
        // Sous le POIDS seulement : sauter par-dessus ne charge rien, c'est tout le point du
        // mécanisme (« sous le poids », voir le spec). `!piece` est nécessaire même si `swimming`
        // est déjà exclu par la branche `else` : en pièce, `pos.x`/`pos.z` sont les coordonnées
        // VIRTUELLES de l'intérieur (voir `matiere` plus haut, même garde) — interroger le terrain
        // réel avec elles n'a aucun sens et pourrait tomber par coïncidence sur une vraie case de
        // glace fine ailleurs sur la carte.
        const surGlaceFine =
          !airborne && !piece && query.kindAt(pos.x, empreinte(pos.z)) === "glace-fine";
        if (surGlaceFine) {
          const cle = caseDe(pos.x, empreinte(pos.z));
          if (cle !== glaceCase) {
            // Case différente de la précédente (ou première case de la traversée) : l'ancienne
            // n'est plus sous le poids, et celle-ci reprend son état là où il en était — peut-être
            // déjà craquelée par un passage précédent qui n'a pas encore eu le temps de regeler.
            if (glaceCase) thinIce.relache(glaceCase);
            glaceCase = cle;
            glaceEtat = thinIce.etat(cle);
          }
          if (glaceEtat === "rompue") {
            // On a marché À PIED sur un trou déjà ouvert (pas encore regelé) — rien à charger, il
            // n'y a plus de glace du tout sous ce pas : on tombe SANS délai. Sans cette garde, un
            // héros revenu sur ses pas depuis la rive resterait planté sur du vide, la collision
            // ne connaissant que le relief (inchangé, toujours solide) et jamais l'état de
            // `thinIce`.
            tomber(cle);
          } else {
            const etatSuivant = thinIce.charge(cle, dt);
            if (etatSuivant !== glaceEtat) {
              glaceEtat = etatSuivant;
              if (etatSuivant === "craquelee") crack();
              else if (etatSuivant === "rompue") tomber(cle);
            }
          }
        } else if (glaceCase) {
          thinIce.relache(glaceCase);
          glaceCase = null;
          glaceEtat = "intacte";
        }
        // Le décalque suit l'état COURANT, pas seulement les transitions ci-dessus : il doit
        // rester visible tant qu'on reste plantés sur une case craquelée, pas clignoter une image.
        crackDisc.visible = surGlaceFine && glaceEtat === "craquelee";
        if (crackDisc.visible) crackDisc.position.set(pos.x, pos.y + 0.02, pos.z);

        // On touche l'eau : plouf, et on passe en nage.
        if (eau && !airborne) enterWater();
      }

      // --- pas et brasses -------------------------------------------------------------------
      // Cadencés à la DISTANCE parcourue, pas au temps : la cadence suit ainsi la vitesse et ne
      // se dérègle jamais, qu'on marche ou qu'on coure.
      const avance = Math.hypot(pos.x - avantX, pos.z - avantZ);
      if (swimming) {
        brasse -= dt;
        if (avance > 1e-4 && brasse <= 0) {
          swimStroke();
          brasse = BRASSE_TOUTES_LES;
        }
      } else if (!airborne) {
        distanceDepuisLePas += avance;
        if (distanceDepuisLePas >= PAS_TOUS_LES) {
          distanceDepuisLePas = 0;
          step(solSous());
        }
      }

      // --- attaque ------------------------------------------------------------------------------
      // On ne frappe pas en nageant, et un coup va jusqu'au bout : réappuyer pendant qu'il se joue
      // ne le relance pas, sinon la lame repart en arrière à chaque martèlement de la touche.
      if (attaque >= 0) {
        const avantAttaque = attaque;
        attaque += dt;
        if (avantAttaque < ATTAQUE_SON && attaque >= ATTAQUE_SON) sonAttaque();
        if (attaque >= ATTAQUE_DUREE) attaque = -1;
      } else if (input.attack && !swimming) {
        attaque = 0;
      }

      if (input.x !== 0) facing = input.x > 0 ? 1 : -1;
      billboard.setFlip(facing < 0);

      if (attaque >= 0) {
        // Déroulée à la main plutôt que par l'animateur : lui boucle, et il reprendrait le coup
        // au début au lieu de rendre la main à la course.
        const frame = Math.min(ATTAQUE.frames - 1, Math.floor(attaque * ATTAQUE.fps));
        billboard.setFrame(ATTAQUE.row * HERO.frame.cols + frame);
      } else if (airborne) {
        billboard.setFrame(HERO.anims.air.row * HERO.frame.cols + HERO.anims.air.frame);
      } else {
        anim.play(input.x !== 0 || input.z !== 0 ? HERO.anims.run : HERO.anims.idle);
        anim.update(dt);
      }

      // Étirement à la montée, écrasement à la chute. Le pivot du sprite est à ses pieds, donc il
      // reste planté au sol.
      const stretch = THREE.MathUtils.clamp(vy * 0.018, -0.1, 0.13);
      billboard.mesh.scale.set(1 - stretch * 0.6, 1 + stretch, 1);

      // En nage, le héros est descendu sous le plan d'eau : c'est lui qui le masque, et le
      // disque à la surface dit où il se trouve.
      billboard.placeAt(pos.x, swimming ? pos.y - HERO.swim.depth : pos.y, pos.z);
      disc.visible = swimming;
      if (swimming) disc.position.set(pos.x, WORLD.waterLevel + 0.03, pos.z);

      // --- ondes de surface ----------------------------------------------------------------------
      prochaineOnde -= dt;
      if (swimming && prochaineOnde <= 0) {
        const o = ondes[ondeSuivante];
        if (o) {
          ondeSuivante = (ondeSuivante + 1) % ONDES;
          o.t = 0;
          o.mesh.position.set(pos.x, WORLD.waterLevel + 0.02, pos.z);
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
    },
  };
}
