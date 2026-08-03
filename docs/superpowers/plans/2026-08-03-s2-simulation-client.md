# S2 — la simulation rendue au client : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sortir les règles de déplacement du héros de leurs 824 lignes entrelacées de rendu, les couvrir de tests, puis faire de la carte une donnée que le serveur et l'éditeur pourront lire.

**Architecture:** Un pas de simulation pur `stepHero(state, input, dt, deps)` qui rend un nouvel état **et une liste d'événements** — le son, les éclaboussures et les traces cessent d'être appelés depuis la règle et deviennent des conséquences que l'adaptateur joue. Puis un format de carte sérialisable en unités-tuile, dont les colliders sont des rectangles. Le labo doit tourner à l'identique après chaque task.

**Tech Stack:** TypeScript strict, Vitest (projet `lab`, environnement node), Biome. `apps/lab` ne dépend que de `@lindocara/hd2d` et `three` ; `@lindocara/engine` ne dépend de rien.

## Global Constraints

- **Le labo doit tourner à l'identique après CHAQUE task**, et ça se vérifie **en jouant**, pas seulement en testant. Les deux vrais bugs de l'île de neige (l'entrée dans l'eau annulée une image plus tard, la case déjà rompue qui ne déclenchait rien) ont été trouvés manette en main et étaient invisibles à la lecture.
- **Commentaires en FRANÇAIS** dans `apps/lab`. Ils disent POURQUOI.
- **`@lindocara/engine` est pur** : ni DOM, ni `three`, ni horloge, ni `Math.random`. Son tsconfig ne lui donne ni `DOM` ni les types Workers — une fuite de plateforme casse le typecheck, c'est voulu.
- **Ne toucher ni `renderer`, ni `client`, ni `editor`, ni `server`, ni `apps/main`.** Le jeu continue de tourner sur PixiJS pendant tout le chantier.
- **Ne pas toucher au protocole.** La règle « le client décide de sa position » est fixée par le spec ; son câblage appartient à S3.
- **`packages/hd2d` ne doit rien apprendre du gameplay.** Ce chantier ne devrait pas avoir à le toucher ; si tu crois devoir le faire, dis-le et justifie-le avant.
- Vérification : `npx vitest run --project lab && npm run typecheck:lab && npm run lint`. À partir de la Task 9, ajouter `--project engine` et `npm run typecheck:engine`.
- Le harnais de charge du labo (`?bench=game`) reste le juge de la performance. **Réarmer sur place** avec `labBench.armer()` avant toute mesure hors du spawn — une mesure sans réarmement porte sur une scène cullée et ment ; c'est arrivé trois fois.

---

## Structure des fichiers

| Fichier | Responsabilité | Task |
| --- | --- | --- |
| `apps/lab/src/world/hero-state.ts` | **Créé.** Les types purs : `HeroState`, `HeroEvent`, `StepDeps`, `HeroSettings`. Aucune logique. | 1 |
| `apps/lab/src/world/hero-step.ts` | **Créé.** `stepHero()` — la règle pure, sans `three`, sans audio. Grossit task après task. | 2-7 |
| `apps/lab/src/world/hero.ts` | **Modifié.** Devient un adaptateur : il tient les billboards, appelle `stepHero`, et joue les événements rendus. Passe de 824 lignes à ~450. | 2-7 |
| `apps/lab/src/world/collider-index.ts` | **Créé.** Colliders rectangulaires en unités-tuile, requête disque-contre-rectangle. Remplace `colliders.ts`. | 8 |
| `apps/lab/src/world/map-data.ts` | **Créé.** Le format de carte sérialisable et son codec. | 9 |
| `apps/lab/src/world/island.ts` | **Modifié.** Cesse d'être lu à l'exécution ; devient un producteur de `MapData`. | 10 |
| `apps/lab/scripts/build-map.ts` | **Créé.** Sérialise l'île générée en carte, une fois, hors exécution. | 10 |
| `packages/engine/src/hd2d/` | **Créé.** Le foyer des règles remontées : `terrain-query.ts`, `collider-index.ts`, `locomotion.ts`, `thin-ice.ts`, `hero-step.ts`, `map-data.ts`. | 11-12 |

**Pourquoi un sous-dossier `hd2d/` dans `engine` :** ces fichiers sont en **unités-tuile** et coexistent avec le monde en **pixels** (`simulation.ts`, `collider.ts`) jusqu'à ce que S3 retire ce dernier. Les mélanger dans le même dossier plat inviterait à importer un pixel dans un calcul en unités-tuile. Le dossier est la frontière visible du sursis.

---

### Task 1: Les types purs, sans une ligne de logique

**Files:**
- Create: `apps/lab/src/world/hero-state.ts`
- Test: `apps/lab/test/hero-state.test.ts`

**Interfaces:**
- Consumes: `TerrainMaterial`, `TerrainQuery` (`world/terrain-query.ts`), `EtatGlace` et `ThinIce` (`world/thin-ice.ts`). `Room` **déménage** de `hero.ts:141` vers ce fichier, qui devient sa seule déclaration.
- Produces: `HeroState`, `HeroEvent`, `HeroSettings`, `StepDeps`, `createHeroState()`. Toutes les tasks suivantes en dépendent.

Cette task ne déplace aucune règle. Elle pose le vocabulaire, et **c'est le vocabulaire qui décide si l'extraction sera possible** : si un champ manque, la task 2 se retrouvera à lire une variable de fermeture de `hero.ts` et l'extraction échouera en silence.

- [ ] **Step 1: Écrire le fichier de types**

Créer `apps/lab/src/world/hero-state.ts` :

```ts
// L'état du héros et les conséquences d'un pas de simulation, en données pures.
//
// Séparé de `hero.ts` (l'adaptateur qui tient les billboards) et de `hero-step.ts` (la règle) :
// c'est le seul des trois qui n'a AUCUNE dépendance, donc le seul que les deux autres peuvent
// importer sans cycle. Il part dans `@lindocara/engine` en Task 11 tel quel.

import type { EtatGlace, ThinIce } from "./thin-ice.js";
import type { TerrainMaterial, TerrainQuery } from "./terrain-query.js";

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

/** DÉPLACÉ depuis `hero.ts:121`, comme `Room` et pour la même raison : `hero.ts` le RÉ-EXPORTE
 *  depuis ici et n'en garde pas une seconde déclaration. Reprendre au passage les commentaires
 *  d'origine sur `souffleTaux` et `haleineVisible` — ils portent le POURQUOI. */
export interface HeroInput {
  x: number;
  z: number;
  jump: boolean;
  attack: boolean;
  /** Multiplicateur de consommation du souffle en nage, fourni par la zone à chaque image. */
  souffleTaux: number;
  /** `true` quand la zone est assez froide pour qu'on voie l'haleine. */
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
  /** -1 ou 1. Décidé par le déplacement, stable à l'arrêt. */
  facing: number;
  room: Room | null;
  /** Distance parcourue depuis le dernier pas — la cadence est à la DISTANCE, pas au temps. */
  distanceDepuisLePas: number;
  /** La brasse, elle, est un compte à rebours au TEMPS (`brasse -= dt`), pas à la distance —
   *  on nage à vitesse à peu près constante, et compter la distance y ferait accélérer la
   *  cadence des bras avec le courant. Ne pas la traiter comme `distanceDepuisLePas`. */
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

/** L'état de départ, au sol, à la position donnée. `reposHaleine` part à son intervalle PLEIN,
 *  pas à zéro : à zéro, le héros soufflerait dès l'apparition au lieu d'attendre l'intervalle
 *  authoré — un changement de comportement qu'aucun typecheck ni aucun test n'attraperait. */
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
```

- [ ] **Step 2: Écrire le test qui prouve que l'état est complet**

Créer `apps/lab/test/hero-state.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { createHeroState } from "../src/world/hero-state.js";

describe("createHeroState", () => {
  it("part immobile, au sol, avec son souffle plein", () => {
    const s = createHeroState(3, -4, 1.8, 12, 2.2);
    // Assertion sur CHAQUE champ, pas sur une poignée : c'est ce test qui garde `HeroState`
    // complet, et un champ non assené est un champ dont la valeur de départ peut dériver de
    // celle de `hero.ts` sans que rien ne le signale.
    expect(s.reposHaleine).toBe(2.2);
    expect(s.facing).toBe(1);
    expect(s.room).toBeNull();
    expect(s.glaceCase).toBeNull();
    expect(s.glaceEtat).toBe("intacte");
    expect(s.attaque).toBe(-1);
    expect(s.coteTrace).toBe(1);
    expect(s.distanceDepuisLePas).toBe(0);
    expect(s.brasse).toBe(0);
    expect(s.coyote).toBe(0);
    expect([s.x, s.y, s.z]).toEqual([3, 1.8, -4]);
    expect([s.vx, s.vz, s.vy]).toEqual([0, 0, 0]);
    expect(s.airborne).toBe(false);
    expect(s.swimming).toBe(false);
    expect(s.breath).toBe(12);
    // `groundY` DOIT valoir `y` au départ : c'est la référence de `maxStep`, et la laisser à 0
    // ferait croire au premier pas qu'on descend d'une falaise dès qu'on démarre en hauteur.
    expect(s.groundY).toBe(1.8);
  });

  it("ne partage aucune structure entre deux états", () => {
    // Un `createHeroState` qui rendrait un objet figé partagé ferait diverger deux héros en
    // silence. Bon marché à vérifier, très cher à découvrir plus tard.
    const a = createHeroState(0, 0, 0, 10, 2.2);
    const b = createHeroState(0, 0, 0, 10, 2.2);
    a.vx = 5;
    expect(b.vx).toBe(0);
  });
});
```

- [ ] **Step 3: Lancer le test**

Run: `npx vitest run --project lab test/hero-state.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 4: Vérifier que rien n'a bougé**

Run: `npx vitest run --project lab && npm run typecheck:lab && npm run lint`
Expected: tout vert. Aucun fichier existant n'a été modifié à ce stade.

- [ ] **Step 5: Commit**

```bash
git add apps/lab/src/world/hero-state.ts apps/lab/test/hero-state.test.ts
git commit -m "feat(lab): les types purs de l'état du héros et de ses événements"
```

---

### Task 2: Le déplacement horizontal, extrait et couvert

**Files:**
- Create: `apps/lab/src/world/hero-step.ts`
- Modify: `apps/lab/src/world/hero.ts` (la section `update` autour des lignes 527-564)
- Test: `apps/lab/test/hero-step-horizontal.test.ts`

**Interfaces:**
- Consumes: tout de `hero-state.ts` (Task 1).
- Produces: `stepHero(state, input, dt, deps): HeroEvent[]` — **mute `state` en place** et rend les événements. Les tasks 3 à 7 étendent cette même fonction.

**Pourquoi muter plutôt que rendre un nouvel état :** le pas tourne à 60 Hz et l'immutabilité y coûterait une allocation d'objet par image, pour un gain nul — rien ici ne conserve l'état précédent. C'est la même raison pour laquelle les lots de particules du labo sont recyclés en rond.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/lab/test/hero-step-horizontal.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { createHeroState } from "../src/world/hero-state.js";
import { stepHero } from "../src/world/hero-step.js";
import { depsPlates } from "./helpers/step-deps.js";

describe("stepHero — déplacement horizontal", () => {
  it("accélère vers la vitesse de la matière et s'y stabilise", () => {
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    for (let i = 0; i < 300; i++) {
      stepHero(s, { x: 1, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false }, 1 / 60, deps);
    }
    // Régime établi = `accel / friction` = la vitesse de la matière, à l'erreur machine près.
    expect(s.vx).toBeCloseTo(deps.hero.speed, 3);
    expect(s.vz).toBeCloseTo(0, 6);
  });

  it("annule la vitesse sur l'axe refusé, pas sur l'autre", () => {
    // Un mur en x : on doit continuer de glisser le long, en z. C'est ce que le test axe par axe
    // achète, et c'est exactement ce que la Task 8 ne doit pas casser en passant aux rectangles.
    const deps = depsPlates({ bloque: (x) => x > 1 });
    const s = createHeroState(0, 0, 0, 10, 2.2);
    s.vx = 5;
    s.vz = 5;
    s.x = 1;
    stepHero(s, { x: 1, z: 1, jump: false, attack: false, souffleTaux: 1, haleineVisible: false }, 1 / 60, deps);
    expect(s.vx).toBe(0);
    expect(s.x).toBe(1);
    expect(s.vz).toBeGreaterThan(0);
    expect(s.z).toBeGreaterThan(0);
  });

  it("émet un pas quand on se propulse, jamais quand on glisse", () => {
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    // Lancé sans aucune entrée : c'est une glisse, pas une marche.
    s.vx = deps.hero.speed;
    let pas = 0;
    for (let i = 0; i < 120; i++) {
      const evts = stepHero(s, { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false }, 1 / 60, deps);
      pas += evts.filter((e) => e.t === "pas").length;
    }
    expect(pas).toBe(0);
  });
});
```

- [ ] **Step 2: Écrire l'aide de test**

Créer `apps/lab/test/helpers/step-deps.ts`. Un terrain plat et sans obstacle, dont chaque morceau
est surchargeable — les tasks suivantes s'en servent aussi.

```ts
import type { ColliderQuery, StepDeps } from "../../src/world/hero-state.js";
import type { TerrainMaterial, TerrainQuery } from "../../src/world/terrain-query.js";

interface Options {
  /** `true` là où un obstacle bloque. Par défaut : nulle part. */
  bloque?: (x: number, z: number) => boolean;
  /** Hauteur du sol, ou `null` pour de l'eau. Par défaut : plat à 0. */
  hauteur?: (x: number, z: number) => number | null;
  matiere?: (x: number, z: number) => TerrainMaterial | null;
}

export function depsPlates(o: Options = {}): StepDeps {
  const hauteur = o.hauteur ?? (() => 0);
  const matiere = o.matiere ?? (() => "herbe" as TerrainMaterial);
  const query: TerrainQuery = {
    heightAt: (x, z) => hauteur(x, z),
    maxHeightAround: (x, z) => hauteur(x, z) ?? 0,
    levelAt: (x, z) => (hauteur(x, z) === null ? null : 0),
    kindAt: (x, z) => matiere(x, z),
    cellCenter: (i, j) => [i + 0.5, j + 0.5],
  };
  const colliders: ColliderQuery = { blocked: (x, z) => o.bloque?.(x, z) ?? false };
  return {
    query,
    colliders,
    hero: {
      speed: 4.2,
      radius: 0.3,
      offset: 0.35,
      friction: { herbe: 80, neige: 130, glace: 0.35 },
      vitesseSol: { herbe: 1, neige: 0.55, glace: 1 },
      jump: { speed: 6, gravity: 18, coyote: 0.12 },
      swim: { speed: 0.6, breath: 12, climb: 1.2 },
      pasTousLes: 1.2,
      brasseTousLes: 1.6,
      haleineRepos: 2.2,
      traceEcart: 0.12,
    },
    world: { size: 72, levelHeight: 0.9, waterLevel: 0, maxStep: 1 },
    glace: { charge: () => {}, relache: () => {}, etat: () => "intacte" },
  };
}
```

- [ ] **Step 3: Lancer le test pour le voir échouer**

Run: `npx vitest run --project lab test/hero-step-horizontal.test.ts`
Expected: FAIL — `hero-step.ts` n'existe pas.

- [ ] **Step 4: Écrire `stepHero`, horizontal seulement**

Créer `apps/lab/src/world/hero-step.ts`. La logique se **déplace** depuis `hero.ts` — lire les
lignes 527-564 de l'original et les transposer, en remplaçant les variables de fermeture par des
champs de `state` et les appels audio par des `HeroEvent`. Ne pas réécrire les règles : les
déplacer.

```ts
// La règle de déplacement du héros, pure. Ni `three`, ni audio, ni billboard : elle lit un état,
// le fait avancer d'un pas, et RACONTE ce qui s'est produit (voir `HeroEvent`). L'adaptateur
// (`hero.ts`) joue ces événements.
//
// Elle mute `state` en place : ce pas tourne à 60 Hz et rien ne conserve l'état précédent, donc
// une copie par image serait une allocation pour rien.

import type { HeroEvent, HeroInput, HeroState, StepDeps } from "./hero-state.js";
import { derapage, pasAmorti, sePropulse } from "./locomotion.js";

export function stepHero(
  state: HeroState,
  input: HeroInput,
  dt: number,
  deps: StepDeps,
): HeroEvent[] {
  const events: HeroEvent[] = [];
  const { query, colliders, hero, world } = deps;

  const empreinte = (z: number) => z - hero.offset;
  const avantX = state.x;
  const avantZ = state.z;

  // La matière SOUS LES PIEDS, avant de bouger, choisit la friction et le plafond de vitesse.
  // En nage, la matière du fond marin n'a aucun sens physique : on retombe sur `null` (= herbe).
  const matiere = state.swimming || state.room ? null : query.kindAt(state.x, empreinte(state.z));
  const friction = frictionPour(matiere, hero);
  const vmax = state.swimming ? hero.speed * hero.swim.speed : vitesseMaxPour(matiere, hero);
  const accel = vmax * friction;

  state.vx = pasAmorti(state.vx, input.x, accel, friction, dt);
  state.vz = pasAmorti(state.vz, input.z, accel, friction, dt);

  events.push({
    t: "glisse",
    intensite: state.airborne || state.swimming ? 0 : derapage(state.vx, state.vz, input.x, input.z, hero.speed),
  });
  const propulsion = sePropulse(state.vx, state.vz, input.x, input.z);

  // Un axe à la fois : buter sur un obstacle en diagonale fait glisser le long. Sur l'axe refusé
  // la vitesse retombe à zéro, sinon on reste collé au mur à pleine vitesse et on repart d'un
  // coup en s'en écartant.
  const nx = state.x + state.vx * dt;
  if (canEnter(state, nx, state.z, deps)) state.x = nx;
  else state.vx = 0;
  const nz = state.z + state.vz * dt;
  if (canEnter(state, state.x, nz, deps)) state.z = nz;
  else state.vz = 0;

  if (state.vx !== 0) state.facing = state.vx > 0 ? 1 : -1;

  // La cadence des pas est à la DISTANCE parcourue, et ne compte que si l'on se propulse
  // réellement — glisser fait avancer sans qu'aucun pied ne quitte le sol.
  if (!state.airborne && !state.swimming && propulsion) {
    state.distanceDepuisLePas += Math.hypot(state.x - avantX, state.z - avantZ);
    if (state.distanceDepuisLePas >= hero.pasTousLes) {
      state.distanceDepuisLePas = 0;
      events.push({ t: "pas", matiere: query.kindAt(state.x, empreinte(state.z)) ?? "herbe" });
    }
  }

  return events;
}
```

`canEnter`, `frictionPour` et `vitesseMaxPour` sont à transposer depuis `hero.ts:391-425` et
`locomotion.ts:59-88` — ces deux dernières prennent désormais `hero: HeroSettings` en second
paramètre au lieu d'importer `HERO`. **Mettre à jour `locomotion.ts` en conséquence**, ses tests
existants compris (`apps/lab/test/hero-friction.test.ts`).

- [ ] **Step 5: Lancer le test pour le voir passer**

Run: `npx vitest run --project lab test/hero-step-horizontal.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Brancher l'adaptateur**

Dans `hero.ts`, remplacer la section horizontale de `update()` par un appel à `stepHero` et une
boucle qui joue les événements. Les autres sections (vertical, nage, glace) restent en place pour
l'instant et lisent désormais `state.*` au lieu des variables locales supprimées.

```ts
const evts = stepHero(state, input, dt, deps);
for (const e of evts) {
  if (e.t === "pas") step(e.matiere);
  else if (e.t === "glisse") setSkid(e.intensite);
}
```

- [ ] **Step 7: Vérifier, et JOUER**

Run: `npx vitest run --project lab && npm run typecheck:lab && npm run lint`

Puis lancer le labo (`npm run lab`) et **jouer** avec la skill `playwright-cli` (jamais l'extension
Chrome) : marcher sur l'herbe, sur la neige, se lancer sur la glace, buter contre un arbre en
diagonale. La cadence des pas, le son de glisse et le glissement le long des obstacles doivent être
**indiscernables** d'avant. C'est le seul juge de cette task.

- [ ] **Step 8: Commit**

```bash
git add apps/lab/src apps/lab/test
git commit -m "feat(lab): stepHero pur, déplacement horizontal extrait et couvert"
```

---

### Task 3: Le saut, la gravité, le coyote et la réception

**Files:**
- Modify: `apps/lab/src/world/hero-step.ts`, `apps/lab/src/world/hero.ts` (lignes 591-627 de l'original)
- Test: `apps/lab/test/hero-step-vertical.test.ts`

**Interfaces:**
- Consumes: `stepHero` (Task 2), `depsPlates` (Task 2).
- Produces: les événements `{ t: "saut" }` et `{ t: "reception"; force }`.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
import { describe, expect, it } from "vitest";
import { createHeroState } from "../src/world/hero-state.js";
import { stepHero } from "../src/world/hero-step.js";
import { depsPlates } from "./helpers/step-deps.js";

const immobile = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false };

describe("stepHero — la verticale", () => {
  it("saute, retombe, et annonce sa réception", () => {
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    const saut = stepHero(s, { ...immobile, jump: true }, 1 / 60, deps);
    expect(saut.some((e) => e.t === "saut")).toBe(true);
    expect(s.airborne).toBe(true);

    let recu: number | null = null;
    for (let i = 0; i < 200 && recu === null; i++) {
      for (const e of stepHero(s, immobile, 1 / 60, deps)) {
        if (e.t === "reception") recu = e.force;
      }
    }
    expect(recu).not.toBeNull();
    expect(s.airborne).toBe(false);
    expect(s.y).toBeCloseTo(0, 6);
  });

  it("pardonne le saut quelques images après avoir quitté le bord", () => {
    // Le coyote time : sans lui, sauter au bord exact d'une falaise rate une fois sur deux.
    const deps = depsPlates({ hauteur: (x) => (x < 1 ? 0 : null) });
    const s = createHeroState(0.99, 0, 0, 10, 2.2);
    s.airborne = true;
    s.coyote = deps.hero.jump.coyote;
    const evts = stepHero(s, { ...immobile, jump: true }, 1 / 60, deps);
    expect(evts.some((e) => e.t === "saut")).toBe(true);
  });

  it("ne saute plus une fois le coyote épuisé", () => {
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    s.airborne = true;
    s.coyote = 0;
    const evts = stepHero(s, { ...immobile, jump: true }, 1 / 60, deps);
    expect(evts.some((e) => e.t === "saut")).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run --project lab test/hero-step-vertical.test.ts`
Expected: FAIL — `stepHero` ne touche pas encore `y`.

- [ ] **Step 3: Déplacer la logique verticale**

Transposer `hero.ts:591-627` dans `stepHero`, après la section horizontale. `land(impact)` devient
`events.push({ t: "reception", force: impact })` ; `sonSaut()` devient
`events.push({ t: "saut" })`. La formule de `impact` (`clamp(-vy / hero.jump.speed, 0.35, 1.4)`)
se transpose telle quelle, mais **sans `THREE.MathUtils.clamp`** — la règle ne doit pas importer
`three`. Écrire le clamp à la main.

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `npx vitest run --project lab test/hero-step-vertical.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Vérifier, et JOUER**

Run: `npx vitest run --project lab && npm run typecheck:lab && npm run lint`

Puis en jeu : sauter à plat, sauter d'une falaise, sauter au bord exact. La secousse de caméra et le
son de réception suivent la hauteur de chute — ils doivent être identiques à avant.

- [ ] **Step 6: Commit**

```bash
git add apps/lab/src apps/lab/test
git commit -m "feat(lab): le saut et la réception passent dans le pas pur"
```

---

### Task 4: La nage, le souffle et la noyade

**Files:**
- Modify: `apps/lab/src/world/hero-step.ts`, `apps/lab/src/world/hero.ts` (lignes 432-476 et 576-590 de l'original)
- Test: `apps/lab/test/hero-step-nage.test.ts`

**Interfaces:**
- Consumes: `stepHero` (Task 3).
- Produces: les événements `entree-eau`, `sortie-eau`, `noyade`, `brasse`.

**Le piège que cette task doit reproduire, pas corriger :** l'île de neige a découvert qu'appeler
l'entrée dans l'eau seule se faisait annuler une image plus tard par la résolution de nage, sur les
cases de glace fine posées sur un terrain de hauteur non nulle. Le correctif est dans le code
actuel — le transposer tel quel et **le couvrir d'un test**, puisqu'il ne l'est pas.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
import { describe, expect, it } from "vitest";
import { createHeroState } from "../src/world/hero-state.js";
import { stepHero } from "../src/world/hero-step.js";
import { depsPlates } from "./helpers/step-deps.js";

const immobile = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false };

describe("stepHero — la nage", () => {
  it("entre à l'eau en tombant du bord, et l'annonce une seule fois", () => {
    const deps = depsPlates({ hauteur: (x) => (x < 0 ? 0 : null) });
    const s = createHeroState(-0.05, 0, 0, 10, 2.2);
    let entrees = 0;
    for (let i = 0; i < 120; i++) {
      const evts = stepHero(s, { ...immobile, x: 1 }, 1 / 60, deps);
      entrees += evts.filter((e) => e.t === "entree-eau").length;
    }
    expect(s.swimming).toBe(true);
    expect(entrees).toBe(1);
  });

  it("consomme le souffle au taux fourni par la zone, puis se noie", () => {
    const deps = depsPlates({ hauteur: () => null });
    const s = createHeroState(0, 0, 0, 2, 2.2);
    s.swimming = true;
    // Taux 2 : l'eau polaire consomme deux fois plus vite. Un souffle de 2 s doit donc tenir 1 s.
    let noyades = 0;
    for (let i = 0; i < 90; i++) {
      noyades += stepHero(s, { ...immobile, souffleTaux: 2 }, 1 / 60, deps).filter((e) => e.t === "noyade").length;
    }
    expect(noyades).toBe(1);
  });

  it("se hisse sur une rive de plain-pied, jamais sur une falaise", () => {
    const hauteM = depsPlates({ hauteur: (x) => (x > 0 ? 5 : null) });
    const s = createHeroState(-0.01, 0, 0, 10, 2.2);
    s.swimming = true;
    for (let i = 0; i < 60; i++) stepHero(s, { ...immobile, x: 1 }, 1 / 60, hauteM);
    expect(s.swimming).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run --project lab test/hero-step-nage.test.ts`
Expected: FAIL.

- [ ] **Step 3: Déplacer la logique de nage**

Transposer `enterWater`/`leaveWater`/`drown` (`hero.ts:432-476`) et la branche `if (swimming)`
(`hero.ts:576-590`). Les `splash(...)` et les appels sonores deviennent des événements portant les
coordonnées — c'est l'adaptateur qui crée le billboard d'éclaboussure.

La remise à zéro de `vx`/`vz` à chaque transition d'état est **load-bearing** : sans elle on entre
dans l'eau avec l'élan de la glace qu'on vient de quitter. La transposer.

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `npx vitest run --project lab test/hero-step-nage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Vérifier, et JOUER**

Run: `npx vitest run --project lab && npm run typecheck:lab && npm run lint`

En jeu : nager jusqu'à l'île du nord, se noyer volontairement, ressortir sur une plage, tenter de
ressortir contre une falaise. Les éclaboussures et les sons doivent être identiques.

- [ ] **Step 6: Commit**

```bash
git add apps/lab/src apps/lab/test
git commit -m "feat(lab): la nage et le souffle passent dans le pas pur"
```

---

### Task 5: La glace fine

**Files:**
- Modify: `apps/lab/src/world/hero-step.ts`, `apps/lab/src/world/hero.ts` (lignes 629-660 de l'original)
- Test: `apps/lab/test/hero-step-glace.test.ts`

**Interfaces:**
- Consumes: `stepHero` (Task 4), `createThinIce` (`world/thin-ice.ts`, inchangé).
- Produces: les événements `glace-craque` et `glace-rompt`.

**Le second bug trouvé en jouant, à couvrir cette fois :** revenir à pied sur une case DÉJÀ rompue
ne déclenchait rien, parce que la logique ne réagissait qu'aux transitions. `tombeEnArrivant()`
existe pour ça — le transposer et le tester.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
import { describe, expect, it } from "vitest";
import { createHeroState } from "../src/world/hero-state.js";
import { stepHero } from "../src/world/hero-step.js";
import { depsPlates } from "./helpers/step-deps.js";
import { createThinIce } from "../src/world/thin-ice.js";

const immobile = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false };

function depsGlace() {
  const glace = createThinIce({ seuilCraquement: 0.5, seuilRupture: 1.4, regel: 6 });
  return { ...depsPlates({ matiere: () => "glace-fine" }), glace };
}

describe("stepHero — la glace fine", () => {
  it("craque sous le poids, puis cède", () => {
    const deps = depsGlace();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    const vus: string[] = [];
    for (let i = 0; i < 120; i++) {
      for (const e of stepHero(s, immobile, 1 / 60, deps)) {
        if (e.t === "glace-craque" || e.t === "glace-rompt") vus.push(e.t);
      }
    }
    expect(vus).toEqual(["glace-craque", "glace-rompt"]);
    expect(s.swimming).toBe(true);
  });

  it("ne charge rien quand on saute par-dessus", () => {
    // « Sous le poids » est tout le mécanisme : survoler ne doit rien user.
    const deps = depsGlace();
    const s = createHeroState(0, 3, 0, 10, 2.2);
    s.airborne = true;
    s.vy = 1;
    for (let i = 0; i < 60; i++) stepHero(s, immobile, 1 / 60, deps);
    expect(deps.glace.etat("36,36")).toBe("intacte");
  });

  it("fait tomber celui qui revient à pied sur un trou déjà ouvert", () => {
    const deps = depsGlace();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    for (let i = 0; i < 120; i++) stepHero(s, immobile, 1 / 60, deps);
    // Sorti de l'eau, on remet le pied sur la MÊME case, encore rompue.
    s.swimming = false;
    s.y = 0;
    const evts = stepHero(s, immobile, 1 / 60, deps);
    expect(evts.some((e) => e.t === "entree-eau" && e.rupture)).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run --project lab test/hero-step-glace.test.ts`
Expected: FAIL.

- [ ] **Step 3: Déplacer la logique de glace fine**

Transposer `hero.ts:629-660` et la garde `dansUnTrou` de la branche de nage
(`hero.ts:577-582`). L'appel `thinIce.update(dt)` reste **inconditionnel et en tête** du pas : le
regel doit avancer au temps réel écoulé, pas seulement quand le héros est dessus. `caseDe()` se
transpose avec `deps.world.size` au lieu de `WORLD.size`.

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `npx vitest run --project lab test/hero-step-glace.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Vérifier, et JOUER**

Run: `npx vitest run --project lab && npm run typecheck:lab && npm run lint`

En jeu : rester sur la glace fine jusqu'à ce qu'elle craque, partir à temps, revenir, tomber,
ressortir, remarcher sur le trou, attendre le regel. Le craquement visuel et les deux sons doivent
être identiques.

- [ ] **Step 6: Commit**

```bash
git add apps/lab/src apps/lab/test
git commit -m "feat(lab): la glace fine passe dans le pas pur"
```

---

### Task 6: L'intérieur, et la fin de l'extraction

**Files:**
- Modify: `apps/lab/src/world/hero-step.ts`, `apps/lab/src/world/hero.ts` (lignes 394-402 et 566-572)
- Test: `apps/lab/test/hero-step-interieur.test.ts`

**Interfaces:**
- Consumes: `stepHero` (Task 5), `Room` (Task 1).
- Produces: `stepHero` complet. `hero.ts` ne contient plus **aucune** règle.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
import { describe, expect, it } from "vitest";
import { createHeroState } from "../src/world/hero-state.js";
import { stepHero } from "../src/world/hero-step.js";
import { depsPlates } from "./helpers/step-deps.js";

const immobile = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false };
const piece = { x0: -2, x1: 2, z0: -2, z1: 2, y: 5, obstacles: [{ x: 0, z: 1, r: 0.5 }] };

describe("stepHero — en intérieur", () => {
  it("garde le plancher plat : ni gravité, ni nage, ni saut", () => {
    const deps = depsPlates({ hauteur: () => null });
    const s = createHeroState(0, 0, 0, 10, 2.2);
    s.room = piece;
    const evts = stepHero(s, { ...immobile, jump: true }, 1 / 60, deps);
    expect(s.y).toBe(5);
    expect(s.airborne).toBe(false);
    expect(s.swimming).toBe(false);
    expect(evts.some((e) => e.t === "saut")).toBe(false);
  });

  it("ne sort pas du rectangle et contourne les meubles", () => {
    const deps = depsPlates();
    const s = createHeroState(0, 5, 0, 10, 2.2);
    s.room = piece;
    for (let i = 0; i < 300; i++) stepHero(s, { ...immobile, x: 1 }, 1 / 60, deps);
    expect(s.x).toBeLessThan(2);
  });

  it("laisse ressortir celui qui chevauche déjà un meuble", () => {
    // L'échappatoire : sans elle, un héros posé sur un meuble est cimenté sur place.
    const deps = depsPlates();
    const s = createHeroState(0, 5, 1, 10, 2.2);
    s.room = piece;
    for (let i = 0; i < 60; i++) stepHero(s, { ...immobile, z: -1 }, 1 / 60, deps);
    expect(s.z).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run --project lab test/hero-step-interieur.test.ts`
Expected: FAIL.

- [ ] **Step 3: Déplacer la logique d'intérieur, et vider `hero.ts` de ses règles**

Transposer la branche `if (piece)` de `canEnter` (`hero.ts:394-402`) et la branche
`if (piece)` de `update` (`hero.ts:566-572`).

Puis **relire `hero.ts` en entier** et vérifier qu'il ne reste plus une seule décision de jeu : il
ne doit plus contenir que la création des billboards, l'animateur, les lots recyclés, la lecture de
`state` pour positionner les objets, et la boucle qui joue les événements.

- [ ] **Step 4: Lancer toute la suite**

Run: `npx vitest run --project lab`
Expected: PASS. Compter les tests de `stepHero` — il doit y en avoir au moins 15.

- [ ] **Step 5: Vérifier, JOUER, et MESURER**

Run: `npm run typecheck:lab && npm run lint`

En jeu : entrer dans la maison, en faire le tour, buter dans les meubles, ressortir.

Puis mesurer au harnais : `?bench=game`, de nuit, au spawn ET au pôle, **avec `labBench.armer()` sur
place**. Références : **2,27 ms/frame au spawn, 2,01 au pôle**. L'extraction ne doit rien coûter —
si elle coûte, c'est qu'une allocation s'est glissée dans le pas. **Remonter l'écart tel quel.**

- [ ] **Step 6: Commit**

```bash
git add apps/lab/src apps/lab/test
git commit -m "feat(lab): hero.ts ne contient plus aucune règle"
```

---

### Task 7: Le souffle visible et les traces, en événements

**Files:**
- Modify: `apps/lab/src/world/hero-step.ts`, `apps/lab/src/world/hero.ts`
- Test: `apps/lab/test/hero-step-ambiance.test.ts`

**Interfaces:**
- Consumes: `stepHero` (Task 6).
- Produces: les événements `haleine` et `trace`.

Ces deux effets sont décoratifs, mais leur **cadence** est une règle : l'haleine suit celle des pas
en marchant et un timer indépendant à l'arrêt, les traces ne se posent qu'en marchant. Les laisser
dans l'adaptateur l'obligerait à recalculer cette cadence — donc à dupliquer la règle.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
import { describe, expect, it } from "vitest";
import { createHeroState } from "../src/world/hero-state.js";
import { stepHero } from "../src/world/hero-step.js";
import { depsPlates } from "./helpers/step-deps.js";

const arret = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: true };

describe("stepHero — souffle et traces", () => {
  it("souffle même à l'arrêt, plus lentement qu'en marchant", () => {
    // Quelqu'un qui respire ne s'arrête pas de respirer. C'est le détail qui distingue « un
    // effet » de « il fait froid ».
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    let n = 0;
    for (let i = 0; i < 60 * 10; i++) {
      n += stepHero(s, arret, 1 / 60, deps).filter((e) => e.t === "haleine").length;
    }
    // 10 s à un intervalle de 2,2 s : quatre bouffées au moins.
    expect(n).toBeGreaterThanOrEqual(4);
  });

  it("ne souffle pas hors de la zone froide", () => {
    const deps = depsPlates();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    let n = 0;
    for (let i = 0; i < 60 * 10; i++) {
      n += stepHero(s, { ...arret, haleineVisible: false }, 1 / 60, deps).filter((e) => e.t === "haleine").length;
    }
    expect(n).toBe(0);
  });

  it("alterne le côté des traces", () => {
    const deps = depsPlates({ matiere: () => "neige" });
    const s = createHeroState(0, 0, 0, 10, 2.2);
    const cotes: number[] = [];
    for (let i = 0; i < 60 * 20; i++) {
      for (const e of stepHero(s, { ...arret, x: 1 }, 1 / 60, deps)) {
        if (e.t === "trace") cotes.push(e.cote);
      }
    }
    expect(cotes.length).toBeGreaterThanOrEqual(2);
    expect(cotes[0]).not.toBe(cotes[1]);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run --project lab test/hero-step-ambiance.test.ts`
Expected: FAIL.

- [ ] **Step 3: Déplacer les deux cadences**

Transposer depuis `hero.ts` : l'émission d'haleine (cadencée sur les pas, plus le timer
`reposHaleine` à l'arrêt, qui ne décompte pas en nage) et la pose de trace (uniquement sur `neige`,
uniquement quand on se propulse, avec l'alternance de côté).

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `npx vitest run --project lab test/hero-step-ambiance.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Vérifier, et JOUER**

Run: `npx vitest run --project lab && npm run typecheck:lab && npm run lint`

En jeu, sur l'île du nord : le souffle sort de la tête, plus vite en courant, jamais absent à
l'arrêt, absent hors zone. Les traces se posent en marchant, jamais en glissant, et alternent.

- [ ] **Step 6: Commit**

```bash
git add apps/lab/src apps/lab/test
git commit -m "feat(lab): le souffle et les traces deviennent des événements du pas"
```

---

### Task 8: Les colliders deviennent des rectangles

**Files:**
- Create: `apps/lab/src/world/collider-index.ts`
- Delete: `apps/lab/src/world/colliders.ts`
- Modify: `apps/lab/src/world/props.ts`, `chest.ts`, `npc-base.ts`, `main.ts`
- Test: `apps/lab/test/collider-index.test.ts`

**Interfaces:**
- Consumes: `ColliderQuery` (Task 1).
- Produces: `createColliderIndex()`, `type ColliderRect = { x: number; z: number; w: number; h: number }`. La Task 9 sérialise ces rectangles.

**La décision qui réduit le risque :** les colliders deviennent des rectangles alignés sur les axes,
**mais le héros garde son empreinte ronde**. Le test est donc disque-contre-rectangle, par le point
le plus proche. Le mur devient possible, et le contact du héros ne change pas — le spec craignait
qu'un tronc carré accroche là où un tronc rond glisse ; en gardant le héros rond, seul le coin de
l'obstacle change, pas la façon dont on le longe.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
import { describe, expect, it } from "vitest";
import { createColliderIndex } from "../src/world/collider-index.js";

describe("createColliderIndex", () => {
  it("bloque un disque qui chevauche un rectangle, par le point le plus proche", () => {
    const idx = createColliderIndex();
    idx.add({ x: 0, z: 0, w: 2, h: 2 }); // de (0,0) à (2,2)
    // Au coin, la distance au rectangle est celle au point (0,0).
    expect(idx.blocked(-0.2, -0.2, 0.5)).toBe(true);
    // Un rayon 0.2 ne suffit plus : la diagonale du coin vaut ~0.283.
    expect(idx.blocked(-0.2, -0.2, 0.2)).toBe(false);
  });

  it("laisse passer un disque qui frôle le bord sans le toucher", () => {
    const idx = createColliderIndex();
    idx.add({ x: 0, z: 0, w: 2, h: 2 });
    expect(idx.blocked(-0.51, 1, 0.5)).toBe(false);
    expect(idx.blocked(-0.49, 1, 0.5)).toBe(true);
  });

  it("trouve un rectangle plus large que la cellule de l'index", () => {
    // Un mur long est le cas que le cercle ne savait pas modéliser, donc celui qu'aucun test
    // existant ne couvre. Il doit être trouvé depuis n'importe quel point de sa longueur.
    const idx = createColliderIndex();
    idx.add({ x: -20, z: 0, w: 40, h: 0.5 });
    expect(idx.blocked(-18, 0.2, 0.3)).toBe(true);
    expect(idx.blocked(0, 0.2, 0.3)).toBe(true);
    expect(idx.blocked(18, 0.2, 0.3)).toBe(true);
    expect(idx.blocked(0, 5, 0.3)).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run --project lab test/collider-index.test.ts`
Expected: FAIL — le fichier n'existe pas.

- [ ] **Step 3: Écrire l'index**

Créer `apps/lab/src/world/collider-index.ts`. Garder la `Map` creuse de `colliders.ts` (elle
convient à une carte large et clairsemée, contrairement aux seaux denses de
`packages/engine/src/collider.ts`), mais insérer chaque rectangle dans **toutes** les cellules qu'il
recouvre — un mur long en occupe beaucoup, et c'est exactement ce que le troisième test vérifie.

Le test de recouvrement :

```ts
/** Distance au carré du centre du disque au point du rectangle le plus proche. */
function overlaps(r: ColliderRect, x: number, z: number, rayon: number): boolean {
  const px = Math.min(Math.max(x, r.x), r.x + r.w);
  const pz = Math.min(Math.max(z, r.z), r.z + r.h);
  const dx = x - px;
  const dz = z - pz;
  return dx * dx + dz * dz < rayon * rayon;
}
```

- [ ] **Step 4: Convertir les appelants**

`props.ts` (lignes 187 et 426), `chest.ts:116` et `npc-base.ts:47` appellent
`colliders.add(x, z, r)`. Les convertir en rectangles centrés : `{ x: x - r, z: z - r, w: 2*r, h: 2*r }`.
**Garder les mêmes rayons** — cette task change la forme, pas le réglage. Un arbre dont le tronc
grossit en même temps qu'il devient carré rendrait la vérification en jeu ininterprétable.

- [ ] **Step 5: Lancer les tests pour les voir passer**

Run: `npx vitest run --project lab && npm run typecheck:lab && npm run lint`
Expected: PASS.

- [ ] **Step 6: JOUER, en cherchant précisément les angles**

C'est **la seule task du chantier qui peut dégrader une sensation acquise**. En jeu : longer un
arbre en diagonale, passer entre deux arbres serrés, contourner le coffre, frôler la source chaude,
courir contre un tronc en biais. Chercher activement un accrochage dans les coins.

Si ça accroche, **le dire** plutôt que de rattraper le rayon en douce — un réglage compensatoire
masquerait le vrai effet du changement de primitive.

- [ ] **Step 7: Commit**

```bash
git add apps/lab/src apps/lab/test
git commit -m "feat(lab): les colliders deviennent des rectangles, le héros reste rond"
```

---

### Task 9: Le format de carte

**Files:**
- Create: `apps/lab/src/world/map-data.ts`
- Test: `apps/lab/test/map-data.test.ts`

**Interfaces:**
- Consumes: `TerrainMaterial` (`world/terrain-query.ts`), `ColliderRect` (Task 8).
- Produces: `type MapData`, `encodeMap(m): string`, `decodeMap(s): MapData`, `mapToQuerySource(m): TerrainQuerySource`. La Task 10 les utilise.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
import { describe, expect, it } from "vitest";
import { decodeMap, encodeMap, type MapData } from "../src/world/map-data.js";

const carte: MapData = {
  version: 1,
  size: 4,
  levelHeight: 0.9,
  waterLevel: 0,
  levels: [null, 0, 0, null, 0, 1, 1, 0, 0, 1, 2, 0, null, 0, 0, null],
  materials: ["herbe", "herbe", "herbe", "herbe", "herbe", "neige", "glace", "herbe",
              "herbe", "neige", "neige", "herbe", "herbe", "herbe", "herbe", "herbe"],
  colliders: [{ x: 1, z: 1, w: 0.4, h: 0.4 }],
  spawns: [{ name: "depart", x: 0, z: 0 }],
};

describe("le codec de carte", () => {
  it("fait un aller-retour sans rien perdre", () => {
    expect(decodeMap(encodeMap(carte))).toEqual(carte);
  });

  it("ne jette jamais sur une entrée malformée", () => {
    // Le serveur lira ce format un jour : un `throw` sur une carte corrompue abattrait une salle.
    for (const mauvais of ["", "{}", "null", "[1,2,3]", '{"version":99}', "pas du json"]) {
      expect(() => decodeMap(mauvais)).not.toThrow();
      expect(decodeMap(mauvais)).toBeNull();
    }
  });

  it("rejette une carte dont la grille ne fait pas size²", () => {
    const tronquee = { ...carte, levels: carte.levels.slice(0, 5) };
    expect(decodeMap(JSON.stringify(tronquee))).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run --project lab test/map-data.test.ts`
Expected: FAIL.

- [ ] **Step 3: Écrire le format et son codec**

```ts
// Une carte, en données. Ce que le labo dessine aujourd'hui par du code procédural, ce qu'un
// éditeur produira demain, et ce qu'un serveur doit pouvoir lire sans une ligne de rendu.
//
// `decodeMap` rend `null` plutôt que de jeter : ce format traversera un jour le réseau, et une
// carte corrompue ne doit pas abattre une salle entière. Même discipline que
// `parseClientMessage` dans `@lindocara/engine`.

export interface MapData {
  version: 1;
  /** Côté de la grille, en cases. */
  size: number;
  levelHeight: number;
  waterLevel: number;
  /** `size * size`, en ligne d'abord. `null` = eau. */
  levels: readonly (number | null)[];
  /** `size * size`. Sans signification là où `levels` vaut `null`. */
  materials: readonly TerrainMaterial[];
  colliders: readonly ColliderRect[];
  spawns: readonly { name: string; x: number; z: number }[];
}
```

`decodeMap` valide : `version === 1`, `size` entier positif, les deux grilles de longueur
`size * size`, chaque matière dans l'union, chaque nombre fini. Toute violation rend `null`.

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `npx vitest run --project lab test/map-data.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Vérifier**

Run: `npx vitest run --project lab && npm run typecheck:lab && npm run lint`

- [ ] **Step 6: Commit**

```bash
git add apps/lab/src/world/map-data.ts apps/lab/test/map-data.test.ts
git commit -m "feat(lab): le format de carte sérialisable et son codec"
```

---

### Task 10: Le labo charge sa carte au lieu de la générer

**Files:**
- Create: `apps/lab/scripts/build-map.ts`, `apps/lab/public/maps/ile.json`
- Modify: `apps/lab/src/main.ts`, `apps/lab/src/world/island.ts`, `apps/lab/src/world/props.ts`
- Test: `apps/lab/test/map-parite.test.ts`

**Interfaces:**
- Consumes: `MapData`, `encodeMap`, `mapToQuerySource` (Task 9) ; `generateIsland` (`world/island.ts`, inchangé).
- Produces: `apps/lab/public/maps/ile.json`, chargé au démarrage comme les textures et les sons.

**L'œuf et la poule :** produire une carte authorée demande un éditeur, donc S5. On le casse en
**sérialisant l'île générée**. Le générateur procédural ne disparaît pas — il cesse d'être une
dépendance de l'exécution pour devenir un outil de production de données.

- [ ] **Step 1: Écrire le test de parité, qui échoue**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { generateIsland } from "../src/world/island.js";
import { decodeMap } from "../src/world/map-data.js";
import { WORLD } from "../src/settings.js";

describe("la carte sérialisée", () => {
  it("décrit exactement l'île que le générateur produit", () => {
    // Le contrôle de non-régression de tout ce chantier : si la carte livrée cesse de
    // correspondre au générateur, le monde a changé sans que personne l'ait voulu.
    const carte = decodeMap(readFileSync("apps/lab/public/maps/ile.json", "utf8"));
    expect(carte).not.toBeNull();
    if (!carte) return;
    const { field } = generateIsland({ size: WORLD.size, seed: WORLD.seed });
    expect(carte.size).toBe(WORLD.size);
    for (let j = 0; j < carte.size; j++) {
      for (let i = 0; i < carte.size; i++) {
        expect(carte.levels[j * carte.size + i]).toBe(field.at(i, j));
        if (field.at(i, j) !== null) {
          expect(carte.materials[j * carte.size + i]).toBe(field.materialAt(i, j));
        }
      }
    }
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `npx vitest run --project lab test/map-parite.test.ts`
Expected: FAIL — le fichier de carte n'existe pas.

- [ ] **Step 3: Écrire le script de production**

Créer `apps/lab/scripts/build-map.ts` : appelle `generateIsland`, appelle `populate` pour récolter
les colliders **en données** plutôt qu'en objets de scène, et écrit `public/maps/ile.json`.

Ajouter au `package.json` du labo : `"build:map": "tsx scripts/build-map.ts"`.

La récolte des colliders est le point délicat : `populate` crée aujourd'hui des billboards **et**
enregistre des colliders dans le même passage, et un script Node ne peut pas construire de billboard.
Extraire d'abord la décision de placement — quoi, où, avec quel rectangle — de la création des objets
`three`, pour que le script appelle la première sans la seconde :

```ts
/** Ce que `populate` DÉCIDE, avant d'avoir rien créé. Pur, donc appelable depuis un script Node
 *  comme depuis le navigateur — c'est ce qui permet de sérialiser les colliders sans WebGL. */
export interface Placement {
  kind: string;
  x: number;
  z: number;
  scale: number;
  /** `null` pour un décor traversable (buisson, fleur). */
  collider: ColliderRect | null;
}

export function decidePlacements(field: HeightField, query: TerrainQuery, seed: number): Placement[];
```

`populate` devient alors : `decidePlacements(...)` puis une boucle qui crée un billboard par
placement. Le script n'appelle que la première moitié.

- [ ] **Step 4: Produire la carte et lancer le test**

```bash
npm run build:map -w @lindocara/lab
npx vitest run --project lab test/map-parite.test.ts
```
Expected: PASS.

- [ ] **Step 5: Charger la carte au démarrage**

Dans `main.ts`, remplacer l'appel à `generateIsland` par le chargement de `/maps/ile.json` via
`fetchAll` — la carte rejoint les textures et les sons dans la barre de chargement, pondérée en
octets comme le reste. Construire `TerrainQuery` depuis `mapToQuerySource(carte)` et alimenter
l'index de colliders depuis `carte.colliders`.

`props.ts` continue de créer les billboards, mais **ne déclare plus de collider** : ils viennent
désormais de la carte.

- [ ] **Step 6: Vérifier, JOUER, et MESURER**

Run: `npx vitest run --project lab && npm run typecheck:lab && npm run lint`

En jeu : l'île doit être **exactement** la même — même relief, mêmes arbres, mêmes obstacles, même
île du nord. Comparer une capture avant/après.

Mesurer au harnais (`?bench=game`, nuit, spawn et pôle, réarmé sur place) contre **2,27 / 2,01**.
Le temps de chargement change aussi : le noter.

- [ ] **Step 7: Commit**

```bash
git add apps/lab
git commit -m "feat(lab): le labo charge sa carte au lieu de la générer"
```

---

### Task 11: La géométrie remonte dans `engine`

**Files:**
- Create: `packages/engine/src/hd2d/terrain-query.ts`, `collider-index.ts`, `map-data.ts`
- Modify: `apps/lab/src/world/*.ts` (les imports), `packages/engine/CLAUDE.md`
- Test: `packages/engine/test/hd2d/` (les tests déménagent avec les fichiers)

**Interfaces:**
- Consumes: les trois fichiers dans leur état de la Task 10.
- Produces: `@lindocara/engine/hd2d/terrain-query.js`, `.../collider-index.js`, `.../map-data.js`.

**La convention :** ces fichiers portent des commentaires en **français** et arrivent dans `engine`,
dont la convention est l'**anglais**. Décision : **traduire en anglais au moment du déménagement**,
parce que `engine` est le paquet que le serveur et un futur contributeur liront, et qu'un îlot
francophone au milieu y serait une exception permanente pour une raison purement historique.
`apps/lab` reste en français.

- [ ] **Step 1: Déplacer les fichiers et leurs tests**

```bash
mkdir -p packages/engine/src/hd2d packages/engine/test/hd2d
git mv apps/lab/src/world/terrain-query.ts packages/engine/src/hd2d/terrain-query.ts
git mv apps/lab/src/world/collider-index.ts packages/engine/src/hd2d/collider-index.ts
git mv apps/lab/src/world/map-data.ts packages/engine/src/hd2d/map-data.ts
git mv apps/lab/test/collider-index.test.ts packages/engine/test/hd2d/collider-index.test.ts
git mv apps/lab/test/map-data.test.ts packages/engine/test/hd2d/map-data.test.ts
```

- [ ] **Step 2: Traduire les commentaires en anglais**

Uniquement les trois fichiers déplacés et leurs deux tests. Traduire le POURQUOI, pas seulement les
mots : les commentaires de `terrain-query.ts` sur le rayon nul et sur le disque contre le point sont
des pièges payés une fois, ils doivent rester lisibles.

- [ ] **Step 3: Corriger les imports du labo**

Tous les `./terrain-query.js` deviennent `@lindocara/engine/hd2d/terrain-query.js`. Ajouter
`@lindocara/engine` aux dépendances de `apps/lab/package.json`.

**Vérifier que `apps/lab` ne gagne aucune autre dépendance :** il ne doit dépendre que de `hd2d`,
`three` et désormais `engine`.

- [ ] **Step 4: Vérifier que `engine` reste pur**

Run: `npm run typecheck:engine`
Expected: PASS. Le tsconfig de `engine` ne donne ni `DOM` ni les types Workers — si un `three` ou un
`document` a suivi le déménagement, il échoue ici, et c'est le point de ce garde-fou.

- [ ] **Step 5: Lancer tout**

Run: `npx vitest run --project lab --project engine && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: JOUER**

L'île doit être identique. Un déménagement d'imports ne change rien — le vérifier quand même, parce
que c'est bon marché et qu'un mauvais chemin d'import se voit tout de suite.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(engine): la géométrie du labo remonte dans engine/hd2d"
```

---

### Task 12: Les règles remontent, et la documentation dit vrai

**Files:**
- Create: `packages/engine/src/hd2d/locomotion.ts`, `thin-ice.ts`, `hero-state.ts`, `hero-step.ts`
- Modify: `apps/lab/AGENTS.md`, `packages/engine/CLAUDE.md`, `AGENTS.md` (racine), `docs/superpowers/specs/2026-08-02-hd2d-reboot-design.md`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: `@lindocara/engine/hd2d/hero-step.js` — le pas de simulation, pur, prêt pour un serveur qui ne l'appelle pas encore.

- [ ] **Step 1: Déplacer les quatre fichiers et leurs tests**

```bash
git mv apps/lab/src/world/locomotion.ts packages/engine/src/hd2d/locomotion.ts
git mv apps/lab/src/world/thin-ice.ts packages/engine/src/hd2d/thin-ice.ts
git mv apps/lab/src/world/hero-state.ts packages/engine/src/hd2d/hero-state.ts
git mv apps/lab/src/world/hero-step.ts packages/engine/src/hd2d/hero-step.ts
git mv apps/lab/test/hero-step-*.test.ts packages/engine/test/hd2d/
git mv apps/lab/test/hero-state.test.ts packages/engine/test/hd2d/
git mv apps/lab/test/hero-friction.test.ts packages/engine/test/hd2d/
git mv apps/lab/test/thin-ice.test.ts packages/engine/test/hd2d/
git mv apps/lab/test/helpers/step-deps.ts packages/engine/test/hd2d/helpers/step-deps.ts
```

- [ ] **Step 2: Traduire, et corriger les imports**

Mêmes règles qu'à la Task 11. `hero.ts` du labo importe désormais
`@lindocara/engine/hd2d/hero-step.js`.

- [ ] **Step 3: Vérifier que la pureté tient**

Run: `npm run typecheck:engine && npx vitest run --project engine`
Expected: PASS. C'est ici que se prouve la promesse du chantier : ces règles tournent **sans
navigateur**.

- [ ] **Step 4: Écrire la documentation**

`packages/engine/CLAUDE.md` gagne une section sur `hd2d/` : ce qu'il contient, pourquoi il est en
**unités-tuile** alors que `simulation.ts` est en **pixels**, et que le second est **en sursis
jusqu'à S3** — aucun code neuf ne doit être écrit contre lui.

`apps/lab/AGENTS.md` : le héros n'a plus de règles ; elles sont dans `engine/hd2d`, et le labo n'en
est qu'un adaptateur. La carte est une donnée, produite par `npm run build:map`.

`AGENTS.md` racine : **ne pas encore toucher** la règle « les clients envoient une intention, jamais
des positions ». Elle reste vraie tant que S3 ne l'a pas rendue fausse. Ajouter en revanche une
ligne dans la table des paquets pour `engine/hd2d`.

`docs/superpowers/specs/2026-08-02-hd2d-reboot-design.md` : amender la ligne du tableau des
chantiers qui annonce le jeu **éteint** pendant S2. Il ne l'est plus.

- [ ] **Step 5: Tout vérifier**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Mesurer une dernière fois**

`?bench=game` et `?bench=heavy`, jour et nuit, au pôle, **réarmés sur place**. Contre les références
du chantier de l'île de neige : `game` 2,01 ms de nuit au pôle, `heavy` 6,24. **Remonter tout écart
tel quel.**

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(engine): les règles du héros remontent dans engine/hd2d"
```

---

## Ce que ce plan ne fait pas

- **Aucun câblage réseau, aucun changement de protocole.** Le labo reste solo. La règle « le client
  décide de sa position » est fixée par le spec ; S3 la câble.
- **Le jeu n'est pas touché** : ni `renderer`, ni `client`, ni `editor`, ni `server`, ni `apps/main`.
  Il continue de tourner sur PixiJS et sur son monde en pixels pendant tout le chantier.
- **`prediction.ts` et la moitié prédictive de `net.ts` ne sont pas supprimées.** Ce chantier les
  rend inutiles ; leur retrait accompagne le basculement, donc S3.
- **Le serveur n'est pas branché sur la nouvelle géométrie.** Elle est livrée *prête* — pure, sans
  DOM ni `three` — et prouvée dans le labo. Le branchement appartient à S3.
