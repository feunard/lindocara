/**
 * The test runtime sees everything the Worker sees, plus the migrations injected as a binding
 * by vitest.config.ts so `test/setup.ts` can build the schema.
 *
 * This augments `Cloudflare.Env` — what `cloudflare:test` types its `env` as — rather than the
 * global `Env` that the Worker and Durable Object are written against. Production code cannot
 * accidentally reach for TEST_MIGRATIONS.
 */

declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
