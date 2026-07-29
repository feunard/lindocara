import { LindocaraApi } from "@lindocara/server/api/index.js";
import { Alepha } from "alepha";

/**
 * `bodyParserOptions`'s atom key (`.vendor/alepha/src/server/core/providers/
 * ServerBodyParserProvider.ts`) — the server-wide request body size cap, default 100_000 bytes.
 * Not re-exported from `alepha/server`'s public barrel (only providers are, not this atom), so it
 * is set here by its literal key rather than an import; `Alepha.create()`'s `state` param is typed
 * against the same `declare module "alepha" { interface State { ... } }` augmentation the atom
 * itself registers, so the key is still type-checked. Task 8 (maps) needs this raised to 4 MiB —
 * the legacy `MAX_MAP_JSON_BYTES` cap in `packages/server/src/index.ts` — because there is no
 * per-route override in this Alepha version (`ServerBodyParserProvider.onRequest` reads only this
 * one global `this.options.limit`). Every later tranche-1 route shares this same limit; the two
 * legacy sub-caps narrower than 4 MiB (hero saves at 4 KiB, adventure saves at 64 KiB) are NOT
 * global and must be enforced by the services that need them, per-body, with `JSON.stringify(body)
 * .length` and a 413 `request_too_large` — see Task 8's report for this finding in full.
 */
const BODY_PARSER_OPTIONS_KEY = "alepha.server.body-parser.options" as const;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Starts a fresh Alepha instance wired to the new server API module, against an in-memory
 * database. Every later tranche-1 test imports this rather than re-wiring `Alepha.create()`
 * itself, so the app composition (modules, env) stays in one place as it grows.
 */
export function createTestApp() {
  process.env.DATABASE_URL = ":memory:";
  return Alepha.create({
    [BODY_PARSER_OPTIONS_KEY]: { inflate: true, limit: MAX_BODY_BYTES },
  }).with(LindocaraApi);
}
