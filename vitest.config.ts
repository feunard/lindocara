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
          TEST_PBKDF2_ITERATIONS: "1000",
          AUTH_RATE_LIMIT_DISABLED: "true",
          CHEATS_ENABLED: "true",
          TEST_MIGRATIONS: migrations,
          // A short lease clock, so the presence-fencing tests can prove a room invalidates
          // itself in half a second instead of sleeping through the production 30s/10s pair.
          // The 12.5:1 ratio is far safer than production's 3:1 — a heartbeat would have to be
          // 4.6s late to drop a live lease — and every test in the suite runs on it, which is
          // what keeps the override itself covered.
          PRESENCE_TTL_MS_OVERRIDE: "5000",
          PRESENCE_HEARTBEAT_MS_OVERRIDE: "400",
        },
      },
    }),
  ],
  test: {
    name: "lindocara",
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    setupFiles: ["./test/setup.ts"],
    // World and CharacterPresence Durable Objects are process-wide singletons in workerd.
    // Parallel test files would share live rooms and flake on capacity, combat, and loot.
    fileParallelism: false,
  },
});
