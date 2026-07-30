import { BODY_PARSER_OPTIONS_SEED } from "@lindocara/server/api/bodySizeCap.js";
import { LindocaraApi } from "@lindocara/server/api/index.js";
import { WEBSOCKET_OPTIONS_SEED } from "@lindocara/server/api/websocketTransportCap.js";
import { Alepha } from "alepha";

/**
 * Starts a fresh Alepha instance wired to the new server API module, against an in-memory
 * database. Every later tranche-1 test imports this rather than re-wiring `Alepha.create()`
 * itself, so the app composition (modules, env) stays in one place as it grows.
 *
 * `BODY_PARSER_OPTIONS_SEED` raises Alepha's global body-size ceiling (default 100_000 bytes) to
 * the 4 MiB this app needs for a map save — see `bodySizeCap.ts`'s docblock for the full story and
 * why per-route caps narrower than that (adventures, small bodies) are enforced separately, inside
 * each route's own handler via `enforceBodySizeCap`.
 *
 * `WEBSOCKET_OPTIONS_SEED` is the same pattern for the vendored `websocketOptions` atom's
 * `maxPayload` (see `websocketTransportCap.ts`'s docblock) — the pre-parse transport backstop a
 * realtime test (`realtime-transport-cap.test.ts`) drives against a real socket.
 *
 * `{ ...BODY_PARSER_OPTIONS_SEED, ...WEBSOCKET_OPTIONS_SEED }`, not the shared constants
 * themselves: `Alepha.create(state)` hands `state` straight to `new StateManager(state)`, which
 * stores it BY REFERENCE as its whole app store (`.vendor/alepha/src/core/providers/
 * StateManager.ts`'s constructor is a bare `this.store = store`, no clone) — and
 * `Alepha.create()` itself mutates that same object (`state.env = {...}`). Passing either
 * module-level seed object directly would make every test's "fresh" Alepha instance share the
 * literal same store object with every other test that ran before it in this process, leaking
 * server handles, DB state and everything else through it. A shallow copy per call keeps only the
 * (never-mutated) nested options values shared, which is safe.
 */
export function createTestApp() {
  process.env.DATABASE_URL = ":memory:";
  return Alepha.create({ ...BODY_PARSER_OPTIONS_SEED, ...WEBSOCKET_OPTIONS_SEED }).with(
    LindocaraApi,
  );
}
