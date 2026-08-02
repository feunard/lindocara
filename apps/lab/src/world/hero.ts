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
import { CAMERA, HERO, WORLD } from "../settings.js";
import type { Colliders } from "./colliders.js";
import type { TerrainQuery } from "./terrain-query.js";

// Water Splash : 9 frames de 192px, jouées une fois.
const SPLASH = { cols: 9, frames: 9, fps: 20, height: 1.7, foot: 0.32 };

// L'attaque se joue une fois, image par image, hors de l'animateur en boucle : elle a un début et
// une fin, pas un cycle.
const ATTAQUE = HERO.anims.attack;
const ATTAQUE_DUREE = ATTAQUE.frames / ATTAQUE.fps;

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
}

export interface Hero {
  readonly object: THREE.Mesh;
  readonly effects: THREE.Group;
  readonly position: THREE.Vector3;
  readonly airborne: boolean;
  readonly swimming: boolean;
  /** Souffle restant, de 1 à 0. */
  readonly breath: number;
  /** Force de la dernière réception, remise à zéro dès qu'on la lit. */
  takeImpact(): number;
  update(dt: number, input: HeroInput): void;
}

/**
 * Port de `~/git/poc-hd-2d/src/world/hero.js`, réduit à ce que la Task 11 couvre : marcher,
 * sauter, tomber, nager, se noyer. Ni le son (`audio.ts`, Task 12) ni les pièces d'intérieur
 * (`piece`/`setRoom`, la maison de Task 12) ne sont portés — la branche « intérieur » de
 * `canEnter`/`update` n'a pas de sens tant qu'aucune pièce n'existe.
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
  let vy = 0;
  let airborne = false;
  let swimming = false;
  let breath = HERO.swim.breath;
  let coyote = 0;
  let facing = 1;
  let impact = 0;
  let attaque = -1; // temps écoulé dans le coup en cours ; négatif = pas d'attaque

  const maxStep = WORLD.maxStep * WORLD.levelHeight + 1e-3;
  // Depuis l'eau on se hisse sur une rive de plain-pied, jamais sur une falaise.
  const climb = WORLD.levelHeight * HERO.swim.climb;

  /** Surface sous un point : le sol, ou le plan d'eau là où il n'y a pas de sol. */
  const surfaceAt = (x: number, z: number) => query.heightAt(x, z) ?? WORLD.waterLevel;

  /** Centre de l'empreinte de collision, décalé sous le corps du sprite. */
  const empreinte = (z: number) => z - HERO.offset;

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

  function enterWater(): void {
    swimming = true;
    airborne = false;
    vy = 0;
    breath = HERO.swim.breath;
    pos.y = WORLD.waterLevel;
    groundY = WORLD.waterLevel;
    splash(pos.x, WORLD.waterLevel, pos.z);
  }

  function leaveWater(y: number): void {
    swimming = false;
    breath = HERO.swim.breath;
    pos.y = y;
    groundY = y;
    splash(pos.x, WORLD.waterLevel, pos.z);
  }

  function drown(): void {
    splash(pos.x, WORLD.waterLevel, pos.z);
    swimming = false;
    airborne = false;
    vy = 0;
    breath = HERO.swim.breath;
    pos.set(spawn[0], query.heightAt(spawn[0], spawn[1]) ?? 0, spawn[1]);
    groundY = pos.y;
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
    get breath() {
      return breath / HERO.swim.breath;
    },
    takeImpact() {
      const v = impact;
      impact = 0;
      return v;
    },
    update(dt, input) {
      const pas = HERO.speed * (swimming ? HERO.swim.speed : 1) * dt;
      // Un axe à la fois : buter sur un obstacle en diagonale fait glisser le long.
      const nx = pos.x + input.x * pas;
      if (input.x !== 0 && canEnter(nx, pos.z)) pos.x = nx;
      const nz = pos.z + input.z * pas;
      if (input.z !== 0 && canEnter(pos.x, nz)) pos.z = nz;

      const sol = query.heightAt(pos.x, empreinte(pos.z));
      const eau = sol === null;

      if (swimming) {
        if (!eau) {
          leaveWater(sol);
        } else {
          pos.y = WORLD.waterLevel;
          breath -= dt;
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
        }

        if (airborne) {
          vy -= HERO.jump.gravity * dt;
          pos.y += vy * dt;
          if (vy <= 0 && pos.y <= ground) {
            pos.y = ground;
            groundY = ground;
            // Le poids de la réception suit la vitesse de chute — pour la secousse de caméra.
            impact = THREE.MathUtils.clamp(-vy / HERO.jump.speed, 0.35, 1.4);
            vy = 0;
            airborne = false;
          }
        }

        // On touche l'eau : plouf, et on passe en nage.
        if (eau && !airborne) enterWater();
      }

      // --- attaque ------------------------------------------------------------------------------
      // On ne frappe pas en nageant, et un coup va jusqu'au bout : réappuyer pendant qu'il se joue
      // ne le relance pas, sinon la lame repart en arrière à chaque martèlement de la touche.
      if (attaque >= 0) {
        attaque += dt;
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
