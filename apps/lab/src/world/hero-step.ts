// La règle de déplacement horizontal du héros, pure. Ni `three`, ni audio, ni billboard : elle
// lit un état, le fait avancer d'un pas, et RACONTE ce qui s'est produit (voir `HeroEvent`).
// L'adaptateur (`hero.ts`) joue ces événements — un appel audio qui se glisserait ici casserait
// silencieusement cette pureté, rien dans le typecheck ni les tests ne le verrait.
//
// Elle mute `state` en place : ce pas tourne à 60 Hz et rien ne conserve l'état d'avant, donc une
// copie par image serait une allocation pour rien — même raison que les lots de billboards
// recyclés en rond du labo.
//
// DÉPLACÉE depuis `hero.ts` (l'ancienne section horizontale de `update()`, lignes ~504-538) et
// `canEnter`/`centreOk` (lignes ~359-399 de ce même fichier avant cette task) : les règles ne
// changent pas de forme, seulement de fichier — voir le rapport de la task pour la seule
// divergence assumée (la mise à jour de `facing`, restée dans `hero.ts` — voir plus bas).

import type { HeroEvent, HeroInput, HeroSettings, HeroState, StepDeps } from "./hero-state.js";
import { derapage, frictionPour, pasAmorti, sePropulse, vitesseMaxPour } from "./locomotion.js";

/** Centre de l'empreinte de collision, décalé sous le corps du sprite — même formule que
 *  `hero.ts`, dupliquée à dessein : `hero-step.ts` ne doit importer AUCUN réglage du labo, y
 *  compris via un module partagé qui l'emporterait avec lui au déménagement vers `engine`. */
function empreinte(z: number, hero: HeroSettings): number {
  return z - hero.offset;
}

/**
 * Peut-on poser le pied à `(x, z)` — transposée telle quelle de `hero.ts:365-399` (`canEnter` et
 * son `centreOk` imbriqué), qui lisaient `pos`/`piece`/`airborne`/`swimming`/`groundY` en
 * fermeture ; ici ce sont les champs de `state` et les réglages de `deps`. Appelée un axe à la
 * fois par `stepHero` : c'est ce qui fait glisser le long d'un mur pris en diagonale plutôt que
 * s'y coller net (voir son test dans `hero-step-horizontal.test.ts`).
 */
function canEnter(state: HeroState, x: number, z: number, deps: StepDeps): boolean {
  const { query, colliders, hero, world } = deps;
  const climb = world.levelHeight * hero.swim.climb;
  const maxStep = world.maxStep * world.levelHeight + 1e-3;
  const surfaceAt = (xx: number, zz: number) => query.heightAt(xx, zz) ?? world.waterLevel;

  // En intérieur, le relief et les props ne s'appliquent plus : la pièce est un simple rectangle,
  // posée hors de la grille de terrain.
  if (state.room) {
    const p = state.room;
    if (!(x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1)) return false;
    // Les meubles s'évitent, avec la même échappatoire qu'au dehors : si on en chevauche déjà un,
    // on doit pouvoir en sortir.
    const dans = (px: number, pz: number) =>
      p.obstacles.some((o) => (o.x - px) ** 2 + (o.z - pz) ** 2 < (o.r + hero.radius) ** 2);
    return !dans(x, z) || dans(state.x, state.z);
  }

  // Le sol sous le CENTRE décide où l'on peut poser le pied. Règle dure : elle n'est jamais
  // assouplie, sinon on gravirait une falaise en la poussant.
  const centreOk = (xx: number, zz: number): boolean => {
    const h = surfaceAt(xx, empreinte(zz, hero));
    if (state.swimming) return h - world.waterLevel <= climb;
    return state.airborne ? h <= state.y + 0.02 : h - state.groundY <= maxStep;
  };
  if (!centreOk(x, z)) return false;

  // Le relief est testé sur le disque du héros, pas sur son centre : sinon il enfonce la moitié
  // de son corps dans la paroi avant d'être arrêté.
  const h = query.maxHeightAround(x, empreinte(z, hero), hero.radius);
  const plafond = state.swimming
    ? world.waterLevel + climb
    : state.airborne
      ? state.y + 0.02
      : state.groundY + maxStep;
  if (h > plafond) {
    // On chevauche déjà quelque chose de trop haut — c'est le cas juste après avoir chuté au pied
    // d'une falaise, le disque mordant encore la case du dessus. Sans cette échappatoire, plus
    // AUCUN déplacement n'est autorisé, même pour s'en éloigner, et le héros reste cimenté sur
    // place.
    const ici = query.maxHeightAround(state.x, empreinte(state.z, hero), hero.radius);
    if (!(ici > plafond && h <= ici)) return false;
  }

  if (!colliders.blocked(x, empreinte(z, hero), hero.radius)) return true;
  // Même échappatoire face aux props (spawn malheureux, prop ajouté dessous).
  return colliders.blocked(state.x, empreinte(state.z, hero), hero.radius);
}

export function stepHero(
  state: HeroState,
  input: HeroInput,
  dt: number,
  deps: StepDeps,
): HeroEvent[] {
  const events: HeroEvent[] = [];
  const { query, hero } = deps;

  const empreinteZ = (z: number) => empreinte(z, hero);
  const avantX = state.x;
  const avantZ = state.z;

  // La matière SOUS LES PIEDS, avant de bouger, choisit la friction et le plafond de vitesse. En
  // nage ou en pièce, la matière réelle du fond marin / des coordonnées virtuelles n'a aucun sens
  // physique : on retombe sur `null` (= herbe).
  const matiere = state.swimming || state.room ? null : query.kindAt(state.x, empreinteZ(state.z));
  const friction = frictionPour(matiere, hero);
  const vmax = state.swimming ? hero.speed * hero.swim.speed : vitesseMaxPour(matiere, hero);
  const accel = vmax * friction;

  state.vx = pasAmorti(state.vx, input.x, accel, friction, dt);
  state.vz = pasAmorti(state.vz, input.z, accel, friction, dt);

  // Glisse (son tenu) : `derapage` ne regarde jamais la matière — coupée ici seulement en l'air et
  // à la nage, où le dérapage au sol n'a pas de sens. Émise à CHAQUE image, jamais seulement au
  // déclenchement : c'est un son tenu, pas un déclic.
  events.push({
    t: "glisse",
    intensite:
      state.airborne || state.swimming
        ? 0
        : derapage(state.vx, state.vz, input.x, input.z, hero.speed),
  });
  // Même signal, seuillé en booléen : ne compter un pas que si le héros se propulse réellement,
  // pas s'il est porté par son élan (glace) — voir la cadence des pas plus bas.
  const propulsion = sePropulse(state.vx, state.vz, input.x, input.z);

  // Un axe à la fois : buter sur un obstacle en diagonale fait glisser le long. Sur l'axe refusé
  // la vitesse retombe à zéro, sinon on reste collé au mur à pleine vitesse et on repart d'un coup
  // en s'en écartant.
  const nx = state.x + state.vx * dt;
  if (canEnter(state, nx, state.z, deps)) state.x = nx;
  else state.vx = 0;
  const nz = state.z + state.vz * dt;
  if (canEnter(state, state.x, nz, deps)) state.z = nz;
  else state.vz = 0;

  // La cadence des pas est à la DISTANCE parcourue, et ne compte que si l'on se propulse
  // réellement — glisser fait avancer sans qu'aucun pied ne quitte le sol. `facing` (l'orientation
  // du sprite) N'EST PAS mise à jour ici, à dessein : `hero.ts` la pilote depuis `input.x` telle
  // quelle, pas depuis `state.vx` — voir le rapport de la task pour la divergence avec le brief
  // (piloter depuis `vx` retarderait le flip sur la glace, où la vitesse met du temps à changer de
  // signe après un demi-tour, ce que le jeu d'avant cette task ne faisait jamais).
  if (!state.airborne && !state.swimming && propulsion) {
    state.distanceDepuisLePas += Math.hypot(state.x - avantX, state.z - avantZ);
    if (state.distanceDepuisLePas >= hero.pasTousLes) {
      state.distanceDepuisLePas = 0;
      events.push({ t: "pas", matiere: query.kindAt(state.x, empreinteZ(state.z)) ?? "herbe" });
    }
  }

  return events;
}
