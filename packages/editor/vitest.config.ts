import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Browser components + HD-2D authoring. jsdom, React, css:false. The `@` alias is the client source
// root (shared with the editor). Node's own webstorage is disabled so jsdom's Storage wins.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("../client/src", import.meta.url)) },
    // Same reason `packages/client/vitest.config.ts` carries this (see its comment): alepha ships
    // browser/server variants behind package.json export conditions, and jsdom needs the browser
    // one named explicitly or Vitest resolves the Node/SSR file. The editor suite needs it since
    // `AdventureEditorScreen` mounts `@alepha/ui`'s `DialogProvider`, whose `useI18n()` reaches
    // `I18nProvider` — and that provider's `start()` hook reads a `$cookie`, whose SSR variant
    // demands a live server request context and throws during boot.
    //
    // Deliberately WITHOUT client's companion `mainFields: ["browser", …]`: that one also rewrites
    // legacy non-exports packages to their browser bundle, which in this suite swaps the Base UI
    // build out from under `AdventureTestDialog`'s Select and leaves its listbox with no options.
    conditions: ["browser", "module", "import", "default"],
  },
  test: {
    name: "editor",
    environment: "jsdom",
    execArgv: ["--no-experimental-webstorage"],
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: [fileURLToPath(new URL("../testing/src/jsdom-setup.ts", import.meta.url))],
    css: false,
  },
});
