/**
 * What the Escape key (and the gamepad button bound to `settings`) means right now.
 *
 * The rule has always been a ladder: close whatever is open, one rung per press, and only open the
 * game menu once the screen is clear. It grew a rung for the editor playtest, where the menu is not
 * the right bottom of the ladder at all: a creator pressing Escape in a test wants to be back in
 * the editor, not looking at the player's settings panel.
 *
 * Pure and separate from `session.ts` so the ladder can be read and tested as the one decision it
 * is. The caller performs the action; nothing here touches a store, the input state or the network.
 */

export type EscapeIntent =
  | "close-interior"
  | "close-map"
  | "close-talents"
  | "close-quest-journal"
  | "close-inventory"
  | "close-settings"
  | "leave-adventure-test"
  | "open-settings";

export interface EscapeContext {
  interiorOpen: boolean;
  mapOpen: boolean;
  talentsOpen: boolean;
  questJournalOpen: boolean;
  inventoryOpen: boolean;
  merchantOpen: boolean;
  settingsOpen: boolean;
  /** A live editor playtest, read from the navigation seam's test-session atom. */
  adventureTestRunning: boolean;
}

export function escapeIntent(context: EscapeContext): EscapeIntent {
  if (context.interiorOpen) return "close-interior";
  if (context.mapOpen) return "close-map";
  if (context.talentsOpen) return "close-talents";
  if (context.questJournalOpen) return "close-quest-journal";
  if (context.inventoryOpen || context.merchantOpen) return "close-inventory";
  if (context.settingsOpen) return "close-settings";
  // Last rung, and only when nothing is open: a playtest is a session the creator is visiting, so
  // the way out of it is the same key that would otherwise open a menu they did not come for.
  if (context.adventureTestRunning) return "leave-adventure-test";
  return "open-settings";
}
