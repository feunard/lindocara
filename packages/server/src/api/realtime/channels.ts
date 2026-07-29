import { z } from "alepha";
import { $channel } from "alepha/websocket";

/**
 * `$channel`'s generic bound is `TObject | TUnion` (see
 * `.vendor/alepha/src/websocket/primitives/$channel.ts`), so a bare `z.unknown()` does not
 * satisfy either side's type, and alepha's own `z` re-export (`ZodProvider.ts`) has no
 * top-level `z.looseObject`/`z.unknown` builder — only `z.object` (a direct reference to
 * native `zod.object`, so its instance methods are the real zod ones). `z.object({}).loose()`
 * is therefore the loosest shape that both compiles against `TObject` AND accepts any JSON
 * object at runtime (unrecognized keys pass through unvalidated instead of being stripped or
 * rejected).
 *
 * This laxity is deliberate, not a placeholder: the single-parser doctrine (see the realtime
 * plan's Global Constraints and `packages/engine/src/protocol.ts`) keeps `parseClientMessage`
 * / `encodeServerMessage` / `parseServerMessage` as the ONLY place that knows the 25 message
 * variants. Re-describing them here in zod would be exactly the drift the doctrine forbids, so
 * every channel schema stays "any JSON object" and defers real validation to `engine`.
 */
function looseWireSchema() {
  return { in: z.object({}).loose(), out: z.object({}).loose() };
}

/**
 * The three realtime-tranche channels, declared as class fields per `$channel`'s own
 * requirement (it reads Alepha's ambient service/module context during field
 * initialization — see `createPrimitive`/`$context` — so it only works inside a class
 * instantiated through `alepha.inject`/`alepha.with`, never a bare module-level call).
 *
 * This class is intentionally NOT registered in `LindocaraApi` yet: Task 1 only declares the
 * channels. The rooms that actually serve them (`WorldRoom`, `PartyRoom`, `PresenceRoom` —
 * Tasks 2-5) will `$inject(RealtimeChannels)` and register themselves; a bare channel
 * declaration needs no module wiring of its own (mirrors `alepha`'s own
 * `room-integration.spec.ts`, which injects a channel-holding class with no `.with()` module at
 * all).
 */
export class RealtimeChannels {
  /**
   * The socketed world room: one `$room` per `partyId:mapId`, tickHz 20, successor to legacy
   * `World`. Browsers connect here directly.
   */
  worldChannel = $channel({
    path: "/ws/world",
    description: "Authoritative simulation room (movement, combat, monsters, loot, events).",
    schema: looseWireSchema(),
  });

  /**
   * The headless party coordinator room, successor to legacy `GameSession`. No browser opens a
   * socket here directly in this tranche — other rooms reach it only through `room.call(...)`
   * RPCs (party chat/victory fan-out, adventure-state writes). The path/schema exist because
   * `$channel`/`$room` require them, not because a client dials this path.
   */
  partyChannel = $channel({
    path: "/ws/party",
    description: "Headless party coordinator room (stub — Task 3 gives it real handlers).",
    schema: looseWireSchema(),
  });

  /**
   * The headless per-hero presence/lease room, successor to legacy `HeroPresence`. Same
   * headless-only shape as `partyChannel`: reached only via `room.call(...)`, never a direct
   * browser socket.
   */
  presenceChannel = $channel({
    path: "/ws/presence",
    description: "Headless hero presence/lease room (stub — Task 2 gives it real handlers).",
    schema: looseWireSchema(),
  });
}
