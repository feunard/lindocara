/**
 * The navigation seam `game/session.ts` uses to reach the router and the application atoms without
 * importing React or `alepha/react` itself. `packages/client/src/game/**` must not import either —
 * the whole point of the client/renderer split (see the root AGENTS.md) — and must never write an
 * atom directly, so this module carries zero `alepha` dependency of its own: it is just a type plus
 * a module-level mutable holder, safe to import from anywhere in the package (including the strict,
 * non-Alepha `tsconfig.json` program `game/**` and `store.ts` compile under).
 *
 * `packages/client/src/ui/AppRouter.tsx`'s root layout installs the real implementation on mount,
 * closing over the Alepha instance's `ReactRouter` and `store` (which DOES need `alepha`, hence
 * that file living in the separate `tsconfig.api.json` program), and clears it on unmount. A test
 * installs a plain fake object by reassignment (`setGameNavigation({...})`) — no Alepha instance
 * required.
 *
 * Task 3 adds a second, sibling seam below (`onUnauthorized`/`setOnUnauthorized`) for the SAME
 * reason: `api.ts`'s plain-`fetch` calls need to react to a 401 without importing `alepha`
 * themselves. It is deliberately not folded into `GameNavigation` — that type is documented as
 * `game/session.ts` specifically, and `api.ts` is a different, broader caller (every screen, both
 * packages).
 */
import type { ConsumableId } from "@lindocara/engine/consumables.js";

import type { AdventureTestSession, PartyListing } from "../api.js";

export type ActiveParty = PartyListing;
export type QuickItems = readonly [ConsumableId | null, ConsumableId | null, ConsumableId | null];

/**
 * `toGame`/`toMenu`/`toAuth`/`toEditor` are the player-facing destinations `game/session.ts`
 * actually reaches (a game session ending with a live editor test session returns to the editor,
 * not the menu — see `returnFromGameSession()`). `setActiveParty`/`getActiveParty`,
 * `getAdventureTestSession` and `getQuickItems` are the atom writes/reads its branches need (an
 * atom's live value, outside React, only exists behind this seam — see `state/atoms.ts`'s
 * docblock; `getQuickItems` backs the `useQuickItem` hotkey, which used to read the zustand
 * `quickItems` field directly). `setAdventureTestSession` backs `game/session.ts`'s own
 * launch/launch-failure paths for the disposable test session atom.
 *
 * Task 6 removed the type's two prior escape hatches — `setAdventureEditorSession` and the untyped
 * `push(routeName: string)` — once the store's deprecated `setScreen`/`setAdventureEditorSession`
 * shims died: every former caller is a React component now (the editor, `MainMenu`, …), so it
 * reaches `useStore(adventureEditorSessionAtom)`/`useRouter().push(...)` directly instead of this
 * non-React seam. `toEditor` is the one remaining non-React caller's (`game/session.ts`) sole
 * navigation need that the router's own typed `push` doesn't otherwise reach for it.
 */
export type GameNavigation = {
  toGame(): void;
  toMenu(): void;
  toAuth(): void;
  toEditor(): void;
  setActiveParty(party: ActiveParty | null): void;
  getActiveParty(): ActiveParty | null;
  setAdventureTestSession(session: AdventureTestSession | null): void;
  getAdventureTestSession(): AdventureTestSession | null;
  getQuickItems(): QuickItems;
  /** Signs the player out through Alepha's `ReactAuth` (a `<form>` POST to `/oauth/logout`; the
   *  server's redirect response makes the browser navigate away on its own — no manual
   *  `window.location.reload()` needed after it, unlike the old `api.ts` `logout()` it replaces). */
  logout(): void;
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

/**
 * The ONE 401-recovery seam (Task 3): "clear the auth atom, navigate to `/auth`" is implemented in
 * exactly one place — the closure `AppLayout` installs below, alongside `GameNavigation` — and both
 * call sites that can notice an unauthenticated response funnel through it rather than each
 * reimplementing recovery:
 *
 * - `AppRouter`'s own `$hook({ on: "client:onError" })` (the lore idiom), for anything that goes
 *   through Alepha's own `HttpClient` (`ReactAuth.ping()`/`login()` today; a future task's typed
 *   `$client<T>()` loaders tomorrow) — that event never fires for a plain `fetch()`.
 * - `api.ts`'s `api()` helper, for its own plain-`fetch` calls, on an `UnauthorizedError`/
 *   `session_expired` machine code specifically (never on `InvalidCredentialsError` — a wrong
 *   password during login/register is not a dead session, and must not bounce the auth form back
 *   onto itself).
 *
 * A no-op before install (a bare-render test, or a genuinely offline call before the app has
 * mounted) — every caller must stay just as null-safe as `getGameNavigation()`'s callers already
 * are, just via a call instead of `?.`.
 */
let onUnauthorizedHandler: (() => void) | null = null;

/** Installed by the AppRouter layout on mount, cleared (`null`) on unmount — same lifecycle as
 *  `setGameNavigation`. A test installs a plain fake by reassignment. */
export function setOnUnauthorized(handler: (() => void) | null): void {
  onUnauthorizedHandler = handler;
}

export function onUnauthorized(): void {
  onUnauthorizedHandler?.();
}
