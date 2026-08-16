# Stock shadcn (Base UI) port

Date: 2026-07-18
Status: approved, not yet implemented

## Problem

`src/client/ui/pixelact-ui/` holds five vendored, hand-edited primitives (Button, Input, Label,
Select, Kbd) descended from PixelAct. `components.json` claims `style: "new-york"` on Radix, which
no longer matches either the vendored source or the current shadcn CLI. The practical consequence
is that `shadcn add <component>` cannot be used: there is no stock tree for it to write into and no
token set for its output to read from.

That blocks the actual goal. The creator editors are about to need a real component vocabulary —
dialogs, tabs, tooltips, fields, popovers — and hand-vendoring each one is not viable.

Separately, the shadcn design tokens were never installed. `--primary`, `--secondary`, `--radius`,
`--ring`, `--destructive`, `--accent` and `--border` are undefined across every stylesheet, so
`select.tsx`'s `focus-visible:ring-ring` currently emits nothing and `pixelact-ui/styles/styles.css`
references a `var(--destructive)` and a `var(--ring)` that do not exist. `app.css` defines exactly
four ad-hoc `@theme` colours to patch the visible half of that hole.

## Goal

Install stock, upgradeable shadcn as a foundation layer, without changing how any player-facing
screen looks. Game UI keeps the Tiny Swords chrome as an explicitly separate superset.

Non-goal: adopting shadcn inside the editors. That is step 2, and it is deliberately not designed
here — the editor's component set should be chosen against real screens, not guessed at now.

## What "stock shadcn" means as of 2026-07

Verified by scaffolding a throwaway project with `shadcn init -t vite -b base -p nova`:

- Base UI is the default primitives library. Components import from `@base-ui/react/*`, not Radix.
- `components.json` carries `style: "base-nova"` — the format is `{library}-{style}`. Available
  styles: nova (Lucide/Geist), vega, maia, lyra, mira, luma, sera, rhea.
- Dependencies: `@base-ui/react@^1.6.0`, `lucide-react`, `tw-animate-css`,
  `@fontsource-variable/geist`, and `shadcn` itself — the last is required at build time because
  the generated CSS does `@import "shadcn/tailwind.css"`.
- The CSS entry gains `@theme inline` (mapping `--color-*` onto bare token names), a `:root` block
  and a `.dark` block, both in oklch, plus a `@layer base` with `* { border-border outline-ring/50 }`,
  `body { bg-background text-foreground }` and `html { font-sans }`.

## Design

### Two sibling trees, no cross-dependency

Under `src/client/ui/`:

- **`components/`** — stock shadcn output. Treated as generated: `shadcn add` writes here and we do
  not hand-edit it. This is what step 2 consumes.
- **`tiny-swords/`** — the game superset. `pixelact-ui/` is absorbed into it wholesale.

`pixelact-ui/` ceases to exist. Its files move and are renamed for what they are:

| From | To |
| --- | --- |
| `pixelact-ui/button/index.tsx` | `tiny-swords/TinyButton.tsx` |
| `pixelact-ui/input.tsx` | `tiny-swords/TinyInput.tsx` |
| `pixelact-ui/label.tsx` | `tiny-swords/TinyLabel.tsx` |
| `pixelact-ui/select.tsx` | `tiny-swords/TinyFieldSelect.tsx` |
| `pixelact-ui/kbd.tsx` | `tiny-swords/TinyKbd.tsx` |
| `pixelact-ui/styles/styles.css` | `styles/tiny-swords-primitives.css` |

`tiny-swords/TinySelect.tsx` already exists and is a different component — a bare `<select>` used by
`AssetBrowser`, `SettingsMenu` and `ControlsSettings`. It is left untouched, which is why the
pixelact select lands under a distinct name rather than being merged into it. Consolidating the two
is a judgement call about the editors and belongs to step 2.

The move is otherwise mechanical. Component bodies change only where noted under Tokens below. The
16 import sites (`TitleScreen`, `AuthScreen`, `CharacterCreator`, `CharacterSelect`, `PartyScreen`,
`PartiesScreen`, `ColorPicker`, `SettingsMenu`, `ControlsSettings`, `AssetBrowser`, `MapEditor`,
`AdventureEditor`, `Chat`, `HelpBar`, `hud/InventoryChip`, `EditorAssetPalette`,
`tiny-swords/TinyIconButton`) get their import path rewritten and nothing else.

Import paths are normalised to the `@/ui/...` alias while we are touching them; today the tree is
split roughly half-and-half between `@/ui/pixelact-ui/...` and relative `./pixelact-ui/...`.

`KbdGroup` is exported but imported nowhere, and `TinyBanner`, `TinyDialog` and `TinyTooltip` have
zero call sites. They are deleted rather than moved.

### components.json

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/client/styles/app.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "rtl": false,
  "aliases": {
    "components": "@/ui/components",
    "utils": "@/lib/utils",
    "ui": "@/ui/components",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "menuColor": "default",
  "menuAccent": "subtle",
  "registries": {}
}
```

`@` resolves to `src/client` (vite.config.ts and vitest.ui.config.ts, identically), so `@/lib/utils`
already points at the existing `cn()`. `moduleResolution` is `"bundler"`, so shadcn's extensionless
imports resolve without patching — the repo's `.js`-suffixed import convention does not need to be
imposed on generated files.

### Tokens

`app.css` drops its four-colour `@theme` block and takes the stock `@import "shadcn/tailwind.css"`,
`@theme inline`, `:root` and `.dark` blocks verbatim from a fresh init. `<html>` in `index.html`
gains `class="dark"`; `<meta name="color-scheme" content="dark">` is already there.

Two collisions are resolved as part of this work, not deferred:

1. **`--muted`.** `legacy.css:7` defines `--muted: #a9bcae` on `:root`, and stock `@theme inline`
   maps `--color-muted` onto `var(--muted)`. Renamed to `--legacy-muted`, with its three use sites
   (legacy.css lines 542, 643, 747).

2. **Tiny primitives borrowing shadcn tokens.** `TinyInput` and `TinyKbd` currently use
   `bg-background`, `text-foreground`, `bg-muted` and `text-muted-foreground`, which only worked
   because of the ad-hoc `@theme` block being deleted. They are repointed at explicit parchment
   variables added to `tokens.css` — `--tiny-surface`, `--tiny-surface-ink`, `--tiny-surface-sunken`,
   `--tiny-surface-sunken-ink`, carrying today's values `#14100b`, `#f7ead0`, `#3a2f22`, `#cdb98a`.
   `TinySelect`'s dead `focus-visible:ring-ring` is replaced with an explicit parchment focus ring.
   After this the superset reads no shadcn token, which is what makes the two trees independent.

The `var(--destructive)` and `var(--ring)` references inside the moved
`tiny-swords-primitives.css` are dead (nothing applies `--pixel-box-shadow-destructive`, and the
`.dark` rebind targets a class the primitives do not carry). They are deleted with the move rather
than repaired.

### Things that are safe, and why

**Background.** Stock shadcn puts `body { @apply bg-background text-foreground }` inside
`@layer base`. `legacy.css` styles `body` unlayered. In Tailwind v4 unlayered rules beat layered
ones irrespective of import order, so the game background is unaffected.

**Fonts.** Same mechanism: `legacy.css:3` sets `font-family: Inter, …` on `:root` unlayered, which
beats shadcn's `html { @apply font-sans }`. Geist therefore cannot leak into the game screens. The
corollary is that it will not reach the shadcn components by inheritance either — so the editor
shell must carry `font-sans` explicitly in step 2. `@fontsource-variable/geist` is still installed,
as stock, so that is a one-class change later rather than a dependency change.

### Dependencies

Added: `@base-ui/react`, `lucide-react`, `tw-animate-css`, `@fontsource-variable/geist`, `shadcn`.

`radix-ui` stays — `TinyLabel` wraps `Label.Root` and `TinyButton`'s `asChild` uses `Slot.Root`.
Both trees having their own primitives library is the expected cost of the superset being genuinely
separate; it is not a migration left half-done.

### Scope of components added in step 1

`button`, `input`, `label` only. Enough to prove `shadcn add` writes correctly, typechecks under
this repo's strict options, and renders under `vitest.ui.config.ts`. The editor's real set is
chosen in step 2.

## Testing

`vitest.ui.config.ts` runs jsdom with `css: false`, so assertions are on classes and data
attributes, never computed style. That shapes what can be verified here:

- `test/ui/pixelact-smoke.test.tsx` → renamed `tiny-button.test.tsx`, import path updated, its four
  `data-tiny-{normal,hover,pressed,disabled}` assertions kept verbatim. Unchanged assertions passing
  after the move is the evidence that no player-facing screen regressed.
- `test/ui/tiny-swords-ui.test.tsx` — import paths updated; keyboard activation, focus and disabled
  coverage unchanged.
- New `test/ui/shadcn-primitives.test.tsx` — renders the stock Button and asserts `data-slot="button"`
  plus the absence of `tiny-button`, i.e. that the two trees have not merged by accident.
- The screen-level suites (`map-editor`, `party-screen`, `parties-screen`, `adventure-editor`,
  `auth-screen`, `chat`, `color-picker`, `title-screen`, `character-select`, `settings-menu`,
  `bar`) exercise the primitives transitively and must pass untouched. Any edit needed in one of
  them means the move was not mechanical and should be re-examined rather than patched.

`npm run check` must pass, including `biome check`. Stock shadcn output omits semicolons and this
repo's Biome config requires them, so `npm run lint:fix` is run after every `shadcn add`. That is
the accepted workflow, not a defect — the alternative, excluding `ui/components/` from formatting,
would leave generated code unlinted.

## Risks

- `tsconfig.json` sets `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noUnusedParameters`
  and `verbatimModuleSyntax`. Generated shadcn components are not written against that strictness.
  With three components the blast radius is small; if a later `shadcn add` produces code that will
  not typecheck, the fix belongs in a documented patch step, not in loosening the tsconfig.
- `shadcn` as a build-time dependency means a CSS `@import` now resolves through node_modules. If
  that proves awkward for the Cloudflare build, `shadcn eject` inlines it and removes the package.

## Rollback

The change is confined to `src/client/ui/`, `src/client/styles/`, `components.json`, `index.html`,
`package.json` and `test/ui/`. No server, shared, protocol or database surface is touched. Reverting
the commit restores the previous tree wholesale.
