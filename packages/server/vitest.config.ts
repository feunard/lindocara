import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The Worker and the Durable Object run inside workerd against the real objects — not mocks.
// Bindings, migrations and compatibility settings come from the root wrangler.jsonc and the
// server package's own migrations, so the test environment cannot drift from production.
// Resolve the migrations dir relative to THIS config (not the cwd): the root aggregator loads
// every project's config regardless of which --project is selected.
const migrations = await readD1Migrations(fileURLToPath(new URL("./migrations", import.meta.url)));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          SESSION_SECRET: "test-secret-do-not-use-in-production",
          TEST_PBKDF2_ITERATIONS: "1000",
          AUTH_RATE_LIMIT_DISABLED: "true",
          CHEATS_ENABLED: "true",
          TEST_MIGRATIONS: migrations,
          PRESENCE_TTL_MS_OVERRIDE: "5000",
          PRESENCE_HEARTBEAT_MS_OVERRIDE: "400",
        },
      },
    }),
  ],
  test: {
    name: "server",
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    setupFiles: ["./test/setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // World and presence Durable Objects are process-wide singletons in workerd.
    fileParallelism: false,
  },
});
