/**
 * Pure/ported hero-authoring error mapping — the Alepha-side twin of `packages/server/src/heroes.ts`
 * and the `heroErrorResponse` table `packages/server/src/index.ts` keeps beside its route handlers
 * (`:798`).
 *
 * The legacy `"prefix: message"` `Error` convention is preserved on purpose: `rethrowAsHeroError`
 * below is the direct port of `heroErrorResponse`, so every message a ported validator throws is
 * still routed to the exact same machine code.
 */
import { HttpError } from "alepha/server";

export function rethrowAsHeroError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  const code = message.split(":")[0];
  if (code === "not_found") throw new HttpError({ status: 404, error: "hero_not_found", message });
  if (code === "not_member")
    throw new HttpError({ status: 403, error: "hero_not_member", message });
  if (code === "cap") throw new HttpError({ status: 409, error: "hero_cap", message });
  throw error;
}
