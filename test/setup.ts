import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

// Build the schema once per test file, from the same .sql that ships to production.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
