import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Browser components + PixiJS art. jsdom, React, css:false. The `@` alias is the client source
// root (shared with the editor). Node's own webstorage is disabled so jsdom's Storage wins.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("../client/src", import.meta.url)) },
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
