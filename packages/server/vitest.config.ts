import { defineConfig } from "vitest/config";

// @lindocara/server's sole vitest project — runtime-neutral (Node), covering both the
// Alepha-ported API/services and the pure `src/world/**` systems the realtime rooms inject. The
// legacy workerd project (cloudflare pool, its own package-root `vitest.config.ts`) died in the
// 2026-07-30 alepha-migration deploy-cleanup tranche; this file took over the package-root
// convention every other package already uses, retiring the `test-api/vitest.config.ts` +
// explicit-root special case that existed only to keep the two projects from colliding.
export default defineConfig({
  test: {
    name: "server",
    environment: "node",
    include: ["test-api/**/*.test.ts"],
  },
});
