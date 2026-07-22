import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// jsdom project for React components. Deliberately separate from vitest.config.ts:
// that one runs inside workerd and must never load DOM code.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./packages/client/src", import.meta.url)) },
  },
  test: {
    name: "lindocara-ui",
    environment: "jsdom",
    // Node >=22 ships its own global `localStorage`/`sessionStorage` (backed by a file that
    // needs `--localstorage-file` to actually work), and it wins over jsdom's window.
    // localStorage on globalThis — every `localStorage.*` call (i18n's locale persistence,
    // PixelAct's) hits Node's non-functional stub instead. Disable Node's version for the
    // worker processes running these tests so jsdom's own Storage implementation is used.
    execArgv: ["--no-experimental-webstorage"],
    include: ["test/ui/**/*.test.tsx"],
    setupFiles: ["./test/ui/setup.ts"],
    css: false,
  },
});
