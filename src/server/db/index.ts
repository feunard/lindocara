/**
 * Drizzle bound to the D1 binding.
 *
 * A factory rather than a module-level singleton: `env` only exists per-request in a Worker,
 * and a Durable Object gets its own. Build one where you have the binding, hand it around.
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.js";

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;

export * from "./schema.js";
