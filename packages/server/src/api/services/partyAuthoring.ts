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
 *
 * `rethrowAsPartyError` also classifies a raw `DbConflictError` — `PartyService.joinParty`'s atomic
 * conditional insert reclassifies its own zero-row race outcome by re-reading state (so a
 * `DbConflictError` should not normally reach here from THAT path), but `createParty`'s initial
 * host-membership insert still goes through a plain `Repository.create()`, which throws one directly
 * on a unique-index hit. `partyMembers` has two unique indexes — `(partyId, userId)` and
 * `(partyId, color)` — and `DbConflictError` itself carries no constraint name (see this file's own
 * comment on `deepestErrorMessage`), so the classification reads the raw SQLite driver message.
 */
import { DbConflictError } from "alepha/orm";
import { HttpError } from "alepha/server";

/**
 * Walks an `Error`'s `.cause` chain to the bottom. `Repository.handleError` wraps the raw driver
 * error twice (its own `DbConflictError`, whose `.cause` is drizzle's wrapper, whose OWN `.cause` is
 * the raw `node:sqlite`/`better-sqlite3` error) — confirmed empirically against this app's own
 * SQLite provider: the deepest message is the only one that actually names the failed index's
 * columns, e.g. `"UNIQUE constraint failed: partyMembers.party_id, partyMembers.color"`.
 */
function deepestErrorMessage(error: unknown): string {
  let current: unknown = error;
  let message = error instanceof Error ? error.message : "";
  const seen = new Set<unknown>();
  while (current instanceof Error && current.cause instanceof Error && !seen.has(current)) {
    seen.add(current);
    const next: Error = current.cause;
    current = next;
    message = next.message;
  }
  return message;
}

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
  if (error instanceof DbConflictError) {
    const detail = deepestErrorMessage(error);
    if (/\bcolor\b/i.test(detail)) {
      throw new HttpError({ status: 409, error: "party_color_taken", message: detail });
    }
    throw new HttpError({ status: 409, error: "party_already_member", message: detail });
  }
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
