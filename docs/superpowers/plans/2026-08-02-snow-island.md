# L'île de neige — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter au labo une quatrième île gelée au nord, atteinte à la nage, avec ses propres règles de sol (la glace glisse, la neige freine, la glace fine cède), sa zone d'ambiance et sa musique déclenchée à l'arrivée — et dont la quasi-totalité des assets est générée localement par `~/git/pixel-art-model`.

**Architecture:** Les matières de terrain passent de deux à cinq ; le mailleur de `@lindocara/hd2d` choisit déjà son atlas par matière, donc le terrain ne l'oblige à rien. Le modèle de déplacement est **remplacé** par un modèle unique à friction variable, pas doublé d'un cas particulier. Une **zone** porte musique, nappe et taux de souffle. Deux effets seulement touchent `hd2d` (aurores, pulse de brouillard) et le font **par extension de l'ambiance**, jamais par un cas « neige ».

**Tech Stack:** TypeScript strict, Three.js via `@lindocara/hd2d`, Vitest (projet `lab`, node), Biome, et le studio `~/git/pixel-art-model` (FLUX.2-klein + LoRA Tiny Swords, MOSS-SoundEffect, Kokoro, ACE-Step).

**Le spec :** [`docs/superpowers/specs/2026-08-02-snow-island-design.md`](../specs/2026-08-02-snow-island-design.md). Le lire avant la Task 1.

**Le registre des pièges de rendu :** [`docs/hd2d-rendering.md`](../../hd2d-rendering.md). Toute task qui touche au rendu le consulte d'abord.

## Global Constraints

- **60 fps, contrainte dure.** Le harnais (`?bench=game`) mesure toujours au même endroit ; l'île de neige ne doit pas le faire bouger. Vérifier au compteur, et par `readPixels` quand le chiffre compte (méthode dans `apps/lab/AGENTS.md`).
- **`@lindocara/hd2d` ne doit à aucun moment apprendre qu'un biome de neige existe.** Les aurores et le pulse de brouillard sont des **canaux d'ambiance** de plus, comme `stars` en est déjà un. Un `if (biome === "neige")` dans le package est un échec de la task.
- **`apps/lab` ne dépend que de `@lindocara/hd2d` et `three`.**
- **Commentaires en FRANÇAIS** dans `hd2d` et `lab`. Ils disent POURQUOI : ce qui a été essayé, la mesure qui a tranché, le piège qui attend le prochain.
- Biome (points-virgules, guillemets doubles) ; TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`).
- **Les assets se génèrent par `python3 studio.py … --out <chemin dans lindocara>`**, jamais en copiant depuis le studio. Voir la section « Generating assets » de l'`AGENTS.md` racine.
- **Chaque asset généré passe une revue humaine.** Aucun n'est réputé bon parce que la commande a rendu 0.
- **Ne pas toucher** `renderer`, `client`, `editor`, `server`, `apps/main`.

---

## Structure de fichiers

**Modifiés**
- `apps/lab/src/world/terrain-query.ts` — `TerrainMaterial` passe à cinq valeurs
- `apps/lab/src/world/island.ts` — la quatrième île, et la matière neige/glace/glace fine
- `apps/lab/src/world/hero.ts` — le modèle à friction, la glisse, la glace fine, le souffle
- `apps/lab/src/core/audio.ts` — sons de sol élargis, glisse continue, musique de zone
- `apps/lab/src/settings.ts` — `HERO.friction`, l'île du nord, les zones, les ambiances
- `apps/lab/src/main.ts` — atlas neige/glace, zones, particules, source chaude
- `apps/lab/src/world/props.ts` — props enneigés, la source chaude
- `packages/hd2d/src/mood.ts`, `src/sky.ts`, `src/shaders.ts` — canaux `aurora` et `fogPulse`

**Créés**
- `apps/lab/src/world/zones.ts` — les zones et la zone courante (pur, testable)
- `apps/lab/src/world/thin-ice.ts` — l'état de la glace fine (pur, testable)
- `apps/lab/src/world/snow-npc.ts` — l'habitant de la banquise
- `apps/lab/test/zones.test.ts`, `test/thin-ice.test.ts`, `test/hero-friction.test.ts`
- `apps/lab/public/tex/tileset-neige.png`, `tileset-glace.png`, `sapin-neige.png`, `stalagmite.png`, `habitant.png`
- `apps/lab/public/sfx/pas-neige-*.ogg`, `pas-glace-*.ogg`, `glisse.ogg`, `craquement.ogg`, `rupture.ogg`, `plouf-glace.ogg`, `rafale.ogg`, `amb-polaire.ogg`
- `apps/lab/public/music/neige.ogg`
- `apps/lab/public/voice/habitant-*.ogg`

---

### Task 1: L'île du nord existe, avec des surfaces provisoires

**Files:**
- Modify: `apps/lab/src/world/terrain-query.ts`, `apps/lab/src/world/island.ts`, `apps/lab/src/settings.ts`, `apps/lab/src/main.ts`
- Test: `apps/lab/test/island.test.ts`

**Interfaces:**
- Produces: `type TerrainMaterial = "sable" | "herbe" | "neige" | "glace" | "glace-fine"`
- Produces: l'île du nord dans `ILES`, et `materialAt` qui rend `"neige"`/`"glace"`/`"glace-fine"` sur son emprise

**Pourquoi les surfaces sont provisoires :** on prouve le chemin de code — cinq matières, quatre îles, deux atlas de plus — **avant** de parier sur ce que le modèle sait générer. Si la Task 2 échoue, cette task tient quand même debout.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
// dans apps/lab/test/island.test.ts, à la suite de l'existant
describe("l'île du nord", () => {
  const { field, query } = generateIsland({ size: WORLD.size, seed: WORLD.seed });

  it("existe, gelée, et n'est pas accessible à pied depuis la grande", () => {
    // Son centre porte de la terre...
    expect(field.levelAt(toCell(NORD.x), toCell(NORD.z))).not.toBeNull();
    // ...et de la neige ou de la glace, jamais de l'herbe.
    expect(["neige", "glace", "glace-fine"]).toContain(query.kindAt(NORD.x, NORD.z));
    // Le couloir entre les deux îles est de l'eau sur toute sa longueur ET sur toute sa largeur :
    // on n'y va qu'à la nage, et un pont d'une seule case en biais suffirait à tout casser.
    //
    // Les bornes se DÉRIVENT des données. Codées en dur, elles redeviennent fausses au premier
    // ajustement de géométrie — et une boucle dont les bornes se croisent ne tourne pas du tout
    // sans que rien ne le signale. C'est arrivé : la première version de ce test s'exécutait
    // exactement une fois, et prétendait parcourir tout le couloir.
    //
    // **Prouve-le par sabotage** : pose une case de terre au milieu du couloir, vérifie que ce
    // test rougit, puis retire-la. Un test de géométrie qu'on n'a jamais vu échouer ne prouve rien.
    const zSud = NORD.z + NORD.r; // bord nord de l'île gelée
    const zNord = -(ILES[0]?.r ?? 16); // bord sud du couloir, au nord de la grande île
    expect(zSud).toBeLessThan(zNord); // la boucle a bien un intérieur
    for (let z = zSud; z <= zNord; z += 0.5) {
      for (let x = -12; x <= 12; x += 0.5) {
        expect(field.levelAt(toCell(x), toCell(z))).toBeNull();
      }
    }
  });

  it("porte les trois matières froides, et aucune matière chaude", () => {
    const vues = new Set<string>();
    for (let dz = -NORD.r; dz <= NORD.r; dz += 0.5)
      for (let dx = -NORD.r; dx <= NORD.r; dx += 0.5) {
        const k = query.kindAt(NORD.x + dx, NORD.z + dz);
        if (k) vues.add(k);
      }
    expect(vues).toContain("neige");
    expect(vues).toContain("glace");
    expect(vues).toContain("glace-fine");
    expect(vues).not.toContain("herbe");
    expect(vues).not.toContain("sable");
  });

  it("laisse les trois autres îles inchangées", () => {
    // La grande reste de l'herbe : ajouter un biome ne doit rien reteindre ailleurs.
    expect(query.kindAt(0, 0)).toBe("herbe");
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run --project lab test/island.test.ts`
Expected: FAIL — `NORD` n'existe pas, `kindAt` ne rend que `sable`/`herbe`.

- [ ] **Step 3: Élargir `TerrainMaterial`**

Dans `apps/lab/src/world/terrain-query.ts`, la seule ligne à changer :

```ts
export type TerrainMaterial = "sable" | "herbe" | "neige" | "glace" | "glace-fine";
```

Vérifier ce que le compilateur signale ensuite : `props.ts` compare à `"sable"`, `hero.ts:167` réduit à `"sable" | "herbe"` pour le son. Les deux sont traités en Task 6 ; ici, les faire compiler sans changer leur comportement.

- [ ] **Step 4: Ajouter l'île du nord**

Dans `settings.ts`, exporter sa description pour que le test puisse la lire :

```ts
/** L'île gelée. Au nord, hors de portée à pied : le couloir qui l'en sépare est de l'eau, et
 *  c'est voulu — on arrive sur la banquise essoufflé, et la musique change à ce moment-là. */
export const NORD = { x: 0, z: -26, r: 7.5 } as const;
```

Dans `island.ts`, une quatrième entrée dans `ILES` à ces coordonnées, avec une `onde` qui lui donne une silhouette propre et un ou deux `reliefs` — un monticule de glace vaut une falaise d'herbe pour le saut.

Puis la matière : dans la boucle qui remplit `kinds`, une case qui tombe dans l'emprise du nord reçoit `"glace"` près du centre (un lac gelé), `"glace-fine"` sur une couronne étroite autour de ce lac, et `"neige"` partout ailleurs. La glace fine **au bord du lac** et non au milieu : on doit pouvoir la voir venir, pas tomber dedans par surprise en traversant.

- [ ] **Step 5: Déclarer les deux atlas provisoires**

Dans `main.ts`, deux entrées de plus dans `atlases` — pour l'instant, elles **réutilisent les textures existantes** :

```ts
  // Provisoire (Task 1) : la géométrie et le chemin de code se prouvent avant que la Task 2 ne
  // parie sur ce que le modèle sait générer. Ces deux entrées basculeront sur `tileset-neige.png`
  // et `tileset-glace.png` sans qu'une ligne d'ici ne change.
  neige: { texture: textures.get("/tex/tileset-lvl0.png"), cols: 9, rows: 6, block: "water-edge", wallRow: 4, tilePx: 64 },
  glace: { texture: textures.get("/tex/tileset-lvl1.png"), cols: 9, rows: 6, block: "cliff-edge", wallRow: 4, tilePx: 64 },
```

`"glace-fine"` se dessine avec l'atlas `glace` — c'est une matière de **règle**, pas d'apparence, jusqu'à ce que la Task 7 lui donne son propre visuel de craquelure.

- [ ] **Step 6: Vérifier**

Run: `npx vitest run --project lab && npm run typecheck:lab && npm run lint`
Expected: PASS

Puis à l'écran (`npm run lab`, skill `playwright-cli`) : nager vers le nord depuis le spawn, arriver sur une île dont le sol est visiblement distinct. Elle sera moche — deux tilesets d'herbe détournés — et c'est attendu.

- [ ] **Step 7: Commit**

```bash
git add apps/lab
git commit -m "feat(lab): l'île du nord, cinq matières de terrain, surfaces provisoires"
```

---

### Task 2: Les surfaces de tileset générées

**Files:**
- Create: `apps/lab/public/tex/tileset-neige.png`, `apps/lab/public/tex/tileset-glace.png`
- Modify: `apps/lab/src/settings.ts` (catalogue), `apps/lab/src/main.ts` (atlas)

**C'est la task à risque du chantier.** Le spec prévoit un repli explicite, et il se décide **sur capture**.

- [ ] **Step 1: Générer**

Depuis `~/git/pixel-art-model`. La consigne à tenir : on veut la **surface**, pas la structure — le modèle ne doit pas essayer de dessiner une grille.

```bash
cd ~/git/pixel-art-model
python3 studio.py sprite --prompt "seamless snow ground texture, soft powder snow, pixel art game terrain, flat top-down" --out ~/git/lindocara/apps/lab/public/tex/_neige-brut.png
python3 studio.py sprite --prompt "seamless frozen lake ice texture, pale blue ice with fine cracks, pixel art game terrain, flat top-down" --out ~/git/lindocara/apps/lab/public/tex/_glace-brut.png
```

Générer **plusieurs variantes** (`--variants 4`) et choisir à l'œil : c'est moins cher qu'un aller-retour.

- [ ] **Step 2: Reporter la surface sur la géométrie**

La planche générée n'a pas la découpe du tileset. Écrire un petit script de composition (Python + PIL, dans `apps/lab/scripts/`) qui prend le tileset Tiny Swords existant **comme masque de structure** — bordures, parois, découpe 4×4 — et y substitue les surfaces générées, en gardant de l'original son **alpha** et la **forme** de ses liserés.

**Sa forme, pas sa couleur.** Les liserés conservés tels quels sortent verts — c'est de l'herbe — et ils enveloppent *chaque arête exposée*, donc le littoral entier de l'île. Un liseré vert autour d'une île de neige est plus dur à défendre qu'une falaise de roche brune ici ou là. Les pièces d'angle des lignes de paroi sont dans le même cas : ce sont des sprites de buisson. **Teinte-les vers le blanc-bleuté** — une transformation colorimétrique sur les pixels existants, jamais une substitution de remplissage : c'est le liseré qui fait tenir les raccords, et le redessiner les casserait.

**C'est la moitié du travail de cette task.** Les raccords viennent de la géométrie d'origine et restent donc exacts ; seul le remplissage change.

- [ ] **Step 3: Brancher et regarder**

Ajouter les deux URL au catalogue de `settings.ts` avec `atlas: true` — **impératif** : un tileset avec mipmaps mélange ses tuiles voisines et fait baver les bordures (voir `docs/hd2d-rendering.md`). Puis pointer les deux entrées `atlases` de `main.ts` dessus.

- [ ] **Step 4: La revue humaine, et la décision de repli**

Capturer l'île du nord de jour **et** de nuit, à la distance de caméra par défaut et dézoomé.

Juger trois choses :
1. **la neige se lit-elle comme de la neige** à 64 px la case, avec le tilt-shift qui floute l'arrière-plan ?
2. **les raccords tiennent-ils** — pas de damier, pas de couture visible entre deux cases ?
3. **la glace se distingue-t-elle de la neige** d'un coup d'œil ? Si le joueur ne voit pas où il va glisser, la mécanique ne vaut rien.

**Si la réponse est non à l'une des trois : basculer sur le repli.** Une re-teinte procédurale du tileset existant vers un blanc-bleuté, écrite dans le même script de composition. Le repli est une décision prévue, pas un échec — le noter dans le rapport avec la capture qui l'a motivé.

- [ ] **Step 5: Commit**

```bash
git add apps/lab
git commit -m "feat(lab): surfaces de tileset neige et glace"
```

---

### Task 3: Le modèle de déplacement à friction

**Files:**
- Modify: `apps/lab/src/world/hero.ts`, `apps/lab/src/settings.ts`
- Create: `apps/lab/test/hero-friction.test.ts`

**Interfaces:**
- Produces: `frictionPour(m: TerrainMaterial | null): number` et `vitesseMaxPour(m: TerrainMaterial | null): number`, exportées de `settings.ts` ou d'un module dédié — **pures et testables**
- Produces: `pasAmorti(v: number, entree: number, accel: number, friction: number, dt: number): number` — un axe, un pas de temps

C'est la task la plus lourde de conséquence : ces règles remontent dans `engine` en S2 pour devenir autoritatives.

Aujourd'hui (`hero.ts:291-299`) :

```ts
const pas = HERO.speed * (swimming ? HERO.swim.speed : 1) * dt;
const nx = pos.x + input.x * pas;
```

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
// apps/lab/test/hero-friction.test.ts
import { describe, expect, it } from "vitest";
import { HERO } from "../src/settings.js";
import { frictionPour, pasAmorti, vitesseMaxPour } from "../src/world/locomotion.js";

/** Rejoue N pas de temps à entrée constante et rend la vitesse atteinte. */
function apres(secondes: number, friction: number, accel: number, dt = 1 / 60): number {
  let v = 0;
  for (let t = 0; t < secondes; t += dt) v = pasAmorti(v, 1, accel, friction, dt);
  return v;
}

describe("le modèle à friction", () => {
  it("atteint exactement la vitesse du héros en régime établi, sur l'herbe", () => {
    // La vitesse d'équilibre vaut accel / friction : c'est ce qui permet de garder HERO.speed
    // comme LA vitesse de référence au lieu d'un nombre qui ne veut plus rien dire.
    const f = frictionPour("herbe");
    const v = apres(2, f, HERO.speed * f);
    expect(v).toBeCloseTo(HERO.speed, 3);
  });

  it("sur l'herbe, atteint sa vitesse en deux images et s'arrête en deux images", () => {
    // C'est la définition opérationnelle d'« indiscernable de l'ancien modèle » : le joueur ne
    // peut pas percevoir deux images. Une égalité stricte est impossible — un amorti exponentiel
    // n'atteint sa cible qu'asymptotiquement — donc on pin le TEMPS, pas la trajectoire.
    const f = frictionPour("herbe");
    const accel = HERO.speed * f;
    expect(apres(2 / 60, f, accel)).toBeGreaterThan(HERO.speed * 0.9);
    // Puis relâché : la vitesse retombe sous 10 % en deux images.
    let v = HERO.speed;
    for (let i = 0; i < 2; i++) v = pasAmorti(v, 0, accel, f, 1 / 60);
    expect(v).toBeLessThan(HERO.speed * 0.1);
  });

  it("sur la glace, garde son élan bien après le relâchement", () => {
    const f = frictionPour("glace");
    let v = HERO.speed;
    for (let i = 0; i < 60; i++) v = pasAmorti(v, 0, HERO.speed * f, f, 1 / 60);
    // Une seconde plus tard, il glisse encore à plus de la moitié de sa vitesse.
    expect(v).toBeGreaterThan(HERO.speed * 0.5);
  });

  it("sur la neige, plafonne plus bas que sur l'herbe", () => {
    expect(vitesseMaxPour("neige")).toBeLessThan(vitesseMaxPour("herbe"));
    expect(frictionPour("neige")).toBeGreaterThan(frictionPour("herbe"));
  });

  it("ordonne les trois frictions dans le sens qui fait le jeu", () => {
    expect(frictionPour("glace")).toBeLessThan(frictionPour("herbe"));
    expect(frictionPour("herbe")).toBeLessThan(frictionPour("neige"));
  });

  it("ne rend jamais une vitesse infinie ni NaN, même à dt aberrant", () => {
    // La boucle plafonne dt à 0.05, mais un module qui partira dans `engine` doit tenir un dt
    // que le serveur pourrait lui passer.
    for (const dt of [0, 1e-6, 0.05, 1, 10]) {
      const v = pasAmorti(3, 1, 100, 8, dt);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run --project lab test/hero-friction.test.ts`
Expected: FAIL — `../src/world/locomotion.js` n'existe pas.

- [ ] **Step 3: Écrire `locomotion.ts`**

```ts
// apps/lab/src/world/locomotion.ts
import type { TerrainMaterial } from "./terrain-query.js";

/**
 * Un seul modèle de déplacement, trois frictions.
 *
 * L'ancien modèle posait `vitesse = entrée · HERO.speed` : instantané dans les deux sens, donc
 * incapable de glisser. Plutôt que d'ajouter un cas particulier « glace » à côté, l'entrée
 * ACCÉLÈRE et la matière FREINE — la glace et la neige profonde sortent alors de la même équation,
 * et l'herbe se règle pour rester indiscernable de l'ancien comportement.
 *
 * La vitesse d'équilibre vaut `accel / friction` : c'est ce qui permet de garder `HERO.speed`
 * comme vitesse de référence au lieu d'un nombre qui ne voudrait plus rien dire.
 *
 * ⚠ Ces règles remontent dans `@lindocara/engine` en S2 pour devenir autoritatives côté serveur et
 * partagées avec la prédiction réseau. Tout ce qui est ici doit rester PUR et déterministe au bit
 * près : pas de `Math.random`, pas d'horloge, pas de `three`.
 */
export function pasAmorti(
  v: number,
  entree: number,
  accel: number,
  friction: number,
  dt: number,
): number {
  // L'intégrateur EXACT de `dv/dt = friction · (cible − v)`, et pas une approximation.
  //
  // La forme naïve — `(v + entree · accel · dt) · exp(−friction · dt)` — a l'air d'un amorti
  // exponentiel mais son point fixe vaut `accel·dt·k / (1 − k)` avec `k = exp(−friction·dt)`, qui
  // ne tend vers `accel / friction` qu'à la limite `dt → 0`. Mesuré : à 60 images par seconde et
  // friction 80, elle plafonne à 2,0 au lieu de 4,2 — **52 % d'erreur**, qu'aucun réglage de
  // friction ne rattrape.
  //
  // La forme ci-dessous a le bon point fixe à N'IMPORTE QUEL `dt`, et compose : deux pas de `dt1`
  // puis `dt2` donnent exactement un pas de `dt1 + dt2`. C'est cette propriété-là — pas l'élégance
  // — qui compte, parce que le serveur et la prédiction n'intègrent pas au même rythme, et que ce
  // module remonte dans `engine` en S2.
  if (friction <= 0) return v + entree * accel * dt;
  const cible = (entree * accel) / friction;
  return cible + (v - cible) * Math.exp(-friction * dt);
}

/** `null` = hors carte ou dans l'eau : on y nage, la friction du sol ne s'applique pas, mais la
 *  fonction doit rendre quelque chose de fini plutôt que d'obliger chaque appelant à tester. */
export function frictionPour(m: TerrainMaterial | null): number {
  return HERO.friction[m ?? "herbe"] ?? HERO.friction.herbe;
}

export function vitesseMaxPour(m: TerrainMaterial | null): number {
  return HERO.speed * (HERO.vitesseSol[m ?? "herbe"] ?? 1);
}
```

Les tables vont dans `HERO` (`settings.ts`), pas en dur ici : ce sont des réglages de contenu, et le
labo est fait pour qu'on les triture. Deux contraintes que les tests pinnent :

- **l'ordre** `glace ≪ herbe < neige` sur la friction ;
- **l'accélération se dérive de la friction** — `accel = HERO.speed * friction` — pour que la vitesse
  d'équilibre (`accel / friction`) reste exactement `HERO.speed` quelle que soit la matière. Sans ça,
  `HERO.speed` cesse de vouloir dire la vitesse du héros et devient un nombre parmi d'autres.
  `vitesseSol` est le multiplicateur qui, par-dessus, fait peiner dans la neige.

- [ ] **Step 4: Brancher dans `hero.ts`**

Remplacer le bloc `const pas = …` par : deux composantes de vitesse persistantes (`vx`, `vz`), lues et écrites à chaque image, avec la matière sous les pieds qui choisit friction et plafond. **Garder intact** tout le reste de `canEnter` — le test par axe, la règle du chevauchement, le disque : rien de la collision ne change, seul ce qui produit le déplacement change.

Un point à ne pas rater : **la vitesse se remet à zéro aux transitions d'état** (entrée dans l'eau, entrée dans une pièce, réapparition après noyade), exactement comme la file de commandes se vide aux transitions de vie côté serveur. Sans ça, on entre dans l'eau en gardant son élan de glace.

- [ ] **Step 5: Vérifier**

Run: `npx vitest run --project lab && npm run typecheck:lab && npm run lint`

Puis à l'écran : sur l'herbe, le déplacement doit être **impossible à distinguer** d'avant — c'est le critère. Sur la glace, on glisse, on dérape en tournant, on ne s'arrête pas net. Dans la neige, on peine.

- [ ] **Step 6: Commit**

```bash
git add apps/lab
git commit -m "feat(lab): un seul modèle de déplacement, trois frictions"
```

---

### Task 4: Les zones

**Files:**
- Create: `apps/lab/src/world/zones.ts`, `apps/lab/test/zones.test.ts`
- Modify: `apps/lab/src/settings.ts`, `apps/lab/src/main.ts`

**Interfaces:**
- Produces: `interface Zone { nom: string; centre: readonly [number, number]; rayon: number; musique: string | null; nappe: string; souffle: number }`
- Produces: `zoneAt(zones: readonly Zone[], x: number, z: number): Zone` — rend toujours une zone, la zone par défaut si aucune ne contient le point

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
// apps/lab/test/zones.test.ts
import { describe, expect, it } from "vitest";
import { type Zone, zoneAt } from "../src/world/zones.js";

const DEFAUT: Zone = { nom: "large", centre: [0, 0], rayon: Infinity, musique: null, nappe: "jour", souffle: 1 };
const POLAIRE: Zone = { nom: "polaire", centre: [0, -26], rayon: 12, musique: "neige", nappe: "polaire", souffle: 2 };
const zones = [POLAIRE, DEFAUT] as const;

describe("zoneAt", () => {
  it("rend la zone qui contient le point", () => {
    expect(zoneAt(zones, 0, -26).nom).toBe("polaire");
    expect(zoneAt(zones, 0, 0).nom).toBe("large");
  });

  it("rend toujours une zone, jamais null", () => {
    // Un appelant qui doit tester la nullité à chaque image finit par oublier une fois.
    expect(zoneAt(zones, 999, 999).nom).toBe("large");
  });

  it("prend la PREMIÈRE zone qui contient le point, pour que l'ordre soit la priorité", () => {
    const large: Zone = { ...POLAIRE, nom: "englobante", rayon: 100 };
    expect(zoneAt([POLAIRE, large, DEFAUT], 0, -26).nom).toBe("polaire");
    expect(zoneAt([large, POLAIRE, DEFAUT], 0, -26).nom).toBe("englobante");
  });

  it("inclut le bord : à rayon exact on est dedans", () => {
    expect(zoneAt(zones, 0, -26 + 12).nom).toBe("polaire");
  });

  it("porte le taux de souffle, qui n'est pas qu'une affaire de musique", () => {
    expect(zoneAt(zones, 0, -26).souffle).toBe(2);
    expect(zoneAt(zones, 0, 0).souffle).toBe(1);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run --project lab test/zones.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Écrire `zones.ts`**

Pur, sans `three`, sans DOM. `zoneAt` parcourt la liste et rend la première dont le point est à portée — l'ordre **est** la priorité, ce qui évite d'inventer un champ de priorité.

- [ ] **Step 4: Déclarer les zones et brancher**

Dans `settings.ts`, deux zones : la polaire autour de `NORD`, et celle par défaut (rayon infini, en dernier). Dans `main.ts`, à chaque image : `zoneAt` sur la position du héros, et **au changement seulement**, `setAmbience(zone.nappe)` et la musique de zone. Comparer par identité de zone, pas par nom : un fondu relancé à chaque image ne monte jamais.

Le `souffle` va au héros — Task 7 s'en sert.

- [ ] **Step 5: Vérifier**

Run: `npx vitest run --project lab && npm run typecheck:lab && npm run lint`

À l'écran : nager vers le nord, et entendre la nappe changer à l'entrée de la zone. Repartir vers le sud : elle revient.

- [ ] **Step 6: Commit**

```bash
git add apps/lab
git commit -m "feat(lab): les zones portent nappe, musique et souffle"
```

---

### Task 5: La musique de la zone

**Files:**
- Create: `apps/lab/public/music/neige.ogg`
- Modify: `apps/lab/src/core/audio.ts`, `apps/lab/src/settings.ts`, `apps/lab/src/main.ts`

`MUSIQUE` (`audio.ts:67`) est un objet **vide** qui attend des pistes, et toute la mécanique existe déjà : entrée à 10 s, fondu de 6 s, pause de 30 s, fondu croisé de 2,5 s. Cette task lui donne sa première piste et la fait obéir à la zone plutôt qu'à l'heure.

- [ ] **Step 1: Générer**

```bash
cd ~/git/pixel-art-model
python3 studio.py music --prompt "sparse frozen wilderness, distant wind, slow icy bells, lonely and cold" --duration 60 --out ~/git/lindocara/apps/lab/public/music/_neige.wav
```

- [ ] **Step 2: Écouter, et juger**

Trois critères : **elle boucle sans couture audible** ? elle **tient sous le vent** de la nappe polaire sans se battre avec ? elle **ne fatigue pas** au troisième passage ? Générer plusieurs variantes et choisir.

Ré-encoder en Opus, comme les nappes du PoC — elles pesaient 10,8 Mo avant.

- [ ] **Step 3: Brancher**

Déclarer la piste dans `MUSIQUE`. Puis faire piloter le choix par la **zone** et non par l'heure : la zone porte son nom de piste, `null` signifiant silence. Garder intacte la règle du PoC — **une seule piste à la fois**, changement en fondu croisé : deux pistes en phase finiraient par se superposer.

- [ ] **Step 4: Vérifier à l'écran**

Nager vers le nord : la musique **entre en fondu à l'arrivée**, pas avant. Repartir : elle sort. `M` la coupe toujours.

- [ ] **Step 5: Commit**

```bash
git add apps/lab
git commit -m "feat(lab): le thème de la zone polaire, déclenché à l'arrivée"
```

---

### Task 6: Les sons du sol

**Files:**
- Create: `apps/lab/public/sfx/pas-neige-{1,2,3}.ogg`, `pas-glace-{1,2,3}.ogg`, `glisse.ogg`, `amb-polaire.ogg`
- Modify: `apps/lab/src/core/audio.ts`, `apps/lab/src/world/hero.ts`, `apps/lab/src/settings.ts`

`step()` (`audio.ts:324`) ne connaît que `"herbe" | "sable"`. Elle doit connaître les cinq matières — et la **glisse n'est pas un pas** : c'est un son continu tant qu'on dérape, pas un déclenchement cadencé à la distance.

- [ ] **Step 1: Générer**

```bash
cd ~/git/pixel-art-model
python3 studio.py sfx --prompt "a single footstep crunching in deep fresh snow" --duration 1 --variants 3 --out ~/git/lindocara/apps/lab/public/sfx/_pas-neige.wav
python3 studio.py sfx --prompt "a single footstep on hard frozen ice, sharp and brittle" --duration 1 --variants 3 --out ~/git/lindocara/apps/lab/public/sfx/_pas-glace.wav
python3 studio.py sfx --prompt "continuous smooth sliding on ice, sustained scraping hiss" --duration 4 --out ~/git/lindocara/apps/lab/public/sfx/_glisse.wav
python3 studio.py sfx --prompt "bleak polar wind over an empty frozen plain, continuous ambience" --duration 20 --out ~/git/lindocara/apps/lab/public/sfx/_amb-polaire.wav
python3 studio.py sfx --prompt "a sudden gust of blizzard wind, rising and falling" --duration 4 --out ~/git/lindocara/apps/lab/public/sfx/_rafale.wav
```

La rafale sert à la Task 9 : le pulse de brouillard se **voit**, et sans son il se lit comme un bug
d'affichage plutôt que comme du vent. La générer ici, avec les autres sons du lieu, évite un
aller-retour au studio pour un seul fichier.

- [ ] **Step 2: Écouter, tailler, ré-encoder**

Le PoC a payé ce prix : ses bêlements arrivaient tous avec une longue queue de réverbe et des attaques décalées, et `sync-assets.sh` a dû les tailler un par un. **Attendre la même chose ici** — vérifier que les trois variantes de pas ont leur crête au même endroit, sinon un pas sur trois traînera.

La glisse doit **boucler proprement** : c'est un son tenu, pas un one-shot.

- [ ] **Step 3: Élargir `step()`**

```ts
export const step = (sol: TerrainMaterial = "herbe"): void => { /* … */ };
```

Chaque matière tire sa variante **et sa hauteur** au hasard, comme le reste du module — cinq échantillons en boucle s'entendent au bout de dix secondes.

- [ ] **Step 4: La glisse, en son tenu**

Une source bouclée, dont le **gain suit l'intensité du dérapage** : nul quand la vitesse est alignée avec l'entrée, maximal quand elle en diffère. Pas de `jouer()` — ce n'est pas un déclenchement.

Dans `hero.ts`, `solSous()` rend maintenant les cinq matières au lieu de réduire à deux.

- [ ] **Step 5: Vérifier à l'oreille et à l'écran**

Marcher sur l'herbe, le sable, la neige, la glace : quatre sons distincts. Prendre de l'élan sur la glace et tourner : la glisse monte. S'arrêter : elle descend.

- [ ] **Step 6: Commit**

```bash
git add apps/lab
git commit -m "feat(lab): pas de neige et de glace, et la glisse en son tenu"
```

---

### Task 7: La glace fine

**Files:**
- Create: `apps/lab/src/world/thin-ice.ts`, `apps/lab/test/thin-ice.test.ts`, `apps/lab/public/sfx/craquement.ogg`, `rupture.ogg`, `plouf-glace.ogg`
- Modify: `apps/lab/src/world/hero.ts`, `apps/lab/src/main.ts`

**Interfaces:**
- Produces: `type EtatGlace = "intacte" | "craquelee" | "rompue"`
- Produces: `createThinIce(opts: { seuilCraquement: number; seuilRupture: number; regel: number }): ThinIce` avec `charge(cle: string, dt: number): EtatGlace`, `relache(cle: string): void`, `update(dt: number): void`, `etat(cle: string): EtatGlace`, `taille(): number`
- `taille()` n'existe que pour que le test prouve la purge : sans elle, rien ne distingue une table qui se vide d'une table qui grossit sans borne au fil d'une session — le défaut exact qu'a eu le registre de billboards en S1.

**C'est la partie la plus invasive, et la première à couper** si le chantier dérape. Elle touche l'eau et le souffle.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
// apps/lab/test/thin-ice.test.ts
import { describe, expect, it } from "vitest";
import { createThinIce } from "../src/world/thin-ice.js";

const REGLAGES = { seuilCraquement: 0.4, seuilRupture: 1.2, regel: 5 } as const;

describe("la glace fine", () => {
  it("craque avant de rompre : on doit pouvoir partir à temps", () => {
    // Tout l'intérêt de la mécanique est là. Une glace qui rompt sans prévenir n'est pas un
    // danger, c'est un piège.
    const g = createThinIce(REGLAGES);
    expect(g.charge("3,4", 0.3)).toBe("intacte");
    expect(g.charge("3,4", 0.2)).toBe("craquelee");
    expect(g.charge("3,4", 0.8)).toBe("rompue");
  });

  it("oublie la charge quand on s'en va, mais garde la craquelure", () => {
    const g = createThinIce(REGLAGES);
    g.charge("3,4", 0.5);
    g.relache("3,4");
    g.update(0.5);
    // On est reparti à temps : elle reste craquelée, pas rompue.
    expect(g.etat("3,4")).toBe("craquelee");
  });

  it("regèle après le délai, pour qu'on puisse réessayer", () => {
    // Dans un labo, un trou définitif empêche de réessayer — et réessayer est tout ce qu'on y fait.
    const g = createThinIce(REGLAGES);
    g.charge("3,4", 1.5);
    expect(g.etat("3,4")).toBe("rompue");
    g.relache("3,4");
    g.update(REGLAGES.regel + 0.1);
    expect(g.etat("3,4")).toBe("intacte");
  });

  it("tient plusieurs cases indépendamment", () => {
    const g = createThinIce(REGLAGES);
    g.charge("1,1", 1.5);
    expect(g.etat("1,1")).toBe("rompue");
    expect(g.etat("2,2")).toBe("intacte");
  });

  it("ne garde pas d'entrée pour une case revenue intacte", () => {
    // Sinon la table grossit sans borne au fil d'une session — le même défaut que les registres
    // de billboards de S1.
    const g = createThinIce(REGLAGES);
    g.charge("1,1", 0.5);
    g.relache("1,1");
    g.update(REGLAGES.regel + 0.1);
    expect(g.taille()).toBe(0);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run --project lab test/thin-ice.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Écrire `thin-ice.ts`**

Pur, sans `three`. Une `Map` de cases chargées, purgée quand une case revient intacte — `taille()` existe pour que le test puisse le prouver.

- [ ] **Step 4: Générer les trois sons**

```bash
python3 studio.py sfx --prompt "thin ice cracking under weight, sharp splintering" --duration 2 --out …/craquement.wav
python3 studio.py sfx --prompt "ice sheet breaking apart and collapsing into water" --duration 2 --out …/rupture.wav
python3 studio.py sfx --prompt "a body falling through ice into freezing water" --duration 2 --out …/plouf-glace.wav
```

- [ ] **Step 5: Brancher dans le héros**

Sous les pieds, une case `"glace-fine"` se charge tant qu'on y reste. Au craquement, le son et un visuel de craquelure. À la rupture, on tombe à l'eau — et **le souffle de la zone s'applique** : l'eau polaire le consomme deux fois plus vite.

- [ ] **Step 6: Vérifier**

Run: `npx vitest run --project lab && npm run typecheck:lab && npm run lint`

À l'écran : rester sur la glace fine, entendre le craquement, partir à temps. Y rester : tomber, et voir la jauge de souffle descendre visiblement plus vite qu'au sud.

- [ ] **Step 7: Commit**

```bash
git add apps/lab
git commit -m "feat(lab): la glace fine craque, cède, et regèle"
```

---

### Task 8: Neige qui tombe, souffle visible, traces de pas

**Files:**
- Modify: `apps/lab/src/main.ts`, `apps/lab/src/world/hero.ts`, `apps/lab/src/settings.ts`

Trois effets de particules, tous sur `createParticleField`/`createPetalFall` qui existent. **Aucun ne doit tourner hors de la zone polaire** : des flocons au-dessus de l'île tropicale seraient absurdes, et c'est du GPU pour rien.

- [ ] **Step 1: Les chutes de neige**

Un champ de particules dérivant vers le bas, dense, sur l'emprise de la zone. Le réglage se fait à l'écran.

- [ ] **Step 2: Le souffle visible**

De petites bouffées blanches à hauteur de tête, **cadencées comme les pas** — la cadence de pas existe déjà (`hero.ts`, un pas tous les 1.2 unité) et donne un souffle qui s'accélère quand on court. C'est ce qui dit « il fait froid » mieux que tout le reste, pour très peu.

Il souffle aussi **à l'arrêt**, plus lentement : quelqu'un qui respire ne s'arrête pas de respirer.

- [ ] **Step 3: Les traces de pas**

Des décalques posés à plat (`makeFlatSprite`), qui s'effacent en quelques secondes. Un **lot recyclé en rond**, jamais d'allocation en cours de partie — le même motif que les ondes de nage.

- [ ] **Step 4: Vérifier**

À l'écran, et **au harnais** : `?bench=game` sur la zone polaire ne doit pas s'écrouler. Trois effets de particules d'un coup, c'est le premier endroit où ça peut coûter.

- [ ] **Step 5: Commit**

```bash
git add apps/lab
git commit -m "feat(lab): flocons, souffle du héros, traces dans la neige"
```

---

### Task 9: Blizzard et aurores — par extension de l'ambiance

**Files:**
- Modify: `packages/hd2d/src/mood.ts`, `packages/hd2d/src/sky.ts`, `packages/hd2d/src/shaders.ts`, `apps/lab/src/settings.ts`
- Test: `packages/hd2d/test/mood.test.ts`

**La contrainte de cette task est plus importante que son contenu :** `hd2d` ne doit à aucun moment apprendre qu'un biome de neige existe. Les deux effets sont des **canaux d'ambiance** de plus, comme `stars` en est déjà un — et le labo les allume par sa `MoodConfig`, sans que le package sache pourquoi.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
// dans packages/hd2d/test/mood.test.ts, à la suite de l'existant
it("interpole les nouveaux canaux comme les anciens", () => {
  // `aurora` et `fogPulse` ne sont pas des cas particuliers : ils traversent le même fondu que
  // `stars` ou `exposure`. Si l'un des deux ne se mélange pas, c'est qu'il a été câblé à côté.
  const mix = createMoodMixer({ day: base, night: { ...nuit, aurora: 1, fogPulse: 0.6 } }, "day", FADE);
  mix.goTo("night");
  mix.update(FADE / 2);
  expect(mix.value.aurora).toBeCloseTo(0.5, 2);
  expect(mix.value.fogPulse).toBeCloseTo(0.3, 2);
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `npx vitest run --project hd2d test/mood.test.ts`
Expected: FAIL — `aurora` n'existe pas sur `MoodConfig`.

- [ ] **Step 3: Ajouter les deux canaux**

`aurora: number` et `fogPulse: number` dans `MoodConfig` et `ResolvedMood`, mélangés comme les autres. Valeur **0 dans les deux ambiances existantes** — le jour et la nuit du labo ne changent pas d'un pixel.

- [ ] **Step 4: Les aurores dans le shader du ciel**

Dans `SkyShader`, un uniforme `uAurora`. À zéro, **le GLSL doit produire exactement l'image d'avant** — c'est la garantie que rien ne régresse ailleurs. Des rubans lents, en haut de la voûte.

Rappel du registre des pièges : à 38° de plongée et 22° de champ, **la voûte n'entre jamais dans le cadre**. Les aurores ne se verront donc qu'en redressant `CAMERA.pitch`… **sauf** par la couleur d'horizon qu'elle donne au brouillard. C'est ce chemin-là qui compte, et il faut le vérifier à l'écran avant de peaufiner des rubans que personne ne verra.

- [ ] **Step 5: Le pulse du brouillard**

`fogPulse` module la portée du brouillard par rafales lentes. Réutiliser la mécanique de bourrasque des props : **la phase se déduit de la position**, pour que la rafale traverse la zone au lieu de pulser partout à la fois.

- [ ] **Step 6: Vérifier**

Run: `npx vitest run && npm run typecheck && npm run lint`

À l'écran : les deux îles chaudes sont **strictement inchangées** — comparer une capture avant/après. Sur l'île du nord, la visibilité se resserre par rafales, et la nuit l'horizon prend la teinte de l'aurore.

- [ ] **Step 7: Commit**

```bash
git add packages/hd2d apps/lab
git commit -m "feat(hd2d): canaux d'ambiance aurora et fogPulse"
```

---

### Task 10: La source chaude

**Files:**
- Modify: `apps/lab/src/world/props.ts`, `apps/lab/src/main.ts`, `apps/lab/src/settings.ts`

Le pendant exact du feu de camp : une flaque de lumière chaude au milieu du blanc, avec de la vapeur. C'est le point de repos de la zone, et sa seule couleur.

- [ ] **Step 1: Porter la recette du feu**

`makeGlow` en deux couches **à poids égal** — donner le dessus à la petite lui rend son statut de tache principale et le « gros rond » revient. Une lumière ponctuelle qui **ne projette que la nuit** : six rendus de scène par source projetante, et l'ombre ne se lit pas en plein jour.

- [ ] **Step 2: La vapeur**

Un champ de particules montant, lent, teinté chaud. Il monte **plus vite quand il fait plus froid** dans la fiction, mais en pratique : un réglage, jugé à l'écran.

- [ ] **Step 3: L'appoint de lumière**

`applyFillFromPointLight` avec la position et la couleur de la source, comme pour le feu — sans quoi un héros dos à la source devient noir à deux pas d'elle.

- [ ] **Step 4: Vérifier**

De nuit, la source doit creuser un halo chaud dans le noir polaire, et le héros s'éclairer en s'en approchant, quelle que soit son orientation.

- [ ] **Step 5: Commit**

```bash
git add apps/lab
git commit -m "feat(lab): la source chaude, pendant du feu de camp"
```

---

### Task 11: Les props enneigés

**Files:**
- Create: `apps/lab/public/tex/sapin-neige.png`, `stalagmite.png`
- Modify: `apps/lab/src/world/props.ts`, `apps/lab/src/settings.ts`

- [ ] **Step 1: Générer**

```bash
cd ~/git/pixel-art-model
python3 studio.py sprite --prompt "a snow-covered pine tree, heavy white snow on dark green branches" --variants 4 --out ~/git/lindocara/apps/lab/public/tex/_sapin-neige.png
python3 studio.py sprite --prompt "a jagged ice stalagmite spike, pale blue translucent ice" --variants 4 --out ~/git/lindocara/apps/lab/public/tex/_stalagmite.png
```

- [ ] **Step 2: Juger et découper**

Trois critères : **la densité de pixels correspond-elle** au reste (un sprite dix fois plus détaillé que ses voisins se voit immédiatement) ? le fond est-il **proprement détouré** ? l'ombre peinte est-elle absente ou tolérable (l'`alphaTest` à 0.5 la supprime, mais une ombre trop marquée survit) ?

`scripts/sprite.py` (rapatrié dans `apps/lab/scripts/`) fait le détourage, le recadrage et la réduction de densité — c'est exactement son travail.

- [ ] **Step 3: Semer**

Dans `populate`, sur les cases de matière `neige` uniquement. **Collider au tronc**, pas au feuillage — la règle de tous les props. La stalagmite en porte un aussi.

- [ ] **Step 4: Vérifier**

À l'écran : les props enneigés ne poussent que sur l'île du nord, et leur densité de pixels se marie avec le reste.

- [ ] **Step 5: Commit**

```bash
git add apps/lab
git commit -m "feat(lab): sapins enneigés et stalagmites de glace"
```

---

### Task 12: L'habitant de la banquise

**Files:**
- Create: `apps/lab/src/world/snow-npc.ts`, `apps/lab/public/tex/habitant.png`, `apps/lab/public/voice/habitant-{1,2,3,4}.ogg`
- Modify: `apps/lab/src/main.ts`, `apps/lab/src/core/audio.ts`, `apps/lab/src/settings.ts`, `apps/lab/AGENTS.md`

La machinerie de Grota se réutilise **telle quelle** : c'est un second contenu dans un système qui en attend un.

- [ ] **Step 1: Le personnage**

L'ajouter à `characters.json` du studio — c'est ce qui lie un nom à un **look et une voix**, pour qu'il reste lui-même d'une voie à l'autre. Puis générer le sprite d'attente et les quatre répliques avec `--character`.

- [ ] **Step 2: Écrire les répliques**

Quatre, comme Grota. Elles doivent **dire quelque chose du lieu** — Grota parle de la nuit qui tombe pour de bon et de la traversée à la nage ; celui-ci parle du froid, de la glace qui ne tient pas partout, de ce qu'il fait là.

- [ ] **Step 3: Générer, écouter, ré-encoder**

Opus mono, comme les prises de Grota — 670 ko de MP3 y étaient tombés à 265.

**Le point qui compte :** `sayLine()` rend la **durée** de la prise, et le bandeau en déduit sa cadence de frappe. Une prise mal découpée donne un texte qui finit trop tôt ou trop tard. Vérifier réplique par réplique.

- [ ] **Step 4: Poser le PNJ**

Sur `createGrota` comme modèle : un collider, il se tourne vers qui l'approche, `F` ouvre le bandeau. **Le même bandeau** — pas un second système.

- [ ] **Step 5: Documenter**

Mettre à jour `apps/lab/AGENTS.md` : l'île du nord, les cinq matières, le modèle à friction (**avec sa conséquence pour S2**), les zones, et la provenance générée des assets.

- [ ] **Step 6: Vérifier**

Run: `npm run check`

À l'écran : nager au nord, trouver l'habitant, lui parler, le texte se cale sur sa voix.

- [ ] **Step 7: Mesurer une dernière fois**

`?bench=game` et `?bench=heavy`, de jour et de nuit, **sur la zone polaire** — flocons, souffle, traces, vapeur et source projetante y tournent tous ensemble. Comparer aux chiffres de S1 (game 2,11 ms de nuit) et **remonter tout écart notable** plutôt que de l'absorber.

- [ ] **Step 8: Commit**

```bash
git add apps/lab packages/hd2d
git commit -m "feat(lab): l'habitant de la banquise, doublé"
```

---

## Ce que ce plan ne fait pas

- Il ne touche ni `renderer`, ni `client`, ni `editor`, ni `server`, ni `apps/main`.
- Il ne remonte rien dans `@lindocara/engine` : le portage du modèle à friction appartient à S2. Mais `locomotion.ts` et `thin-ice.ts` sont écrits **purs et déterministes** pour que ce portage soit un déplacement de fichier.
- Il ne change pas les trois îles existantes. Une capture avant/après des îles chaudes est le contrôle de non-régression de la Task 9.
