import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  // The plugin reads wrangler.jsonc, runs the Worker and the Durable Object inside workerd
  // during `vite dev`, and emits a deployable wrangler.json next to the client build. It
  // infers `assets.directory` from the client output, which is why wrangler.jsonc omits it.
  plugins: [cloudflare()],
  build: {
    sourcemap: true,
  },
});
