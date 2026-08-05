/**
 * App-level wire caps for the realtime tranche's `$room`s. Alepha has no built-in frame-size
 * cap or per-connection rate limiter (recon-verified — see the realtime-tranche plan's
 * "Verified recon findings" #6), so every socketed room must enforce these itself in its
 * `onMessage`.
 *
 * The four numeric caps are re-exported straight from `../../world/world-runtime.ts`, which
 * stays their single source of truth: `src/world/*` is the pure domain-system layer this
 * package's realtime rooms already compose with injected dependencies (see `WorldRoom.ts`'s own
 * import of `world-runtime.js`), not retired legacy code, so importing it here is unremarkable
 * and kills what would otherwise be a hand-maintained duplicate. This file's own addition is
 * `frameByteLength`, the UTF-8-accurate byte counter these caps are measured against.
 */
export {
  MAX_FRAME_BYTES,
  MAX_MALFORMED,
  RATE_MAX_MESSAGES,
  RATE_WINDOW_MS,
} from "../../world/world-runtime.js";

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
