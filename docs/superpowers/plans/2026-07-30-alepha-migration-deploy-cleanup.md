# Alepha Migration — Deploy + Cleanup Tranche Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the pure-Alepha stack to Cloudflare production (`lindocara.alepha.dev`) and then retire the entire legacy stack — the final tranche of the migration.

**Architecture:** Deploy FIRST, retire SECOND — legacy stays the rollback net until Alepha prod has proven itself. The framework fix ($room wiring in the Cloudflare build) is done directly in `../alepha` (its tests live there), then vendor-synced. App-side prep closes the two recon-found production holes (client `public/` tree dropped by the build; raw `process.env` reads never pushed as CF secrets) plus the SPA fallback config, the migrations baseline, and CI. After a real `platform up` and prod smoke, the retirement deletes 31 legacy server files + 3 world orphans + config/deps, migrates 18 pure system-test suites into a node project, and rewrites the docs.

**Tech Stack:** Alepha CLI (`platform up`, `db migrations`), Cloudflare (D1, Durable Objects, assets), the vendored framework + `../alepha` (dogfood loop), wrangler under the hood.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-alepha-migration-design.md` (Tranche 4 — cleanup + deploy). Prod is disposable (owner ruling: "on va l'exploser la prod, 0 migration de données").
- **Order is load-bearing**: Tasks 2-5 (deploy) complete and prod is verified BEFORE Tasks 6-7 (retirement) delete anything legacy.
- Vendor dogfood loop authorized and REQUIRED for framework work: the $room build fix is implemented in `/Users/nfo/git/alepha` (tests there), `yarn v` (5-min timeout), commit+push, then `npx alepha vendor sync` here (own commit).
- `packages/engine` untouched. `src/world/**` pure systems SURVIVE (they power `src/api/realtime/`); only the three recon-verified orphans die (`observability-system.ts`, `persistence-system.ts`, `map-zone.ts`).
- The 18 pure system-test suites (recon list) MIGRATE before their workerd siblings die — no invariant coverage is lost silently; anything not migrated is named in the task report.
- Human-owned step (Task 5): `APP_SECRET` — generated once, exported for `platform up`, and stored in GitHub repo secrets via `gh secret set APP_SECRET` (+ existing `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` verified).
- Repo rules: Biome, no `private` in Alepha classes, no `vi.mock`, multi-line JSDoc, foreground verification only (no backgrounded checks).
- Loadtest against prod requires its explicit `--allow-remote --allow-production` opt-ins; keep them.

## Task Overview

1. Fix the parked BACK-during-loading session leak
2. Framework: wire `$room` into the Cloudflare build (in ../alepha, then sync)
3. App deploy prep: assets, $env secrets, SPA fallback, migrations baseline
4. CI: build + deploy workflows on the alepha stack
5. Deploy to production + prod smoke (+ opt-in loadtest)
6. Legacy retirement α: code, config, deps
7. Legacy retirement β: test migration + TS/vitest re-plumb
8. Docs rewrite + final verify

---

### Task 1: Fix the parked BACK-during-loading leak

**Files:**
- Modify: `packages/client/src/ui/AppRouter.tsx` (the route-leave effect), `packages/client/src/game/session.ts` (launch abort seam)
- Test: `packages/client/test/game-route-back.test.tsx` (extend)

**The parked finding (react-shell final review):** the leave-`/game` effect gates on `store.game`, but during the hero-loading window (`heroLoading` true, `startGameIdentity` running, `store.game` still null) a browser BACK changes the pathname without stopping the launch — `setGame()` later installs an orphaned live session under the menu. Fix: `startGameIdentity` already has `activeLaunchId` guarding superseding launches — extend it: the leave-effect (or the navigation seam) bumps/invalidates the active launch id when the path leaves `/game` while `heroLoading` is set; `startGameIdentity` re-checks its launch id after every await and, when stale, tears down whatever it built so far (socket close, renderer dispose — reuse the existing teardown pieces) WITHOUT navigating. Read `session.ts`'s launch path fully first; the fix must not break: normal load completion, the test-session flow, reconnects.

Steps: failing test (mount router, start a launch with a controllable async gate so `store.game` is still null, push `/menu`, release the gate — assert no game handle installed, teardown invoked, no navigation fired by the abort) → implement → `npm run test:client`, `typecheck:client`, lint → real-browser spot-check (BACK during the loading spinner; menu stays quiet) → commit `fix: abort the game launch when navigation leaves during loading`.

### Task 2: Framework — `$room` in the Cloudflare build (in ../alepha)

**Files (ALL in /Users/nfo/git/alepha — this task works upstream, then syncs):**
- Modify: `packages/alepha/src/cli/core/tasks/BuildCloudflareTask.ts` (`hasWebSocket`/`websocketPaths` resolution :148-162; migrations tag idempotence :422-426; the 401 secure check in `writeWorkerEntryPoint` :529-532)
- Modify: `packages/alepha/src/cli/core/tasks/BuildManifestTask.ts:169-176,:232-235` (same union — the `--prebuilt` path)
- Modify: `packages/alepha/src/cli/core/tasks/BuildServerTask.ts:124-126` (`exportDurableObject` includes `$room`)
- Tests: `packages/alepha/src/cli/core/__tests__/BuildCloudflareTask.spec.ts` (+ `BuildManifestTask.spec.ts:64-65`, `tasks/__tests__/BuildServerTask.spec.ts:26`)

**The changes (recon-verified anchors and shapes):**
- Path union: `$room` primitives are registered (`websocket/index.ts:34`, `index.workerd.ts:38`) and expose the same `p.options.channel.options.path` shape as `$websocket`; `secure` is top-level on `RoomPrimitiveOptions` (`RoomInterfaces.ts:177`). Union both registries into `hasWebSocket`/`websocketPaths` (dedup'd).
- `BuildServerTask.exportDurableObject`: `$websocket OR $room` — without it `dist/index.js` never re-exports `AlephaWebSocketDurableObject` and wrangler fails on `class_name`.
- Migrations tag: currently hardcoded `{tag:"v1", new_sqlite_classes:[…]}` pushed AFTER the user-config spread — make it idempotent (skip if the class is already declared) and collision-free (first free `v${n}`).
- The 401 check: `getEndpoint(path) ?? getRoomEndpoint(path)` (`CloudflareDurableObjectWebSocketServerProvider.ts:107-111`, `WebSocketServerProvider.ts:83`) so `$room({secure})` is honored on CF.
- Runtime needs NO change (recon-verified: `WebSocketRoom` routes rooms once the path is in `wsPaths`).

Steps: extend the specs FIRST (a fake app with only `$room` primitives must produce wsPaths + DO binding + DO export + secure 401 + a user-supplied `migrations` config must not double the tag) → run them RED → implement → `yarn v` in /Users/nfo/git/alepha (foreground, 5-min timeout) → commit upstream (`feat(cli): wire $room apps into the cloudflare build`) → push → back in lindocara: `npx alepha vendor sync --force`, verify `vendor diff` clean, `cd apps/main && npx alepha build --target cloudflare` now emits `dist/wrangler.jsonc` WITH the DO binding + `/ws/world` in wsPaths (inspect and paste into the report) → commit the sync (`chore: vendor sync alepha to <sha> ($room cloudflare build wiring)`).

### Task 3: App deploy prep

**Files:**
- Modify: `apps/main/alepha.config.ts` (cloudflare config block), `apps/main/vite.config.ts` or an assets strategy, `packages/server/src/api/` env reads → `$env`, `apps/main/package.json` (db scripts)
- Create: `apps/main/migrations/sqlite/<timestamp>_baseline/` (generated, committed)
- Test: `packages/server/test-api/` env-read adjustments if signatures change

**Three recon-found holes to close:**
1. **Assets**: `BuildClientTask.ts:101` forces `publicDir: "public"` (app-root-relative), silently dropping `packages/client/public` (208 files: audio, `catalog.json` fetched at runtime). Preferred fix is UPSTREAM (BuildClientTask honors the app vite.config's `publicDir`) — if you take it, it rides Task 2's dogfood loop pattern (spec + fix + yarn v + push + sync; a second upstream commit is fine). Fallback if upstream is disproportionate: make `apps/main/public` real (a build-time copy step from `packages/client/public` — a small `prebuild` script; NEVER a committed duplicate). Either way: prove `alepha build --target cloudflare` lands the tree in `dist/public` (`ls dist/public/assets/lindocara/tiny-swords/catalog.json`).
2. **SPA fallback + worker-first**: the generated wrangler has no `not_found_handling`/`run_worker_first`. Add via the sanctioned escape hatch `defineConfig({ build: { cloudflare: { config: { assets: { not_found_handling: "single-page-application", run_worker_first: ["/api/*", "/ws/*", "/_auth/*", "/oauth/*"] } } } } })` in `apps/main/alepha.config.ts` — check how the spread merges with the generated `assets` block (recon: user config spreads FIRST, generated fields after — verify the generated `directory`/`binding` don't clobber your keys; adapt to whichever merge order wins, and prove the final wrangler.jsonc carries all four keys).
3. **Secrets/$env**: convert the raw `process.env` reads to `$env` primitives so `platform up` pushes them: `WEBSOCKET_MAX_PAYLOAD` (`packages/server/src/api/websocketTransportCap.ts:32`), `NAVIGATION_DEBUG` + `CHEATS_ENABLED` (`WorldRoom.ts:533,831-832`) — read `.vendor/alepha/src/core` for the `$env` primitive shape (schema'd, defaulted). `APP_SECRET` needs NO code (alepha's SecretProvider owns it; it throws in prod if defaulted — that's the guarantee we want). Keep dev/test behavior identical (defaults preserved).
4. **Migrations baseline**: point the db scripts at the app (`apps/main`: `"db:generate": "alepha db migrations create"` — the CLI boots `apps/main/src/main.ts` and needs a resolvable `DATABASE_URL`; use the dev sqlite default or `:memory:` env as lore does), generate the baseline ONCE, inspect the SQL (all 17+realm tables, both partial uniques, the checks), commit it. Wire `alepha db migrations check` into the verify pipeline (root `alepha.config.ts` verify command) per the alepha-repo convention.

Steps: TDD where testable (env reads via `$env` — adapt the existing transport-cap test; baseline = generate + inspect + a `migrations check` green run) → foreground `npm run v --fast` equivalent (lint+typecheck+tests) + the build-artifact proofs → commit (`feat: production deploy prep — assets, envs, spa fallback, migrations baseline`).

### Task 4: CI on the alepha stack

**Files:**
- Modify: `.github/workflows/ci.yml` (the `build:legacy` step → `npm run build` with `--target cloudflare`; artifact upload path), `.github/workflows/deploy.yml` (full rewrite)

deploy.yml becomes the lore shape (alepha repo `.github/workflows/ci.yml:262-292` is the reference): reuse ci.yml's check job via `workflow_call` as today, then ONE step — `npm run deploy` (= `alepha platform up -e production`) in the workspace, with `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `APP_SECRET` (+ the three game envs if non-default values are wanted) as job env from repo secrets. Keep `workflow_dispatch` ONLY for now (the push trigger returns after Task 5 proves prod — leave a dated comment saying so). Keep the "Publish Liin Adventure IA" step (it posts via /api/* — verify its auth flow still works against the alepha API: it uses scripts/adventure-io.ts — READ it; if it authenticates via the legacy routes, port it now or mark the step disabled-with-comment and ledger it).

Steps: rewrite → `actionlint` if available (else careful re-read) → commit (`ci: build and deploy the alepha stack`). No live deploy in this task.

### Task 5: Deploy to production + prod smoke

**Files:** none beyond evidence; possibly small fixes committed separately.

Steps:
- [ ] Preflight: `gh secret list` — verify `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` exist. Generate `APP_SECRET=$(openssl rand -base64 48)`; `gh secret set APP_SECRET --body "$APP_SECRET"`; keep it exported for the local run. (Repo-owner authorized.)
- [ ] `cd apps/main && APP_SECRET=... CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npx alepha platform up -e production` (foreground, generous timeout). This provisions D1, applies the baseline, deploys the worker+DO+assets, pushes secrets, binds `lindocara.alepha.dev` — REPLACING the legacy prod (owner-authorized destruction). Capture the full output.
- [ ] Prod smoke (playwright-cli against https://lindocara.alepha.dev): register fresh account → login → create adventure → party → hero → enter game → WASD with ack → a second browser context joins the same party → mutual visibility → map transition (4008 rejoin) → editor loads. Screenshots.
- [ ] Opt-in loadtest: `npm run loadtest -- --players=6 --duration=30 --scenario=mixed --allow-remote --allow-production --url=https://lindocara.alepha.dev` (check the script's exact remote flags/URL argument — read it) — report ack latency vs the local baseline (p95 206ms local; D1+DO will be slower; numbers are evidence, not a gate).
- [ ] If the smoke fails: fix-forward small issues (committed individually), or STOP and report BLOCKED with the exact broken layer — the legacy prod is already gone at this point, which is accepted (disposable), but the tranche pauses for controller/owner review rather than thrashing.
- [ ] Re-enable the deploy push trigger (deploy.yml: `on: push: branches: [main]` restored + workflow_dispatch kept) — commit `ci: enable continuous deploy of the alepha stack`.

### Task 6: Legacy retirement α — code, config, deps

**Files (from the recon inventory — it is the checklist, follow it exactly):**
- Delete: the 31 `packages/server/src` legacy files (list in the recon report section 1, incl. `env.d.ts`/`worker-configuration.d.ts`), the 3 world orphans (`observability-system.ts`, `persistence-system.ts`, `map-zone.ts`), `wrangler.jsonc`, `drizzle.config.ts`, `migrations/` (the 37 legacy .sql — NOT `apps/main/migrations/`), `.dev.vars*`, `packages/server/vitest.config.ts` (workerd), `scripts/prepare-local-env.mjs`, `apps/main/vite.legacy.config.ts`, `apps/main/src/legacy/`, `packages/client/src/ui/LegacyShell.tsx`.
- Modify: `packages/server/src/items.ts:3` (inline the `EquipmentSlot` type — copy the union from the deleted schema or import from `api/entities/heroEquipment.ts` if exported), `packages/client/src/main.tsx` (drop mountLegacyApp), `packages/client/src/ui/AppRouter.tsx` (LegacyShell references :3,10,75,133,402,408), `packages/client/src/game/net.ts` (rollback `?character=` arm :194-195,309-315,755-756), `packages/client/src/game/session.ts` (:852-855 hard-reload swap, :1102-1104 `startGame(character)`), `packages/client/src/api.ts` (`CharacterSummary`, stale comments), scripts cleanup (root + apps/main + packages/server per recon section 2 — incl. the root `alepha.config.ts` verify command dropping `build:legacy`), deps (`wrangler`, `drizzle-kit`, `@cloudflare/vitest-pool-workers`, `@cloudflare/vite-plugin`, server's `drizzle-orm`), `.gitignore` (`.dev.vars*`, `.wrangler/`).
- DO NOT touch `styles/legacy.css` (shadcn fence, unrelated) or the KEEP lists (24 world modules, root keepers incl. `adventure-registry.ts`, `authored-quest-system.ts`, `profile-types.ts`, `items.ts`, `spatial-grid.ts`).

Steps: delete/modify per inventory → the workerd test suite is now broken by design; Task 7 owns tests — in THIS task, temporarily narrow the root vitest aggregator to exclude the dead workerd project so `npm test` stays green (comment: Task 7 finishes) → foreground `npm run lint`, `npm run typecheck` (expect the server tsconfig break — Task 7 owns the re-plumb; if typecheck can't pass without it, fold the MINIMAL tsconfig adjustment in here and say so) → `npm run dev` boots + one browser click-through → commit (`feat!: retire the legacy workerd stack`).

### Task 7: Legacy retirement β — tests + TS/vitest re-plumb

**Files:**
- Move: the 18 pure suites (recon section 4 list: `world-systems`, `monster-system`, `navigation-system`, `npc-movement-system`, `projectile-system`, `damage-over-time-system`, `event-run-system`, `party-system`, `cooperation`, `cooldowns`, `cheats`, `authored-quest-system`, `authored-guard-system`, `authored-monster-system`, `priest/ranger/warrior-variant-system`, `rogue-state/skill/shadow-dance-system`, `spatial-grid`) from `packages/server/test/` into the node test project (git mv into `packages/server/test-api/` or a sibling `test-systems/` dir inside the same vitest project — pick by import-adjustment cost; they import only `src/world/**` so they should run under node with near-zero edits).
- Delete: the remaining `packages/server/test/` (31 workerd files + harnesses).
- Modify: `packages/server/tsconfig.api.json` → becomes `packages/server/tsconfig.json` (include `["src", "test-api", …]`), `typecheck:server` simplifies to one program, root `vitest.config.ts` aggregator entry, `test:server-api` script naming (optional rename to `test:server` — update AGENTS.md refs if renamed).

Steps: git mv the 18 suites → run them under the node project (fix trivial import/path fallout only — any suite needing REAL changes is reported, not hacked) → delete the workerd remains → re-plumb tsconfig/vitest/scripts → foreground `npm test` (ALL projects), `npm run typecheck`, `npm run lint` → commit (`test: migrate the pure system suites to the node project, drop workerd`).

### Task 8: Docs rewrite + final verify

**Files:**
- Modify: `AGENTS.md` (all recon-listed sections: commands table, migration-status section becomes a short "history" note, layout table rows, Server world systems, per-package tsconfigs, Database → the alepha ORM reality, run_worker_first → the new config home, Hero presence → the rooms, Gotchas (drop DO-singleton/billing legacy items that no longer apply — KEEP the ones that still do for alepha rooms: empty-room reset, one-object-per-id in prod), Secrets → APP_SECRET + the $envs, Conventions), `packages/server/AGENTS.md` (legacy sections die; realtime/api sections become THE architecture), `apps/main/AGENTS.md`, `packages/client/AGENTS.md`, `README.md` (recon lines).
- The memory of the migration lives in git + the spec — the docs describe the PRESENT only.

Steps: rewrite → fact-check pass (every command in the table runs; every path exists) → `npm run v` (full, foreground — note the verify command no longer builds legacy) → one last prod smoke (title→game on lindocara.alepha.dev) → commit (`docs: lindocara is a pure alepha app`).

---

## Verified recon findings the executor must know

1. The framework fix is FIVE files in ../alepha with existing spec suites to extend; runtime needs nothing. Line anchors in Task 2 are from the CURRENT files (652-line BuildCloudflareTask), not the older recon.
2. `callRoom` DO→DO works on CF (single `ALEPHA_WEBSOCKET` namespace, env re-bound inside each DO). Every cross-room `await` in a tick is a network round-trip — already the accepted design; not this tranche's problem.
3. The generated HTML shell needs no canvas (bootClient creates `#stage` imperatively) — the R11-era `#stage` concern is obsolete.
4. `platform up` = provision → build → migrate (D1 via `dist/migrations` + wrangler apply) → deploy → secrets (bulk PATCH from process.env, allowlist = the manifest's `$env` keys — hence Task 3's conversion). `alepha db baseline mark` refuses D1; the platform variant exists if needed.
5. DO economics at 20Hz: each tick callback is a billed invocation while sockets are connected (same envelope as the legacy loop); CPU limit applies per tick, not per loop; `dt` derives from the engine clock (safe under Workers' frozen `Date.now()` between I/O).
6. `SESSION_SECRET` dies entirely with the legacy files. `APP_SECRET` is the one prod secret alepha requires (throws in prod when defaulted).
7. `adventure-io.ts` (the Liin CI publish step) — auth path unverified; Task 4 must read it and port-or-disable-with-ledger.

## Explicitly deferred (NOT this tranche)

- Controller response typing (`z.any()` → schemas) + typed `$client` adoption in loaders — post-migration quality work.
- `$dictionary` i18n migration — post-migration optional.
- Node-VPS hosting target — someday (Alepha is runtime-neutral; nothing here forecloses it).
- Observability parity (`world_metrics` windows on alepha rooms) — post-deploy follow-up with real prod data.
