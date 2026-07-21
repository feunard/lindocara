# Monorepo par packages fonctionnels — design

- **Date** : 2026-07-22
- **Statut** : proposé
- **Objectif** : découper le monolithe `src/` en packages npm-workspaces à frontières
  physiques, pour que (a) un agent puisse tester uniquement la couche où il travaille,
  (b) les frontières entre couches soient imposées par le build et non par la seule
  convention, (c) le graphe de dépendances soit explicite et acyclique.

## Contexte

Aujourd'hui tout vit sous un seul `package.json` et un `src/` unique découpé par
**runtime** via trois tsconfigs (`client` DOM / `worker` workerd / `node`), pas par
package. Ce découpage runtime est volontaire et documenté : `src/shared/` est compilé
**deux fois** parce qu'il doit être valide en navigateur *et* en workerd, et le
déploiement est **un seul artefact** (le plugin Vite/Cloudflare bundle client + Worker +
Durable Object, assemblé par `wrangler`).

Constats vérifiés qui rendent le split réaliste :

- `src/shared/` n'importe **rien** de `client`/`server` et n'utilise **aucun** global
  DOM/Workers. Il est réellement platform-free.
- `src/client/` n'importe jamais `src/server/`.
- `src/shared/` est référencé par chemins relatifs (`../shared`, `../../shared`…) sur
  **~380 sites** — conversion mécanique mais massive.
- `renderer.ts` (jeu qui tourne) et `map-editor-stage.ts` (stage WYSIWYG de l'éditeur)
  partagent une couche de dessin PixiJS commune (`catalog-element-render`, `tile-draw`,
  `terrain-visuals`, `stage-application`, les `*-art`, `autotile` helper).
- Le seul lien `renderer → net` est **type-only** (`import type SceneSample`), donc
  effacé au build : pas de cycle runtime. `net`/`input`/`sound` n'importent jamais le
  renderer ; c'est `session.ts` qui construit le renderer et le nourrit.

## Ce que le split change, et ce qu'il ne change pas

| Objectif visé | Résultat |
| --- | --- |
| Tests ciblés rapides | **Livré.** Chaque package a sa config de test ; un agent lance `npm run test -w @lindocara/<pkg>`. |
| Frontières strictes | **Livré.** Packages + `tsconfig references` = barrière physique. `engine` gagne un tsconfig *pur* (ni DOM ni Workers) qui attrape un couplage plateforme accidentel que le double-check actuel peut laisser passer. |
| Vrai monorepo packages | **Livré.** npm workspaces natifs, pas de nouvel outil (turbo/pnpm). |
| Builds/deploys séparés | **Se transforme.** Cloudflare = un seul Worker qui sert les assets client. On sépare le *build graph* (bundle client et bundle Worker indépendants), mais l'assemblage final reste **un** `wrangler deploy`. « Déployer le client sans le server » n'a pas de sens : le server *est* ce qui sert le client. |

## Le graphe de dépendances cible (5 packages, acyclique)

```
                    engine        (pur, ni DOM ni Workers)
                   ↙   │   ↘
             server    │    renderer
                       │    ↙    ↘
                       │  editor  │
                       │    ↘     ↓
                       └──►  client  ◄──┘
```

- `engine` ← personne
- `server` ← `engine`
- `renderer` ← `engine`
- `editor` ← `engine`, `renderer`
- `client` ← `engine`, `renderer`, `editor`

**Décision de structure** (prise) : pas de package `render-core` séparé. La couche de
dessin partagée vit dans **`renderer`**, et **`editor` dépend de `renderer`** pour la
réutiliser. Un package de moins ; l'inconvénient (l'éditeur tire le package renderer
entier) est neutralisé par le tree-shaking du bundler.

**Invariant anti-cycle** (règle qui décide l'affectation des feuilles ambiguës) : *si le
renderer importe un module à runtime, ce module est `renderer` ou `engine`, jamais
`client`.* C'est pourquoi `display-settings`, `server-clock`, `world-layout` descendent
côté renderer même s'ils ressemblent à de la config/glue.

## Contenu de chaque package

### `@lindocara/engine`
Depuis `src/shared/` **intégralement**. Règles pures et contrats partagés : `simulation`,
`game`, `protocol`, `prediction`, `death`, `skills`, `combat-actions`, `cooperation`,
`resources`, `zones`, `tileset`, `autotile` (tables), `tile-layer-codec`, `tile-brush`,
`map-data`, `map-migrate`, `i18n/`, `tilesets/`.

- tsconfig **pur** : `lib: ["ES2022"]`, aucun `types` DOM ni Workers. Vérifié une seule
  fois (suffisant : sans global DOM/Workers, valide dans les deux mondes).
- Tests : projet vitest **node** (logique pure), pas de workerd.

### `@lindocara/server`
Depuis `src/server/` intégralement (Worker, Durable Object, `world/` systems, `db/`).
Détient `wrangler.jsonc`, les bindings, l'accès D1.

- Dépend de `engine`.
- Tests : projet vitest **cloudflare-pool** contre le vrai Durable Object (le harness
  workerd/D1 actuel). Point le plus délicat de la migration (voir *Risques*).

### `@lindocara/renderer`
La moitié « dessin » de `src/client/game/`. Runtime PixiJS + art + arithmétique de rendu :
`renderer`, `world-view`, `world-layout`, `minimap`, `minimap-surface`, `map-render-cache`,
`map-preview`, `terrain-visuals`, `interiors`, `catalog-element-render`, `tile-draw`,
`stage-application`, `feedback`, `combat-motion`, `combat-visual-state`, `display-settings`,
`server-clock`, `autotile` (helper d'offset), et tous les `*-art`
(`character-art`, `enemy-art`, `combat-art`, `portrait-art`, `tiny-swords-art`,
`tiny-swords-assets`, `editor-asset-art`).

- Dépend de `engine`.
- Tests : projet vitest (jsdom si besoin DOM, sinon node).

### `@lindocara/editor`
Depuis `src/client/ui/editor/` + les modules d'édition de `src/client/game/` :
`map-editor-stage`, `editor-state`, `event-command-tree`.

- Dépend de `engine`, `renderer`.
- Tests : projet vitest jsdom (React).

### `@lindocara/client`
La coquille appli + la glue jeu. Depuis `src/client/` : `main.tsx`, `App`, `store`, `api`,
`i18n`, `lib/`, `styles/`, `ui/components/`, `ui/hud/`, `ui/tiny-swords/`, plus la glue de
`src/client/game/` : `net`, `input`, `input-settings`, `sound`, `audio-settings`,
`combat-sounds`, `cooldown-sync`, `session`, `party`.

- Dépend de `engine`, `renderer`, `editor`.
- Détient l'entrée Vite et produit le bundle d'assets servi par le Worker.
- Tests : projet vitest jsdom (React).

> L'affectation exacte des feuilles de `src/client/game/` est finalisée pendant le plan en
> suivant le graphe d'import réel et l'invariant anti-cycle ci-dessus, pas à la main.

## Refactors mécaniques connus (à faire dans la migration)

1. **Couper l'arête `renderer → net`** : déplacer le type `SceneSample` de `net.ts` vers
   `renderer` (il est déjà importé en `import type`, donc l'usage runtime est nul).
2. **Dédupliquer `autotile`** : les tables `edge16`/`run4` vont dans `engine`
   (`shared/autotile.ts` actuel) ; le helper d'offset (`game/autotile.ts`) reste dans
   `renderer` et importe les tables depuis `engine`. Un seul jeu de tables.
3. **Réécrire ~380 imports** `../shared`, `../../shared`, `../../../shared` (et
   `.../shared/i18n`, `.../shared/tilesets`, `.../shared/zones`) → `@lindocara/engine`.
   Codemod scripté, pas à la main.

## Layout & câblage

```
package.json                 ← workspace root : workspaces[], scripts agrégés, biome, devDeps partagées
tsconfig.base.json           ← options compilo communes (l'actuel tsconfig.json)
packages/
  engine/    package.json · tsconfig.json (pur) · src/ · test/
  server/    package.json · tsconfig.json · wrangler.jsonc · src/ · test/
  renderer/  package.json · tsconfig.json · src/ · test/
  editor/    package.json · tsconfig.json · src/ · test/
  client/    package.json · tsconfig.json · vite.config.ts · index.html · src/ · test/
migrations/  docs/  scripts/  assets/  public/   ← restent à la racine
```

À recâbler pendant la migration :

- **npm workspaces** : `"workspaces": ["packages/*"]` à la racine ; dépendances
  inter-packages en `"@lindocara/engine": "*"`.
- **tsconfig references** : chaque package référence ses dépendances ; `npm run typecheck`
  devient `tsc -b` sur le graphe (remplace les trois programmes actuels, dont la raison
  d'être — séparer DOM/Workers — est désormais portée par les frontières de packages :
  `engine` pur, `server` Workers, `renderer`/`editor`/`client` DOM).
- **Vite** (`packages/client`) : entrée `main.tsx`, alias `@` → `packages/client/src`,
  plugin Cloudflare qui pointe vers l'entrée Worker de `packages/server`.
- **wrangler.jsonc** (`packages/server`) : chemins `main` / assets recalculés ; l'assemblage
  reste un `wrangler deploy` unique.
- **drizzle.config.ts** : `schema` → `packages/server/src/db/schema.ts` ; `migrations/`
  reste à la racine.
- **biome.json** : les `includes`/`overrides` en dur (`src/server/**`,
  `src/client/game/session.ts`, `src/client/ui/editor/EventCommandEditor.tsx`, etc.) sont
  réécrits vers les nouveaux chemins `packages/**`.
- **vitest** : les 4 configs actuelles (`main`/`runtime`/`ui`/`catalog`) deviennent des
  projets nommés par package ; `npm test` à la racine agrège, `npm test -w
  @lindocara/<pkg>` cible.

## Exécution : big-bang ordonné (pas de phases)

Projet solo, trunk-based, pas de merge à coordonner : les incréments shippables
n'apportent rien ici, et maintenir des configs intermédiaires qu'on jette coûterait plus
cher. On fait **une migration, sur une branche, verte à la fin**. Il reste un **ordre
interne mécanique** (pas des jalons shippables) :

1. Poser le squelette workspace (root `package.json` workspaces, `tsconfig.base.json`).
2. Extraire `engine` (`src/shared/` → `packages/engine/src/`), tsconfig pur, dédup
   `autotile`. Doit exister avant toute réécriture d'import.
3. Codemod : réécrire les ~380 imports vers `@lindocara/engine`.
4. Extraire `renderer` (dessin de `client/game/`), couper l'arête `SceneSample`.
5. Extraire `editor`.
6. Extraire `client` (coquille + glue), recâbler Vite.
7. Extraire `server`, recâbler wrangler/drizzle. **Câbler la vitest cloudflare-pool en
   dernier** et prouver que la suite Durable Object passe avant de déclarer vert.
8. Recâbler biome + les scripts racine ; `npm run check` vert de bout en bout.

## Risques

- **Le harness workerd/Durable Object est le point dur.** Migrations lues au config-time,
  singletons workerd process-wide, pas d'isolation de storage entre tests. Le recâblage de
  la vitest cloudflare-pool se fait en dernier et se valide en exécutant réellement la
  suite DO, pas juste le typecheck.
- **~380 réécritures d'import** : scriptées (codemod) et vérifiées par le typecheck, pas à
  la main.
- **Régression de couplage silencieuse** : une feuille de `client/game` mal affectée peut
  créer un cycle. L'invariant anti-cycle (« importé par le renderer ⇒ renderer/engine,
  jamais client ») + `tsc -b` (qui refuse les cycles de references) le détectent.
- **CSS non couvert par les tests** (`css: false`) : les régressions de skin (fence
  `legacy.css`, shadcn) ne seront pas attrapées par la suite ; vérification navigateur
  requise après le split du client.

## Hors périmètre

- Aucun changement de comportement runtime, de protocole, de schéma D1 ou de gameplay.
- Pas de nouvel outil de build (turbo, nx, pnpm) : npm workspaces natifs.
- Pas de déploiement séparé par package : l'artefact reste un Worker + assets unique.
- Pas de sur-découpage : i18n, protocol et tileset restent dans `engine` (pas de packages
  `@lindocara/i18n`/`protocol` dédiés) tant qu'aucun besoin concret ne l'exige.
