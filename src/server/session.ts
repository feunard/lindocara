import { isUuid } from "../shared/identifiers.js";

/**
 * Stateless, signed sessions.
 *
 * A token is `base64url(payload) "." base64url(hmac)`. The signature exists so that a
 * player cannot hand themselves someone else's id and hijack their account.
 *
 * The `id` is an account id, minted once at registration by `createAccount` — not per
 * login. Logging in again reuses the same id; only `iat` changes.
 */

export const SESSION_COOKIE = "lindocara_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{2,16}$/;

export interface Session {
  id: string;
  username: string;
  /** Issued-at, in seconds since the epoch. */
  iat: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function isValidUsername(value: unknown): value is string {
  return typeof value === "string" && USERNAME_PATTERN.test(value);
}

export function isValidPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 128;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(text: string): Uint8Array | null {
  try {
    const padded = text.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function importKey(secret: string): Promise<CryptoKey> {
  // Without this, an unset SESSION_SECRET reaches WebCrypto as a zero-length key and every
  // login dies with an opaque "Zero-length key is not supported" 500. Say what is wrong.
  if (!secret) throw new Error("SESSION_SECRET is not configured");

  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSession(session: Session, secret: string): Promise<string> {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(session)));
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Returns the session only when the signature checks out and the token has not expired.
 * Every failure path returns `null` — callers must not be able to distinguish "bad
 * signature" from "malformed" from "expired".
 */
export async function verifySessionState(
  token: string,
  secret: string,
): Promise<Session | "expired" | null> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;

  const payload = token.slice(0, dot);
  const signature = base64UrlDecode(token.slice(dot + 1));
  if (signature === null) return null;

  const key = await importKey(secret);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    signature as unknown as ArrayBuffer,
    encoder.encode(payload) as unknown as ArrayBuffer,
  );
  if (!ok) return null;

  const decoded = base64UrlDecode(payload);
  if (decoded === null) return null;

  let session: unknown;
  try {
    session = JSON.parse(decoder.decode(decoded));
  } catch {
    return null;
  }

  if (
    typeof session !== "object" ||
    session === null ||
    !isUuid((session as Session).id) ||
    !Number.isSafeInteger((session as Session).iat) ||
    (session as Session).iat < 0 ||
    !isValidUsername((session as Session).username)
  ) {
    return null;
  }

  const { id, username, iat } = session as Session;
  if (Date.now() / 1000 > iat + SESSION_TTL_SECONDS) return "expired";

  return { id, username, iat };
}

export async function verifySession(token: string, secret: string): Promise<Session | null> {
  const result = await verifySessionState(token, secret);
  return result === "expired" ? null : result;
}

export function createSession(id: string, username: string): Session {
  return { id, username, iat: Math.floor(Date.now() / 1000) };
}

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const raw = part.trim();
    const eq = raw.indexOf("=");
    if (eq === -1) continue;
    if (raw.slice(0, eq) === SESSION_COOKIE) return raw.slice(eq + 1);
  }
  return null;
}

export function serializeSessionCookie(token: string, secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  // `Secure` on plain-HTTP localhost is rejected by some browsers, so only set it when
  // the request actually arrived over TLS.
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const attributes = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}
