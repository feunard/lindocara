/**
 * Pure/ported party-authoring rules — the Alepha-side twin of `packages/server/src/parties.ts` and
 * the party route handlers `packages/server/src/index.ts` keeps beside them (`:784` for the error
 * table, `:971` for cursor pagination).
 *
 * Nothing here touches a database. `PartyService` (`./PartyService.ts`) is the only caller and is
 * where every repository read/write lives; keeping the cursor codec/error-mapping pure here mirrors
 * `mapAuthoring.ts`'s split.
 *
 * The legacy `"prefix: message"` `Error` convention is preserved on purpose: `rethrowAsPartyError`
 * below is the direct port of `packages/server/src/index.ts`'s `partyErrorResponse`, so every
 * message a ported validator throws is still routed to the exact same machine code.
 */
import { HttpError } from "alepha/server";

/**
 * A page cursor is `<createdAt>:<id>`. Unlike legacy's millisecond-epoch cursor, `createdAt` here is
 * the ISO-8601 string `Repository.clean()` always normalizes datetime columns to (see
 * `Repository.ts`'s own comment on `z.schema.isDateTime`) — so the split uses `lastIndexOf(":")`,
 * not `indexOf`, because the ISO timestamp itself contains colons (`HH:mm:ss`) while a server-minted
 * id never does.
 */
export interface PartyCursor {
  createdAt: string;
  id: string;
}

const CURSOR_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** Ported from `parsePartyCursor` in `packages/server/src/parties.ts`, re-expressed for an ISO
 *  `createdAt` string instead of a millisecond epoch number. */
export function parsePartyCursor(value: string | undefined): PartyCursor | null {
  if (value === undefined) return null;
  const separator = value.lastIndexOf(":");
  if (separator <= 0) throw new Error("page: invalid party cursor");
  const createdAt = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (Number.isNaN(Date.parse(createdAt)) || !CURSOR_ID_PATTERN.test(id)) {
    throw new Error("page: invalid party cursor");
  }
  return { createdAt, id };
}

/** Ported from `encodePartyCursor` in `packages/server/src/parties.ts`. */
export function encodePartyCursor(row: { createdAt: string; id: string }): string {
  return `${row.createdAt}:${row.id}`;
}

/**
 * `parties.ts` throws `"prefix: message"`; the prefix is the machine code. Ported verbatim from
 * `partyErrorResponse` in `packages/server/src/index.ts`, but throws `HttpError` instead of building
 * a `Response` — this is the Worker-route boundary re-expressed for `$action` handlers. An
 * unrecognized prefix is rethrown as-is (matching legacy), which surfaces as an unhandled 500 rather
 * than a business error, since it was never meant to be reachable from a validated body.
 */
export function rethrowAsPartyError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  const code = message.split(":")[0];
  if (code === "not_found") throw new HttpError({ status: 404, error: "party_not_found", message });
  if (code === "adventure") throw new HttpError({ status: 404, error: "party_adventure", message });
  if (code === "not_playable") {
    throw new HttpError({ status: 409, error: "adventure_not_playable", message });
  }
  if (code === "cap") throw new HttpError({ status: 409, error: "party_cap", message });
  if (code === "already_member" || code === "full" || code === "color_taken") {
    throw new HttpError({ status: 409, error: `party_${code}`, message });
  }
  if (code === "page") throw new HttpError({ status: 400, error: "party_page_invalid", message });
  throw error;
}
