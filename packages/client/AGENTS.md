# @lindocara/client

The React front end: the app shell, screens, HUD, the Tiny Swords component tree, and the game-loop
glue that binds the renderer to the network. Browser + React. This is the base the editor builds on.

## Responsibility

- `main.tsx`/`ui/App.tsx` — entry + routing (title → login → resumable parties/saves; the editor is
  lazy-`import()`ed). `ui/*` — screens (`AuthScreen`, `PartiesScreen`, `PartyScreen`, …). `ui/hud/`
  — the in-game HUD. `ui/tiny-swords/` — the game component tree (its own `--tiny-*` tokens).
- `store.ts` — the zustand bridge (game session writes, React reads; text is i18n keys + params,
  never rendered strings). `api.ts` — the fetch client (machine codes → dictionary keys). `i18n.ts`
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
- `game/` code must not import React — the store is the only bridge (`GameHandle` is the seam).
- Interpolation delay (150ms) buys smooth remote motion; do not "fix" it. Your own square is drawn in
  the present, everyone else `INTERPOLATION_DELAY_MS` in the past.
- CSS is not covered by tests (`css: false`) — verify skin changes in a browser. Fix game text colour
  in `legacy.css`'s unlayered `html, body`, never in the generated token blocks.

See the root [`AGENTS.md`](../../AGENTS.md) for the two-players-two-rules and CSS-layering details.
