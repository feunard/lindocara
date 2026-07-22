import { defineConfig } from "vitest/config";

// The workspace aggregator: each package owns its own vitest.config.ts (engine=node,
// server=workerd/cloudflare-pool, renderer/client/editor=jsdom). `npm test` runs them all;
// `vitest run --project <name>` or `npm test -w @lindocara/<pkg>` runs one.
export default defineConfig({
  test: {
    projects: ["packages/*/vitest.config.ts"],
  },
});
