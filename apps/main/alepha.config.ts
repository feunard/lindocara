import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";

export default defineConfig({
  plugins: [
    platform({
      environments: {
        production: { domain: "lindocara.alepha.dev", adapter: "cloudflare" },
      },
    }),
  ],
  build: {
    cloudflare: {
      // `BuildCloudflareTask.generateCloudflare` spreads this whole object
      // as `...ctx.options.cloudflare?.config` INTO the base wrangler
      // object, ahead of its own `wrangler.assets ??= { directory: "./public",
      // binding: "ASSETS" }` default. `??=` only fires when `wrangler.assets`
      // is still undefined at that point — so an `assets` key here that
      // carried only `not_found_handling`/`run_worker_first` would make
      // `wrangler.assets` truthy and silently swallow the generated
      // `directory`/`binding`, breaking asset serving entirely. All four
      // keys are therefore authored together here, `directory`/`binding`
      // matching the task's own generated defaults verbatim.
      config: {
        assets: {
          directory: "./public",
          binding: "ASSETS",
          // The client is a single-page app: any unmatched path (a deep
          // link, a browser refresh on `/game`) must fall back to
          // `index.html` rather than 404 from the asset store.
          not_found_handling: "single-page-application",
          // Without `run_worker_first`, `not_found_handling` would also
          // swallow `/api/*`/`/ws/*`/`/_auth/*`/`/oauth/*` — those must
          // reach the Worker (and its Durable Objects) before the SPA
          // fallback ever applies.
          run_worker_first: ["/api/*", "/ws/*", "/_auth/*", "/oauth/*"],
        },
      },
    },
  },
});
