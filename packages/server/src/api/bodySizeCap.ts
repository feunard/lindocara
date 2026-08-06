/**
 * Request body size caps for the Alepha API. Ported values from legacy's `readJson` byte caps
 * (`packages/server/src/index.ts`'s `MAX_API_JSON_BYTES`/`MAX_MAP_JSON_BYTES`/
 * `MAX_ADVENTURE_JSON_BYTES`), which rejected an oversized body with 413 `request_too_large`
 * before buffering it.
 *
 * **Why this is a post-parse check, not a pre-parse one.** Grepping `.vendor/alepha/src/server`
 * for a body-size knob finds exactly one: `bodyParserOptions`
 * (`.vendor/alepha/src/server/core/providers/ServerBodyParserProvider.ts`), and it is a single
 * GLOBAL limit — `ServerBodyParserProvider.onRequest` reads only its own `this.options.limit`,
 * there is no per-route/per-action override, and the provider's `server:onRequest` hook parses the
 * body into memory before ANY action-level code (including this file's `enforceBodySizeCap`) ever
 * runs. That knob is raised here (`BODY_PARSER_OPTIONS_SEED`, spread into `Alepha.create()` by
 * `apps/main/src/main.ts` and `test-api/helpers.ts`) to the widest cap this app needs (4 MiB) —
 * without that, a legitimate large map save would be rejected by the framework's own default
 * (100_000 bytes) before this app's code ever saw it. The NARROWER per-route caps below (64 KiB
 * adventures, 4 KiB small bodies) cannot be expressed through that same global-only knob, so they
 * are enforced HERE, inside each route's own handler, strictly after Alepha has already parsed the
 * body — the parse cost itself is not avoided for an oversized-but-under-the-global-cap payload.
 *
 * The `Content-Length` header is checked first — genuinely proportional-cost-free even at this
 * post-parse point, since it's a header read, not a re-serialization. Its absence (chunked
 * transfer, a proxy that strips it) falls back to measuring the already-parsed body's
 * `JSON.stringify` size — a proxy for wire size, and the only measurement available post-parse.
 *
 * **Upstream feature request for Alepha**: `$action`/`$route` schema has no `bodyLimit` option to
 * enforce a per-route cap ahead of `ServerBodyParserProvider`'s parse (mirroring
 * `ServerMultipartProvider`'s own per-route `fileLimit`). Adding one would let this become a true
 * pre-parse guard instead of the app-level post-parse check below.
 *
 * **Map routes are a degenerate case, by design.** `MAX_MAP_JSON_BYTES` equals the global ceiling
 * `BODY_PARSER_OPTIONS_SEED` installs, so a map body over 4 MiB never reaches `enforceBodySizeCap`
 * at all — `ServerBodyParserProvider` itself rejects it first, with its OWN 413 (`error:
 * "PayloadTooLargeError"`, Alepha's generic status-name default, not `request_too_large`). Callers
 * of `enforceBodySizeCap(headers, body, MAX_MAP_JSON_BYTES)` on the map routes still get correct
 * behavior (still a 413, just occasionally the other machine code depending on which layer catches
 * it first) — kept for symmetry with every other route and as a safety net should the global
 * ceiling ever move independently of `MAX_MAP_JSON_BYTES`.
 */
import { HttpError } from "alepha/server";

/** 4 MiB — map create/save. Matches legacy `MAX_MAP_JSON_BYTES`. */
export const MAX_MAP_JSON_BYTES = 4 * 1024 * 1024;
/**
 * 2 MiB — a heightfield write (`PUT /api/maps/:id/heightfield`). Narrower than
 * `MAX_MAP_JSON_BYTES` on purpose: that constant equals the global parser ceiling (see this file's
 * "degenerate case" paragraph above), so on that route `enforceBodySizeCap` never fires and the
 * effective bound is Alepha's, not this app's. Here it fires.
 *
 * Derived from the largest LEGITIMATE payload rather than picked round. A heightfield's own size is
 * bounded by `MAX_HEIGHTFIELD_SIZE` (256), so the worst honest grid is 256² = 65 536 cells with
 * every level `null` (`"null,"`, 5 bytes) and every material the longest name (`"glace-fine",`,
 * 13 bytes, 15 once escaped inside the JSON body that carries it): ~1.31 MB. 2 MiB leaves ~780 KB
 * over that for colliders, spawns, props and events — whose COUNTS are bounded separately and
 * relative to the same `size` (`parseHeightfieldBody`), because bytes alone cannot tell a dense
 * 256² map from a 1×1 one padded with 160 000 colliders.
 *
 * The stored string is re-sent VERBATIM in every `welcome`, so this cap is not only a write bound:
 * it is the ceiling on what one authored map can cost every client that joins it.
 */
export const MAX_HEIGHTFIELD_JSON_BYTES = 2 * 1024 * 1024;
/** 64 KiB — adventure create/update. Matches legacy `MAX_ADVENTURE_JSON_BYTES`. */
export const MAX_ADVENTURE_JSON_BYTES = 65_536;
/** 4 KiB — every other authenticated body (party/hero/test-session creates). Matches legacy
 *  `MAX_API_JSON_BYTES`. */
export const MAX_API_JSON_BYTES = 4_096;

/**
 * `bodyParserOptions`'s atom key (`.vendor/alepha/src/server/core/providers/
 * ServerBodyParserProvider.ts`) — the server-wide request body size cap, default 100_000 bytes.
 * Not re-exported from `alepha/server`'s public barrel (only providers are, not this atom), so it
 * is referenced here by its literal key rather than an import. `Alepha.create()`'s `state` param
 * is typed against the same `declare module "alepha" { interface State { ... } }` augmentation the
 * atom itself registers — transitively pulled into this program's types the moment anything here
 * imports `alepha/server` — so the key stays type-checked despite not being importable directly.
 */
const BODY_PARSER_OPTIONS_KEY = "alepha.server.body-parser.options" as const;

/**
 * Spread into `Alepha.create()` (see `apps/main/src/main.ts` and `test-api/helpers.ts`) to raise
 * Alepha's global body-size ceiling (default 100_000 bytes) to the widest cap this app needs.
 * Without this seed, a legitimate 4 MiB map save is rejected by Alepha's own default before ever
 * reaching `enforceBodySizeCap` below.
 */
export const BODY_PARSER_OPTIONS_SEED = {
  [BODY_PARSER_OPTIONS_KEY]: { inflate: true, limit: MAX_MAP_JSON_BYTES },
} as const;

/**
 * Throws 413 `request_too_large` when `body`'s wire size exceeds `limitBytes`. Call as the first
 * line of any handler whose body schema is `z.any()` (and thus otherwise uncapped below the global
 * 4 MiB ceiling `BODY_PARSER_OPTIONS_SEED` installs). See this file's docblock for why the check
 * runs after Alepha has already parsed the body, and why `Content-Length` is preferred over
 * re-measuring the parsed body.
 */
export function enforceBodySizeCap(
  headers: Record<string, string>,
  body: unknown,
  limitBytes: number,
): void {
  const declared = Number.parseInt(headers["content-length"] ?? "", 10);
  const size = Number.isFinite(declared)
    ? declared
    : new TextEncoder().encode(JSON.stringify(body ?? null)).length;
  if (size > limitBytes) {
    throw new HttpError({
      status: 413,
      error: "request_too_large",
      message: "request body size limit exceeded",
    });
  }
}
