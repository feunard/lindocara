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
 * })`. This module raises — or lowers — that default to whatever this app needs.
 *
 * The app default (16 KiB) is deliberately well above `MAX_FRAME_BYTES` (2048): Alepha's room
 * transport wraps a client frame as `{roomId, message}` before this app's own cap re-measures the
 * unwrapped bytes, so the transport ceiling must clear both the envelope overhead and any
 * legitimate multi-room future growth, while staying orders of magnitude below the framework's
 * 1 MiB default — a client has no legitimate reason to ever send a frame that large on this wire.
 *
 * **Why `$env`, not a raw `process.env` read.** `WEBSOCKET_MAX_PAYLOAD` used to be read directly
 * off `process.env` and spread into `Alepha.create()` at module-import time, before any Alepha
 * instance existed. That reads fine in Node dev/test, but `process.env` does not exist on the
 * Cloudflare Workers runtime this app deploys to — a value pushed as a `wrangler secret` only
 * ever reaches the app through the Workers `env` binding Alepha's entrypoint lifts into
 * `alepha.env` (`Alepha#loadEnv`), never through `process.env`. Declaring the variable through
 * `$env` also puts it in the manifest's `$env` allowlist, which is what `alepha platform up`
 * pushes as a Cloudflare secret in the first place. `$env` needs a live DI context
 * (`$context()`), so it cannot run at bare module scope the way the old seed did — this is now a
 * real service (`WebSocketTransportCapProvider`, registered in `LindocaraApi.services`) whose
 * `"configure"` hook writes the resolved value into the `websocketOptions` atom. Alepha's
 * lifecycle runs every service's `"configure"` hook to completion before any `"start"` hook
 * begins (`Alepha.boot`), and `NodeWebSocketServerProvider` only reads `websocketOptions` (via
 * `$state`, a live per-access getter) from its own `"start"` hook to construct the real
 * `WebSocketServer` — so this write is guaranteed to land before anything reads it, regardless of
 * service registration order.
 */
import { $env, $hook, $inject, Alepha, z } from "alepha";
import { websocketOptions } from "alepha/websocket";

/** Comfortably above `MAX_FRAME_BYTES` (2048, `realtime/wire.ts`) plus the room envelope, and far
 *  below the framework's 1 MiB default. */
export const DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES = 16 * 1024;

export const websocketTransportCapEnvSchema = z.object({
  WEBSOCKET_MAX_PAYLOAD: z
    .integer()
    .min(1)
    .default(DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES)
    .describe(
      "Transport-level WebSocket frame cap in bytes, passed straight to `new " +
        "WebSocketServer({ maxPayload })`. A pre-parse backstop ahead of the app-level 2048-byte " +
        "MAX_FRAME_BYTES cap. Defaults to 16 KiB.",
    ),
});

/**
 * Installs this app's transport-level WebSocket frame cap into the vendored `websocketOptions`
 * atom. Registered in `LindocaraApi.services` — nothing else constructs it, so leaving it out
 * means the atom keeps the framework's 1 MiB default instead of this app's 16 KiB one.
 */
export class WebSocketTransportCapProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly env = $env(websocketTransportCapEnvSchema);

  /**
   * `path` is repeated at its own schema default (`"/ws"`) because an atom write replaces the
   * whole stored value, not a per-field merge — see `bodySizeCap.ts`'s identical note for
   * `BODY_PARSER_OPTIONS_SEED`.
   */
  protected readonly configure = $hook({
    on: "configure",
    handler: () => {
      this.alepha.set(websocketOptions, {
        path: "/ws",
        maxPayload: this.env.WEBSOCKET_MAX_PAYLOAD,
      });
    },
  });
}
