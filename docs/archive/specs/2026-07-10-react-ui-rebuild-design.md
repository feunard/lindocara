# React UI rebuild — design

2026-07-10. Sub-project A of the next cycle (sub-project B: character classes, separate spec).
Approved approach: rebuild every DOM overlay in React + Vite + Tailwind v4 + shadcn +
PixelAct UI components, skinned with garrison's textured-PNG technique. The PixiJS canvas and
the whole game loop are untouched.

## Goals

- Every DOM UI surface becomes a React component: auth (login/register tabs), character
  select/create, HUD (identity, HP/XP bars, quest, inventory, attack cooldown), chat, event
  log, interaction prompt, interior overlay, help bar, status bar, locale toggle.
- Visual identity: garrison's "textured PNG" look — 9-slice `border-image` frames for panels
  and buttons, tiled paper/wood material backgrounds, `image-rendering: pixelated` on painted
  art — applied over PixelAct UI's shadcn-structured components.
- The existing FR/EN i18n keeps working with live toggle; React re-renders replace the
  `data-i18n` mechanism.

## Non-goals

- No gameplay, protocol, server, or schema changes. Zero edits to `src/server/**`,
  `src/shared/protocol.ts`, `src/shared/game.ts`.
- No rewrite of the PixiJS renderer, prediction, input polling, or net code beyond swapping
  who consumes their callbacks.
- No visual redesign of the canvas world.
- No new UI features — feature parity with today's screens (plus whatever polish the skin
  brings for free).

## Stack decisions (locked)

- **React 19** + `@vitejs/plugin-react`, added to the existing Vite config alongside the
  Cloudflare plugin.
- **Tailwind v4** via `@tailwindcss/vite`; tokens declared with `@theme` in CSS.
- **shadcn** initialized (`components.json`, `@/` alias → `src/client/`).
- **PixelAct UI** components installed via its shadcn registry
  (`npx shadcn@latest add https://pixelactui.com/r/<name>.json`) — they are copied into the
  repo (MIT) and then restyled. Components used: button, input, label, card, dialog, select,
  badge, kbd, toast, tooltip. PixelAct has **no `progress` and no `tabs`** — those two are
  built in-house in the same style (HP/XP/quest/cooldown bars; auth tabs).
- **Zustand** as the game-state → React bridge (garrison's pattern). The game loop writes;
  components subscribe with selectors. React never drives the game.
- Fonts follow garrison: vendored woff2, `@font-face` in a tokens stylesheet (display font
  for headings/buttons, UI font for body). Reuse garrison's Cinzel/Inter unless the pixel
  look calls for something else during implementation — the token indirection makes the
  choice swappable.

## Architecture

```
index.html                <canvas id="stage"> + <div id="root"> only; all overlay markup gone
src/client/
  main.tsx                boot: stamp <html lang> from the detected locale, mount <App/>;
                          owns nothing else
  game/                   (existing files, moved not rewritten)
    net.ts renderer.ts input.ts sound.ts world-layout.ts
  store.ts                zustand store: screen state + game-derived UI state
  api.ts                  fetch client extracted from today's main.ts (api(), ApiError, types)
  i18n.ts                 keeps t()/setLocale/onLocaleChange; adds useLocale() hook
                          (useSyncExternalStore over onLocaleChange); applyStaticText and
                          data-i18n handling deleted
  ui/
    App.tsx               screen router: auth → characters → game overlays
    AuthScreen.tsx        tabs (in-house), forms on PixelAct input/button/label
    CharacterSelect.tsx   cards (PixelAct card/badge), create form, two-click delete
    hud/Hud.tsx           identity, bars, quest, inventory, cooldown panels
    hud/Bar.tsx           in-house 9-slice progress bar (replaces <progress>)
    Chat.tsx EventLog.tsx Prompt.tsx InteriorOverlay.tsx HelpBar.tsx StatusBar.tsx
    LocaleToggle.tsx
    pixelact/             registry-installed PixelAct components (restyled)
  styles/
    tokens.css            @font-face + CSS custom properties (colors, spacing)
    theme.css             garrison skin: .framed/.parchment/.wood 9-slice + materials
  assets/hud/             frame-panel.png frame-button.png paper.png wood.png (from garrison)
```

### The bridge (store.ts)

The game loop stays imperative. `play()`'s callbacks (`onWelcome`, `onState`, `onChat`,
`onEvent`, `onClose`) and the per-frame handler write into the zustand store instead of
mutating DOM:

- `screen: "auth" | "characters" | "game"`, plus session/characters data
- `self: PlayerSnapshot | undefined` (written at most once per animation frame, and only when
  changed — the HUD must not re-render 60×/s for an unchanged bar)
- `selfState: SelfState`, `questStatus`, `prompt: {key, params} | null`
- `events: Array<{id, text, tone}>` (capped at 6), `chatLog` (capped at 8)
- `status: {key, params}`, `attackCooldownUntil`, `interiorDoorId | null`

Store contents that feed text hold **i18n keys + params, not rendered strings**, so a locale
toggle re-renders correctly without re-translating stored history (exception: event-log and
chat lines render once with the locale active at arrival, as today).

The renderer keeps its own canvas concerns (world labels already re-localize via its
registry). `window.__lindocara` dev handle survives.

### Skin

`theme.css` carries the garrison recipe: panels `border: 13px solid transparent;
border-image: url(frame-panel.png) 26 / 13px stretch; background-clip: padding-box;`,
buttons the same with `frame-button.png 14 / 8px`, `.parchment`/`.wood` tiled materials,
`image-rendering: pixelated` where painted art scales. The PixelAct copies are edited to use
these classes/variables in place of their CSS-only borders — that is the point of a
registry-copied library. Tailwind handles layout/spacing/typography utilities; the 9-slice
frames stay in plain CSS (border-image is not expressible as a Tailwind utility).

## Error handling

Same machine-code contract as today: `ApiError.code` → `t()` key mapping (the existing
`ERROR_KEYS` map moves into `api.ts`/components). Stored per-form error **codes** re-render
on locale toggle for free because React renders from state. Disconnect close codes keep
their `status.close.*` mapping.

## Testing

- The 146 existing workerd tests are untouched and must stay green (nothing under
  `src/server`/`src/shared` changes except nothing at all).
- New Vitest **jsdom project** (second entry in the vitest config, `environment: "jsdom"`,
  scoped to `test/ui/**`) for the stateful screens: AuthScreen (tab switch, mismatch error,
  error re-localization on toggle), CharacterSelect (cap disables create card, two-click
  delete), Bar (value/max rendering). `fetch` is stubbed at the `api.ts` seam — the API
  contract itself is already covered by the workerd tests.
- Typecheck boundary: `tsconfig.client.json` gains `"jsx": "react-jsx"`; `test/ui/**` is
  checked by a client-side program, never the worker one.
- Manual gate before merge: full click-through in the browser (register → create → play →
  toggle FR in-game → switch character → logout) on dev and on lindocara.alepha.dev.

## Risks / notes

- `vite dev` stacked-Workers gotcha applies doubly while reworking the client: restart the
  dev server before judging any UI bug real.
- Bundle size will grow (React + Radix primitives inside PixelAct copies); acceptable for
  this project, but tree-shake by importing only the components listed.
- The `#stage` canvas stays OUTSIDE the React root as a sibling; React must never unmount it.
- CLAUDE.md's client architecture block and the conventions section need updating (React,
  store bridge, where UI strings render) when this lands.
