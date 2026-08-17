/**
 * Pure/ported adventure-authoring rules — the Alepha-side twin of `packages/server/src/adventures.ts`
 * and the adventure-body parsing helpers `packages/server/src/index.ts` keeps beside its route
 * handlers.
 *
 * Nothing here touches a database. `AdventureService` (`./AdventureService.ts`) is the only caller
 * and is where every repository read/write lives; keeping the decode/error-mapping pure here mirrors
 * `mapAuthoring.ts`'s split.
 *
 * The legacy `"prefix: message"` `Error` convention is preserved on purpose: `rethrowAsAdventureError`
 * below is the direct port of `packages/server/src/index.ts`'s `adventureErrorResponse`, so every
 * message a ported validator throws is still routed to the exact same machine code.
 */
import {
  type AdventureAudioConfig,
  DEFAULT_ADVENTURE_AUDIO,
  parseAdventureAudioConfig,
} from "@lindocara/engine/audio-catalog.js";
import { HttpError } from "alepha/server";

/** Never throws — degrades to the default config, matching `decodeAdventureAudio` in `adventures.ts`. */
export function decodeAdventureAudio(text: string): AdventureAudioConfig {
  if (text === "") return { ...DEFAULT_ADVENTURE_AUDIO };
  try {
    return parseAdventureAudioConfig(JSON.parse(text)) ?? { ...DEFAULT_ADVENTURE_AUDIO };
  } catch {
    return { ...DEFAULT_ADVENTURE_AUDIO };
  }
}

/**
 * `adventures.ts` throws `"prefix: message"`; the prefix is the machine code. Ported verbatim from
 * `adventureErrorResponse` in `packages/server/src/index.ts`, but throws `HttpError` instead of
 * building a `Response` — this is the Worker-route boundary re-expressed for `$action` handlers. An
 * unrecognized prefix is rethrown as-is (matching legacy), which surfaces as an unhandled 500 rather
 * than a business error, since it was never meant to be reachable from a validated body.
 */
export function rethrowAsAdventureError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  const code = message.split(":")[0];
  if (code === "not_found") {
    throw new HttpError({ status: 404, error: "adventure_not_found", message });
  }
  // 403, deliberately, where the map routes answer a foreign row with 404. A map hides behind
  // "no such map" because nothing tells the caller it exists; an adventure is READABLE by every
  // authenticated account, so the caller has already been handed the row and telling them it does
  // not exist would contradict the GET they just made. Refusing the write is the honest answer.
  if (code === "forbidden") {
    throw new HttpError({ status: 403, error: "adventure_forbidden", message });
  }
  if (code === "referenced") {
    throw new HttpError({ status: 409, error: "adventure_referenced", message });
  }
  if (code === "in_use") {
    throw new HttpError({ status: 409, error: "adventure_in_use", message });
  }
  if (code === "title" || code === "players" || code === "maps" || code === "graph") {
    throw new HttpError({ status: 400, error: `adventure_${code}`, message });
  }
  throw error;
}
