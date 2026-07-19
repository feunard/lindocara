/**
 * "Last-edited adventure" memory (UX wave #15): opening the editor lands directly in the last
 * adventure this account edited, so there is no picker page. The id is remembered in localStorage,
 * keyed per account so two accounts on the same browser never inherit each other's last adventure.
 *
 * When no account id is known (it always is inside the editor — you must be logged in — but be
 * defensive) the value falls back to a single global key; the only cost is that a shared browser with
 * an unknown identity would remember one adventure across accounts, which the bootstrap tolerates
 * because a gone/forbidden id simply falls through to instant-create.
 *
 * Every access is wrapped: a browser with localStorage disabled (private mode, storage quota, a test
 * without a DOM) must degrade to "no memory", never throw and take the editor down with it.
 */
const KEY_PREFIX = "lindocara:editor:last-adventure";

function keyFor(accountId: string | null): string {
  return accountId ? `${KEY_PREFIX}:${accountId}` : `${KEY_PREFIX}:__global__`;
}

export function readLastEditedAdventure(accountId: string | null): string | null {
  try {
    return globalThis.localStorage?.getItem(keyFor(accountId)) ?? null;
  } catch {
    return null;
  }
}

export function writeLastEditedAdventure(accountId: string | null, adventureId: string): void {
  try {
    globalThis.localStorage?.setItem(keyFor(accountId), adventureId);
  } catch {
    // Best-effort: an unwritable store just means we forget the last adventure, not a broken editor.
  }
}

export function clearLastEditedAdventure(accountId: string | null): void {
  try {
    globalThis.localStorage?.removeItem(keyFor(accountId));
  } catch {
    // As above — a failed clear is harmless; the next bootstrap re-validates the remembered id.
  }
}
