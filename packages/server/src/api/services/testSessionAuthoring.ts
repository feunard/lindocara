/**
 * Pure/ported test-session error mapping — the Alepha-side twin of
 * `packages/server/src/adventure-test-sessions.ts` and the `adventureTestErrorResponse` table
 * `packages/server/src/index.ts` keeps beside its route handlers (`:808`).
 *
 * The legacy `"prefix: message"` `Error` convention is preserved on purpose: `rethrowAsTestSessionError`
 * below is the direct port of `adventureTestErrorResponse`, so every message a ported validator
 * throws is still routed to the exact same machine code. Note the two DISTINCT "not found" codes
 * legacy keeps apart: a missing SESSION (`deleteAdventureTestSession`'s own `"not_found: ..."`) is
 * `adventure_test_not_found`, while a missing ADVENTURE (`"adventure: ..."`) is `adventure_not_found`
 * — `TestSessionService` throws the exact prefix each call site needs, matching legacy verbatim.
 */
import { HttpError } from "alepha/server";

export function rethrowAsTestSessionError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  const code = message.split(":")[0];
  if (code === "not_found") {
    throw new HttpError({ status: 404, error: "adventure_test_not_found", message });
  }
  if (code === "adventure") {
    throw new HttpError({ status: 404, error: "adventure_not_found", message });
  }
  if (code === "map") {
    throw new HttpError({ status: 404, error: "map_not_found", message });
  }
  if (code === "not_playable") {
    throw new HttpError({ status: 409, error: "adventure_not_playable", message });
  }
  throw error;
}
