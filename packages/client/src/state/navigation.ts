/**
 * The navigation seam `game/session.ts` (and the zustand store's deprecated editor-facing shims)
 * use to reach the router and the application atoms without importing React or `alepha/react`
 * themselves. `packages/client/src/game/**` must not import either — the whole point of the
 * client/renderer split (see the root AGENTS.md) — and must never write an atom directly, so this
 * module carries zero `alepha` dependency of its own: it is just a type plus a module-level
 * mutable holder, safe to import from anywhere in the package (including the strict, non-Alepha
 * `tsconfig.json` program `game/**` and `store.ts` compile under).
 *
 * `packages/client/src/ui/AppRouter.tsx`'s root layout installs the real implementation on mount,
 * closing over the Alepha instance's `ReactRouter` and `store` (which DOES need `alepha`, hence
 * that file living in the separate `tsconfig.api.json` program), and clears it on unmount. A test
 * installs a plain fake object by reassignment (`setGameNavigation({...})`) — no Alepha instance
 * required.
 */
import type { ConsumableId } from "@lindocara/engine/consumables.js";
import type { AdventureTestSession, PartyListing } from "../api.js";
import type { AdventureEditorSession } from "../store.js";

export type ActiveParty = PartyListing;
export type QuickItems = readonly [ConsumableId | null, ConsumableId | null, ConsumableId | null];

/**
 * `toGame`/`toMenu`/`toAuth` are the player-facing destinations `game/session.ts` actually
 * reaches. `setActiveParty`/`getActiveParty`, `getAdventureTestSession` and `getQuickItems` are the
 * atom writes/reads its branches need (an atom's live value, outside React, only exists behind this
 * seam — see `state/atoms.ts`'s docblock; `getQuickItems` backs the `useQuickItem` hotkey, which
 * used to read the zustand `quickItems` field directly). `setAdventureTestSession`/
 * `setAdventureEditorSession` back the store's deprecated `setAdventureTestSession`/
 * `setAdventureEditorSession`/`setActiveParty` shims (editor writers only — Task 6 removes all
 * three alongside the editor's zustand coupling). `push` is a deliberately loose escape hatch for
 * the store's deprecated `setScreen` shim (removed in Task 6 alongside the `screen` field): it
 * still has to reach destinations (`title`, `new`/`continue`/`join`, `credits`, the editor) this
 * typed surface has no other reason to name.
 */
export type GameNavigation = {
  toGame(): void;
  toMenu(): void;
  toAuth(): void;
  setActiveParty(party: ActiveParty | null): void;
  getActiveParty(): ActiveParty | null;
  setAdventureTestSession(session: AdventureTestSession | null): void;
  getAdventureTestSession(): AdventureTestSession | null;
  getQuickItems(): QuickItems;
  /** @deprecated Editor-shim-only — see the type docblock. */
  setAdventureEditorSession(session: AdventureEditorSession | null): void;
  /** @deprecated Editor/legacy-screen-shim-only — see the type docblock. */
  push(routeName: string): void;
};

let installed: GameNavigation | null = null;

/** Installed by the AppRouter layout on mount, cleared (`null`) on unmount. A test installs a fake
 *  by plain reassignment. */
export function setGameNavigation(nav: GameNavigation | null): void {
  installed = nav;
}

/** The currently installed seam, or null before the router has mounted (or in a test that never
 *  installs one) — every caller must stay null-safe (`getGameNavigation()?.toMenu()`), the same way
 *  `game/session.ts` already treats `connection`/timers as possibly absent. */
export function getGameNavigation(): GameNavigation | null {
  return installed;
}
