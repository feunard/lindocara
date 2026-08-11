import type { EventCode } from "@lindocara/engine/protocol.js";

/**
 * The top-right log is reserved for durable or critical outcomes. Moment-to-moment combat,
 * technique activation and failed proximity attempts already have immediate world/HUD feedback;
 * repeating them here only hides the information a player may actually need to remember.
 */
const IMPORTANT_EVENT_CODES = new Set<EventCode>([
  "level_up",
  "quest.accepted",
  "quest.fulfilled",
  "quest.run_started",
  "quest.run_expired",
  "quest.chapter_ready",
  "authored_quest.reward",
  "potion.used",
  "item.used",
  "item.resurrected",
  "merchant.purchased",
  "player.down",
  "loot.picked",
  "item.full",
  "death.fallen",
  "death.released",
  "death.reclaimed",
  "death.resurrected",
  "resurrect.cast",
  "peasant.camp_gold_deposited",
  "peasant.camp_gold_withdrawn",
  "talent.unlocked",
  "talent.reset",
  "party.created",
  "party.invited",
  "party.joined",
  "party.refused",
  "party.left",
  "party.kicked",
  "party.dissolved",
  "party.invalid",
  "party.forbidden",
  "party.full",
  "presence.replaced",
  "presence.lost",
  "room.full",
  "room.invalid_location",
  "zone.transition_failed",
  "adventure.victory",
]);

export function shouldLogEvent(code: EventCode): boolean {
  // Test commands are deliberate and need a visible result, but never occur in ordinary play.
  return IMPORTANT_EVENT_CODES.has(code) || code.startsWith("cheat.");
}
