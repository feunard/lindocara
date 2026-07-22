import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // The Cloudflare plugin reads wrangler.jsonc, runs the Worker and the Durable Object
  // inside workerd during `vite dev`, and emits a deployable wrangler.json next to the
  // client build. React and Tailwind only touch the client graph.
  plugins: [cloudflare(), react(), tailwindcss()],
  publicDir: "packages/client/public",
  resolve: {
    alias: { "@": fileURLToPath(new URL("./packages/client/src", import.meta.url)) },
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
