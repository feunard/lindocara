# Monorepo par packages — plan d'exécution (big-bang ordonné)

> **Mandat** (décidé par l'auteur, exécution autonome de nuit) : livrer les 5 packages
> `@lindocara/*` **même si rouge**, **direct sur main**, en **commits ordonnés**. Viser le
> vert à fond ; le rouge n'est que le fallback documenté si non-convergence.

**Goal** : découper `src/` en 5 packages npm-workspaces à frontières physiques acycliques.

**Baseline** : `main` @ `fb126e9`, `npm run check` vert (281 tests). Branche de travail
`refactor/monorepo-packages` puis merge/push sur main.

## Câblage retenu
- npm workspaces natifs : `"workspaces": ["packages/*"]`.
- Résolution cross-package : symlink node_modules + `exports` `{ ".": "./src/index.ts",
  "./*": "./src/*" }`, mapping `.js`→`.ts` par le bundler (Vite/vitest/tsc bundler).
- **Pas** de project references (pas de `composite`). Typecheck = `tsc -p` par package.
- Un seul déploiement : wrangler assemble Worker (`packages/server`) + assets
  (`packages/client` build). Inchangé fonctionnellement.

## Graphe (acyclique, prouvé)
`engine ← {server, renderer}` · `renderer ← editor` · `{engine, renderer, editor} ← client`

## Mapping `src/client/game/` (prouvé sans cycle runtime)
- **renderer** : renderer, world-view, world-layout, minimap, minimap-surface,
  map-render-cache, terrain-visuals, interiors, catalog-element-render, tile-draw,
  stage-application, feedback, combat-motion, combat-visual-state, combat-art,
  display-settings, server-clock, autotile, character-art, enemy-art, portrait-art,
  tiny-swords-art, tiny-swords-assets, editor-asset-art, **input, input-settings**,
  + nouveau `scene-sample.ts` (type `SceneSample` extrait de net).
- **editor** : ui/editor/* + map-editor-stage, editor-state, event-command-tree,
  **map-preview**.
- **client** : main/App/store/api/i18n/lib/styles/ui{components,hud,tiny-swords} + glue
  game : net, sound, audio-settings, combat-sounds, cooldown-sync, session, party.

## Refactors mécaniques
1. `SceneSample` : extraire de `net.ts` vers `packages/renderer/src/scene-sample.ts`
   (importe les `*Snapshot` depuis `@lindocara/engine`). `net.ts` l'importe de renderer.
2. `autotile` : tables dans engine (déjà `shared/autotile.ts`) ; helper d'offset
   `game/autotile.ts` reste renderer et importe les tables d'engine.
3. Codemod imports `(../)+shared` → `@lindocara/engine` (~380 sites).
4. Codemod imports intra-`client/game` `./X.js` devenus cross-package →
   `@lindocara/<pkg>/X.js`.

---

## Ordre d'exécution (chaque tâche = gate + commit)

### T1 — Squelette workspace
- Créer `packages/`. Root `package.json` : ajouter `workspaces`, garder devDeps/scripts.
- `tsconfig.base.json` = contenu actuel de `tsconfig.json`.
- Gate : `npm install` réussit (symlinks créés). Commit `chore: workspace skeleton`.

### T2 — engine
- `git mv src/shared packages/engine/src`.
- `packages/engine/package.json` (name `@lindocara/engine`, `type module`, `exports`).
- `packages/engine/tsconfig.json` : extends base, `lib:["ES2022"]`, **aucun** types
  DOM/Workers, `include:["src"]`.
- Codemod `(../)+shared` → `@lindocara/engine` sur src/server, src/client, test.
- Smoke test résolution : `npx tsc -p packages/engine/tsconfig.json --noEmit`.
- Gate : engine typecheck vert. Commit `refactor: extract @lindocara/engine`.

### T3 — server
- `git mv src/server packages/server/src` (+ `wrangler.jsonc` copié/adapté, `db/`).
- `packages/server/package.json` (dep `@lindocara/engine`), `tsconfig.json`
  (types `@cloudflare/vitest-pool-workers/types`, lib ES2022).
- Recâbler chemins wrangler (`main`, migrations, assets vers client build).
- Gate : `tsc -p packages/server` vert. Commit `refactor: extract @lindocara/server`.

### T4 — renderer
- `git mv` des fichiers renderer de `src/client/game/` → `packages/renderer/src/`.
- Extraire `scene-sample.ts`. `packages/renderer/{package.json,tsconfig.json}` (dep engine,
  lib DOM).
- Codemod imports intra-game cross-package.
- Gate : `tsc -p packages/renderer`. Commit `refactor: extract @lindocara/renderer`.

### T5 — editor
- `git mv src/client/ui/editor` + map-editor-stage/editor-state/event-command-tree/
  map-preview → `packages/editor/src/`.
- `package.json` (deps engine, renderer), `tsconfig.json`.
- Gate : `tsc -p packages/editor`. Commit `refactor: extract @lindocara/editor`.

### T6 — client
- Déplacer le reste de `src/client/` → `packages/client/src/` ; `index.html`,
  `vite.config.ts` → `packages/client/`.
- `package.json` (deps engine, renderer, editor), `tsconfig.json`.
- Recâbler Vite (entrée, alias `@`, plugin Cloudflare → entrée server).
- Gate : `tsc -p packages/client` + `npm run build`. Commit `refactor: extract client`.

### T7 — Tests & tooling (le point dur en dernier)
- Répartir `test/` par package ; recâbler les 4 configs vitest en projets par package
  (cloudflare-pool pour server **en dernier**, jsdom pour renderer/editor/client, node
  pour engine).
- Recâbler `biome.json` (chemins overrides), `drizzle.config.ts`, scripts racine
  (`typecheck` = tsc par package, `test`/`test:<pkg>`, `check`).
- Gate dur : suite Durable Object verte. `npm run check` racine.
- Commit `refactor: per-package test/lint/build wiring`.

### T8 — Vert de bout en bout & push
- `npm run check` racine vert (ou rapport d'échecs documenté si non-convergence).
- Merge `refactor/monorepo-packages` → `main`, push. Rapport final + memory.

## Fallback (si non-vert à T7/T8)
Committer l'état atteint, écrire les échecs précis dans le message de commit + un
`MIGRATION-STATUS.md`, push sur main (mandat « full même si rouge »). Ne jamais prétendre
vert si rouge.
