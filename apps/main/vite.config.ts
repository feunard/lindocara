import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Vite config for the app (`alepha dev` / `alepha build` auto-load it from the app root).
// Alepha owns the server/plugin wiring (react plugin, tsconfig paths, its own middleware) —
// this file only adds what the framework cannot know about this app:
// - `tailwindcss()`: the client/ui styles are Tailwind 4 (`@import "tailwindcss"` in
//   packages/client/src/styles/app.css) and need the plugin to compile.
// - `publicDir`: the client's static assets (favicon, title art) live in the client package, not
//   under apps/main/public.
// - `@` alias: the client source root, same as every package tsconfig.
// - `fs.allow`: client/renderer/catalog sources (Tiny Swords art via import.meta.glob) sit
//   outside this app dir, so the dev server must be allowed to read the whole workspace.
export default defineConfig({
  plugins: [tailwindcss()],
  publicDir: fileURLToPath(new URL("../../packages/client/public", import.meta.url)),
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../packages/client/src", import.meta.url)) },
  },
  server: {
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
});
