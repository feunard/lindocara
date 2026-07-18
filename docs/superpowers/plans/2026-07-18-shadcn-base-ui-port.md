# Stock shadcn (Base UI) Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install stock, upgradeable shadcn (Base UI, `base-nova`) as a foundation layer under `src/client/ui/components/`, and absorb the vendored `pixelact-ui/` primitives into the Tiny Swords superset, with zero visual change to any player-facing screen.

**Architecture:** Two sibling component trees with no cross-dependency. `ui/components/` is generated shadcn output, never hand-edited. `ui/tiny-swords/` is the game superset, which after this work reads no shadcn design token. The shadcn `:root`/`.dark` token blocks are installed verbatim and `.dark` is forced on `<html>`.

**Tech Stack:** React 19, Tailwind v4, Base UI 1.6, shadcn CLI 4.13, Vitest (jsdom project), Biome.

## Global Constraints

- `components.json` `style` must be exactly `base-nova`. Base UI, not Radix, for the `components/` tree.
- `@` resolves to `src/client` (vite.config.ts and vitest.ui.config.ts). Not `src`.
- `moduleResolution` is `"bundler"`. Existing hand-written files in this repo use `.js`-suffixed relative/alias imports (`@/lib/utils.js`); **preserve that suffix when moving existing files**. Generated shadcn files use extensionless imports; **leave them as generated**.
- Biome requires semicolons and double quotes. Stock shadcn output has no semicolons, so `npm run lint:fix` runs after every `shadcn add`.
- `npm run check` must pass at the end of every task that touches code.
- Player-facing screens must not change appearance. The `data-tiny-*` assertions in the button test are the regression evidence.
- Never touch `src/server/`, `src/shared/`, `src/client/game/`, protocol, or the database.
- **This plan executes in the `feature/shadcn-base-ui` worktree, not on `main`.** Another agent is concurrently deleting `CharacterCreator.tsx`, `CharacterPreview.tsx`, `CharacterSelect.tsx`, `TinyBanner.tsx`, `TinyDialog.tsx`, `TinyTooltip.tsx` and `test/ui/character-select.test.tsx` on `main` as part of the admission-cutover dead-code purge. Known merge resolutions, to be applied when this branch merges — not now:
  - `TinyBanner`/`TinyDialog`/`TinyTooltip`: both sides delete. Resolve as delete.
  - `CharacterCreator.tsx` / `CharacterSelect.tsx` / `CharacterPreview.tsx`: this branch edits imports, `main` deletes the file. **Resolve as delete — their removal wins.** Do not resurrect these files.
  - `test/ui/character-select.test.tsx`: resolve as delete.
  Inside this worktree the files still exist and must keep compiling, so Task 3 still rewrites their imports. That is expected throwaway work, not wasted effort — it keeps the branch green.
- Do not add English strings to any component. All player-facing copy stays in `src/shared/i18n/`.

---

## File Structure

**Created:**
- `src/client/ui/components/button.tsx` — generated shadcn Button (Base UI)
- `src/client/ui/components/input.tsx` — generated shadcn Input
- `src/client/ui/components/label.tsx` — generated shadcn Label
- `src/client/ui/tiny-swords/TinyButton.tsx` — moved from `pixelact-ui/button/index.tsx`
- `src/client/ui/tiny-swords/TinyInput.tsx` — moved from `pixelact-ui/input.tsx`
- `src/client/ui/tiny-swords/TinyLabel.tsx` — moved from `pixelact-ui/label.tsx`
- `src/client/ui/tiny-swords/TinyFieldSelect.tsx` — moved from `pixelact-ui/select.tsx`
- `src/client/ui/tiny-swords/TinyKbd.tsx` — moved from `pixelact-ui/kbd.tsx`
- `src/client/styles/tiny-swords-primitives.css` — moved from `pixelact-ui/styles/styles.css`
- `test/ui/shadcn-primitives.test.tsx` — proves the two trees are separate

**Deleted:**
- `src/client/ui/pixelact-ui/` (entire directory)
- `src/client/ui/tiny-swords/TinyBanner.tsx`, `TinyDialog.tsx`, `TinyTooltip.tsx` (zero call sites)
- `KbdGroup` export (zero call sites)

**Modified:**
- `components.json`, `package.json`, `index.html`
- `src/client/styles/app.css`, `legacy.css`, `tokens.css`
- 16 import sites, listed in Task 3
- `test/ui/pixelact-smoke.test.tsx` → renamed `test/ui/tiny-button.test.tsx`
- `test/ui/tiny-swords-ui.test.tsx`

---

## Task 1: Free the `--muted` token name

Stock shadcn's `@theme inline` maps `--color-muted` onto `var(--muted)`. `legacy.css` already defines `--muted: #a9bcae` on `:root` for unrelated legacy text. Rename legacy's before the shadcn tokens land, so the two never coexist.

**Files:**
- Modify: `src/client/styles/legacy.css:7,542,643,747`

**Interfaces:**
- Consumes: nothing
- Produces: the CSS custom property name `--legacy-muted`, replacing `--muted`. No later task depends on it; this task exists to make Task 4 safe.

- [ ] **Step 1: Confirm the exact current use sites**

Run: `grep -n -- "--muted" src/client/styles/legacy.css`
Expected: exactly four lines — one definition at line 7, three `var(--muted)` reads at 542, 643, 747. If the count differs, stop and re-read the file; the rename must cover every site.

- [ ] **Step 2: Rename all four**

Run: `sed -i '' 's/--muted\b/--legacy-muted/g' src/client/styles/legacy.css`

- [ ] **Step 3: Verify no `--muted` remains and nothing else broke**

Run: `grep -rn -- "--muted" src/client/styles/ ; grep -rn -- "--legacy-muted" src/client/styles/legacy.css`
Expected: the first grep prints nothing from `legacy.css` (it may still print `--muted-foreground` matches from `app.css` — that is a different token and must be left alone; if `sed` altered `--muted-foreground` anywhere, revert and use a more precise pattern). The second prints four lines.

- [ ] **Step 4: Run the UI suite**

Run: `npm run test:ui`
Expected: PASS. (`css: false` in vitest.ui.config.ts means stylesheets are not evaluated, so this only proves nothing else regressed.)

- [ ] **Step 5: Commit**

```bash
git add src/client/styles/legacy.css
git commit -m "refactor rename legacy muted token"
```

---

## Task 2: Decouple the Tiny primitives from shadcn tokens

`TinyInput`, `TinyKbd` and the pixelact `Select` currently read `bg-background`, `text-foreground`, `bg-muted`, `text-muted-foreground` and `ring-ring`. Those only resolve because of the four ad-hoc colours in `app.css`'s `@theme` block, which Task 4 deletes. Repoint them at explicit parchment variables so the superset owns its own colours.

Do this **before** the components move, so the diff stays readable: this task changes content, Task 3 changes paths.

**Files:**
- Modify: `src/client/styles/tokens.css`
- Modify: `src/client/ui/pixelact-ui/input.tsx`
- Modify: `src/client/ui/pixelact-ui/select.tsx`
- Modify: `src/client/ui/pixelact-ui/kbd.tsx`
- Modify: `src/client/ui/pixelact-ui/label.tsx`
- Modify: `src/client/styles/app.css`

**Interfaces:**
- Consumes: nothing
- Produces: four CSS custom properties on `:root`, consumed by the Tiny primitives from here on:
  - `--tiny-surface: #14100b`
  - `--tiny-surface-ink: #f7ead0`
  - `--tiny-surface-sunken: #3a2f22`
  - `--tiny-surface-sunken-ink: #cdb98a`

- [ ] **Step 1: Add the tokens**

In `src/client/styles/tokens.css`, extend the existing `:root` block. Append these four lines after `--gold: #f3c96a;`:

```css
  /* Tiny Swords primitive surfaces. Deliberately NOT shadcn tokens: the game superset
   * under ui/tiny-swords/ must not read --background/--muted, so that ui/components/
   * can carry stock shadcn values without the two skins fighting. Values are the ones
   * that previously lived in app.css's ad-hoc @theme block. */
  --tiny-surface: #14100b;
  --tiny-surface-ink: #f7ead0;
  --tiny-surface-sunken: #3a2f22;
  --tiny-surface-sunken-ink: #cdb98a;
```

- [ ] **Step 2: Repoint `input.tsx`**

In `src/client/ui/pixelact-ui/input.tsx`, replace this line:

```tsx
          "max-w-full bg-background p-2 text-foreground outline-none placeholder:text-sm md:placeholder:text-base",
```

with:

```tsx
          "max-w-full p-2 outline-none placeholder:text-sm md:placeholder:text-base",
          "[background-color:var(--tiny-surface)] [color:var(--tiny-surface-ink)]",
```

- [ ] **Step 3: Repoint `select.tsx`**

In `src/client/ui/pixelact-ui/select.tsx`, replace this line:

```tsx
        "max-w-full bg-background p-2 text-foreground outline-none",
```

with:

```tsx
        "max-w-full p-2 outline-none",
        "[background-color:var(--tiny-surface)] [color:var(--tiny-surface-ink)]",
```

and replace this line:

```tsx
        "focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
```

with:

```tsx
        "focus-visible:ring-2 focus-visible:ring-[var(--gold)]",
        "disabled:cursor-not-allowed disabled:opacity-40",
```

`ring-ring` resolved to nothing before this change (no `--ring` was ever defined), so this is a fix, not a like-for-like port. `--gold` is the existing focus accent in `theme.css`.

- [ ] **Step 4: Repoint `kbd.tsx`**

In `src/client/ui/pixelact-ui/kbd.tsx`, replace this line:

```tsx
        "inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 bg-muted p-2 font-sans text-xs text-muted-foreground select-none pointer-events-none",
```

with:

```tsx
        "inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 p-2 font-sans text-xs select-none pointer-events-none",
        "[background-color:var(--tiny-surface-sunken)] [color:var(--tiny-surface-sunken-ink)]",
```

Then delete the following line entirely — it targets a `data-slot="tooltip-content"` ancestor that no component in this repo renders, and it reads `bg-background`, which is about to become a stock shadcn colour:

```tsx
        "in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10",
```

- [ ] **Step 5: Repoint `label.tsx`**

In `src/client/ui/pixelact-ui/label.tsx`, replace this line:

```tsx
        "pixel-font mb-2 flex items-center gap-2 text-sm leading-none font-medium text-foreground select-none",
```

with:

```tsx
        "pixel-font mb-2 flex items-center gap-2 text-sm leading-none font-medium select-none",
        "[color:var(--tiny-surface-ink)]",
```

- [ ] **Step 6: Delete the ad-hoc theme block**

In `src/client/styles/app.css`, delete the entire trailing comment and `@theme` block — everything from the line beginning `/* shadcn-style palette tokens consumed by` to the closing `}`. The file must end after the five `@import` lines. Task 4 rebuilds this section from stock output.

- [ ] **Step 7: Verify no Tiny primitive reads a shadcn token**

Run: `grep -rnE "bg-background|text-foreground|bg-muted|text-muted-foreground|ring-ring" src/client/ui/pixelact-ui/ src/client/ui/tiny-swords/`
Expected: no output. Any hit means a site was missed.

- [ ] **Step 8: Run checks**

Run: `npm run lint:fix && npm run typecheck && npm run test:ui`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/client/styles/tokens.css src/client/styles/app.css src/client/ui/pixelact-ui/
git commit -m "refactor give tiny primitives their own surface tokens"
```

---

## Task 3: Absorb pixelact-ui into the Tiny Swords superset

Pure move and rename. No component body changes beyond import paths and the removal of dead exports.

**Files:**
- Create: `src/client/ui/tiny-swords/TinyButton.tsx`, `TinyInput.tsx`, `TinyLabel.tsx`, `TinyFieldSelect.tsx`, `TinyKbd.tsx`
- Create: `src/client/styles/tiny-swords-primitives.css`
- Delete: `src/client/ui/pixelact-ui/` (whole directory)
- Delete: `src/client/ui/tiny-swords/TinyBanner.tsx`, `TinyDialog.tsx`, `TinyTooltip.tsx`
- Modify: `src/client/styles/app.css`
- Modify: 16 import sites (listed in Step 4)
- Modify: `test/ui/tiny-swords-ui.test.tsx`
- Rename: `test/ui/pixelact-smoke.test.tsx` → `test/ui/tiny-button.test.tsx`

**Interfaces:**
- Consumes: the `--tiny-surface*` tokens from Task 2.
- Produces, all from `@/ui/tiny-swords/<File>.js`:
  - `TinyButton.tsx` → `export { Button as TinyButton, pixelButtonVariants as tinyButtonVariants }`, `export interface TinyButtonProps`
  - `TinyInput.tsx` → `export { Input as TinyInput }`, `export interface TinyInputProps`
  - `TinyLabel.tsx` → `export { Label as TinyLabel }`, `export interface TinyLabelProps`
  - `TinyFieldSelect.tsx` → `export { Select as TinyFieldSelect }`, `export interface TinyFieldSelectProps`
  - `TinyKbd.tsx` → `export { Kbd as TinyKbd }`
  - Props, variants (`default | secondary | warning | success | destructive | link`), sizes (`default | sm | lg`) and all `data-*` attributes are unchanged from the pixelact originals.

Renaming the exports (rather than keeping `Button`, `Input`, …) is deliberate: Task 4 introduces a *different* `Button` in `ui/components/`, and two components with the same name in one file is exactly the confusion this layering exists to prevent.

- [ ] **Step 1: Move the files with git so history follows**

```bash
git mv src/client/ui/pixelact-ui/button/index.tsx src/client/ui/tiny-swords/TinyButton.tsx
git mv src/client/ui/pixelact-ui/input.tsx src/client/ui/tiny-swords/TinyInput.tsx
git mv src/client/ui/pixelact-ui/label.tsx src/client/ui/tiny-swords/TinyLabel.tsx
git mv src/client/ui/pixelact-ui/select.tsx src/client/ui/tiny-swords/TinyFieldSelect.tsx
git mv src/client/ui/pixelact-ui/kbd.tsx src/client/ui/tiny-swords/TinyKbd.tsx
git mv src/client/ui/pixelact-ui/styles/styles.css src/client/styles/tiny-swords-primitives.css
git rm -q src/client/ui/tiny-swords/TinyBanner.tsx src/client/ui/tiny-swords/TinyDialog.tsx src/client/ui/tiny-swords/TinyTooltip.tsx
rmdir src/client/ui/pixelact-ui/button src/client/ui/pixelact-ui/styles src/client/ui/pixelact-ui 2>/dev/null || true
```

- [ ] **Step 2: Fix the moved files' internals**

`TinyButton.tsx` — the catalogue import was relative to a two-level-deeper directory. Replace:

```tsx
import { TINY_SWORDS_UI } from "../../../../shared/tiny-swords-catalog.js";
```

with:

```tsx
import { TINY_SWORDS_UI } from "../../../shared/tiny-swords-catalog.js";
```

and replace the export line:

```tsx
export { Button, pixelButtonVariants };
```

with:

```tsx
export { Button as TinyButton, pixelButtonVariants as tinyButtonVariants };
```

and rename the exported interface `ButtonProps` → `TinyButtonProps` (both at its declaration and in the `Button` function's parameter type).

`TinyInput.tsx` — rename `InputProps` → `TinyInputProps` and change the export line to `export { Input as TinyInput };`.

`TinyFieldSelect.tsx` — rename `SelectProps` → `TinyFieldSelectProps` and change the export line to `export { Select as TinyFieldSelect };`.

`TinyLabel.tsx` — rename `LabelProps` → `TinyLabelProps`, change the export line to `export { Label as TinyLabel };`, and **delete** the line `import "./styles/styles.css";` (Step 3 wires that stylesheet through `app.css` instead).

`TinyKbd.tsx` — **delete** the line `import "./styles/styles.css";`, **delete** the entire `KbdGroup` function (zero call sites), and change the export line to `export { Kbd as TinyKbd };`.

- [ ] **Step 3: Rewire the moved stylesheet**

In `src/client/styles/tiny-swords-primitives.css`, the self-hosted font path was relative to the old nested location. Replace:

```css
  src: url("../../../assets/fonts/press-start-2p/press-start-2p-latin.woff2") format("woff2");
```

with:

```css
  src: url("../assets/fonts/press-start-2p/press-start-2p-latin.woff2") format("woff2");
```

Then delete the `--pixel-box-shadow-destructive` declaration from `:root` and the entire `.dark { ... }` block. Both reference `var(--destructive)` / `var(--ring)`, which were never defined, and neither is applied by any component. Leaving them would silently start resolving against stock shadcn colours after Task 4.

Finally, register the stylesheet in `src/client/styles/app.css` by adding this import after `@import "./tokens.css";`:

```css
@import "./tiny-swords-primitives.css";
```

- [ ] **Step 4: Rewrite every import site**

All 16 files below import from `pixelact-ui`. Rewrite each to the `@/ui/tiny-swords/<File>.js` alias form with the new export names — including the files that currently use a relative `./pixelact-ui/...` path, so the tree ends up consistent.

Files importing `Button` → `TinyButton`: `AssetBrowser.tsx`, `MapEditor.tsx`, `PartyScreen.tsx`, `CharacterCreator.tsx`, `AdventureEditor.tsx`, `AuthScreen.tsx`, `TitleScreen.tsx`, `SettingsMenu.tsx`, `ControlsSettings.tsx`, `CharacterSelect.tsx`, `ColorPicker.tsx`, `PartiesScreen.tsx`, `tiny-swords/TinyIconButton.tsx`
Files importing `Input` → `TinyInput`: `AssetBrowser.tsx`, `MapEditor.tsx`, `PartyScreen.tsx`, `CharacterCreator.tsx`, `AdventureEditor.tsx`, `AuthScreen.tsx`, `EditorAssetPalette.tsx`, `Chat.tsx`, `PartiesScreen.tsx`
Files importing `Label` → `TinyLabel`: `MapEditor.tsx`, `PartyScreen.tsx`, `CharacterCreator.tsx`, `AdventureEditor.tsx`, `AuthScreen.tsx`, `PartiesScreen.tsx`
Files importing `Select` → `TinyFieldSelect`: `MapEditor.tsx`, `PartyScreen.tsx`, `AdventureEditor.tsx`, `PartiesScreen.tsx`
Files importing `Kbd` → `TinyKbd`: `HelpBar.tsx`, `Chat.tsx`, `hud/InventoryChip.tsx`

Example — in `src/client/ui/AuthScreen.tsx`, replace:

```tsx
import { Button } from "@/ui/pixelact-ui/button/index.js";
import { Input } from "@/ui/pixelact-ui/input.js";
import { Label } from "@/ui/pixelact-ui/label.js";
```

with:

```tsx
import { TinyButton } from "@/ui/tiny-swords/TinyButton.js";
import { TinyInput } from "@/ui/tiny-swords/TinyInput.js";
import { TinyLabel } from "@/ui/tiny-swords/TinyLabel.js";
```

then update the JSX in that file: `<Button` → `<TinyButton`, `</Button>` → `</TinyButton>`, and likewise for `Input`, `Label`, `Select`, `Kbd`.

`TinyIconButton.tsx` is a special case — it currently imports the pixelact `Button` from a relative path and wraps it. Point it at `./TinyButton.js` and rename its usage.

Note `SettingsMenu.tsx`, `ControlsSettings.tsx` and `AssetBrowser.tsx` also import the pre-existing `TinySelect` (a bare `<select>`, a *different* component). Leave those imports untouched.

- [ ] **Step 5: Verify nothing references the old path**

Run: `grep -rn "pixelact" src/ test/ components.json`
Expected: no output.

- [ ] **Step 6: Move and update the button test**

```bash
git mv test/ui/pixelact-smoke.test.tsx test/ui/tiny-button.test.tsx
```

Then replace its whole contents with:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TinyButton } from "@/ui/tiny-swords/TinyButton.js";

describe("tiny button", () => {
  it("renders with the Tiny Swords frame and four authored states", () => {
    render(<TinyButton>Press Start</TinyButton>);
    const button = screen.getByRole("button", { name: "Press Start" });
    expect(button).toHaveClass("tiny-button");
    expect(button).toHaveAttribute("data-tiny-normal");
    expect(button).toHaveAttribute("data-tiny-hover");
    expect(button).toHaveAttribute("data-tiny-pressed");
    expect(button).toHaveAttribute("data-tiny-disabled");
  });
});
```

The four `data-tiny-*` assertions are unchanged on purpose. They passing after the move is the evidence that no player-facing screen regressed.

- [ ] **Step 7: Update the other UI test**

In `test/ui/tiny-swords-ui.test.tsx`, update the `pixelact-ui` import to `@/ui/tiny-swords/TinyButton.js` and rename `Button` to `TinyButton` at every usage. Change nothing else — its keyboard-activation, focus and disabled assertions must survive untouched.

- [ ] **Step 8: Run the full check**

Run: `npm run lint:fix && npm run typecheck && npm run test:ui`
Expected: all PASS, with no edits needed in `map-editor.test.tsx`, `party-screen.test.tsx`, `parties-screen.test.tsx`, `adventure-editor.test.tsx`, `auth-screen.test.tsx`, `chat.test.tsx`, `color-picker.test.tsx`, `title-screen.test.tsx`, `character-select.test.tsx` or `settings-menu.test.tsx`. **If any of those needs changing, stop.** It means the move was not mechanical, and the cause should be understood rather than patched.

- [ ] **Step 9: Commit**

Stage explicit paths only. Another agent is committing to `src/server/` and `src/client/game/` on this branch concurrently; `git add -A` would sweep their in-progress work into this commit.

```bash
git add src/client/ui src/client/styles test/ui
git commit -m "refactor absorb pixelact primitives into tiny swords superset"
```

Run `git status --short` before committing and confirm nothing outside `src/client/ui/`, `src/client/styles/` or `test/ui/` is staged.

---

## Task 4: Install stock shadcn

**Files:**
- Modify: `components.json`, `package.json`, `index.html`, `src/client/styles/app.css`
- Create: `src/client/ui/components/button.tsx`, `input.tsx`, `label.tsx` (generated)
- Create: `test/ui/shadcn-primitives.test.tsx`

**Interfaces:**
- Consumes: an `app.css` with no `@theme` block (Task 2 Step 6) and a Tiny tree that reads no shadcn token (Task 2 Step 7).
- Produces: `Button`, `buttonVariants`, `Input`, `Label` from `@/ui/components/<name>` (extensionless, as generated), plus the full stock token set on `:root`/`.dark`.

- [ ] **Step 1: Write the failing test first**

Create `test/ui/shadcn-primitives.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/ui/components/button";

describe("stock shadcn primitives", () => {
  it("renders a Base UI button that carries no Tiny Swords skin", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("data-slot", "button");
    expect(button).not.toHaveClass("tiny-button");
    expect(button).not.toHaveAttribute("data-tiny-normal");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:ui -- shadcn-primitives`
Expected: FAIL — "Failed to resolve import \"@/ui/components/button\"".

- [ ] **Step 3: Install the dependencies**

```bash
npm install @base-ui/react lucide-react tw-animate-css @fontsource-variable/geist
npm install --save-dev shadcn
```

`shadcn` is a devDependency because it is only needed at build time, to resolve the `@import "shadcn/tailwind.css"` in `app.css`. `radix-ui` stays installed — `TinyLabel` and `TinyButton` still use it.

- [ ] **Step 4: Replace `components.json`**

Write exactly:

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

- [ ] **Step 5: Install the stock token blocks into `app.css`**

The file currently holds six `@import` lines and nothing else. Insert the shadcn imports so they come **before** the project stylesheets, then append the token blocks. The result must be, in this order:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "@fontsource-variable/geist";
@import "./tokens.css";
@import "./tiny-swords-primitives.css";
@import "./theme.css";
@import "./legacy.css";
@import "./character-creator.css";

@custom-variant dark (&:is(.dark *));
```

followed verbatim by the `@theme inline { … }`, `:root { … }`, `.dark { … }` and `@layer base { … }` blocks that `shadcn init` generates for `base-nova` / `neutral`. Obtain them by scaffolding a throwaway project rather than transcribing from memory:

```bash
cd "$(mktemp -d)" && npx --yes shadcn@latest init -t vite -b base -y -n probe --no-monorepo -p nova && cat probe/src/index.css
```

Copy everything from `@theme inline` onward out of that file. Do not hand-edit the values — the point of this task is that they are stock.

Add this comment directly above `@custom-variant`:

```css
/* Everything below is stock shadcn (base-nova / neutral), generated by `shadcn init`.
 * Do not hand-tune these values: ui/components/ is regenerated by `shadcn add` and must
 * keep resolving against the upstream token set. The Tiny Swords skin owns its own
 * surfaces in tokens.css and never reads these. */
```

- [ ] **Step 6: Force dark mode**

In `index.html`, replace:

```html
<html lang="en">
```

with:

```html
<html lang="en" class="dark">
```

`<meta name="color-scheme" content="dark">` is already present.

- [ ] **Step 7: Generate the three components**

```bash
npx --yes shadcn@latest add button input label --yes
npm run lint:fix
```

Verify they landed in the right place and use Base UI:

Run: `ls src/client/ui/components/ && grep -h "^import" src/client/ui/components/button.tsx`
Expected: `button.tsx  input.tsx  label.tsx`, and an import from `@base-ui/react/button` — **not** from `radix-ui` or `@radix-ui/*`. If it pulled Radix, `components.json`'s `style` is wrong.

- [ ] **Step 8: Run the new test**

Run: `npm run test:ui -- shadcn-primitives`
Expected: PASS.

- [ ] **Step 9: Run the full check**

Run: `npm run check`
Expected: PASS.

Two known failure modes, both worth fixing properly rather than working around:
- **Typecheck errors in generated components.** This repo sets `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noUnusedParameters` and `verbatimModuleSyntax`; stock shadcn is not written against that. Fix the generated file minimally and record what changed in a comment at the top of it, so the next `shadcn add` re-applies knowingly. Do **not** loosen `tsconfig.json`.
- **Biome failing to parse `@custom-variant`.** `biome.json` sets `css.parser.tailwindDirectives: true`; if that does not cover `@custom-variant`, add `!src/client/styles/app.css` to the Biome `files.includes` ignore list and note why, rather than deleting the directive (dark mode depends on it).

- [ ] **Step 10: Verify the app actually renders**

Run: `npm run dev`, open the title screen, and confirm the Tiny Swords chrome is unchanged — the title, login and hero-creation screens must look exactly as before. Then check the browser console for unresolved-CSS-variable warnings.

This step is not optional. The UI suite runs with `css: false` and therefore cannot detect a theming regression; a human or browser-driven look is the only evidence that the token swap was safe.

- [ ] **Step 11: Commit**

Stage explicit paths only, for the same reason as Task 3.

```bash
git add components.json package.json package-lock.json index.html src/client/styles src/client/ui/components test/ui
git commit -m "feat install stock shadcn base ui foundation"
```

Run `git status --short` before committing and confirm nothing under `src/server/`, `src/shared/` or `src/client/game/` is staged.

---

## Task 5: Document the layering

The two-tree rule is invisible from the code alone, and CLAUDE.md is the file that tells the next contributor which surface to use.

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing consumed by code.

- [ ] **Step 1: Update the client architecture section**

In `CLAUDE.md`, under the `src/client/` tree listing, replace the `ui/` line with:

```
  ui/           React components: screens, HUD, chat, overlays and creator tools.
    components/ stock shadcn (Base UI, base-nova). Generated by `shadcn add` — do not
                hand-edit. The vocabulary for creator tools and any non-game surface.
    tiny-swords/ the game superset: TinyButton/TinyInput/TinyLabel/TinyFieldSelect/TinyKbd
                plus panels and bars. Reads its own `--tiny-*` tokens from tokens.css and
                never a shadcn token, so the two trees can be restyled independently.
```

- [ ] **Step 2: Add the rule to Conventions**

Append to the `## Conventions` list:

```markdown
- Two component trees, one rule each. Player/game UI uses `ui/tiny-swords/`; creator tools and
  any non-game surface use stock shadcn from `ui/components/`. Never import a Tiny component
  into an editor to "match the theme", and never hand-edit `ui/components/` — run
  `npx shadcn@latest add <name>` then `npm run lint:fix`. See
  `docs/superpowers/specs/2026-07-18-shadcn-base-ui-port-design.md`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs record the two component tree rule"
```

---

## Self-Review Notes

Spec coverage checked section by section: layering → Tasks 3 and 4; `components.json` → Task 4 Step 4; both token collisions → Tasks 1 and 2; dead-component deletion → Task 3 Step 1; dependencies → Task 4 Step 3; the three-component scope → Task 4 Step 7; every listed test change → Task 3 Steps 6–8 and Task 4 Steps 1–2; the font finding → carried into Task 5's documentation rather than a code change, since `legacy.css:3` already prevents the leak; both spec risks → Task 4 Step 9.

Export names are consistent across tasks: `TinyButton`/`TinyInput`/`TinyLabel`/`TinyFieldSelect`/`TinyKbd` are declared in Task 3's Interfaces block and used with those exact names in Steps 4, 6, 7 and in Task 5.
