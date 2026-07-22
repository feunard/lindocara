import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit only *generates* SQL here; it never talks to D1. The emitted numbered .sql
 * files are applied by `wrangler d1 migrations apply`, which is also what CI runs. One
 * migration system, not two.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./packages/server/src/db/schema.ts",
  out: "./packages/server/migrations",
});
