import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Browser components + Tiny Swords art. jsdom, React, css:false. The `@` alias is the client source
// root (shared with the editor). Node's own webstorage is disabled so jsdom's Storage wins.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("../client/src", import.meta.url)) },
    // Alepha ships browser/server variants of its react packages behind package.json export
    // conditions (e.g. `alepha/react/router` -> `index.browser.ts`, which registers the
    // ReactBrowserProvider/ReactBrowserRendererProvider that actually mount into `#root`). jsdom
    // tests need the browser condition explicitly — Vitest otherwise resolves the Node/SSR
    // variant, and `router.push()` would validate routes but never render anything. Mirrors
    // alepha's own jsdom project config (`vitest.config.ts` in the alepha repo).
    conditions: ["browser", "module", "import", "default"],
    mainFields: ["browser", "module", "main"],
  },
  test: {
    name: "client",
    environment: "jsdom",
    execArgv: ["--no-experimental-webstorage"],
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: [fileURLToPath(new URL("../testing/src/jsdom-setup.ts", import.meta.url))],
    css: false,
  },
});
