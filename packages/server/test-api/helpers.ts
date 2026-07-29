import { LindocaraApi } from "@lindocara/server/api/index.js";
import { Alepha } from "alepha";

/**
 * Starts a fresh Alepha instance wired to the new server API module, against an in-memory
 * database. Every later tranche-1 test imports this rather than re-wiring `Alepha.create()`
 * itself, so the app composition (modules, env) stays in one place as it grows.
 */
export function createTestApp() {
  process.env.DATABASE_URL = ":memory:";
  return Alepha.create().with(LindocaraApi);
}
