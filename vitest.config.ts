import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

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
      // SESSION_SECRET is a secret, so it is absent from wrangler.jsonc by design. Supply a
      // throwaway value for tests; the crypto is what's under test, not the key.
      miniflare: { bindings: { SESSION_SECRET: "test-secret-do-not-use-in-production" } },
    }),
  ],
  test: {
    name: "lindocara",
    include: ["test/**/*.test.ts"],
  },
});
