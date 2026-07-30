import { defineConfig } from "vitest/config";

// The workspace aggregator: each package owns its own vitest.config.ts (engine=node,
// renderer/client/editor=jsdom). `npm test` runs them all;
// `vitest run --project <name>` or `npm test -w @lindocara/<pkg>` runs one.
//
// @lindocara/server's own workerd project (`packages/server/vitest.config.ts`, the "server"
// project) was deleted by the legacy retirement (Task 6 of the 2026-07-30 alepha-migration
// deploy-cleanup tranche): the whole legacy Worker/Durable-Object stack it tested is gone. The
// glob below simply no longer matches anything there, so no explicit exclusion is needed — this
// comment exists so the gap isn't mistaken for an oversight. Task 7 finishes the job: it
// re-plumbs `packages/server/test-api/` (already listed explicitly below, since it sits outside
// the glob's per-package convention) into the package's sole test project and retires this note.
export default defineConfig({
  test: {
    // The glob covers one vitest.config.ts per package; @lindocara/server's runtime-neutral
    // project (test-api/) isn't at that conventional path, so it's listed explicitly.
    projects: ["packages/*/vitest.config.ts", "packages/server/test-api/vitest.config.ts"],
  },
});
