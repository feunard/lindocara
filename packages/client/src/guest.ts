/**
 * Guest accounts.
 *
 * "Continue as guest" is a real account, not a special server-side mode: the client mints a random
 * username and password, registers them like anyone else, and keeps them in localStorage so the
 * same browser lands back on the same heroes. The server stays entirely unaware that a guest is a
 * guest, which is the point — no second auth path to secure, no guest-only branch in the session,
 * presence or party code, and a guest can be turned into a named account later by nothing more
 * than a rename.
 *
 * The trade-off is deliberate and worth stating: a password sits in localStorage in clear text.
 * Anything with script access to the origin can read it. That is acceptable only because the
 * credential is generated, never reused elsewhere, and guards nothing but this game's save. Never
 * put a human-chosen password through here.
 */
import { ApiError, api, type Me } from "./api.js";

const STORAGE_KEY = "lindocara.guest";
/** Matches the server's USERNAME_PATTERN alphabet, lowercased since accounts are stored that way. */
const USERNAME_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const PASSWORD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const USERNAME_PREFIX = "guest-";
/** The server caps usernames at 16, so the prefix plus this is exactly the budget. */
const USERNAME_SUFFIX_LENGTH = 10;
const PASSWORD_LENGTH = 32;
/** Two 16-character namespaces colliding is vanishingly unlikely, but it must not be a dead end. */
const REGISTER_ATTEMPTS = 5;

export interface GuestCredentials {
  username: string;
  password: string;
}

function randomChars(count: number, alphabet: string): string {
  // Discard the biased tail of the byte range rather than taking a plain modulo, so every character
  // stays equally likely. This is the password's entropy, not a display id.
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  const chars: string[] = [];
  const buffer = new Uint8Array(count * 2);
  while (chars.length < count) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (chars.length === count) break;
      if (byte >= limit) continue;
      chars.push(alphabet[byte % alphabet.length] as string);
    }
  }
  return chars.join("");
}

export function mintGuestCredentials(): GuestCredentials {
  return {
    username: USERNAME_PREFIX + randomChars(USERNAME_SUFFIX_LENGTH, USERNAME_ALPHABET),
    password: randomChars(PASSWORD_LENGTH, PASSWORD_ALPHABET),
  };
}

/** Reads the stored guest, validating it against the server's own rules. Storage is user-writable
 * and survives across deploys, so it is treated as untrusted input exactly like a wire message. */
export function readGuest(): GuestCredentials | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be disabled outright (private windows, blocked cookies). Guests then simply do
    // not persist, which is a worse experience but never a broken one.
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const username = (parsed as { username?: unknown } | null)?.username;
  const password = (parsed as { password?: unknown } | null)?.password;
  if (typeof username !== "string" || typeof password !== "string") return null;
  if (!/^[A-Za-z0-9_-]{2,16}$/.test(username)) return null;
  if (password.length < 8 || password.length > 128) return null;
  return { username, password };
}

export function saveGuest(credentials: GuestCredentials): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
  } catch {
    // Out of quota or storage disabled: the account still exists and this session still works, it
    // just will not be found again. Losing the handle must not lose the login that already worked.
  }
}

export function forgetGuest(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — the caller is already on its way out.
  }
}

async function registerGuest(): Promise<Me> {
  for (let attempt = 0; attempt < REGISTER_ATTEMPTS; attempt += 1) {
    const credentials = mintGuestCredentials();
    try {
      const me = await api<Me>("/api/register", {
        method: "POST",
        body: JSON.stringify(credentials),
      });
      // Only after the server accepted it: storing first would leave a credential behind that no
      // account answers to, and the next visit would fail its login and mint a second account.
      saveGuest(credentials);
      return me;
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "username_taken") throw error;
    }
  }
  throw new Error("guest registration exhausted its attempts");
}

/**
 * Signs in as the guest this browser already owns, or creates one. Returns the account the caller
 * is now authenticated as.
 */
export async function continueAsGuest(): Promise<Me> {
  const stored = readGuest();
  if (!stored) return registerGuest();
  try {
    return await api<Me>("/api/session", { method: "POST", body: JSON.stringify(stored) });
  } catch (error) {
    // The stored account no longer answers — a wiped database, a deleted account. Mint a fresh one
    // rather than stranding someone on a credential they can neither see nor retype. Any other
    // failure (rate limit, network, server error) is real and must surface.
    if (!(error instanceof ApiError) || error.code !== "invalid_credentials") throw error;
    forgetGuest();
    return registerGuest();
  }
}
