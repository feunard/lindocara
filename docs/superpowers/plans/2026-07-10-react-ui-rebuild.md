# React UI Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild every DOM overlay (auth, character select, HUD, chat, event log, prompt, interior, help, status, locale toggle) as React components skinned with garrison's textured-PNG look, leaving the PixiJS canvas and the entire game loop untouched.

**Architecture:** React 19 mounts into `#root` beside the `#stage` canvas. A Zustand store bridges the imperative game loop (net.ts callbacks + per-frame handler write) to React (components subscribe with selectors). The port is incremental: each task moves one surface from `index.html`+`main.ts` DOM code into React, and the tree stays green (`npm run check` + browser-usable) at every commit.

**Tech Stack:** React 19, Vite (existing Cloudflare plugin + `@vitejs/plugin-react`), Tailwind v4 (`@tailwindcss/vite`), shadcn structure, PixelAct UI registry components (restyled), Zustand, Vitest + jsdom + Testing Library for UI tests.

**Spec:** `docs/superpowers/specs/2026-07-10-react-ui-rebuild-design.md`

## Global Constraints

- Zero changes under `src/server/**`, `src/shared/protocol.ts`, `src/shared/game.ts`. The 146 workerd tests must pass untouched at every commit.
- Biome `noNonNullAssertion`: never write `!`, narrow properly. `npm run lint:fix` before every commit.
- The `#stage` canvas lives OUTSIDE the React root as a sibling; React must never create, move, or unmount it.
- React never drives the game: no game logic in components; the store is written by the game session and read by React.
- Store text state holds i18n keys + params, never rendered strings (exception: event-log and chat lines render once at arrival). All user-facing strings via `t()` from `src/client/i18n.ts`.
- Machine-code API errors: components map codes via the `ERROR_KEYS` table; stored per-form error codes, re-rendered by React on locale change automatically.
- `import.meta.env.DEV` `window.__lindocara` handle must survive.
- UI tests: `.tsx` files under `test/ui/`, run by `vitest.ui.config.ts` (jsdom), NEVER by the workerd pool (its glob only matches `.ts`). `test/ui/**` is typechecked by the client program only.
- Coexistence rule: until Task 8, legacy DOM UI and React coexist. Every task states which `index.html` markup dies and which `main.ts`/`session.ts` code stops running. Never leave two owners for one surface.
- `npm run check` green before every commit (it will grow a UI-test step in Task 1).

## Pre-flight

- [ ] `git checkout -b feature/react-ui` (from up-to-date `main`).

---

### Task 1: React + Tailwind foundation, locale toggle as the first component

**Files:**
- Modify: `package.json` (deps + scripts), `vite.config.ts`, `tsconfig.client.json`, `index.html`
- Create: `src/client/main.tsx`, `src/client/ui/App.tsx`, `src/client/ui/LocaleToggle.tsx`, `src/client/styles/app.css`, `src/client/lib/utils.ts`, `components.json`, `vitest.ui.config.ts`, `test/ui/setup.ts`, `test/ui/locale-toggle.test.tsx`
- Modify: `src/client/i18n.ts` (add `useLocale`, unsubscribe support; drop toggle-button wiring)
- Delete: nothing yet (`src/client/main.ts` keeps running the whole legacy UI)

**Interfaces:**
- Produces: `useLocale(): Locale` hook (re-render on toggle); `onLocaleChange(fn): () => void` now returns an unsubscribe; `cn(...inputs)` helper; `<App/>` shell that renders `<LocaleToggle/>` and (for now) nothing else; npm script `test:ui`; `npm run check` runs lint → typecheck → workerd tests → UI tests.
- Consumes: existing `i18n.ts` internals.

- [ ] **Step 1: Install dependencies**

```bash
npm install react react-dom zustand
npm install -D @vitejs/plugin-react tailwindcss @tailwindcss/vite @types/react @types/react-dom \
  jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom \
  class-variance-authority clsx tailwind-merge
```

- [ ] **Step 2: Wire Vite, TypeScript, and scripts**

`vite.config.ts` — full replacement:

```ts
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  // The Cloudflare plugin reads wrangler.jsonc, runs the Worker and the Durable Object
  // inside workerd during `vite dev`, and emits a deployable wrangler.json next to the
  // client build. React and Tailwind only touch the client graph.
  plugins: [cloudflare(), react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/client", import.meta.url)) },
  },
  build: {
    sourcemap: true,
  },
});
```

`tsconfig.client.json` — full replacement:

```json
{
  // The browser bundle. DOM lib, no Workers types.
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "jsx": "react-jsx",
    "paths": { "@/*": ["./src/client/*"] }
  },
  "include": [
    "src/client/**/*.ts",
    "src/client/**/*.tsx",
    "src/shared/**/*.ts",
    "test/ui/**/*.ts",
    "test/ui/**/*.tsx"
  ]
}
```

`package.json` scripts: `"test:ui": "vitest run -c vitest.ui.config.ts"` and change
`"check": "npm run lint && npm run typecheck && npm run test && npm run test:ui"`.

- [ ] **Step 3: shadcn scaffolding (no CLI init — write the files)**

`components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/client/styles/app.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/ui",
    "ui": "@/ui",
    "lib": "@/lib",
    "utils": "@/lib/utils",
    "hooks": "@/hooks"
  }
}
```

`src/client/lib/utils.ts`:

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

`src/client/styles/app.css` (imported by `main.tsx`; `style.css` keeps serving the legacy UI until Task 8):

```css
@import "tailwindcss";

/* Design tokens land here in Task 2 (garrison skin). */
```

- [ ] **Step 4: i18n hook + unsubscribe**

In `src/client/i18n.ts`:
- `onLocaleChange` becomes:

```ts
export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
```

- Add (new imports: `import { useSyncExternalStore } from "react";`):

```ts
/** React subscription to the locale — components re-render on toggle. */
export function useLocale(): Locale {
  return useSyncExternalStore(onLocaleChange, currentLocale);
}
```

- In `initLocale()`, delete the `#locale-toggle` button wiring and the `paint` closure (React owns the toggle now); keep `document.documentElement.lang = current;`, keep the `onLocaleChange(() => applyStaticText())` subscription and the initial `applyStaticText()` (legacy markup still uses `data-i18n` until Task 8).

- [ ] **Step 5: Mount React**

`index.html`: add `<div id="root"></div>` right after the `<canvas id="stage">`; DELETE the `#locale-toggle` markup (React renders it now). Change the script tag to `<script type="module" src="/src/client/main.tsx"></script>`.

`src/client/main.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { App } from "./ui/App.js";
import "./styles/app.css";
// The legacy DOM app keeps running everything React has not yet taken over.
// Tasks 4-8 move surfaces out of it one by one; Task 8 deletes it.
import "./main.js";

const root = document.querySelector("#root");
if (!root) throw new Error("index.html is missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

(Vite resolves `./main.js` to `main.ts`. `main.ts` no longer needs to be the entry; its top-level boot keeps working as a side-effect import.)

`src/client/ui/App.tsx`:

```tsx
import { LocaleToggle } from "./LocaleToggle.js";

export function App() {
  return <LocaleToggle />;
}
```

`src/client/ui/LocaleToggle.tsx`:

```tsx
import { cn } from "@/lib/utils.js";
import { setLocale, useLocale } from "../i18n.js";

const LOCALES = ["en", "fr"] as const;

export function LocaleToggle() {
  const locale = useLocale();
  return (
    <fieldset id="locale-toggle" aria-label="Language / Langue">
      {LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          className={cn(locale === code && "active")}
          onClick={() => setLocale(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </fieldset>
  );
}
```

(The existing `#locale-toggle` CSS in `style.css` styles it unchanged.)

- [ ] **Step 6: UI test harness + first test**

`vitest.ui.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// jsdom project for React components. Deliberately separate from vitest.config.ts:
// that one runs inside workerd and must never load DOM code.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/client", import.meta.url)) },
  },
  test: {
    name: "lindocara-ui",
    environment: "jsdom",
    include: ["test/ui/**/*.test.tsx"],
    setupFiles: ["./test/ui/setup.ts"],
    css: false,
  },
});
```

`test/ui/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  localStorage.clear();
});
```

`test/ui/locale-toggle.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { currentLocale, setLocale } from "../../src/client/i18n.js";
import { LocaleToggle } from "../../src/client/ui/LocaleToggle.js";

describe("LocaleToggle", () => {
  it("marks the current locale active and switches on click", async () => {
    setLocale("en");
    render(<LocaleToggle />);
    expect(screen.getByRole("button", { name: "EN" })).toHaveClass("active");

    await userEvent.click(screen.getByRole("button", { name: "FR" }));
    expect(currentLocale()).toBe("fr");
    expect(screen.getByRole("button", { name: "FR" })).toHaveClass("active");
    expect(document.documentElement.lang).toBe("fr");
  });
});
```

Run: `npm run test:ui` → 1 passed. (Before Step 5's implementation existed it would fail to resolve `LocaleToggle.js` — the usual TDD order applies per-component within tasks.)

- [ ] **Step 7: Full verification**

Run: `npm run check` → lint, 3 typechecks, 146 workerd tests, 1 UI test — all green.
Then restart `npm run dev` and click through: login screen renders (legacy), the React FR/EN toggle sits top-right and flips the legacy UI live (proves the bridge between React toggle and legacy `applyStaticText` works).

- [ ] **Step 8: Commit**

```bash
npm run lint:fix
git add -A
git commit -m "Mount React beside the canvas; port the locale toggle"
```

---

### Task 2: Garrison skin + PixelAct UI components

**Files:**
- Create: `src/client/assets/hud/` (4 PNGs copied from garrison), `src/client/styles/tokens.css`, `src/client/styles/theme.css`
- Create (registry): `src/client/ui/pixelact-ui/*` for: button, input, label, card, dialog, select, badge, kbd, tooltip
- Modify: `src/client/styles/app.css`

**Interfaces:**
- Produces: CSS classes `.framed`, `.parchment`, `.wood`, `.pixelated`; CSS custom properties `--font-display`, `--font-ui`, `--parchment`, `--parchment-ink`, `--surface-raised`; restyled PixelAct components importable as `@/ui/pixelact-ui/<name>` (button exports `Button`, input `Input`, label `Label`, card `Card`/`CardContent`/`CardHeader`/`CardTitle`, dialog `Dialog`/`DialogContent`/`DialogTrigger`, select `Select`/..., badge `Badge`, kbd `Kbd`, tooltip `Tooltip`/...).
- Consumes: Task 1 alias/config.

- [ ] **Step 1: Copy the garrison asset kit**

```bash
mkdir -p src/client/assets/hud
cp ../garrison/src/assets/art/hud/frame-panel.png \
   ../garrison/src/assets/art/hud/frame-button.png \
   ../garrison/src/assets/art/hud/paper.png \
   ../garrison/src/assets/art/hud/wood.png \
   src/client/assets/hud/
```

(Your own project's assets; 9-slice frames are 783 B/579 B, tiles ~94 KB/~73 KB.)

- [ ] **Step 2: Tokens + theme**

`src/client/styles/tokens.css`:

```css
/* Design tokens. Fonts follow garrison (display for headings/buttons, UI for body);
 * everything below is swappable without touching components. */
:root {
  --font-display: "Cinzel", "Georgia", serif;
  --font-ui: "Inter", system-ui, sans-serif;
  --parchment: #e8d9b0;
  --parchment-ink: #2b1d10;
  --surface-raised: rgba(24, 16, 10, 0.96);
  --gold: #f0d060;
}
```

(If garrison's woff2 files are wanted verbatim, copy `../garrison/src/assets/fonts/*` and its `@font-face` blocks from `../garrison/src/ui/tokens.css` into this file with paths adjusted; otherwise the stacks above degrade gracefully. Copy them — the look is the point.)

`src/client/styles/theme.css` (the garrison recipe, verbatim technique):

```css
.framed {
  border: 13px solid transparent;
  border-image: url("../assets/hud/frame-panel.png") 26 / 13px stretch;
  background: var(--surface-raised);
  background-clip: padding-box;
}

.parchment {
  background: var(--parchment) url("../assets/hud/paper.png");
  color: var(--parchment-ink);
}

.wood {
  background: #3a2818 url("../assets/hud/wood.png");
}

.pixelated {
  image-rendering: pixelated;
}

.btn-frame {
  border: 8px solid transparent;
  border-image: url("../assets/hud/frame-button.png") 14 / 8px stretch;
  background: linear-gradient(180deg, #8a6a34 0%, #6b4c1e 55%, #57390f 100%);
  background-clip: padding-box;
  color: #f7ead0;
  font-family: var(--font-display);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.75);
}
.btn-frame:hover:not(:disabled) {
  filter: brightness(1.16);
  box-shadow: 0 0 14px rgba(240, 208, 96, 0.35);
}
.btn-frame:active:not(:disabled) {
  transform: translateY(1px);
  filter: brightness(0.86);
}
.btn-frame:disabled {
  filter: grayscale(0.6) brightness(0.7);
}
```

`app.css` becomes:

```css
@import "tailwindcss";
@import "./tokens.css";
@import "./theme.css";
```

- [ ] **Step 3: Install PixelAct components**

```bash
for c in button input label card dialog select badge kbd tooltip; do
  npx shadcn@latest add "https://pixelactui.com/r/$c.json" --yes
done
```

Components land under `src/client/ui/pixelact-ui/` (via the `aliases.ui` mapping). If the CLI fails (network/registry), vendor instead: fetch each component's source from `github.com/pixelact-ui/pixelact-ui` under `apps/web/src/components/ui/pixelact-ui/` and commit it manually with its imports rewritten to `@/lib/utils.js` — the registry files are plain `.tsx`+`.css`.

- [ ] **Step 4: Restyle to the garrison skin**

In the copied components (they are ours now):
- `button`: replace its pixel box-shadow border classes with `btn-frame` (add to the base cva class string; keep size variants). Delete its `button.css` box-shadow rules that fight `border-image`.
- `card`/`dialog` content: add `framed` to the container class and `parchment` (cards) — dialogs keep `framed` over `var(--surface-raised)`.
- `input`: keep PixelAct's structure; swap fonts to `var(--font-ui)`, border to a 2px solid using `--parchment-ink`-derived color on parchment surfaces.
- Do NOT restyle beyond these three touchpoints; the rest inherits tokens.

Add a quick visual smoke to `App.tsx` temporarily? NO — do not commit demo markup. Verify visually in Task 4 when the first real screen uses them. For this task, verification is compile-level plus one snapshot-free render test:

`test/ui/pixelact-smoke.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/ui/pixelact-ui/button/index.js";

describe("pixelact button", () => {
  it("renders with the garrison frame class", () => {
    render(<Button>Press Start</Button>);
    const button = screen.getByRole("button", { name: "Press Start" });
    expect(button.className).toContain("btn-frame");
  });
});
```

(Adjust the import path to the actual file layout the registry produced — `button/index.tsx` or `button.tsx`.)

- [ ] **Step 5: Verify and commit**

Run: `npm run check` → all green (typecheck now compiles the copied components).

```bash
npm run lint:fix
git add -A
git commit -m "Add garrison PNG skin and PixelAct UI components"
```

---

### Task 3: `api.ts` + the Zustand store (no visual change)

**Files:**
- Create: `src/client/api.ts`, `src/client/store.ts`
- Modify: `src/client/main.ts` (delete the api/error block, import from `api.js`)
- Test: `test/ui/store.test.tsx`

**Interfaces:**
- Produces (`api.ts`): `interface Me { id: string; username: string }`, `interface CharacterSummary { id: string; name: string; appearance: Appearance; level: number }`, `const MAX_CHARACTERS = 3`, `class ApiError extends Error { readonly code: string }`, `api<T>(path, init?): Promise<T>`, `fetchMe(): Promise<Me | null>`, `fetchCharacters(): Promise<CharacterSummary[]>`, `errorCode(error: unknown): string`, `authErrorText(code: string): string`, `logout(): Promise<void>` (DELETE /api/session then `window.location.reload()`).
- Produces (`store.ts`), the exact shape every later task consumes:

```ts
import { create } from "zustand";
import type { MessageKey } from "../shared/i18n/index.js";
import type { PlayerSnapshot, SelfState, QuestStatus } from "../shared/protocol.js";
import type { CharacterSummary } from "./api.js";

export interface LocalizedText {
  key: MessageKey;
  params?: Record<string, string | number>;
}

export interface EventLine {
  id: number;
  text: string; // rendered at arrival, deliberately (spec)
  tone: "info" | "good" | "bad";
}

export interface ChatLine {
  id: number;
  from: string;
  text: string;
}

/** What the HUD needs from the self snapshot — excludes x/y so it does not churn 60x/s. */
export interface SelfHud {
  nick: string;
  level: number;
  hp: number;
  maxHp: number;
  dead: boolean;
}

export interface GameHandle {
  attack(): void;
  interact(): void;
  usePotion(): void;
  sendChat(text: string): void;
  switchCharacter(): void;
  logout(): void;
}

interface UiState {
  screen: "auth" | "characters" | "game";
  characters: CharacterSummary[] | null;
  self: SelfHud | null;
  selfState: SelfState | null;
  questStatus: QuestStatus;
  prompt: LocalizedText | null;
  status: LocalizedText | null;
  events: EventLine[];
  chat: ChatLine[];
  chatFocusRequest: number;
  attackCooldownUntil: number;
  interiorDoorId: string | null;
  game: GameHandle | null;

  setScreen(screen: UiState["screen"]): void;
  setCharacters(characters: CharacterSummary[] | null): void;
  setSelf(self: SelfHud | null): void;
  setSelfState(state: SelfState): void;
  setQuestStatus(status: QuestStatus): void;
  setPrompt(prompt: LocalizedText | null): void;
  setStatus(status: LocalizedText): void;
  addEvent(text: string, tone: EventLine["tone"]): void;
  removeEvent(id: number): void;
  addChat(from: string, text: string): void;
  requestChatFocus(): void;
  setAttackCooldownUntil(until: number): void;
  setInteriorDoorId(id: string | null): void;
  setGame(game: GameHandle | null): void;
}

export const useUiStore = create<UiState>(...);
```

  Implementation details: `addEvent` assigns `id` from a module counter and trims to the newest 6; `addChat` trims to the newest 8; `setSelf`/`setPrompt`/`setStatus` are no-ops when the value is shallow-equal to the current one (this is the 60fps guard — compare each `SelfHud` field, and `key`+`JSON.stringify(params)` for `LocalizedText`); `requestChatFocus` increments the counter. Store is import-safe outside React (`useUiStore.getState()` / `useUiStore.setState()`).

- [ ] **Step 1: Failing store test**

`test/ui/store.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { useUiStore } from "../../src/client/store.js";

describe("ui store", () => {
  it("caps the event log at 6 and the chat at 8", () => {
    const store = useUiStore.getState();
    for (let i = 0; i < 9; i++) store.addEvent(`event ${i}`, "info");
    for (let i = 0; i < 10; i++) store.addChat("nick", `line ${i}`);
    const state = useUiStore.getState();
    expect(state.events).toHaveLength(6);
    expect(state.events[0]?.text).toBe("event 3");
    expect(state.chat).toHaveLength(8);
    expect(state.chat[7]?.text).toBe("line 9");
  });

  it("setSelf is referentially stable for equal values", () => {
    const self = { nick: "Hero", level: 2, hp: 90, maxHp: 112, dead: false };
    useUiStore.getState().setSelf(self);
    const first = useUiStore.getState().self;
    useUiStore.getState().setSelf({ ...self });
    expect(useUiStore.getState().self).toBe(first);
  });
});
```

Run: `npm run test:ui` → FAIL (module missing).

- [ ] **Step 2: Implement `api.ts` and `store.ts`**

`api.ts` is a verbatim extraction from `main.ts:26-91` (the `Me`/`CharacterSummary` interfaces, `MAX_CHARACTERS`, `ApiError`, `api()`, `fetchMe`, `fetchCharacters`, `ERROR_KEYS`, `errorCode`, `authErrorText`) plus:

```ts
export async function logout(): Promise<void> {
  await fetch("/api/session", { method: "DELETE" });
  window.location.reload();
}
```

`store.ts` implements the interface above. The events cap keeps the NEWEST 6 with new entries appended (`[...events, line].slice(-6)`) — note the legacy DOM prepended; the React `EventLog` will render newest-first by reversing in the component.

- [ ] **Step 3: Point `main.ts` at `api.ts`**

Delete `main.ts:26-91` and import `{ api, ApiError → (not needed), fetchMe, fetchCharacters, errorCode, authErrorText, MAX_CHARACTERS, type CharacterSummary, type Me }` from `./api.js` (import exactly what remains used; Biome will flag leftovers). `lastCharacters`, forms, and all behavior stay as-is.

- [ ] **Step 4: Verify and commit**

Run: `npm run check` → green (2 new UI tests pass; game still fully playable — restart dev server and spot-check login).

```bash
npm run lint:fix
git add -A
git commit -m "Extract the API client and add the UI store"
```

---

### Task 4: AuthScreen + CharacterSelect in React

**Files:**
- Create: `src/client/ui/AuthScreen.tsx`, `src/client/ui/CharacterSelect.tsx`, `src/client/ui/Tabs.tsx` (in-house, PixelAct has none)
- Modify: `src/client/ui/App.tsx`, `src/client/main.ts`, `index.html`
- Test: `test/ui/auth-screen.test.tsx`, `test/ui/character-select.test.tsx`

**Interfaces:**
- Consumes: `api.ts`, `useUiStore` (`screen`, `characters`, `setScreen`, `setCharacters`), `t`/`useLocale`, PixelAct `Button`/`Input`/`Label`/`Card`/`Badge`, `Tabs`.
- Produces: `<AuthScreen/>` (calls `setScreen("characters")` after login/register); `<CharacterSelect onPlay={(c: CharacterSummary) => void}/>`; `App` owns boot: on mount `fetchMe()` → `setScreen("characters")` or `"auth"`; `main.ts` exports `startGame(character: CharacterSummary): Promise<void>` (the renamed `play`) — `App` calls it and sets `setScreen("game")`.
- Dies: `#auth` and `#characters` markup in `index.html`; `main.ts` lines for tabs/forms/lists (`:100-300` area: element lookups, `showAuth`, `setTab`, both submit handlers, `showCharacters`, `renderCharacterList`, `newCharacterCard`, create/cancel/logout handlers, `lastCharacters`, `showFormError` machinery for login/register/character) and the boot block at the bottom (`initLocale()` stays, called from `main.tsx` now; the `fetchMe` boot moves to `App`).

- [ ] **Step 1: Failing tests**

`test/ui/auth-screen.test.tsx` (fetch stubbed at the seam):

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { AuthScreen } from "../../src/client/ui/AuthScreen.js";

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("AuthScreen", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({ screen: "auth" });
  });

  it("switches tabs and blocks mismatched register passwords client-side", async () => {
    const mock = stubFetch(200, {});
    render(<AuthScreen />);
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await userEvent.type(screen.getByLabelText("Username"), "nico");
    await userEvent.type(screen.getByLabelText("Password"), "12345678");
    await userEvent.type(screen.getByLabelText("Confirm password"), "87654321");
    await userEvent.click(screen.getByRole("button", { name: "Create account", exact: true }));
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match.");
    expect(mock).not.toHaveBeenCalled();
  });

  it("shows the machine-code error localized, and re-localizes on toggle", async () => {
    stubFetch(401, { error: "invalid_credentials" });
    render(<AuthScreen />);
    await userEvent.type(screen.getByLabelText("Username"), "nico");
    await userEvent.type(screen.getByLabelText("Password"), "12345678");
    await userEvent.click(screen.getByRole("button", { name: "Enter the Hollow" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong username or password.");
    setLocale("fr");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nom d'utilisateur ou mot de passe incorrect.",
    );
  });

  it("moves to the characters screen on successful login", async () => {
    stubFetch(200, { id: "a", username: "nico" });
    render(<AuthScreen />);
    await userEvent.type(screen.getByLabelText("Username"), "nico");
    await userEvent.type(screen.getByLabelText("Password"), "12345678");
    await userEvent.click(screen.getByRole("button", { name: "Enter the Hollow" }));
    await vi.waitFor(() => expect(useUiStore.getState().screen).toBe("characters"));
  });
});
```

`test/ui/character-select.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterSummary } from "../../src/client/api.js";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { CharacterSelect } from "../../src/client/ui/CharacterSelect.js";

const three: CharacterSummary[] = [
  { id: "1", name: "One", appearance: "azure", level: 1 },
  { id: "2", name: "Two", appearance: "ember", level: 2 },
  { id: "3", name: "Three", appearance: "moss", level: 3 },
];

describe("CharacterSelect", () => {
  beforeEach(() => {
    setLocale("en");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("disables the new-character card at the cap", () => {
    useUiStore.setState({ screen: "characters", characters: three });
    render(<CharacterSelect onPlay={() => undefined} />);
    expect(screen.getByRole("button", { name: "New character" })).toBeDisabled();
  });

  it("requires two clicks to delete", async () => {
    const mock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", mock);
    useUiStore.setState({ screen: "characters", characters: [three[0] as CharacterSummary] });
    render(<CharacterSelect onPlay={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(mock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete forever?" }));
    expect(mock).toHaveBeenCalledWith("/api/characters/1", expect.objectContaining({ method: "DELETE" }));
  });

  it("calls onPlay with the chosen character", async () => {
    const onPlay = vi.fn();
    useUiStore.setState({ screen: "characters", characters: three });
    render(<CharacterSelect onPlay={onPlay} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Play" })[0] as HTMLElement);
    expect(onPlay).toHaveBeenCalledWith(three[0]);
  });
});
```

Run: `npm run test:ui` → FAIL (components missing).

- [ ] **Step 2: Implement `Tabs.tsx`**

```tsx
import { cn } from "@/lib/utils.js";

interface TabsProps {
  tabs: ReadonlyArray<{ id: string; label: string }>;
  active: string;
  onSelect(id: string): void;
}

export function Tabs({ tabs, active, onSelect }: TabsProps) {
  return (
    <div className="flex gap-2" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          className={cn(
            "btn-frame flex-1 py-2 opacity-60",
            tab.id === active && "opacity-100 font-bold",
          )}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Implement `AuthScreen.tsx`**

Functional contract (build with PixelAct `Button`/`Input`/`Label`, the `framed`/`parchment` classes for the card, Tailwind for layout; every string via `t()`, with `useLocale()` called once at the top so the component re-renders on toggle):

```tsx
import { useState } from "react";
import { Button } from "@/ui/pixelact-ui/button/index.js";
import { Input } from "@/ui/pixelact-ui/input.js";
import { Label } from "@/ui/pixelact-ui/label.js";
import { api, authErrorText, errorCode, type Me } from "../api.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";
import { Tabs } from "./Tabs.js";

type Tab = "login" | "register";

export function AuthScreen() {
  useLocale();
  const setScreen = useUiStore((s) => s.setScreen);
  const [tab, setTab] = useState<Tab>("login");
  const [error, setError] = useState<string | null>(null); // machine code, not text
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    if (tab === "register" && data.get("password") !== data.get("confirm")) {
      setError("password_mismatch");
      return;
    }
    setBusy(true);
    try {
      await api<Me>(tab === "login" ? "/api/session" : "/api/register", {
        method: "POST",
        body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
      });
      setScreen("characters");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }
  // render: fixed inset-0 grid place-items-center; a .framed.parchment card containing
  // eyebrow (t("auth.eyebrow")), h1 lindocara, h2 t("auth.subtitle"), p t("auth.tagline")),
  // <Tabs tabs={[{id:"login",label:t("auth.tab.login")},{id:"register",label:t("auth.tab.register")}]}
  //   active={tab} onSelect={(id)=>{setTab(id as Tab); setError(null);}} />
  // one <form key={tab} onSubmit={submit}> whose fields depend on the tab:
  //   username: <Label htmlFor="auth-username">{t("auth.username")}</Label>
  //             <Input id="auth-username" name="username" minLength={2} maxLength={16}
  //                    pattern="[A-Za-z0-9_\-]{2,16}" autoComplete="username" required />
  //   password: t("auth.password"), type="password", minLength 8 maxLength 128,
  //             autoComplete login? "current-password" : "new-password"
  //   register-only confirm: t("auth.password_confirm"), name="confirm"
  //   submit <Button disabled={busy}>{t(tab === "login" ? "auth.submit.login" : "auth.submit.register")}</Button>
  //   {error && <p role="alert">{authErrorText(error)}</p>}
}
```

The commented render sketch is normative: ids, names, validation attributes, and key usage must match it exactly (the tests depend on labels and roles). Because `error` stores the code and `useLocale()` re-renders, error re-localization is automatic.

- [ ] **Step 4: Implement `CharacterSelect.tsx`**

Contract: subscribes to `characters` from the store, fetches on mount when null, renders cards + create form.

```tsx
import { useEffect, useState } from "react";
import { Button } from "@/ui/pixelact-ui/button/index.js";
import { Input } from "@/ui/pixelact-ui/input.js";
import { Label } from "@/ui/pixelact-ui/label.js";
import {
  api,
  authErrorText,
  type CharacterSummary,
  errorCode,
  fetchCharacters,
  logout,
  MAX_CHARACTERS,
} from "../api.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";

export function CharacterSelect({ onPlay }: { onPlay(character: CharacterSummary): void }) {
  useLocale();
  const characters = useUiStore((s) => s.characters);
  const setCharacters = useUiStore((s) => s.setCharacters);
  const setScreen = useUiStore((s) => s.setScreen);
  const [creating, setCreating] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (characters !== null) return;
    fetchCharacters().then(setCharacters, () => setScreen("auth"));
  }, [characters, setCharacters, setScreen]);
  // ...
}
```

Behavior requirements (normative):
- `characters === null` → render nothing (fetch in flight).
- Card per character: appearance swatch (`swatch swatch--{appearance}` classes already in style.css — keep using them), name, `t("hud.level", {level})`, Play button (`onPlay(character)`), Delete button — first click sets `confirmingId`, relabels to `t("chars.delete_confirm")`; second click `api DELETE` then `setCharacters(null)` (triggers refetch) and `setConfirmingId(null)`.
- New-character card: disabled at `characters.length >= MAX_CHARACTERS`; click → `setCreating(true)`. Creation form auto-shows when `characters.length === 0`.
- Create form: name input (`id="character-name"`, same pattern attributes as auth username), four appearance radio swatches (`name="appearance"`, values azure/ember/moss/violet, azure checked), submit → `api POST /api/characters` → reset + `setCreating(false)` + `setCharacters(null)`; cancel → `setCreating(false)`. Errors as machine codes → `authErrorText`.
- Header: `t("chars.title")` + a logout Button calling `logout()`.

- [ ] **Step 5: Rewire `App.tsx` and gut the legacy code**

`App.tsx`:

```tsx
import { useEffect } from "react";
import type { CharacterSummary } from "../api.js";
import { fetchMe } from "../api.js";
import { startGame } from "../main.js";
import { useUiStore } from "../store.js";
import { AuthScreen } from "./AuthScreen.js";
import { CharacterSelect } from "./CharacterSelect.js";
import { LocaleToggle } from "./LocaleToggle.js";

export function App() {
  const screen = useUiStore((s) => s.screen);
  const setScreen = useUiStore((s) => s.setScreen);

  useEffect(() => {
    fetchMe().then((me) => setScreen(me ? "characters" : "auth"));
  }, [setScreen]);

  function play(character: CharacterSummary) {
    setScreen("game");
    void startGame(character);
  }

  return (
    <>
      <LocaleToggle />
      {screen === "auth" && <AuthScreen />}
      {screen === "characters" && <CharacterSelect onPlay={play} />}
    </>
  );
}
```

`main.ts`: rename `play` → `export async function startGame(...)` and delete everything the screens owned (see the task's "Dies" list — element lookups for auth/characters, handlers, `showAuth`/`setTab`/`showCharacters`/`renderCharacterList`/`newCharacterCard`, `lastCharacters`, the login/register/character branches of the form-error machinery, the boot block; `initLocale()` moves to `main.tsx` before render; keep the `onLocaleChange` subscription only for the parts still legacy: status, state, player, interior). Delete the `#auth`/`#characters` markup from `index.html`. Keep `#switch-character`/`#logout-game` wiring inside `startGame` (still legacy HUD).

The circular import (`main.tsx` side-effect-imports `main.ts`; `App` imports `startGame` from `main.ts`) is benign under ESM but ugly — resolve it now: move the side-effect import out by making `main.ts` export-only (no top-level boot left after this task — verify nothing at module top level still runs except constant definitions; the remaining `onLocaleChange(...)` subscription at top level is fine).

- [ ] **Step 6: Verify**

Run: `npm run check` → green (UI tests: locale-toggle, pixelact-smoke, store, auth-screen ×3, character-select ×3).
Restart `npm run dev`; click through: register (new account) → React character select (garrison-framed cards) → create → Play → the legacy in-game HUD appears and the game plays; FR toggle flips both React screens live.

- [ ] **Step 7: Commit**

```bash
npm run lint:fix
git add -A
git commit -m "Port auth and character select screens to React"
```

---

### Task 5: The game session module — store writes replace DOM writes

**Files:**
- Create: `src/client/game/session.ts` (from `main.ts`'s `startGame`), `src/client/game/interiors.ts`
- Move: `git mv src/client/net.ts src/client/game/net.ts` — same for `renderer.ts`, `input.ts`, `sound.ts`, `world-layout.ts` (update their relative imports: `../shared/...` → `../../shared/...`, `./i18n.js` → `../i18n.js`)
- Modify: `src/client/ui/App.tsx` (import `startGame` from `../game/session.js`), delete `src/client/main.ts`
- Test: none new (this task is a refactor; the covering evidence is `npm run check` + the browser click-through)

**Interfaces:**
- Consumes: `useUiStore` setters (`setSelf`, `setSelfState`, `setQuestStatus`, `setPrompt`, `setStatus`, `addEvent`, `addChat`, `requestChatFocus`, `setAttackCooldownUntil`, `setInteriorDoorId`, `setGame`, `setScreen`, `setCharacters`), `api.ts` `logout`.
- Produces: `startGame(character: CharacterSummary): Promise<void>` in `game/session.ts`; `INTERIORS`/`InteriorDoor`/`INTERIOR_RANGE`/`nearestInterior(self)` in `game/interiors.ts` (the `InteriorDoor` interface and `INTERIORS` array move verbatim from `main.ts`).
- Dies: ALL direct DOM manipulation in the session for surfaces that are still legacy — **wait, no**: this task converts the session to write ONLY to the store, and the legacy DOM pieces (`#hud`, `#chat`, `#event-log`, `#prompt`, `#interior`, `#status`, `#help`) keep rendering because Tasks 6–8 build their React replacements **in this same commit series' following tasks**. To keep THIS task green in the browser, the legacy DOM writes stay for now — the store writes are ADDED alongside them. Tasks 6–8 then delete the legacy write + markup per surface. (Double-writing for one to three commits is the price of an always-green tree; it is temporary by design.)

- [ ] **Step 1: Move the game modules**

```bash
mkdir -p src/client/game
git mv src/client/net.ts src/client/renderer.ts src/client/input.ts src/client/sound.ts src/client/world-layout.ts src/client/game/
```

Fix the import paths inside the moved files (`../shared/` → `../../shared/`, `./i18n.js` → `../i18n.js`, `./world-layout.js` stays sibling). `npm run typecheck` finds every miss.

- [ ] **Step 2: Extract `game/interiors.ts`**

Move `InteriorDoor`, `INTERIOR_RANGE`, `INTERIORS`, `nearestInterior` from `main.ts` verbatim (exported). `nearestInterior` keeps its exact signature `(self: PlayerSnapshot | undefined): InteriorDoor | undefined`.

- [ ] **Step 3: Create `game/session.ts`**

Move the remainder of `main.ts` (`startGame`, `eventText`, `shouldLogEvent`, `updatePrompt`, `updateAttackCooldown`, `renderState`, `renderPlayer`, `itemChip`, `addEvent`, `addChat`, `openInterior`, `closeInterior`, `setStatus`, the element lookups for still-legacy surfaces, the `onLocaleChange` subscription, the sound instance) into `game/session.ts`, and ADD store writes at these exact points:

| Session moment | Store write (added) |
|---|---|
| `setStatus(() => t(key, params))` call sites | also `useUiStore.getState().setStatus({ key, params })` — refactor `setStatus` to take `(key, params?)` and do both |
| `renderState(state)` | also `setSelfState(state)` and `setQuestStatus(state.quest.status)` |
| `renderPlayer(self)` | also `setSelf(self ? { nick: self.nick, level: self.level, hp: self.hp, maxHp: self.maxHp, dead: self.dead } : null)` |
| `addEvent(text, tone)` | also `useUiStore.getState().addEvent(text, tone)` |
| `addChat(from, text)` | also `useUiStore.getState().addChat(from, text)` |
| `updatePrompt(...)` computes text | refactor to compute `{ key, params } \| null` once, write `setPrompt(...)`, and keep setting the legacy DOM from `t(key, params)` |
| attack handler sets `attackCooldownUntil` | also `setAttackCooldownUntil(until)` |
| `openInterior(door)` / `closeInterior()` | also `setInteriorDoorId(door.id)` / `setInteriorDoorId(null)` |
| `focusChat` action | also `requestChatFocus()` |
| after `client.connect(...)` | `setGame({ attack, interact, usePotion, sendChat: connection.sendChat, switchCharacter: () => { connection.close(); window.location.reload(); }, logout: () => { connection.close(); void logout(); } })` where attack/interact/usePotion are the same closures handed to `trackActions` |
| `onClose` | also `setGame(null)` |

Interior gating that reads `interior.hidden` should now read `useUiStore.getState().interiorDoorId !== null` (single source of truth for open/closed; the legacy `#interior` element mirrors it).

- [ ] **Step 4: Verify and commit**

Run: `npm run check` → green. Restart dev server; full click-through (login → play → attack/interact/potion/chat/interior/FR toggle) — identical behavior, now double-written to the store.

```bash
npm run lint:fix
git add -A
git commit -m "Extract the game session; write UI state to the store"
```

---

### Task 6: HUD in React (Bar, identity, quest, inventory, cooldown)

**Files:**
- Create: `src/client/ui/hud/Bar.tsx`, `src/client/ui/hud/Hud.tsx`, `src/client/ui/hud/InventoryChip.tsx`, `src/client/ui/hud/CooldownBar.tsx`
- Modify: `src/client/ui/App.tsx`, `src/client/game/session.ts`, `index.html`, `src/client/styles/theme.css`
- Test: `test/ui/bar.test.tsx`, `test/ui/hud.test.tsx`

**Interfaces:**
- Consumes: store `self`, `selfState`, `attackCooldownUntil`, `game` (`switchCharacter`/`logout`); `t`/`useLocale`; PixelAct `Badge`/`Kbd`; `ATTACK_COOLDOWN_MS` from `../../shared/game.js`.
- Produces: `<Hud/>` rendered by `App` when `screen === "game"`; `<Bar value max variant?: "hp" | "xp" | "quest"` — the in-house 9-slice progress bar: outer div `framed` (thin variant), inner fill div width `${(value/max)*100}%`, `role="progressbar"` with `aria-valuenow/max`.
- Dies: `#hud` markup in `index.html`; `renderState`/`renderPlayer`/`itemChip`/`updateAttackCooldown` legacy DOM writes and the `#hud` element lookups in `session.ts` (the store writes from Task 5 remain — they are now the only writer). The `hud.hidden = false` on welcome becomes unnecessary (React renders `<Hud/>` from `screen === "game"`).

- [ ] **Step 1: Failing tests**

`test/ui/bar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Bar } from "../../src/client/ui/hud/Bar.js";

describe("Bar", () => {
  it("exposes progressbar semantics and proportional fill", () => {
    render(<Bar value={30} max={120} variant="hp" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "30");
    expect(bar).toHaveAttribute("aria-valuemax", "120");
    const fill = bar.querySelector("[data-fill]");
    expect(fill).toHaveStyle({ width: "25%" });
  });

  it("clamps overflow", () => {
    render(<Bar value={500} max={100} variant="xp" />);
    const fill = screen.getByRole("progressbar").querySelector("[data-fill]");
    expect(fill).toHaveStyle({ width: "100%" });
  });
});
```

`test/ui/hud.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { Hud } from "../../src/client/ui/hud/Hud.js";

describe("Hud", () => {
  beforeEach(() => setLocale("en"));

  it("renders identity, bars, quest and inventory from the store", () => {
    useUiStore.setState({
      self: { nick: "Hero", level: 3, hp: 80, maxHp: 124, dead: false },
      selfState: {
        xp: 40,
        xpToNext: 220,
        inventory: { potions: 2, gold: 9, crystals: 1, weapon: "rusty_sword" },
        quest: { status: "active", progress: 1, target: 3 },
      },
    });
    render(<Hud />);
    expect(screen.getByText("Hero")).toBeInTheDocument();
    expect(screen.getByText("Level 3")).toBeInTheDocument();
    expect(screen.getByText("80/124")).toBeInTheDocument();
    expect(screen.getByText("40/220")).toBeInTheDocument();
    expect(screen.getByText("Quiet gloam creatures in the woods (1/3)")).toBeInTheDocument();
    expect(screen.getByText("Heartroot tonic")).toBeInTheDocument();
    // FR toggle re-renders live
    setLocale("fr");
    expect(screen.getByText("Niveau 3")).toBeInTheDocument();
  });
});
```

Run: `npm run test:ui` → FAIL.

- [ ] **Step 2: Implement**

`Bar.tsx`:

```tsx
import { cn } from "@/lib/utils.js";

const FILLS: Record<"hp" | "xp" | "quest", string> = {
  hp: "bg-gradient-to-b from-[#f0796b] to-[#bd494e]",
  xp: "bg-gradient-to-b from-[#f0d060] to-[#b89a30]",
  quest: "bg-gradient-to-b from-[#7fb069] to-[#557d43]",
};

export function Bar({ value, max, variant = "hp" }: { value: number; max: number; variant?: keyof typeof FILLS }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className="h-3 w-full border-2 border-black/70 bg-black/50"
    >
      <div data-fill className={cn("h-full", FILLS[variant])} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}
```

`InventoryChip.tsx` — props `{ icon: "potion" | "gold" | "crystal" | "sword"; label: string; value: string; hotkey?: string }`; renders the same structure as the legacy `itemChip` (reuse the existing `item-chip`/`item-icon item-icon--{icon}` CSS classes from style.css; `title`/`aria-label` composed identically; hotkey as PixelAct `Kbd`).

`CooldownBar.tsx` — reads `attackCooldownUntil` from the store; a local `requestAnimationFrame` loop (in `useEffect`, cancelled on unmount) recomputes remaining each frame and hides itself (`return null`) when `remaining <= 0`; renders `<Bar value={ATTACK_COOLDOWN_MS - remaining} max={ATTACK_COOLDOWN_MS} variant="quest" />` inside a `framed` mini-panel titled `t("hud.strike")`. The rAF loop stores remaining in `useState` rounded to the frame — this component re-renders per frame BY DESIGN and nothing else does.

`Hud.tsx` — a `<aside>` positioned like the legacy `#hud` (reuse its CSS by keeping `id="hud"` on the React element and deleting the markup, not the styles): identity panel (crest span, nick, `t("hud.level", {level})`, VIT `<Bar hp/>` + `hp/maxHp` text, ÉCLAT/SPARK `<Bar xp/>` + text, switch/logout buttons wired to `game.switchCharacter`/`game.logout`), quest panel (`t("hud.oath")` title; text per `quest.status` exactly as legacy `renderState` mapped them; `<Bar quest/>` when active/ready), `<CooldownBar/>`, inventory panel (`t("hud.pack")`; four `InventoryChip`s mirroring the legacy calls). All reads via store selectors; `useLocale()` at the top. Render `null` when `self === null || selfState === null`.

- [ ] **Step 3: Swap ownership**

`App.tsx` renders `{screen === "game" && <Hud />}`. Delete from `index.html`: the whole `#hud` aside. Delete from `session.ts`: the `#hud`-related element lookups (`hud`, `playerName`, `playerLevel`, `hpBar`, `hpText`, `xpBar`, `xpText`, `inventoryText`, `questText`, `questProgress`, `attackCooldown`, `combatPanel`, `#switch-character`/`#logout-game` wiring), the legacy DOM bodies of `renderState`/`renderPlayer` (keep the store writes — the functions shrink to store calls), `itemChip`, `updateAttackCooldown`, `pulse` (if now unused), and `hud.hidden = false`. `session.ts`'s `onLocaleChange` subscription drops the state/player re-render lines (React handles them).

- [ ] **Step 4: Verify and commit**

Run: `npm run check` → green. Dev click-through: HUD renders in React with garrison frames; bars track damage/XP; cooldown bar appears on attack and drains; switch character and logout work; FR toggle flips every HUD label live.

```bash
npm run lint:fix
git add -A
git commit -m "Port the HUD to React"
```

---

### Task 7: Chat, event log, prompt, status, help

**Files:**
- Create: `src/client/ui/Chat.tsx`, `src/client/ui/EventLog.tsx`, `src/client/ui/Prompt.tsx`, `src/client/ui/StatusBar.tsx`, `src/client/ui/HelpBar.tsx`
- Modify: `src/client/ui/App.tsx`, `src/client/game/session.ts`, `index.html`
- Test: `test/ui/chat.test.tsx`, `test/ui/event-log.test.tsx`

**Interfaces:**
- Consumes: store `chat`, `chatFocusRequest`, `events`, `removeEvent`, `prompt`, `status`, `game.sendChat`; `t`/`useLocale`; PixelAct `Input`/`Kbd`.
- Produces: the five components, all rendered by `App` when `screen === "game"` (StatusBar renders on every screen — it shows connecting/disconnected text).
- Dies: `#chat`, `#event-log`, `#prompt`, `#status`, `#help` markup; `addEvent`/`addChat` legacy DOM bodies, the `chatInput` focus/blur/submit listeners, `chat.classList` toggles, the `prompt`/`statusBar`/`help` lookups and writes in `session.ts` (store writes remain as sole writer). `updatePrompt` keeps computing but ONLY writes `setPrompt`.

- [ ] **Step 1: Failing tests**

`test/ui/chat.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { Chat } from "../../src/client/ui/Chat.js";

describe("Chat", () => {
  beforeEach(() => setLocale("en"));

  it("renders lines and sends trimmed input through the game handle", async () => {
    const sendChat = vi.fn();
    useUiStore.setState({
      chat: [{ id: 1, from: "alice", text: "hello" }],
      game: { attack: vi.fn(), interact: vi.fn(), usePotion: vi.fn(), sendChat, switchCharacter: vi.fn(), logout: vi.fn() },
    });
    render(<Chat />);
    expect(screen.getByText("hello")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox"), "  hi there  {Enter}");
    expect(sendChat).toHaveBeenCalledWith("hi there");
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("focuses the input when the store requests it", () => {
    useUiStore.setState({ chat: [], chatFocusRequest: 0 });
    render(<Chat />);
    useUiStore.getState().requestChatFocus();
    expect(screen.getByRole("textbox")).toHaveFocus();
  });
});
```

`test/ui/event-log.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../../src/client/store.js";
import { EventLog } from "../../src/client/ui/EventLog.js";

describe("EventLog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUiStore.setState({ events: [] });
  });

  it("renders newest first with tone markers and expires lines after 6s", () => {
    render(<EventLog />);
    act(() => {
      useUiStore.getState().addEvent("first", "good");
      useUiStore.getState().addEvent("second", "bad");
    });
    const lines = screen.getAllByText(/first|second/);
    expect(lines[0]).toHaveTextContent("! second");
    expect(lines[1]).toHaveTextContent("+ first");
    act(() => vi.advanceTimersByTime(6_100));
    expect(screen.queryByText(/first/)).not.toBeInTheDocument();
  });
});
```

(After these tests, restore real timers in the shared `afterEach` — add `vi.useRealTimers()` to `test/ui/setup.ts`'s `afterEach`.)

- [ ] **Step 2: Implement**

- `Chat.tsx`: keeps `id="chat"` (reuses existing CSS incl. `has-chat`/`chat-open` classes as React state-driven classNames); lines from `store.chat`; controlled input; submit → `game?.sendChat(trimmed)` when non-empty, clear, blur; focus/blur toggle a local `open` state mapped to `chat-open`; an effect watches `chatFocusRequest` (skip the initial value) and focuses the input. Title `t("chat.title")` + `<Kbd>Enter</Kbd>`; placeholder `t("chat.placeholder")`.
- `EventLog.tsx`: `id="event-log"` `aria-live="polite"`; renders `[...events].reverse()`; each line `event {tone}` class with the legacy marker prefix (`+ `/`! `/`* `); per-line effect `setTimeout(() => removeEvent(id), 6_000)` cleared on unmount.
- `Prompt.tsx`: `id="prompt"`; renders `t(prompt.key, prompt.params)` or `null`.
- `StatusBar.tsx`: `id="status"`; renders `status ? t(status.key, status.params) : ""`.
- `HelpBar.tsx`: `id="help"`; `<Kbd>WASD</Kbd> {t("help.move")} <Kbd>Space</Kbd> {t("help.strike")} <Kbd>E</Kbd> {t("help.commune")} <Kbd>Q</Kbd> {t("help.tonic")}`.

- [ ] **Step 3: Swap ownership**

`App.tsx` adds `<StatusBar />` always and `{screen === "game" && (<><Hud /><Chat /><EventLog /><Prompt /><HelpBar /></>)}`. Delete the five markup blocks from `index.html` and the corresponding lookups/writes/listeners from `session.ts` (per the Dies list). `session.ts`'s `focusChat` action keeps only `input.reset(); useUiStore.getState().requestChatFocus();`.

- [ ] **Step 4: Verify and commit**

Run: `npm run check` → green. Dev click-through: chat via Enter (focus jumps to input, send works, remote lines appear), events float and expire, prompt tracks NPC/doors, status shows connected/disconnected, help bar localized.

```bash
npm run lint:fix
git add -A
git commit -m "Port chat, event log, prompt, status, and help to React"
```

---

### Task 8: Interior overlay + legacy teardown

**Files:**
- Create: `src/client/ui/InteriorOverlay.tsx`
- Modify: `src/client/ui/App.tsx`, `src/client/game/session.ts`, `index.html`, `src/client/i18n.ts`, `src/client/styles/*`, `src/client/style.css`
- Test: `test/ui/interior.test.tsx`

**Interfaces:**
- Consumes: store `interiorDoorId`, `setInteriorDoorId`; `INTERIORS` from `../game/interiors.js`.
- Produces: `<InteriorOverlay/>`; a fully-React `index.html` (canvas + root + nothing else); `i18n.ts` without `applyStaticText`/`initLocale` (the `<html lang>` stamp moves to `main.tsx`: `document.documentElement.lang = currentLocale();` before render, plus the existing `setLocale` stamp).
- Dies: `#interior` markup; `openInterior`/`closeInterior` DOM bodies (store write only), `interiorClose` listener, the last `onLocaleChange` legacy subscription in `session.ts`; `applyStaticText`, `initLocale`, and every `data-i18n` attribute (none should remain in `index.html` anyway); all dead rules in `style.css` (see Step 3).

- [ ] **Step 1: Failing test**

`test/ui/interior.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { InteriorOverlay } from "../../src/client/ui/InteriorOverlay.js";

describe("InteriorOverlay", () => {
  beforeEach(() => setLocale("en"));

  it("renders the open door localized and closes via the button", async () => {
    useUiStore.setState({ interiorDoorId: "crossing-hall" });
    render(<InteriorOverlay />);
    expect(screen.getByText("Crossing Hall")).toBeInTheDocument();
    setLocale("fr");
    expect(screen.getByText("Le Hall de la Croisée")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /fermer/i }));
    expect(useUiStore.getState().interiorDoorId).toBeNull();
  });

  it("renders nothing when closed", () => {
    useUiStore.setState({ interiorDoorId: null });
    const { container } = render(<InteriorOverlay />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Implement + teardown**

`InteriorOverlay.tsx`: looks up the door in `INTERIORS` by `interiorDoorId` (null/unknown → `null`); renders the legacy structure (`id="interior"` + `interior-room` + header with `t(door.nameKey)` and a close button `aria-label={t("interior.close")}`, the decorative `room-grid` spans with `data-room={door.id}` on the container, `t(door.copyKey)` paragraph) reusing the existing CSS. Close button → `setInteriorDoorId(null)`.

`session.ts`: `openInterior`/`closeInterior` become pure store writes; the E-key/Escape handlers already call them; delete the last legacy element lookups (`interior*`), the final `onLocaleChange` subscription, and the now-unused `t` re-render plumbing (`lastStatus` thunk machinery — `setStatus` writes only `{key, params}` to the store now, so simplify it to a direct store call and delete the local).

`i18n.ts`: delete `applyStaticText` and `initLocale`. `main.tsx` stamps `document.documentElement.lang = currentLocale()` before render.

`index.html` final form — exactly:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <title>lindocara - Everwild Hollow</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  </head>
  <body>
    <canvas id="stage"></canvas>
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: CSS reconciliation**

`style.css` still holds the visual identity for ids/classes React reuses (`#hud` panels, `#chat`, `#event-log`, `.item-chip`, `.swatch`, `.character-card`, `#interior`, `#locale-toggle`, `#prompt`, `#status`, `#help`, `.pulse`). Keep those. DELETE rules whose markup no longer exists in any component: old `<progress>` styling, `#auth`/`.tabs`/form-specific rules replaced by components, `[hidden]` compound selectors for removed panels, `data-i18n` related nothing (none). Verification method: `grep -o '#[a-z-]*\|\.[a-z-]*' src/client/style.css | sort -u` and check each against the React components + canvas. When in doubt, keep the rule — dead CSS is a Minor; a missing rule is a visual regression. Move the survivors into `src/client/styles/legacy.css`, imported from `app.css`, and delete `style.css` + its import in `session.ts` (was `main.ts`'s `import "./style.css"`).

- [ ] **Step 4: Verify and commit**

Run: `npm run check` → green. Dev click-through of EVERYTHING: register→create→play→fight→loot→quest→potion→chat→interior open/close (E and Escape and button)→FR toggle on every screen→switch character→logout→login. Also `grep -rn "data-i18n\|applyStaticText\|initLocale" src/ index.html` → zero hits.

```bash
npm run lint:fix
git add -A
git commit -m "Port the interior overlay; retire the legacy DOM layer"
```

---

### Task 9: Docs, full check, deploy, live verification

**Files:**
- Modify: `CLAUDE.md` (via `AGENTS.md` — CLAUDE.md is a symlink), `README.md`

- [ ] **Step 1: Update docs**

- Architecture block, `src/client/` section — new shape:

```
src/client/     runs in a browser.
  main.tsx      React entry; mounts <App/> beside the canvas.
  ui/           React components: screens, HUD, chat, overlays. PixelAct UI copies
                (restyled) under ui/pixelact-ui/.
  store.ts      zustand bridge: the game session writes, React reads. Text state is
                i18n keys + params, never rendered strings.
  api.ts        fetch client; machine-code errors mapped to dictionary keys.
  game/         the game loop: net.ts (prediction), renderer.ts (PixiJS), input.ts,
                sound.ts, session.ts (owns the store writes). No React in here.
  i18n.ts       locale state; useLocale() for React, t() for everyone.
```

- Conventions: add "UI is React; game code under `src/client/game/` must not import React. The store is the only bridge — components never call into net/renderer directly (the `GameHandle` in the store is the exception and the boundary)."
- Gotchas: add "**The canvas is not React's.** `#stage` is a sibling of `#root`; nothing in `ui/` may touch it."
- README: stack line gains React 19, Tailwind v4, shadcn/PixelAct UI, Zustand; a sentence on the garrison-style 9-slice PNG skin.

- [ ] **Step 2: Full gate + deploy (user-authorized, no migrations this time)**

```bash
npm run check
npm run deploy
```

- [ ] **Step 3: Verify live at https://lindocara.alepha.dev/**

Browser pass: register a throwaway, create a character, play (HUD frames, bars, chat, events, interior), FR toggle everywhere, switch character, logout. Curl smoke: `curl -sS -o /dev/null -w '%{http_code}' https://lindocara.alepha.dev/` → 200 and the HTML contains `id="root"`.

- [ ] **Step 4: Commit docs + merge**

```bash
npm run lint:fix
git add -A
git commit -m "Update docs for the React UI"
```

Then superpowers:finishing-a-development-branch merges `feature/react-ui` into `main` and pushes.

---

## Plan self-review notes

- **Spec coverage:** stack (T1), skin + PixelAct (T2), store bridge with 60fps guard (T3, T5), all screens/surfaces (T4 auth+select, T6 HUD incl. in-house Bar, T7 chat/log/prompt/status/help incl. in-house Tabs in T4, T8 interior), i18n hook + `applyStaticText` retirement (T1, T8), jsdom test project (T1) with the spec's named tests (T4 auth ×3 incl. re-localization, T4 select cap/two-click, T6 Bar), `index.html` reduced to canvas+root (T8), docs (T9), deploy+manual gate (T9). `window.__lindocara` survives inside `session.ts` (moved verbatim in T5). No gaps found.
- **Deliberate deviations:** components land in `ui/pixelact-ui/` (registry naming) instead of the spec's `ui/pixelact/`; `toast`/`tooltip` from the spec's component list — toast is NOT installed (nothing uses it; YAGNI), tooltip is installed for inventory chips only if the chip `title` proves insufficient — default is the native `title`, so tooltip may end up uninstalled too; drop it from Task 2's loop if unused by Task 6. Status bar renders on all screens (spec implies game-only; connecting/disconnected text predates the game screen).
- **Type consistency:** `GameHandle`/`SelfHud`/`LocalizedText`/`EventLine`/`ChatLine` defined once in T3 and consumed by T5-T8 with matching names; `startGame(character: CharacterSummary)` consistent between T4 (App) and T5 (move to game/session.ts — T4's App imports from `../main.js`, T5 updates the import to `../game/session.js`; both shown).
- **Always-green audit:** T1-T4 legacy and React coexist with disjoint surfaces; T5 double-writes (declared); T6-T8 flip ownership one surface per task with markup+code deletion in the same commit.

