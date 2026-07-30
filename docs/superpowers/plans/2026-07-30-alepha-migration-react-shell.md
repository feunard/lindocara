# Alepha Migration — React Shell Tranche Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the zustand screen machine with Alepha's `$page` router, move application state to `$atom`s, adopt `useAuth`/typed loaders — while the 60 Hz game bridge stays on zustand and both UI trees stay untouched.

**Architecture:** An `AppRouter` class of `$page`s (root layout `ssr: false`) becomes the navigation truth: title/menu/play/credits/auth/game/editor are URLs. The store splits along the measured line: application state (`activeParty`, `adventureTestSession`, editor session, `quickItems`, `questTracking`) becomes `$atom`s; the game bridge (`self`, `selfState`, `prompt`, cooldowns, `party`, events/chat, overlay flags, `GameHandle`) STAYS zustand — recon verified Alepha atoms validate zod on every `set` and notify an unfiltered global bus, which disqualifies them at 60 Hz (the spec's anticipated fallback: "zustand survit pour ce pont précis et seul lui"). `session.ts` (React-free) stops writing navigation state directly: it receives injected navigation callbacks at wiring time. R11's `SpaController` is retired in favor of the `$page` tree.

**Tech Stack:** Alepha react (`$page`, `ReactRouter`, `$atom`/`useStore`/`useSelector`, `useAuth`/`ReactAuth`, `renderWithAlepha` testing), zustand (bridge only), existing tiny-swords + shadcn UI trees.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-alepha-migration-design.md` (Tranche React section + amendments). Decisions locked by this plan (deviations are plan bugs):
  - zustand SURVIVES for the game bridge only (fields listed in Task 2); no atom is ever written from `packages/client/src/game/**`.
  - lindocara's i18n stays (`useLocale`/`t`, engine `MessageKey` contract, 53 consumer files); `$dictionary` is deferred post-migration (spec-sanctioned).
  - `api.ts` remains the mutation/error-mapping seam; typed `$client<T>` (via `import type` of server controllers — build-erased, no runtime cycle; lore precedent `AppRouter.ts:10-21`) is adopted for `$page` loaders' reads. Full `api.ts` retirement is the cleanup tranche's.
  - Both UI trees untouched (tiny-swords for game, `@lindocara/ui` shadcn for editor). No component restyling.
- `packages/client/src/game/**` must not import React OR any `alepha/react` module (ReactRouter pulls React transitively) — navigation crosses via injected callbacks.
- `packages/engine` untouched.
- Browser config: `scrollRestoration: "manual"` and `interceptAnchorClicks: false` via the `alepha.react.browser.options` atom (a game+editor app has no content anchors; the document-level click interceptor is a foot-gun near the canvas).
- The canvas contract holds: `<canvas id="stage">` stays a sibling OUTSIDE `#root`; recon verified `ReactBrowserProvider.getRootElement()` leaves foreign siblings alone.
- Repo rules: Biome, no `private` in Alepha service classes, no `vi.mock` (`vi.stubGlobal` precedent OK), multi-line JSDoc, foreground verification only. Vendor patches authorized with the dogfood loop (patch `.vendor`, prove, flag; controller mirrors upstream).
- Route map (names are the typed `push()` keys): `title` `/`, `menu` `/menu`, `credits` `/credits`, `auth` `/auth`, `playContinue` `/play/continue`, `playNew` `/play/new`, `playJoin` `/play/join`, `game` `/game`, `editor` `/editor`. Sub-screens (`pending` hero-create, `pickedId`) stay local `useState` (YAGNI on URLs for them).
- Deep-link/refresh semantics: any URL reload re-runs the boot logic (auth ping → guest fallback); `/game` on reload without a live session redirects to `/menu` (a game session is not URL-resumable in this tranche — the party/hero context lives in atoms, not the URL; URL-resumable sessions are a later nicety).

## Task Overview

1. AppRouter skeleton + browser entry (title/menu/credits live; SpaController retired)
2. Atoms + the session.ts navigation seam (store split)
3. Auth route on useAuth (+ 401 hook, guest flow)
4. Launch routes (continue/new/join + hero create, typed loaders)
5. Game route (bridge intact, immersive from route, reconnect/end flows)
6. Editor route (lazy $page, editor store couplings re-seamed)
7. Wrap-up: docs, full verify, browser smoke (deep links, refresh, editor)

---

### Task 1: AppRouter skeleton + browser entry

**Files:**
- Create: `packages/client/src/ui/AppRouter.tsx` (the `$page` tree + layout)
- Modify: `apps/main/src/main.browser.ts` (Alepha.create().with(...) bootstrap)
- Modify: `packages/client/src/main.tsx` (mounting path — see step 3)
- Delete: `packages/server/src/api/controllers/SpaController.ts` (+ its registration in `packages/server/src/api/index.ts` and its test `packages/server/test-api/spa.test.ts` — the `$page` tree now serves the shell)
- Test: `packages/client/test/app-router.test.tsx` (new, jsdom)

**Interfaces:**
- Consumes: alepha react (`$page`, `AlephaReact`), the existing screen components (`TitleScreen`, `MainMenu`, `Credits` — read `packages/client/src/ui/App.tsx:93-139` for what renders per screen).
- Produces: `export class AppRouter` with `$page` fields named EXACTLY `title`, `menu`, `credits`, `auth`, `playContinue`, `playNew`, `playJoin`, `game`, `editor` (later tasks fill auth/play/game/editor with placeholders first — declare ALL routes now with stub components so `router.push("game")` typechecks from Task 2 onward), root layout `$page({ ssr: false, children: [...] })` carrying the chrome App.tsx owns today (LocaleToggle/StatusBar visibility, menu music effect — port `App.tsx:70-84` into the layout component, driven by route instead of `screen`).
- The boot flow (`App.tsx:49-65`: fetchMe → title | guest → title | fallback auth) moves into the LAYOUT's mount effect for now (Task 3 replaces fetchMe with useAuth) — target route only replaces `screen` writes.
- `main.browser.ts` becomes the lore idiom: `Alepha.create().with(AppRouter)` + `run(alepha)`; set the browser-options atom (`scrollRestoration: "manual"`, `interceptAnchorClicks: false`) — find the exact atom name/shape in `.vendor/alepha/src/react/browser` (recon: `alepha.react.browser.options`, `ReactBrowserProvider.ts:28-47`).
- The `#stage` canvas: the served shell (previously SpaController's HTML) must keep `<canvas id="stage">` outside `#root`. With SpaController gone, find where the $page shell's HTML skeleton comes from (`ViteUtils.ts:376-386` generates `#root` + script only) — the canvas must be injected: the clean seam is `packages/client/src/main.tsx`-equivalent bootstrap creating the canvas imperatively BEFORE React mounts if absent (`document.body.prepend` of the canvas — this also fixes any template gap and is runtime-owned, not template-owned). Verify the renderer finds it (`client/game/renderer.ts` looks up `#stage` — read how).

Steps (TDD):
- [ ] Failing test (renderWithAlepha idiom from `.vendor`… tests are stripped from .vendor — read the harness source `packages/alepha/src/react/testing/` in /Users/nfo/git/alepha + its `$page.browser.spec.tsx:17-45` idiom): router starts at `/` → TitleScreen content visible; `router.push("/menu")` → MainMenu visible; canvas `#stage` exists as sibling of `#root` after bootstrap.
- [ ] Run to FAIL → implement → PASS.
- [ ] `npm run test:client`, `npm run test:server-api` (SpaController tests removed cleanly), `npm run typecheck:client`, `npm run lint`; boot `npm run dev` once and verify `/`, `/menu`, `/credits` render in a real browser (title screen visuals intact).
- [ ] Commit: `feat: alepha page router skeleton — title, menu, credits`

### Task 2: Atoms + the session.ts navigation seam

**Files:**
- Create: `packages/client/src/state/atoms.ts` (`$atom` definitions)
- Create: `packages/client/src/state/navigation.ts` (the injected-callback seam)
- Modify: `packages/client/src/store.ts` (remove migrated fields), `packages/client/src/game/session.ts` (replace direct store navigation writes), `packages/client/src/ui/App.tsx` consumers of removed fields
- Test: `packages/client/test/store.test.tsx` (rewrite the launch-navigation describe), `packages/client/test/atoms.test.tsx` (new)

**Interfaces:**
- Produces `atoms.ts`: `activePartyAtom` (`$atom({ name: "lindocara.activeParty", schema: <the ActiveParty shape from store.ts:18-29>, default: null })`), `adventureTestSessionAtom`, `adventureEditorSessionAtom`, `quickItemsAtom` (persist: true if `$atom` supports local persistence — check `.vendor` `$atom.ts` `persist` option; else keep the current mechanism), `questTrackingAtom`. React reads via `useStore`/`useSelector`.
- Produces `navigation.ts`: `type GameNavigation = { toGame(): void; toMenu(): void; toAuth(): void; setActiveParty(p: ActiveParty | null): void; setAdventureTestSession(s: AdventureTestSession | null): void }` — a module-level mutable holder `setGameNavigation(nav)` installed by the AppRouter layout on mount (closing over `ReactRouter.push` + `alepha.store.set`), consumed by `session.ts` (plain functions, zero React imports). Every `session.ts` write of `screen`/`activeParty`/`adventureTestSession` (recon: `session.ts:275,513,637-642,818,833,1041,1048-1053`) routes through it.
- The zustand store KEEPS (verbatim, untouched semantics): `self`, `selfState`, `prompt`, `status`, `questStatus`, `party`, `attackCooldownUntil`, `healCooldownUntil`, `skillCooldowns`, `zoneNameKey`, `worldSize`, `reconnect`, `heroLoading`, `events`, `chat`, `partyInvite`, `eventDialogue`, `questDialogue`, `interiorDoorId`, `adventureVictory`, `chatFocusRequest`, `merchantOpen`+all overlay flags, `game` (GameHandle), and the three equality helpers. `screen` DIES (router). `accountId` survives until Task 3 replaces it with useAuth.
- `resetToTitle`/`resetToSaves` (`store.ts:485-496`): become `clearedGameSession()` on the store + a navigation call at the call sites — the store no longer navigates.

Steps: failing tests (atom round-trip + React re-render via useStore; session-end path calls `nav.toMenu` — assert via a test-installed navigation holder, plain reassignment) → migrate → all client+editor suites green (`npm run test:client`, `npm run test:editor` — the editor imports the store; its consumers of migrated fields get the atom equivalents in Task 6, so in THIS task keep temporary re-export shims in store.ts for the editor-facing fields (`adventureEditorSession`, `setScreen`) marked `@deprecated` with a comment naming Task 6) → `typecheck:client`+`typecheck:editor`, lint. Commit: `feat: application state on alepha atoms, navigation seam for the game session`.

### Task 3: Auth route on useAuth

**Files:**
- Modify: `packages/client/src/ui/AppRouter.tsx` auth route + layout boot effect, `packages/client/src/ui/AuthScreen.tsx`, `packages/client/src/guest.ts`, `packages/client/src/api.ts` (drop fetchMe/logout duplicates where ReactAuth owns them)
- Test: `packages/client/test/auth-screen.test.tsx` (adapt)

**Interfaces:**
- Consumes: `useAuth()` (`{user, login, logout}` — login signature `login("credentials", {username, password})`, recon `ReactAuth.ts:97-118`), `currentUserAtom` for non-hook reads.
- Produces: boot flow = `ReactAuth.ping()` equivalent on layout mount (check whether AlephaReact pings automatically on start — read `.vendor/alepha/src/react/auth`; wire only what's missing); authenticated → stay/title, anonymous → `continueAsGuest()` (guest flow keeps registering via the existing two-phase api.ts calls, then a `ReactAuth` login or re-ping so `currentUserAtom` is filled — pick the cleaner and document); total failure → `/auth`.
- AuthScreen submits via `useAuth().login`; register stays on api.ts two-phase then login; machine error codes keep mapping to the SAME i18n keys (`auth.error.*`).
- 401 handling: the lore idiom — a `$hook({ on: "client:onError" })` in AppRouter clearing `currentUserAtom` + `router.push("auth")` (recon `AppRouter.ts:133-150`), replacing the ~10 editor/client `setScreen("auth")` sites progressively (editor's own sites are Task 6's).
- `accountId` in the store dies; consumers read `useAuth().user` (map `user.id`/`user.username`).
- Logout: ReactAuth.logout() (form POST) — verify the post-logout landing is `/` and kill the `window.location.reload()` in `api.ts:416` if ReactAuth's flow makes it redundant.

Steps: adapt tests first (login/register/guest paths, 401 hook pushes /auth) → implement → `test:client` + `typecheck:client` + lint + a real-browser login/logout via `npm run dev`. Commit: `feat: auth on useAuth — login, guest, 401 redirect`.

### Task 4: Launch routes (continue/new/join)

**Files:**
- Modify: `packages/client/src/ui/AppRouter.tsx` (three play routes with loaders), `packages/client/src/ui/LaunchScreens.tsx`, `packages/client/src/ui/HeroCreate.tsx`
- Test: `packages/client/test/launch-screens.test.tsx` (adapt/create)

**Interfaces:**
- Loaders: `playContinue.loader` → typed client `import type { PartyController } from "@lindocara/server/api/controllers/PartyController.js"` (TYPE-ONLY import; add `@lindocara/server` as devDependency of `packages/client` if not resolvable — verify the tsconfig.api/client program boundary tolerates the type-only import; if the client TS program chokes on server types (workers/node types bleed), FALL BACK to loaders calling the existing `api.ts` functions and note it — the loader pattern is the win, the typed client is a bonus) fetching parties+heroes; `playNew.loader` → playable adventures; `playJoin.loader` → open parties. Components consume loader data via the `$page` props (find the exact prop-passing shape in `.vendor` `$page.ts` `loader`/`props`).
- `startGameAsHero(...)` call sites keep working; on success session.ts drives `nav.toGame()` (Task 2 seam). Sub-screens (`pending`, `pickedId`) stay `useState`.
- Back/cancel buttons: `router.push("menu")` instead of `setScreen`.

Steps: failing tests (each route renders its list from a stubbed loader/fetch; hero-create flows to game via the nav seam) → implement → suites+typecheck+lint green; real-browser pass over the three screens. Commit: `feat: launch screens as alepha pages with loaders`.

### Task 5: Game route

**Files:**
- Modify: `packages/client/src/ui/AppRouter.tsx` (game route), `packages/client/src/ui/App.tsx` (dissolve — the layout + routes now own everything it did; delete the component when empty), `packages/client/src/game/session.ts` (launch/exit paths via nav seam — completing Task 2's wiring)
- Test: `packages/client/test/game-route.test.tsx` (new)

**Interfaces:**
- `game` route renders the in-game React tree (HUD, chat, overlays — everything `App.tsx` rendered when `screen === "game"`); all of it keeps reading the zustand bridge unchanged.
- `immersive` (hide LocaleToggle/StatusBar, `App.tsx:77-84`) derives from the active route (`game` + `editor`) via `useRouterState()`/`router.isActive` instead of `screen`.
- Reload-on-/game-without-session: the route's `can()` or loader checks a live `GameHandle` (store `game` field) — absent → `Redirection` to `/menu` (find the exact redirect mechanism for loaders/can in `.vendor` `$page.ts`).
- Reconnect/end flows: `session.ts` `endGame`/reconnect paths (`:637-642`, `:833`, `:1048-1053`) navigate via the seam (`toMenu`) — no `window.location.reload()` on switch paths if avoidable; keep reload ONLY where legacy semantics genuinely require a cold start (document each kept reload).
- Menu music/title effects continue working across routes (layout effect from Task 1).

Steps: failing tests (game route redirects to /menu without a session; with a stubbed GameHandle it renders the HUD shell; immersive flag on) → implement → suites+typecheck+lint; real-browser full loop title→menu→continue→game→die/leave→menu. Commit: `feat: game route — the HUD tree behind the router, bridge untouched`.

### Task 6: Editor route

**Files:**
- Modify: `packages/client/src/ui/AppRouter.tsx` (editor route `lazy: () => import("@lindocara/editor/ui/editor/AdventureEditorScreen.js")` — keep the undeclared-dependency lazy-import pattern exactly as App.tsx:34 does today), `packages/editor/src/ui/editor/AdventureEditorScreen.tsx` + `AdventurePickerScreen.tsx` (store couplings), `packages/client/src/store.ts` (drop the Task-2 shims)
- Test: `packages/editor/test/` affected suites

**Interfaces:**
- Editor's `setScreen("adventure-editor"|"auth"|"title")` sites (recon: `AdventureEditorScreen.tsx:19,210,219-230,339,759,826,853,903,919,955,1021,1523`, `AdventurePickerScreen.tsx:32-33,50,124`) → `useRouter().push("editor"|"auth"|"title")`; `adventureEditorSession`/`adventureTestSession` reads/writes → the Task-2 atoms (`useStore(adventureEditorSessionAtom)`).
- MainMenu's editor button → `router.push("editor")`.
- The editor stays stock-shadcn; no UI changes. Delete the deprecated shims from store.ts — `screen`/`setScreen` now fully dead; grep the whole repo for leftovers.
- Editor 401 sites covered by Task 3's global hook — remove the local redirects where now redundant (keep ones carrying editor-specific state cleanup).

Steps: failing/adapted editor tests → implement → `test:editor` + `test:client` + both typechecks + lint; real-browser: menu → editor loads (THE LAZY CHUNK — this closes the R11 deferred minor "editor lazy chunk never exercised"), edit a map, test-session launch round-trips to game and back. Commit: `feat: editor behind the router, screen machine retired`.

### Task 7: Wrap-up — docs, verify, smoke

**Files:**
- Modify: `AGENTS.md` (client architecture paragraphs: router replaces the screen machine; the store's reduced role as game bridge; atoms list), `packages/client/AGENTS.md` (the store/session/navigation contract — the "no alepha/react in game/" rule), `packages/editor/AGENTS.md` if it documents setScreen couplings
- Test: full pipeline

Steps:
- [ ] `npm run v` (full, foreground, generous timeout) — everything green.
- [ ] Browser smoke (playwright-cli): deep-link `/menu` directly (URL loads, no screen-machine boot dance breakage), refresh ON `/game` mid-session → clean redirect `/menu` → resume via continue; login/logout; editor deep-link `/editor`; two-player quick sanity (reuse the R11 flow shape, one context is enough for the shell — the realtime tranche already proved multiplayer).
- [ ] Docs edits (factual, tight).
- [ ] Commit code fixes separately if any; docs commit: `docs: react-shell tranche — router, atoms and the surviving zustand bridge`.

---

## Verified recon findings the executor must know

1. **Atoms are NOT for the hot path**: every `store.set` validates zod and emits on an unfiltered global bus (`StateManager.ts`); `useSelector` is fine for READS. The game bridge stays zustand; nothing in `game/**` writes an atom.
2. **`$page` ssr:false is inherited from the root layout**; loaders still run server-side on SSR requests — irrelevant for us in dev (SPA), but never put browser-only APIs in a loader.
3. **Navigation is a service** (`ReactRouter` via `useRouter()`), typed on the `$page` field names; `push` accepts names. The document-level anchor interceptor is disabled per Global Constraints.
4. **`getRootElement` prepends `#root` if missing and leaves siblings alone** — the canvas survives; create it imperatively pre-mount.
5. **Typed `$client` is a compile-time Proxy** — `import type` of a server controller is build-erased (lore precedent). If the client TS program rejects server types, fall back to api.ts inside loaders (documented fallback, not a failure).
6. **Test idiom**: `renderWithAlepha` + `document.body.innerHTML = '<div id="root"></div>'` + `alepha.inject(ReactRouter)` + `act(() => router.push(...))` (from alepha's own `$page.browser.spec.tsx:17-45`; the harness lives in `alepha/react/testing`, source visible in /Users/nfo/git/alepha since .vendor strips specs).
7. **`useStore` seeds the atom default during render** — never rely on an atom being unset.

## Explicitly deferred (NOT this tranche)

- `$dictionary`/`useI18n` migration (lindocara i18n stays; spec-sanctioned deferral).
- Full `api.ts` retirement onto typed `$client` — cleanup tranche.
- URL-resumable game sessions (`/game/:partyId` deep link reconnect) — later nicety.
- Legacy stack retirement, CF deploy — their own tranches.
