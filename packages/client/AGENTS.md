# @lindocara/client

The React front end: the app shell, screens, HUD, the Tiny Swords component tree, and the game-loop
glue that binds the renderer to the network. Browser + React. This is the base the editor builds on.

## Responsibility

- `main.tsx`/`ui/AppRouter.tsx` — bootstrap + routing. `main.tsx`'s `bootClient()` is the shared
  pre-mount bootstrap (locale, theme, the `#stage` canvas, the DEV-only `?preview` route), run by
  `apps/main/src/main.browser.ts` before it mounts `AppRouter` on Alepha's `$page` router (title
  → login → resumable parties/saves; the editor is lazy-`import()`ed). `ui/*` — screens
  (`AuthScreen`, `PartiesScreen`, `PartyScreen`, …). `ui/hud/` — the in-game HUD.
  `ui/tiny-swords/` — the game component tree (its own `--tiny-*` tokens).
- `state/atoms.ts` — Alepha `$atom`s for the application state that used to live on the store but
  isn't part of the 60Hz game bridge: `activePartyAtom`, `adventureTestSessionAtom`,
  `adventureEditorSessionAtom`, `quickItemsAtom` (localStorage-persisted), `questTrackingAtom`.
  React reads/writes them via `useStore`/`useSelector`. `state/navigation.ts` — the injected-
  callback seam `game/session.ts` uses to reach the router and these atoms without importing React
  or `alepha`/`alepha/react` itself; `ui/AppRouter.tsx`'s root layout installs the real
  implementation on mount, a test installs a plain fake by reassignment.
- `store.ts` — the zustand bridge, REDUCED to exactly the 60Hz game bridge (`self`, `selfState`,
  cooldowns, `party`, chat, `events`, dialogue/overlay flags, the `GameHandle`, the equality
  helpers — text state is i18n keys + params, never rendered strings). Everything above moved to
  `state/atoms.ts` instead, because every atom write validates a zod schema and fires an
  unfiltered global event bus — fine once per screen transition, disqualifying for anything
  written 20-60x/s. `api.ts` — the fetch client (machine codes → dictionary keys). `i18n.ts`
  — re-exports the renderer's locale core + the React `useLocale` hook and `setLocale` (flushSync).
- `game/` glue: `net` (prediction/WS + re-exports `SceneSample`), `session` (constructs the renderer,
  owns store writes), `sound`/`audio-settings`/`combat-sounds`, `party`, `cooldown-sync`.
- `styles/` — `app.css` (Tailwind + the client sheets + `@lindocara/ui/globals.css` last), `legacy.css`
  (the Tiny Swords skin + the two-tree fence), `tokens.css`. `public/` — atlas/audio/served assets.

## Graph

- **Depends on:** `engine`, `renderer`, `ui`.
- **Depended on by:** `editor` (which sits on top of this base); the app `apps/main` bundles it.

## Commands

```bash
npm run typecheck:client        # tsc, DOM + React
npm test -w @lindocara/client   # or: npm run test:client — jsdom
```

## Rules

- Two component trees: game UI uses `ui/tiny-swords/`; creator/non-game surfaces use `@lindocara/ui`.
  Never mix them to "match the theme".
- `game/` code must not import React OR any `alepha`/`alepha/react` module (`ReactRouter` pulls
  React transitively) — the store is the bridge for the 60Hz game state (`GameHandle` is the
  seam), and `state/navigation.ts` is the bridge for navigation/atom writes; `game/session.ts`
  reaches the router and the atoms in `state/atoms.ts` only through that seam, never directly.
- Interpolation delay (150ms) buys smooth remote motion; do not "fix" it. Your own square is drawn in
  the present, everyone else `INTERPOLATION_DELAY_MS` in the past.
- CSS is not covered by tests (`css: false`) — verify skin changes in a browser. Fix game text colour
  in `legacy.css`'s unlayered `html, body`, never in the generated token blocks.

See the root [`AGENTS.md`](../../AGENTS.md) for the two-players-two-rules and CSS-layering details.
