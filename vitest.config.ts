import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Read at config time, in Node, then handed to the workers runtime as a binding. The tests
// apply these against the in-memory D1 so the test schema is the deployed schema — there is
// no second, hand-maintained CREATE TABLE anywhere.
const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  // Tests run inside workerd, against the real Durable Object — not a mock of it. Bindings,
  // migrations and compatibility settings all come from wrangler.jsonc, so the test
  // environment cannot drift from production.
  //
  // Note this file deliberately does not load vite.config.ts: the Cloudflare *build* plugin
  // has no place in the test runtime.
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          // SESSION_SECRET is a secret, so it is absent from wrangler.jsonc by design. Supply
          // a throwaway value for tests; the crypto is what's under test, not the key.
          SESSION_SECRET: "test-secret-do-not-use-in-production",
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
  test: {
    name: "lindocara",
    include: ["test/**/*.test.ts"],
    // mission-2a drives the legacy `?character=` admission path, which no client reaches any
    // more (see docs/superpowers/specs/2026-07-18-admission-cutover-design.md step 6). It costs
    // ~59s of the suite's ~122s because its lease tests wait on the real 30s PRESENCE_TTL_MS.
    // Disabled on request until either the TTL is injectable or its five unique shared-runtime
    // invariants are ported to the hero harness. Re-enable by deleting this exclude.
    exclude: ["test/mission-2a.test.ts", "**/node_modules/**", "**/dist/**"],
    setupFiles: ["./test/setup.ts"],
    // World and CharacterPresence Durable Objects are process-wide singletons in workerd.
    // Parallel test files would share live rooms and flake on capacity, combat, and loot.
    fileParallelism: false,
  },
});
