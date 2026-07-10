import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
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
