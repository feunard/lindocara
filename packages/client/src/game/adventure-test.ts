/**
 * Leaving an editor playtest, once, for both ways out.
 *
 * Its own module rather than a function in `session.ts` because two very different callers need
 * the same five steps in the same order: `ui/AdventureTestOverlay.tsx`'s "Return to editor" button
 * and the Escape key, which `session.ts` routes here once its close ladder has nothing left to
 * close. Keeping it beside `stopActiveGameSession` would have made the overlay's own test mock the
 * exit it is trying to exercise; here the leave logic stays real while `session.js` is stubbed.
 */
import { ApiError, deleteAdventureTestSessionApi, errorCode } from "../api.js";
import { getGameNavigation } from "../state/navigation.js";
import { stopActiveGameSession } from "./session.js";

/**
 * Delete the disposable envelope, tear the runtime down, clear the atoms that say a test is
 * running, and land back in the editor.
 *
 * The ORDER matters and is the reason this is one function: the session atom is still set while
 * `stopActiveGameSession` runs, which is how `returnFromGameSession` knows to head for the editor
 * rather than the main menu.
 *
 * Returns `null` on success, or the api error code when the delete failed. A failure deliberately
 * leaves the creator INSIDE the test rather than falsely promising a clean return, and each caller
 * surfaces it its own way: the overlay in its banner, the key on the status line. An envelope the
 * server has already dropped (`adventure_test_not_found`) counts as success, since expiry achieved
 * exactly what the delete was for.
 *
 * Safe to call with no test running: it does nothing and reports success.
 */
export async function leaveAdventureTest(): Promise<string | null> {
  const nav = getGameNavigation();
  const session = nav?.getAdventureTestSession();
  if (!session) return null;
  try {
    await deleteAdventureTestSessionApi(session.id);
  } catch (caught) {
    if (!(caught instanceof ApiError) || caught.code !== "adventure_test_not_found") {
      return errorCode(caught);
    }
  }
  stopActiveGameSession();
  nav?.setAdventureTestSession(null);
  nav?.setActiveParty(null);
  nav?.toEditor();
  return null;
}
