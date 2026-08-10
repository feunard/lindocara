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
// - `port` + `strictPort`: this app's dedicated dev port, see below.
export default defineConfig({
  plugins: [tailwindcss()],
  publicDir: fileURLToPath(new URL("../../packages/client/public", import.meta.url)),
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../packages/client/src", import.meta.url)) },
  },
  server: {
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
    // This app's dedicated dev port. 5173 is the Vite/Alepha default, shared by every Alepha
    // project on the machine, so `alepha dev` used to walk 5173, 5174, ... until it found a free
    // one — and the port it landed on changed run to run. Every local tool that talks to the
    // running app (`scripts/lib/adventure-api.ts`, the seed scripts, the load test,
    // `.claude/launch.json`) hardcodes a target, so a drifting port silently pointed them at
    // whatever else happened to be listening.
    //
    // 5273 rather than something adjacent to 5173, because "adjacent" is the crowded part: Alepha
    // Lore is itself a multi-app workspace, and its own `alepha dev` claims 5173..5179 in one go
    // (`DevCommand.selectApps` hands out `basePort + i`). Any pin inside that band would collide
    // whenever Lore runs — which is what the earlier 5178 default did. The rule is: the framework
    // default plus 100, clear of any neighbour's fleet.
    //
    // `strictPort` is the half that makes it dedicated: without it Vite still walks forward on a
    // collision, which is exactly the drift this pins down. Fail loudly instead — a busy 5273
    // means a stale dev server is still running, and that is worth knowing.
    //
    // `SERVER_PORT` in the environment still wins (Alepha reads it before this config), which is
    // how the framework's multi-app runner assigns ports; nothing here fights it.
    port: 5273,
    strictPort: true,
  },
});
