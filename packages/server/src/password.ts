/**
 * PBKDF2-SHA256 password hashing via WebCrypto — native in workerd, zero dependencies.
 *
 * The iteration count is stored alongside each hash so it can be raised later without
 * invalidating existing accounts: an old row verifies with its recorded count, and new
 * accounts pick up the new constant.
 */

/**
 * **workerd's hard ceiling for PBKDF2 is 100,000 iterations** — `crypto.subtle.deriveBits`
 * throws `NotSupportedError: iteration counts above 100000 are not supported` for anything higher.
 * OWASP recommends 600,000, but on Cloudflare Workers that value makes every register/login/guest
 * 500 in production (it slips past the test suite, which overrides the count via
 * TEST_PBKDF2_ITERATIONS). So this is pinned to the platform maximum. The count is stored per row,
 * so raising it later — only ever up to 100,000 — verifies old rows at their recorded count.
 */
export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

export interface PasswordRecord {
  /** base64 of the derived bits */
  hash: string;
  /** base64 of the per-account random salt */
  salt: string;
  iterations: number;
}

const encoder = new TextEncoder();

/** Tests can shorten the deliberately expensive hash; production has no such binding. */
export function configuredPasswordIterations(env: Pick<Env, "TEST_PBKDF2_ITERATIONS">): number {
  const raw = env.TEST_PBKDF2_ITERATIONS;
  if (raw === undefined) return PBKDF2_ITERATIONS;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= PBKDF2_ITERATIONS
    ? parsed
    : PBKDF2_ITERATIONS;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as ArrayBuffer, iterations },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(
  password: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<PasswordRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return { hash: toBase64(hash), salt: toBase64(salt), iterations };
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const expected = fromBase64(record.hash);
  const actual = await derive(password, fromBase64(record.salt), record.iterations);
  if (expected.length !== actual.length) return false;
  // Constant-time comparison: never early-exit on the first differing byte.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= (expected[i] ?? 0) ^ (actual[i] ?? 0);
  return diff === 0;
}
