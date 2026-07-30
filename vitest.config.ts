import { defineConfig } from "vitest/config";

// The workspace aggregator: each package owns its own vitest.config.ts (engine=node,
// server=node, renderer/client/editor=jsdom). `npm test` runs them all;
// `vitest run --project <name>` or `npm test -w @lindocara/<pkg>` runs one.
//
// @lindocara/server's legacy workerd project (cloudflare pool) died in the legacy retirement
// (2026-07-30 alepha-migration deploy-cleanup tranche): the whole Worker/Durable-Object stack it
// tested is gone, and Task 7 migrated its 21 pure system-test suites into
// `packages/server/test-api/` (project name "server", `npm run test:server`) alongside the
// runtime-neutral Alepha API tests that already lived there, retiring the config's old
// explicit-path special case now that `packages/server/vitest.config.ts` sits at the same
// conventional path as every other package's.
export default defineConfig({
  test: {
    projects: ["packages/*/vitest.config.ts"],
  },
});
