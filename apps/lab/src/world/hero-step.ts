// La règle de déplacement du héros — horizontal ET vertical —, pure. Ni `three`, ni audio, ni
// billboard : elle lit un état, le fait avancer d'un pas, et RACONTE ce qui s'est produit (voir
// `HeroEvent`). L'adaptateur (`hero.ts`) joue ces événements — un appel audio qui se glisserait
// ici casserait silencieusement cette pureté, rien dans le typecheck ni les tests ne le verrait.
//
// Elle mute `state` en place : ce pas tourne à 60 Hz et rien ne conserve l'état d'avant, donc une
// copie par image serait une allocation pour rien — même raison que les lots de billboards
// recyclés en rond du labo.
//
// DÉPLACÉE depuis `hero.ts` (l'ancienne section horizontale de `update()`, lignes ~504-538, et
// `canEnter`/`centreOk`, lignes ~359-399, avant Task 2 ; le saut/la gravité/le coyote/la
// réception, lignes ~591-627, avant Task 3 ; l'entrée/la sortie d'eau, la noyade et la cadence des
// brasses, lignes ~432-476 et ~576-602, avant Task 4) : les règles ne changent pas de forme,
// seulement de fichier — voir le rapport de chaque task pour les divergences assumées (la mise à
// jour de `facing`, restée dans `hero.ts` — voir plus bas —, le clamp de l'impact de réception,
// écrit à la main faute de pouvoir importer `three` ici, et le renvoi au point d'apparition après
// noyade, resté dans `hero.ts` — voir la docstring de `drown` plus bas).

import type {
  HeroEvent,
  HeroInput,
  HeroSettings,
  HeroState,
  StepDeps,
  WorldSettings,
} from "./hero-state.js";
import { derapage, frictionPour, pasAmorti, sePropulse, vitesseMaxPour } from "./locomotion.js";
import { compteCommeEau } from "./thin-ice.js";

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

/** Clef de la case de glace fine sous un point monde — même formule que `hero.ts` (sa fonction
 *  interne `caseDe`, elle-même alignée sur `TerrainQuery`, voir `terrain-query.ts:toCell`),
 *  dupliquée à dessein : `hero-step.ts` ne doit importer AUCUN réglage du labo (voir l'en-tête). */
function caseDe(x: number, z: number, world: WorldSettings): string {
  const demiGrille = world.size / 2;
  return `${Math.floor(x + demiGrille)},${Math.floor(z + demiGrille)}`;
}

/**
 * Entre dans l'eau : position au niveau de l'eau, souffle plein, vitesse coupée. La remise à zéro
 * de `vx`/`vz` est LOAD-BEARING (voir l'en-tête du fichier) : sans elle on entre dans l'eau avec
 * l'élan de la glace qu'on vient de quitter.
 *
 * `rupture` distingue le plouf ordinaire (bord, chute) de la glace fine qui cède sous le poids —
 * cette dernière reste hors de `stepHero` (Task 5 : `hero.ts`, `tomber()`) mais réutilise CETTE
 * fonction telle quelle plutôt que de la réimplémenter, comme le faisait déjà l'ancien
 * `enterWater(plunge)` de `hero.ts`. C'est la SEULE raison de l'exporter : l'adaptateur choisit le
 * son (le plouf ordinaire ou le `plunge` de la glace qui cède) à la lecture de `rupture` sur
 * l'événement rendu, jamais `stepHero` lui-même.
 *
 * Le type de retour est le membre PRÉCIS de l'union `HeroEvent`, pas `HeroEvent` en général :
 * `tomber()` (`hero.ts`) lit `x`/`y`/`z` sur la valeur rendue sans re-tester `t`, ce que `HeroEvent`
 * seul n'autoriserait pas (les autres membres de l'union n'ont pas tous ces champs).
 */
export function enterWater(
  state: HeroState,
  deps: StepDeps,
  rupture: boolean,
): Extract<HeroEvent, { t: "entree-eau" }> {
  const { hero, world } = deps;
  state.swimming = true;
  state.airborne = false;
  state.vy = 0;
  state.vx = 0;
  state.vz = 0;
  state.breath = hero.swim.breath;
  state.y = world.waterLevel;
  state.groundY = world.waterLevel;
  return { t: "entree-eau", x: state.x, y: world.waterLevel, z: state.z, rupture };
}

/** Sort de l'eau sur une rive à `y` — jamais une falaise : `canEnter` (plus haut, la contrainte de
 *  `climb`) a déjà exclu cette possibilité en amont, cette fonction ne fait qu'acter la sortie. */
function leaveWater(state: HeroState, deps: StepDeps, y: number): HeroEvent {
  const { hero, world } = deps;
  state.swimming = false;
  state.vx = 0;
  state.vz = 0;
  state.breath = hero.swim.breath;
  state.y = y;
  state.groundY = y;
  return { t: "sortie-eau", x: state.x, y: world.waterLevel, z: state.z };
}

/**
 * Le souffle est épuisé. L'événement porte la position DE LA NOYADE — celle où l'éclaboussure doit
 * apparaître — jamais celle du renvoi au point d'apparition : ce renvoi (téléportation vers
 * `spawn`, hauteur du terrain à cet endroit) reste le travail de l'adaptateur (`hero.ts`), qui SEUL
 * connaît `spawn` — `stepHero` ne le reçoit jamais en paramètre, à dessein (voir l'en-tête).
 */
function drown(state: HeroState, deps: StepDeps): HeroEvent {
  const { hero, world } = deps;
  const x = state.x;
  const z = state.z;
  state.swimming = false;
  state.airborne = false;
  state.vy = 0;
  state.vx = 0;
  state.vz = 0;
  state.breath = hero.swim.breath;
  return { t: "noyade", x, y: world.waterLevel, z };
}

export function stepHero(
  state: HeroState,
  input: HeroInput,
  dt: number,
  deps: StepDeps,
): HeroEvent[] {
  const events: HeroEvent[] = [];
  const { query, hero, world } = deps;

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

  // --- verticale : plancher de pièce, sol, saut, gravité, coyote, réception (Task 3) -----------
  // Transposée telle quelle de `hero.ts:591-627` (avant cette task) — plus le plancher de pièce et
  // le calcul de `sol` qui la précédaient (lignes ~566-574) : ce dernier n'était pas dans la plage
  // citée par le brief, mais `sol` doit être lu APRÈS la résolution horizontale ci-dessus (la
  // case sous les pieds a pu changer ce pas-ci — sinon sauter pile au bord d'une falaise
  // détecterait le vide une image en retard), donc la règle doit le recalculer elle-même plutôt
  // que le recevoir en paramètre. `hero.ts` recalcule `sol`/`eau` une seconde fois, pour ce qui y
  // reste en fermeture sur l'audio et les billboards (nage, glace fine, entrée dans l'eau) — un
  // second appel pur, pas une résolution rejouée.
  if (state.room) {
    // Plancher plat : ni gravité, ni nage, ni saut. On garde les pas.
    state.y = state.room.y;
    state.airborne = false;
    state.swimming = false;
    state.vy = 0;
  }
  const sol = state.room ? state.room.y : query.heightAt(state.x, empreinteZ(state.z));

  if (!state.swimming) {
    const ground = sol ?? world.waterLevel;
    if (state.airborne) {
      state.coyote -= dt;
    } else if (ground < state.y - 1e-3) {
      state.airborne = true; // le sol s'est dérobé : on tombe, on ne glisse pas
      state.vy = 0;
    } else {
      state.y = ground;
      state.groundY = ground;
      state.coyote = hero.jump.coyote;
    }

    // Pas de saut depuis l'eau, et coyote time : on pardonne quelques frames après avoir quitté
    // le bord.
    if (input.jump && state.coyote > 0) {
      state.vy = hero.jump.speed;
      state.airborne = true;
      state.coyote = 0;
      events.push({ t: "saut" });
    }

    if (state.airborne) {
      state.vy -= hero.jump.gravity * dt;
      state.y += state.vy * dt;
      if (state.vy <= 0 && state.y <= ground) {
        state.y = ground;
        state.groundY = ground;
        // Le poids de la réception suit la vitesse de chute — pour le son comme pour la secousse
        // de caméra. `Math.min(Math.max(...))` plutôt que `THREE.MathUtils.clamp` : cette règle
        // n'importe pas `three` (voir l'en-tête du fichier).
        const impact = Math.min(1.4, Math.max(0.35, -state.vy / hero.jump.speed));
        events.push({ t: "reception", force: impact });
        state.vy = 0;
        state.airborne = false;
        state.distanceDepuisLePas = 0;
      }
    }

    // --- entrée dans l'eau ordinaire (Task 4) -----------------------------------------------
    // Bord ou chute — hors glace fine, restée dans `hero.ts` (`tomber()`, Task 5) : cette dernière
    // réutilise `enterWater` telle quelle, avec `rupture: true`, plutôt que de la réimplémenter.
    // Évaluée ICI, à la fin de la résolution verticale : `state.swimming` est donc déjà à jour pour
    // la cadence des pas/brasses juste en dessous, sur CETTE MÊME image — c'est la moitié « eau
    // ordinaire » de la dette de cadence que cette task ferme (voir son rapport ; la moitié
    // « rupture de glace fine », elle, reste ouverte : `tomber()` s'exécute encore après le retour
    // de `stepHero`, dans `hero.ts`).
    const eau = !state.room && sol === null;
    if (eau && !state.airborne) events.push(enterWater(state, deps, false));
  } else {
    // --- résolution de nage (Task 4) ----------------------------------------------------------
    // Transposée telle quelle depuis `hero.ts` : sortie sur une rive, ou noyade progressive.
    // `dansUnTrou` reproduit le garde `compteCommeEau` déjà présent dans le code d'origine (voir sa
    // docstring, `thin-ice.ts`) — SANS lui, une case de glace fine rompue posée sur un terrain de
    // hauteur NON NULLE ferait ressortir le héros de l'eau une image après y être tombé : `sol` y
    // reste un nombre réel, `kindAt` changeant la matière d'une case, jamais sa hauteur. C'est le
    // piège que l'île de neige a découvert en jouant — couvert par `hero-step-nage.test.ts`.
    const dansUnTrou = compteCommeEau(deps.glace.etat(caseDe(state.x, empreinteZ(state.z), world)));
    if (sol !== null && !dansUnTrou) {
      events.push(leaveWater(state, deps, sol));
    } else {
      state.y = world.waterLevel;
      // Le taux vient de la zone (voir `HeroInput.souffleTaux`) : le héros n'a plus à savoir QUELLE
      // eau consomme plus vite, seulement lire ce qu'on lui donne.
      state.breath -= dt * input.souffleTaux;
      if (state.breath <= 0) events.push(drown(state, deps));
    }
  }

  // La cadence des pas/brasses est à la DISTANCE parcourue — les pas ne comptent que si l'on se
  // propulse réellement (glisser fait avancer sans qu'aucun pied ne quitte le sol), les brasses à
  // chaque avance en nage. Évaluée ICI, après la résolution verticale ET de nage ci-dessus :
  // `airborne`/`swimming` sont donc à jour pour l'image COURANTE, pas celle d'avant — ce qui ferme
  // l'écart de parité borné laissé par la Task 2 (voir son rapport) aux images d'atterrissage et de
  // transition d'eau ordinaire, l'ancien code évaluant la condition équivalente après cette même
  // résolution sol/eau. `facing` (l'orientation du sprite) N'EST PAS mise à jour ici, à dessein :
  // `hero.ts` la pilote depuis `input.x` telle quelle, pas depuis `state.vx` — voir le rapport de
  // la Task 2 pour la divergence avec le brief (piloter depuis `vx` retarderait le flip sur la
  // glace, où la vitesse met du temps à changer de signe après un demi-tour, ce que le jeu d'avant
  // cette task ne faisait jamais).
  const avance = Math.hypot(state.x - avantX, state.z - avantZ);
  if (state.swimming) {
    state.brasse -= dt;
    if (avance > 1e-4 && state.brasse <= 0) {
      events.push({ t: "brasse" });
      state.brasse = hero.brasseTousLes;
    }
  } else if (!state.airborne && propulsion) {
    state.distanceDepuisLePas += avance;
    if (state.distanceDepuisLePas >= hero.pasTousLes) {
      state.distanceDepuisLePas = 0;
      events.push({ t: "pas", matiere: query.kindAt(state.x, empreinteZ(state.z)) ?? "herbe" });
    }
  }

  return events;
}
