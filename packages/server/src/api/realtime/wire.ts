/**
 * App-level wire caps for the realtime tranche's `$room`s. Alepha has no built-in frame-size
 * cap or per-connection rate limiter (recon-verified — see the realtime-tranche plan's
 * "Verified recon findings" #6), so every socketed room must enforce these itself in its
 * `onMessage`, the same way legacy `world.ts` does.
 *
 * Values and names are copied verbatim from
 * `packages/server/src/world/world-runtime.ts:72-81` (NOT imported — `src/api/` never imports
 * legacy server code, see `packages/server/CLAUDE.md`'s "legacy stack stays untouched" rule).
 * If the legacy constants ever change, re-copy them here by hand.
 */
export const MAX_FRAME_BYTES = 2_048;
export const RATE_WINDOW_MS = 1_000;
export const RATE_MAX_MESSAGES = 35;
export const MAX_MALFORMED = 5;
export const MAX_QUEUED_COMMANDS = 12;

const textEncoder = new TextEncoder();

/**
 * UTF-8 byte length of a raw wire frame. `raw.length` counts UTF-16 code units, which
 * undercounts any multi-byte character — French chat/dialogue text is full of them (é, ç, …) —
 * so comparing `.length` against `MAX_FRAME_BYTES` would silently let an oversized frame
 * through. Matches legacy `world.ts`'s byte-accurate frame cap.
 */
export function frameByteLength(raw: string): number {
  return textEncoder.encode(raw).length;
}
