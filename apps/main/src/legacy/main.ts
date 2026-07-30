// The legacy deployable app's entry (rollback-only, `dev:legacy`/`build:legacy` — the primary path
// is `main.browser.ts`, mounting Alepha's `$page` router). Lives inside the Vite root (apps/main)
// so the dev server serves it as a real module. `bootClient()` runs the shared pre-mount bootstrap
// (locale, theme, the `#stage` canvas, the `?preview` shortcut); `mountLegacyApp()` is the old
// zustand-screen-machine `createRoot(...).render(<App/>)` call, kept in `main.tsx` because it's
// JSX and this file isn't a `.tsx` module. See `vite.legacy.config.ts` for why this stack still
// runs at all.
import { bootClient, mountLegacyApp } from "@lindocara/client/main.js";

if (bootClient()) mountLegacyApp();
