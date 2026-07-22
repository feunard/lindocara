import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// This is the deployable app (apps/main): the Vite root is this directory, and the Cloudflare
// plugin reads packages/server/wrangler.jsonc, runs the Worker + Durable Object (packages/server) inside workerd
// during `vite dev`, and emits a deployable wrangler.json into ./dist alongside the client bundle.
// The client and server sources live in sibling workspace packages, referenced here by path.
export default defineConfig({
  plugins: [
    cloudflare({
      configPath: fileURLToPath(new URL("../../packages/server/wrangler.jsonc", import.meta.url)),
    }),
    react(),
    tailwindcss(),
  ],
  publicDir: fileURLToPath(new URL("../../packages/client/public", import.meta.url)),
  resolve: {
    // The `@` alias is the client source root, shared with the editor package.
    alias: { "@": fileURLToPath(new URL("../../packages/client/src", import.meta.url)) },
  },
  server: {
    // The entry (index.html → packages/client/src/main.tsx) and the client/server sources sit
    // outside this app dir, so let Vite's dev server read the whole workspace.
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
  build: {
    sourcemap: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "tiny-swords-assets",
              test: /[\\/]assets[\\/]Tiny Swords/,
              maxSize: 350_000,
            },
          ],
        },
      },
    },
  },
});
