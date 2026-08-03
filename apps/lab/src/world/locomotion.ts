import { HERO } from "../settings.js";
import type { TerrainMaterial } from "./terrain-query.js";

/**
 * Un seul modèle de déplacement, trois frictions.
 *
 * L'ancien modèle posait `vitesse = entrée · HERO.speed` : instantané dans les deux sens, donc
 * incapable de glisser. Plutôt que d'ajouter un cas particulier « glace » à côté, l'entrée
 * ACCÉLÈRE et la matière FREINE — la glace et la neige profonde sortent alors de la même équation,
 * et l'herbe se règle pour rester indiscernable de l'ancien comportement.
 *
 * ⚠ Ces règles remontent dans `@lindocara/engine` en S2 pour devenir autoritatives côté serveur et
 * partagées avec la prédiction réseau. Tout ce qui est ici doit rester PUR et déterministe au bit
 * près : pas de `Math.random`, pas d'horloge, pas de `three`.
 */

/**
 * Un axe, un pas de temps : `vitesse += entrée · accélération · dt`, puis amorti exponentiel.
 *
 * ATTENTION à la formule exacte — la brief de cette task proposait
 * `(v + entree*accel*dt) * Math.exp(-friction*dt)`, mais son propre premier test
 * (« atteint EXACTEMENT HERO.speed en régime établi ») échoue avec CETTE formule quelle que soit la
 * friction choisie : son régime établi vaut `accel*dt*k/(1-k)` (k = exp(-friction·dt)), qui ne
 * converge vers `accel/friction` qu'à la LIMITE `dt → 0` — à dt fixe (1/60 s ici), l'écart minimal
 * atteignable, tous frictions confondues, est ~0.11 unité, alors que `toBeCloseTo(HERO.speed, 3)`
 * exige moins de 0.0005 (vérifié par calcul, voir le rapport de la task). Le commentaire du brief
 * affirmant un régime établi « exactement accel/friction » était donc faux pour cette formule.
 *
 * La formule ci-dessous est l'intégrateur exponentiel EXACT de l'équation différentielle qu'on
 * veut vraiment : `dv/dt = friction · (cible − v)`, où `cible = entrée · accel / friction`. Sa
 * solution analytique est `v(t) = cible + (v₀ − cible) · exp(−friction·t)`, et comme c'est la
 * solution exacte (pas une approximation d'Euler), l'échantillonner à n'importe quel pas `dt` — 2
 * secondes d'un coup ou 120 pas de 1/60 s — donne EXACTEMENT le même résultat, avec un régime établi
 * qui vaut `accel/friction` à l'erreur machine près, quel que soit `dt`. C'est cette propriété qui
 * fait que `HERO.speed` reste la vitesse de référence, quelle que soit la matière, et que le modèle
 * reste indépendant du pas de temps — donc rejouable à l'identique par la prédiction réseau une fois
 * remonté dans `engine`.
 */
export function pasAmorti(
  v: number,
  entree: number,
  accel: number,
  friction: number,
  dt: number,
): number {
  // Friction nulle ou négative (ne devrait pas arriver avec les tables du jeu, mais ce module part
  // dans `engine` où un appelant futur pourrait passer n'importe quoi) : pas de division par zéro,
  // on retombe sur un ajout d'accélération pur, sans amorti.
  if (friction <= 0) return v + entree * accel * dt;
  const cible = (entree * accel) / friction;
  return cible + (v - cible) * Math.exp(-friction * dt);
}

/** `null` = hors carte ou dans l'eau : on y nage, la friction du sol ne s'applique pas, mais la
 *  fonction doit rendre quelque chose de fini plutôt que d'obliger chaque appelant à tester.
 *  `"glace-fine"` partage la friction de `"glace"` — même comportement de glisse tant qu'elle n'a
 *  pas cédé (Task 7 lui donnera son propre visuel de craquelure, pas sa propre physique).
 *  `"sable"` n'a pas encore de règle propre : il retombe sur `"herbe"`. */
export function frictionPour(m: TerrainMaterial | null): number {
  switch (m) {
    case "glace":
    case "glace-fine":
      return HERO.friction.glace;
    case "neige":
      return HERO.friction.neige;
    case "sable":
    case "herbe":
    case null:
      return HERO.friction.herbe;
  }
}

/** Vitesse de pointe (= vitesse d'équilibre, `accel/friction` quand `accel` en dérive) sur cette
 *  matière. C'est le multiplicateur `vitesseSol` qui fait PLAFONNER plus bas dans la neige, en plus
 *  de la friction plus haute qui fait déjà peiner à l'ATTEINDRE. */
export function vitesseMaxPour(m: TerrainMaterial | null): number {
  switch (m) {
    case "glace":
    case "glace-fine":
      return HERO.speed * HERO.vitesseSol.glace;
    case "neige":
      return HERO.speed * HERO.vitesseSol.neige;
    case "sable":
    case "herbe":
    case null:
      return HERO.speed * HERO.vitesseSol.herbe;
  }
}

/**
 * Intensité du dérapage (Task 6, le son de la glisse) : 0 quand la vitesse suit l'entrée, 1
 * quand elles s'opposent — pondérée par la vitesse, pour qu'un résidu de dérive à vitesse
 * quasi nulle (la toute fin d'un arrêt) ne sonne pas à pleine intensité. Entrée nulle mais
 * vitesse non nulle vaut le désaccord MAXIMAL : glisser sur son élan sans direction demandée est
 * exactement l'arrêt sur la glace, pas une absence de dérapage.
 *
 * SANS jamais regarder la matière du sol, par construction — c'est le même calcul qui fait que
 * la glace glisse (l'entrée accélère, la matière freine, voir plus haut) qui fait que cette
 * intensité retombe proche de zéro ailleurs : sur l'herbe/le sable/la neige la vitesse rattrape
 * l'entrée en une ou deux images, bien avant que `setSkid` (`core/audio.ts`) n'ait le temps de le
 * rendre audible. Pure et déterministe comme le reste du module : c'est un effet SONORE, pas une
 * règle de jeu qui remontera dans `engine`, mais autant la garder testable au même titre.
 */
export function derapage(
  vx: number,
  vz: number,
  ix: number,
  iz: number,
  vitesseRef: number,
): number {
  const vitesse = Math.hypot(vx, vz);
  if (vitesse < 1e-3) return 0;
  const entree = Math.hypot(ix, iz);
  const desaccord = entree > 1e-3 ? (1 - (vx * ix + vz * iz) / (vitesse * entree)) / 2 : 1;
  return desaccord * Math.min(1, vitesse / vitesseRef);
}
