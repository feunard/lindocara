import { defineConfig } from "vitest/config";

// The workspace aggregator: each package owns its own vitest.config.ts (engine=node,
// server=workerd/cloudflare-pool, renderer/client/editor=jsdom). `npm test` runs them all;
// `vitest run --project <name>` or `npm test -w @lindocara/<pkg>` runs one.
export default defineConfig({
  test: {
    // The glob covers one vitest.config.ts per package; @lindocara/server also has a second,
    // runtime-neutral project (test-api/) alongside its workerd one, so it's listed explicitly.
    projects: ["packages/*/vitest.config.ts", "packages/server/test-api/vitest.config.ts"],
  },
});
