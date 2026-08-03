// L'état du héros et les conséquences d'un pas de simulation, en données pures.
//
// Séparé de `hero.ts` (l'adaptateur qui tient les billboards) et de `hero-step.ts` (la règle) :
// c'est le seul des trois qui n'a AUCUNE dépendance, donc le seul que les deux autres peuvent
// importer sans cycle. Il part dans `@lindocara/engine` en Task 11 tel quel.

import type { TerrainMaterial, TerrainQuery } from "./terrain-query.js";
import type { EtatGlace, ThinIce } from "./thin-ice.js";

/** Rectangle où le héros peut marcher en intérieur — plancher plat, ni gravité ni nage ni saut.
 *  DÉPLACÉ depuis `hero.ts:141` : `hero.ts` doit désormais le RÉ-EXPORTER depuis ici, pas en
 *  garder une seconde déclaration — deux `Room` structurellement identiques compileraient sans
 *  broncher et divergeraient au premier champ ajouté. */
export interface Room {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
  obstacles: readonly { x: number; z: number; r: number }[];
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
  /** `true` quand le héros est dans une zone assez froide pour qu'on voie son haleine (Task 8 :
   *  la zone polaire, `main.ts` compare `zone === ZONE_POLAIRE` par identité, comme le reste du
   *  câblage de zone). Ne coupe QUE l'émission de nouvelles bouffées — une bouffée déjà en vol
   *  finit de s'estomper normalement, sinon sortir de la zone en ferait disparaître une en plein
   *  vol. Nommé "haleine" et non "souffle" pour ne pas se confondre avec `souffleTaux` ci-dessus
   *  (Task 7, la réserve d'air en apnée) : même mot français, deux notions sans rapport. */
  haleineVisible: boolean;
}

/**
 * TOUT ce qui doit survivre d'une image à l'autre. Un champ oublié ici devient une variable de
 * fermeture dans `hero.ts`, et la règle cesse d'être pure sans que rien ne le signale — c'est le
 * mode d'échec principal de ce chantier.
 */
export interface HeroState {
  x: number;
  y: number;
  z: number;
  /** Vitesse horizontale persistante (le modèle à friction). */
  vx: number;
  vz: number;
  /** Vitesse verticale : chute et saut. */
  vy: number;
  airborne: boolean;
  swimming: boolean;
  breath: number;
  coyote: number;
  /** Hauteur du dernier sol foulé — la référence de `maxStep`, pas `y`. */
  groundY: number;
  /** Orientation du personnage : -1 ou 1. EXCEPTION DOCUMENTÉE : écrit par l'adaptateur
   *  (`hero.ts`, ligne 658), pas par la règle pure `stepHero`. C'est voulu, pour deux raisons :
   *
   *  1. Il suit l'ENTRÉE utilisateur (`input.x`), pas la vitesse (`state.vx`). Cela évite un
   *     retard de retournement sur glace : la vitesse y persiste longuement après que l'entrée
   *     ait changé, et dériver `facing` de la vitesse rendrait le changement d'orientation trop
   *     lent.
   *
   *  2. `emitHaleine()` (appelée lignes 500 et 637 de `hero.ts`) lit `state.facing` dans la
   *     boucle d'événements juste après le retour de `stepHero`. Dans le code d'origine, cette
   *     lecture voyait toujours le `facing` de l'image PRÉCÉDENTE. L'écrire à l'intérieur de
   *     `stepHero` basculerait cette lecture sur l'image COURANTE, ce qui serait un écart de
   *     comportement : la bouffée d'haleine pointerait dans la nouvelle direction avant même
   *     que le sprite ait été affiché tourné. */
  facing: number;
  room: Room | null;
  /** Distance parcourue depuis le dernier pas — la cadence est à la DISTANCE, pas au temps. */
  distanceDepuisLePas: number;
  /** Compte à rebours du temps avant la prochaine brasse, en nage. Contrairement à
   *  `distanceDepuisLePas` (distance-based), `brasse` DÉCROÎT avec le `dt` chaque image. */
  brasse: number;
  /** Compte à rebours avant la prochaine bouffée d'haleine au repos. */
  reposHaleine: number;
  /** Case de glace fine actuellement chargée sous le poids, ou `null`. */
  glaceCase: string | null;
  /** Dernier état lu sur cette case, pour ne réagir qu'aux TRANSITIONS. */
  glaceEtat: EtatGlace;
  /** Temps écoulé dans le coup en cours ; négatif = pas d'attaque. */
  attaque: number;
  /** Alterne pied gauche / pied droit d'une trace à l'autre. */
  coteTrace: number;
}

/**
 * Ce qu'un pas a PROVOQUÉ. La règle ne joue aucun son et ne crée aucun billboard : elle le
 * raconte, et l'adaptateur exécute. C'est ce qui rend la règle testable sans navigateur — et ce
 * qui permettra au serveur d'ignorer purement et simplement les événements décoratifs.
 */
export type HeroEvent =
  | { t: "pas"; matiere: TerrainMaterial }
  | { t: "brasse" }
  | { t: "saut" }
  | { t: "reception"; force: number }
  | { t: "entree-eau"; x: number; y: number; z: number; rupture: boolean }
  | { t: "sortie-eau"; x: number; y: number; z: number }
  | { t: "noyade"; x: number; y: number; z: number }
  | { t: "glace-craque"; cle: string; x: number; z: number }
  | { t: "glace-rompt"; cle: string; x: number; z: number }
  | { t: "trace"; x: number; z: number; cote: number }
  | { t: "haleine" }
  /** Intensité du dérapage, 0..1 — un son TENU, donc émis à chaque image, pas au déclenchement. */
  | { t: "glisse"; intensite: number };

/**
 * Les réglages que la règle lit. Passés en paramètre plutôt qu'importés de `settings.ts` : c'est
 * ce qui permet à `hero-step.ts` de partir dans `engine` sans emporter les réglages du LABO avec
 * lui. La revue de S1 avait nommé ce couplage comme le point à recâbler au déménagement.
 */
export interface HeroSettings {
  speed: number;
  radius: number;
  /** Décalage de l'empreinte de collision sous le corps du sprite. */
  offset: number;
  friction: { herbe: number; neige: number; glace: number };
  vitesseSol: { herbe: number; neige: number; glace: number };
  jump: { speed: number; gravity: number; coyote: number };
  swim: { speed: number; breath: number; climb: number };
  /** Distance parcourue entre deux pas. */
  pasTousLes: number;
  /** Idem entre deux brasses. */
  brasseTousLes: number;
  /** Intervalle entre deux bouffées d'haleine à l'arrêt, en secondes. */
  haleineRepos: number;
  /** Écart latéral d'une trace par rapport à l'axe de marche. */
  traceEcart: number;
}

export interface WorldSettings {
  size: number;
  levelHeight: number;
  waterLevel: number;
  maxStep: number;
}

/** Ce qu'un collider sait répondre. Une interface plutôt que le type concret : la Task 8 change
 *  l'implémentation (cercles → rectangles) sans que la règle s'en aperçoive. */
export interface ColliderQuery {
  /** `true` si un disque de rayon `r` centré en `(x, z)` chevauche un obstacle. */
  blocked(x: number, z: number, r: number): boolean;
}

export interface StepDeps {
  query: TerrainQuery;
  colliders: ColliderQuery;
  hero: HeroSettings;
  world: WorldSettings;
  /** L'état de la glace fine — mutable et tenu hors de `HeroState` parce qu'il appartient à la
   *  CARTE, pas au héros : deux héros sur la même case partagent la même glace. C'est le type
   *  `ThinIce` existant tel quel, pas une redéclaration : le redéclarer ici le ferait dériver de
   *  son implémentation à la première évolution. */
  glace: ThinIce;
}

/** L'état de départ, au sol, à la position donnée. */
export function createHeroState(
  x: number,
  z: number,
  y: number,
  breath: number,
  reposHaleine: number,
): HeroState {
  return {
    x,
    y,
    z,
    vx: 0,
    vz: 0,
    vy: 0,
    airborne: false,
    swimming: false,
    breath,
    coyote: 0,
    groundY: y,
    facing: 1,
    room: null,
    distanceDepuisLePas: 0,
    brasse: 0,
    reposHaleine,
    glaceCase: null,
    glaceEtat: "intacte",
    attaque: -1,
    coteTrace: 1,
  };
}
