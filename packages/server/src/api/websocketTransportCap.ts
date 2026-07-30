/**
 * The transport-level WebSocket frame cap — the PRE-PARSE backstop ahead of the app-level
 * `MAX_FRAME_BYTES` (2048, `realtime/wire.ts`) that `WorldRoom.handleMessage` enforces AFTER
 * Alepha's room transport has already `JSON.parse`d the frame (`NodeWebSocketServerProvider
 * .handleRoomConnection`'s `ws.on("message", ...)`). Without a transport-level ceiling, the
 * vendored `ws` server's own default (~100 MiB) means a hostile client can make the server
 * `JSON.parse` a payload nearly six orders of magnitude past what any legitimate frame needs,
 * before the app-level cap ever runs.
 *
 * Fixed upstream (dogfood loop — see the vendor patch's own docblock): `.vendor/alepha/src/
 * websocket/providers/NodeWebSocketServerProvider.ts`'s `websocketOptions` atom gained a
 * `maxPayload` field (framework default 1 MiB), threaded into `new WebSocketServer({ maxPayload
 * })`. This module raises — or lowers — that default to whatever this app needs, mirroring
 * `bodySizeCap.ts`'s `BODY_PARSER_OPTIONS_SEED` pattern for the exact same class of vendor knob
 * (a global `*Options` atom with no per-route override): read once from the `WEBSOCKET_MAX_PAYLOAD`
 * environment variable, falling back to a sane app default, and spread the result into
 * `Alepha.create()` in `apps/main/src/main.ts` and `test-api/helpers.ts`.
 *
 * The app default (16 KiB) is deliberately well above `MAX_FRAME_BYTES` (2048): Alepha's room
 * transport wraps a client frame as `{roomId, message}` before this app's own cap re-measures the
 * unwrapped bytes, so the transport ceiling must clear both the envelope overhead and any
 * legitimate multi-room future growth, while staying orders of magnitude below the framework's
 * 1 MiB default — a client has no legitimate reason to ever send a frame that large on this wire.
 */
import { websocketOptions } from "alepha/websocket";

/** Comfortably above `MAX_FRAME_BYTES` (2048, `realtime/wire.ts`) plus the room envelope, and far
 *  below the framework's 1 MiB default. */
const DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES = 16 * 1024;

function resolveMaxPayload(): number {
  const raw = process.env.WEBSOCKET_MAX_PAYLOAD;
  if (raw === undefined) return DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES;
}

/**
 * Spread into `Alepha.create()` (see `apps/main/src/main.ts` and `test-api/helpers.ts`) to install
 * this app's transport-level WebSocket frame cap. `path` is repeated at its own schema default
 * (`"/ws"`) because an atom write replaces the whole stored value, not a per-field merge — see
 * `bodySizeCap.ts`'s identical note for `BODY_PARSER_OPTIONS_SEED`.
 */
export const WEBSOCKET_OPTIONS_SEED = {
  [websocketOptions.key]: { path: "/ws", maxPayload: resolveMaxPayload() },
} as const;
