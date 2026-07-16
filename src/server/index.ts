/**
 * Worker entry: the API surface and the front door to the world.
 *
 * Static assets are served by Cloudflare before this ever runs — `run_worker_first` in
 * wrangler.jsonc routes only `/api/*` here, so the SPA fallback can never swallow an API
 * call and this handler never has to think about serving files.
 */

import { normalizeAppearance } from "../shared/character.js";
import { WS_CLOSE } from "../shared/close-codes.js";
import { isValidClass } from "../shared/game.js";
import { isUuid } from "../shared/identifiers.js";
import { isValidInstanceId } from "../shared/zones.js";
import { accountExists, createAccount, verifyCredentials } from "./accounts.js";
import {
  characterOwnedBy,
  createCharacter,
  deleteCharacter,
  isValidAppearance,
  isValidCharacterName,
  listCharacters,
} from "./characters.js";
import { createDb } from "./db/index.js";
import { resolveMapFor } from "./maps.js";
import { loadProfile } from "./profile.js";
import {
  clearSessionCookie,
  createSession,
  isValidPassword,
  isValidUsername,
  readSessionCookie,
  type Session,
  serializeSessionCookie,
  signSession,
  verifySession,
  verifySessionState,
} from "./session.js";
import { locationFromMap } from "./world/map-zone.js";

export { CharacterPresence } from "./character-presence.js";
export { World } from "./world.js";

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

const MAX_API_JSON_BYTES = 4_096;

async function readJson(request: Request): Promise<{ value: unknown } | Response> {
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_API_JSON_BYTES) {
    return json({ error: "request_too_large" }, { status: 413 });
  }
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "expected_json" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > MAX_API_JSON_BYTES) {
      await reader.cancel();
      return json({ error: "request_too_large" }, { status: 413 });
    }
    chunks.push(part.value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { value: JSON.parse(new TextDecoder().decode(body)) };
  } catch {
    return json({ error: "expected_json" }, { status: 400 });
  }
}

function closedWebSocket(code: number, reason: string): Response {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}

function isSecure(url: URL): boolean {
  return url.protocol === "https:";
}

async function currentSession(request: Request, env: Env) {
  const token = readSessionCookie(request);
  if (!token) return null;
  return verifySession(token, env.SESSION_SECRET);
}

type SessionAuth = { session: Session } | Response;

/** Cryptographic session plus a live account row — stale cookies after a local D1 reset 401 here. */
async function requireSession(request: Request, env: Env, url: URL): Promise<SessionAuth> {
  const session = await currentSession(request, env);
  if (!session) return json({ error: "unauthorized" }, { status: 401 });
  if (!(await accountExists(createDb(env.DB), session.id))) {
    return json(
      { error: "session_expired" },
      { status: 401, headers: { "Set-Cookie": clearSessionCookie(isSecure(url)) } },
    );
  }
  return { session };
}

interface Credentials {
  username: string;
  password: string;
}

/** Returns parsed credentials or a ready-to-send 400. */
async function readCredentials(request: Request): Promise<Credentials | Response> {
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const body = parsed.value;
  const username = (body as { username?: unknown } | null)?.username;
  const password = (body as { password?: unknown } | null)?.password;
  if (!isValidUsername(username)) return json({ error: "invalid_username" }, { status: 400 });
  if (!isValidPassword(password)) return json({ error: "invalid_password" }, { status: 400 });
  return { username, password };
}

async function sessionResponse(
  account: { id: string; username: string },
  env: Env,
  url: URL,
): Promise<Response> {
  const session = createSession(account.id, account.username);
  const token = await signSession(session, env.SESSION_SECRET);
  return json(
    { id: account.id, username: account.username },
    { headers: { "Set-Cookie": serializeSessionCookie(token, isSecure(url)) } },
  );
}

async function handleRegister(request: Request, env: Env, url: URL): Promise<Response> {
  const credentials = await readCredentials(request);
  if (credentials instanceof Response) return credentials;
  const account = await createAccount(createDb(env.DB), credentials.username, credentials.password);
  if (account === "username_taken") return json({ error: "username_taken" }, { status: 409 });
  return sessionResponse(account, env, url);
}

async function handleLogin(request: Request, env: Env, url: URL): Promise<Response> {
  const credentials = await readCredentials(request);
  if (credentials instanceof Response) return credentials;
  const account = await verifyCredentials(
    createDb(env.DB),
    credentials.username,
    credentials.password,
  );
  // One body for both "no such user" and "wrong password" — indistinguishable by design.
  if (!account) return json({ error: "invalid_credentials" }, { status: 401 });
  return sessionResponse(account, env, url);
}

async function handleJoin(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("expected a websocket upgrade", { status: 426 });
  }

  const token = readSessionCookie(request);
  if (!token) return json({ error: "unauthorized" }, { status: 401 });
  const session = await verifySessionState(token, env.SESSION_SECRET);
  if (session === "expired") {
    return closedWebSocket(WS_CLOSE.SESSION_EXPIRED, "session expired");
  }
  if (!session) return json({ error: "unauthorized" }, { status: 401 });
  if (!(await accountExists(createDb(env.DB), session.id))) {
    return closedWebSocket(WS_CLOSE.SESSION_EXPIRED, "session expired");
  }

  const characterId = url.searchParams.get("character");
  if (!characterId) return json({ error: "missing_character" }, { status: 400 });
  if (!isUuid(characterId)) return json({ error: "invalid_character" }, { status: 400 });

  // Ownership is proven here, outside the Durable Object, so the DO can trust the header.
  const owned = await characterOwnedBy(createDb(env.DB), session.id, characterId);
  if (!owned) return json({ error: "forbidden" }, { status: 403 });
  const profile = await loadProfile(createDb(env.DB), owned.id);
  if (!profile) return json({ error: "not_found" }, { status: 404 });
  // D1 owns where a map is, so D1 owns where a character is. `resolveMapFor` never throws: their
  // own map, or the front door if it was deleted under them, or the built-in floor on an empty
  // database. A character with a broken location still has to be able to log in.
  const stored = await resolveMapFor(createDb(env.DB), profile.zoneId);
  if (!isValidInstanceId(profile.instanceId)) {
    return closedWebSocket(WS_CLOSE.INVALID_LOCATION, "invalid character location");
  }
  const location = locationFromMap(stored, profile.instanceId);

  const connectionId = crypto.randomUUID();
  let sessionEpoch: number;
  try {
    const lease = await env.CHARACTER_PRESENCE.getByName(characterId).acquire({
      characterId,
      connectionId,
      roomKey: location.roomKey,
      zoneId: location.zoneId,
      instanceId: location.instanceId,
    });
    sessionEpoch = lease.sessionEpoch;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "presence_acquisition_failed",
        characterId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return closedWebSocket(WS_CLOSE.PRESENCE_ERROR, "presence acquisition failed");
  }

  const stub = env.WORLD.getByName(location.roomKey);
  return stub.fetch(
    new Request(request, {
      headers: {
        Upgrade: "websocket",
        "x-character-id": owned.id,
        "x-connection-id": connectionId,
        "x-session-epoch": String(sessionEpoch),
        "x-room-key": location.roomKey,
        "x-zone-id": location.zoneId,
        "x-instance-id": location.instanceId,
      },
    }),
  );
}

async function handleListCharacters(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  return json(await listCharacters(createDb(env.DB), auth.session.id));
}

async function handleCreateCharacter(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  const session = auth.session;

  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const body = parsed.value;
  const name = (body as { name?: unknown } | null)?.name;
  const appearance = (body as { appearance?: unknown } | null)?.appearance;
  const klass = (body as { class?: unknown } | null)?.class;
  if (!isValidCharacterName(name)) return json({ error: "invalid_name" }, { status: 400 });
  if (!isValidAppearance(appearance)) return json({ error: "invalid_appearance" }, { status: 400 });
  if (!isValidClass(klass)) return json({ error: "invalid_class" }, { status: 400 });

  const created = await createCharacter(
    createDb(env.DB),
    session.id,
    name,
    normalizeAppearance(appearance),
    klass,
  );
  if (created === "limit_reached") return json({ error: "limit_reached" }, { status: 409 });
  return json(created);
}

async function handleDeleteCharacter(
  request: Request,
  env: Env,
  url: URL,
  characterId: string,
): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  const session = auth.session;
  const deleted = await deleteCharacter(createDb(env.DB), session.id, characterId);
  if (!deleted) return json({ error: "not_found" }, { status: 404 });

  await env.CHARACTER_PRESENCE.getByName(characterId).revoke();
  return new Response(null, { status: 204 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // A deploy succeeds without the secret being set — nothing in wrangler.jsonc requires it.
    // Fail loudly and legibly here rather than deep inside WebCrypto on the first login.
    if (!env.SESSION_SECRET) {
      return json({ error: "server misconfigured: SESSION_SECRET is not set" }, { status: 503 });
    }

    if (url.pathname === "/api/ws") {
      return handleJoin(request, env, url);
    }

    if (url.pathname === "/api/register" && request.method === "POST") {
      return handleRegister(request, env, url);
    }

    if (url.pathname === "/api/session" && request.method === "POST") {
      return handleLogin(request, env, url);
    }

    if (url.pathname === "/api/session" && request.method === "DELETE") {
      return new Response(null, {
        status: 204,
        headers: { "Set-Cookie": clearSessionCookie(isSecure(url)) },
      });
    }

    if (url.pathname === "/api/me" && request.method === "GET") {
      const auth = await requireSession(request, env, url);
      if (auth instanceof Response) return auth;
      return json({ id: auth.session.id, username: auth.session.username });
    }

    if (url.pathname === "/api/characters" && request.method === "GET") {
      return handleListCharacters(request, env, url);
    }
    if (url.pathname === "/api/characters" && request.method === "POST") {
      return handleCreateCharacter(request, env, url);
    }
    const characterPath = url.pathname.match(/^\/api\/characters\/([^/]+)$/);
    if (isUuid(characterPath?.[1]) && request.method === "DELETE") {
      return handleDeleteCharacter(request, env, url, characterPath[1]);
    }

    return json({ error: "not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
