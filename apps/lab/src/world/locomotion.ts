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
 *  `"glace-fine"` partage la friction de `"glace"` — même comportement tant qu'elle n'a pas cédé
 *  (Task 7 lui donnera son propre visuel de craquelure, pas sa propre physique).
 *  `"sable"` n'a pas encore de règle propre : il retombe sur `"herbe"`.
 *
 *  ⚠ Depuis Task 7b, `HERO.friction.glace` NE PILOTE PLUS le cas nominal sur la glace : la glisse
 *  y est désormais VERROUILLÉE (`glissementSuivant`, plus bas), à vitesse constante, pas amortie
 *  par une friction. Cette valeur ne reste appelée que dans les marges où la glace n'est PAS
 *  verrouillée : le tout premier pas où le pied vient de toucher la glace mais où la règle ne
 *  verrouille pas encore (un pas d'avance, voir `glissementSuivant`), et le cas d'une case de
 *  glace isolée qu'on quitte sans qu'aucune case glissante ne suive (là non plus rien ne
 *  verrouille). Garder cette valeur BASSE reste correct dans ces deux marges — on continue d'y
 *  glisser un peu plutôt que de piler — mais elle n'est plus LA règle de la glace, seulement son
 *  filet de sécurité. */
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

// --- la glisse verrouillée (Task 7b, la règle de Pokémon Argent) -------------------------------
//
// La Task 3 avait donné à la glace une friction quasi nulle : on gardait son élan, on dérapait en
// tournant, mais on pouvait encore diriger — du patinage. L'auteur en voulait autre chose (voir le
// spec, section « La glace : glisse verrouillée, pas friction basse ») : entrer sur la glace
// VERROUILLE la direction, l'entrée est ignorée, et on file en ligne droite jusqu'à ce que la case
// suivante ne soit plus glissante. Ce n'est plus un réglage de friction, c'est un ÉTAT de
// déplacement contraint — la condition d'existence des énigmes de glace, l'objectif réel de cette
// matière (voir le spec pour le POURQUOI).
//
// L'ancien `derapage()` (Task 6, le son de la glisse) a disparu avec elle : il mesurait le
// désaccord entre la vitesse et l'entrée pendant un virage qui dérape, un état qui n'existe plus —
// soit on n'est pas verrouillé et la vitesse suit l'entrée normalement, soit on l'est et l'entrée
// n'est même plus lue. Il n'y a plus rien entre les deux à mesurer.

/** L'état de glisse verrouillée : la direction (unitaire) dans laquelle on file, ou `null` quand
 *  on n'est pas en train de glisser. Portée par le héros (`hero.ts`) d'une image à l'autre — cette
 *  fonction ne fait que dire, à chaque image, ce que devient l'état d'AVANT. */
export type Glissement = { readonly dirX: number; readonly dirZ: number } | null;

/** `true` pour les deux matières qui verrouillent la direction — la glace fine glisse EXACTEMENT
 *  comme la glace pour cette règle (elle partage déjà sa friction et son son, voir plus haut et
 *  `core/audio.ts`) : c'est justement ce qui la rend plus sûre sous cette règle (Task 7b) — on ne
 *  s'y attarde plus jamais, on la traverse en glissant. */
function estGlissante(m: TerrainMaterial | null): boolean {
  return m === "glace" || m === "glace-fine";
}

/**
 * La règle ENTIÈRE de la glisse verrouillée, pure et déterministe (elle remonte dans `engine` en
 * S2, autoritative côté serveur) : ni terrain, ni colliders, ni héros — seulement des matières et
 * une entrée, fournis par l'appelant (`hero.ts`) qui seul sait ce qu'il y a sous les pieds et
 * devant. `matiereSousLesPieds` est la matière de la case où l'on se trouve MAINTENANT, avant le
 * pas de cette image (le même instant que `frictionPour`/`vitesseMaxPour` interrogent, voir plus
 * haut) ; `matiereDevant` est celle de la case que le pas de cette image atteindrait, dans la
 * direction candidate (celle du verrou si on glisse déjà, sinon celle de `entree`).
 *
 * Deux branches :
 * - **Verrouillé** (`actuel` non nul) : `entree` n'est même pas lue — c'est elle qui EST la règle
 *   de Pokémon. On continue tant que la case suivante glisse encore ; sinon le verrou tombe, sans
 *   qu'aucun mouvement supplémentaire n'ait à se produire pour ça (c'est `hero.ts` qui garantit
 *   qu'aucun pas ne suit ce `null` — voir sa docstring, le rapport de la task pour le détail).
 * - **Pas verrouillé** : il faut ÊTRE sur la glace maintenant (`matiereSousLesPieds`) — regarder
 *   seulement la case devant verrouillerait un pas trop tôt, avant même d'avoir posé le pied
 *   dessus. Il faut AUSSI que la case devant glisse encore — sinon on verrouillerait la sortie
 *   d'une case de glace isolée, ce qui enverrait un pas à vitesse de glace vers la matière censée
 *   arrêter la glisse : exactement le débordement que « on s'arrête sur la dernière case de
 *   glace » (le spec) interdit. Les deux conditions sont nécessaires, aucune ne suffit seule.
 *
 * Enfin, sans direction, rien ne se verrouille (`entree` nulle) : poussé à l'arrêt sur la glace,
 * ou tombé dessus sans élan, partir dans une direction arbitraire serait pire qu'attendre l'entrée
 * du joueur.
 */
export function glissementSuivant(
  actuel: Glissement,
  entree: { x: number; z: number },
  matiereSousLesPieds: TerrainMaterial | null,
  matiereDevant: TerrainMaterial | null,
): Glissement {
  if (actuel) {
    return estGlissante(matiereDevant) ? actuel : null;
  }
  if (!estGlissante(matiereSousLesPieds) || !estGlissante(matiereDevant)) return null;
  const norme = Math.hypot(entree.x, entree.z);
  if (norme < 1e-6) return null;
  return { dirX: entree.x / norme, dirZ: entree.z / norme };
}
