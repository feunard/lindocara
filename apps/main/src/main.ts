import { BODY_PARSER_OPTIONS_SEED } from "@lindocara/server/api/bodySizeCap.js";
import { LindocaraApi } from "@lindocara/server/api/index.js";
import { WEBSOCKET_OPTIONS_SEED } from "@lindocara/server/api/websocketTransportCap.js";
import { Alepha, run } from "alepha";

// Raises Alepha's global body-size ceiling (default 100_000 bytes) to the 4 MiB this app needs
// for a map save — see `bodySizeCap.ts`'s docblock for why this seed exists and why it alone is
// not enough (the narrower per-route caps are enforced in each controller). `WEBSOCKET_OPTIONS_SEED`
// is the same pattern for the vendored `websocketOptions` atom's `maxPayload` (see
// `websocketTransportCap.ts`'s docblock) — the pre-parse transport backstop ahead of the app-level
// 2048-byte `MAX_FRAME_BYTES` cap `WorldRoom` enforces after the frame is already parsed.
//
// `{ ...BODY_PARSER_OPTIONS_SEED, ...WEBSOCKET_OPTIONS_SEED }`, not the shared constants
// themselves: `Alepha.create(state)` stores `state` BY REFERENCE as its whole app store (see
// `test-api/helpers.ts`'s `createTestApp` for the full explanation, where reusing the bare
// constant across many Alepha instances is an actual cross-test leak). One process only ever
// calls this once, so it is harmless here today, but a shallow copy costs nothing and keeps this
// call site correct if that ever changes.
const alepha = Alepha.create({ ...BODY_PARSER_OPTIONS_SEED, ...WEBSOCKET_OPTIONS_SEED }).with(
  LindocaraApi,
);

run(alepha);
