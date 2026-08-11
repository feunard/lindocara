# @lindocara/client

The React front end: the app shell, screens, HUD, the Tiny Swords component tree, and the game-loop
glue that binds the renderer to the network. Browser + React. This is the base the editor builds on.

## Responsibility

- `main.tsx`/`ui/AppRouter.tsx` â€” bootstrap + routing. `main.tsx`'s `bootClient()` is the shared
  pre-mount bootstrap (locale, theme, the `#stage` canvas, the DEV-only `?preview` route â€” itself
  rebuilt with the editor on the shared HD-2D map preview), run by
  `apps/main/src/main.browser.ts` before it mounts `AppRouter` on Alepha's `$page` router (title
  â†’ login â†’ resumable parties/saves; the `/editor` route lazy-`import()`ed the editor package until
  the rebuilt HD-2D package and lazy-loads the working editor â€” see that route's docblock and
  `packages/editor/AGENTS.md`). `ui/*` â€” screens
  (`AuthScreen`, `PartiesScreen`, `PartyScreen`, â€¦). `ui/hud/` â€” the in-game HUD.
  `ui/tiny-swords/` â€” the game component tree (its own `--tiny-*` tokens).
- `state/atoms.ts` â€” Alepha `$atom`s for the application state that used to live on the store but
  isn't part of the 60Hz game bridge: `activePartyAtom`, `adventureTestSessionAtom`,
  `adventureEditorSessionAtom`, `quickItemsAtom` (localStorage-persisted), `questTrackingAtom`.
  React reads/writes them via `useStore`/`useSelector`. `state/navigation.ts` â€” the injected-
  callback seam `game/session.ts` uses to reach the router and these atoms without importing React
  or `alepha`/`alepha/react` itself; `ui/AppRouter.tsx`'s root layout installs the real
  implementation on mount, a test installs a plain fake by reassignment.
- `store.ts` â€” the zustand bridge, REDUCED to exactly the 60Hz game bridge (`self`, `selfState`,
  cooldowns, `party`, chat, `events`, dialogue/overlay flags, the `GameHandle`, the equality
  helpers â€” text state is i18n keys + params, never rendered strings). Everything above moved to
  `state/atoms.ts` instead, because every atom write validates a zod schema and fires an
  unfiltered global event bus â€” fine once per screen transition, disqualifying for anything
  written 20-60x/s. `api.ts` â€” the fetch client (machine codes â†’ dictionary keys). `i18n.ts`
  â€” re-exports the renderer's locale core + the React `useLocale` hook and `setLocale` (flushSync).
- `game/` glue: `net` (the WebSocket, the 20 Hz move report + re-exports `SceneSample`),
  `hero-controller` (**the client's own `HeroState`**, stepped by `stepHero` every animation frame â€”
  the seam that replaced prediction when S3 moved movement here, and where a server-granted blink is
  spent), `session` (constructs the renderer,
  owns store writes), `sound`/`audio-settings`/`combat-sounds` (including the procedural
  consumer of movement `HeroEvent`s), `party`, `cooldown-sync`.
- `styles/` â€” `app.css` (the client sheets + `@alepha/ui/styles.css` last, which brings Tailwind itself), `legacy.css`
  (the Tiny Swords skin + the two-tree fence), `tokens.css`. `public/` â€” atlas/audio/served assets.

- `ui/Chat.tsx` keeps only its transparent local dialogue log visible while unfocused; the dark
  glass, filters, input and top-right resize grip appear while writing. The grip resizes width and
  height together, clamps to the viewport, and persists the validated pair under
  `lindocara.chat.size.v2`; keep transient pointer coordinates in refs, not render state.

## Graph

- **Depends on:** `engine`, `renderer`, `ui`.
- **Depended on by:** `editor` (which sits on top of this base); the app `apps/main` bundles it.

## Commands

```bash
npm run typecheck:client        # tsc, DOM + React
npm test -w @lindocara/client   # or: npm run test:client â€” jsdom
```

## Rules

- Two component trees: game UI uses `ui/tiny-swords/`; creator/non-game surfaces use `@alepha/ui`.
  Never mix them to "match the theme".
- `game/` code must not import React OR any `alepha`/`alepha/react` module (`ReactRouter` pulls
  React transitively) â€” the store is the bridge for the 60Hz game state (`GameHandle` is the
  seam), and `state/navigation.ts` is the bridge for navigation/atom writes; `game/session.ts`
  reaches the router and the atoms in `state/atoms.ts` only through that seam, never directly.
- Interpolation delay (150ms) buys smooth remote motion; do not "fix" it. Your own hero is drawn in
  the present â€” it IS the present now, since this package runs the movement rule â€” and everyone else
  `INTERPOLATION_DELAY_MS` in the past.
- The move report is capped at 20/s (`MOVE_REPORT_MS`) and suppresses identical frames. The hero
  still steps every animation frame; only the report is throttled. Lifting that ceiling spends the
  rate window (`RATE_MAX_MESSAGES`, 35/s) that chat, actions and resyncs share.
- CSS is not covered by tests (`css: false`) â€” verify skin changes in a browser. Fix game text colour
  in `legacy.css`'s unlayered `html, body`, never in the generated token blocks.

See the root [`AGENTS.md`](../../AGENTS.md) for the two-players-two-rules and CSS-layering details.
