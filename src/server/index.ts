/**
 * Worker entry: the API surface and the front door to the world.
 *
 * Static assets are served by Cloudflare before this ever runs — `run_worker_first` in
 * wrangler.jsonc routes only `/api/*` here, so the SPA fallback can never swallow an API
 * call and this handler never has to think about serving files.
 */

import { isValidClass } from "../shared/game.js";
import { createAccount, verifyCredentials } from "./accounts.js";
import {
  characterOwnedBy,
  createCharacter,
  deleteCharacter,
  isValidAppearance,
  isValidCharacterName,
  listCharacters,
} from "./characters.js";
import { createDb } from "./db/index.js";
import {
  clearSessionCookie,
  createSession,
  isValidPassword,
  isValidUsername,
  readSessionCookie,
  serializeSessionCookie,
  signSession,
  verifySession,
} from "./session.js";

export { World } from "./world.js";

/** There is exactly one world, so every connection resolves to the same object. */
const WORLD_NAME = "world";

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

function isSecure(url: URL): boolean {
  return url.protocol === "https:";
}

async function currentSession(request: Request, env: Env) {
  const token = readSessionCookie(request);
  if (!token) return null;
  return verifySession(token, env.SESSION_SECRET);
}

interface Credentials {
  username: string;
  password: string;
}

/** Returns parsed credentials or a ready-to-send 400. */
async function readCredentials(request: Request): Promise<Credentials | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "expected_json" }, { status: 400 });
  }
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

  const session = await currentSession(request, env);
  if (!session) return json({ error: "unauthorized" }, { status: 401 });

  const characterId = url.searchParams.get("character");
  if (!characterId) return json({ error: "missing_character" }, { status: 400 });

  // Ownership is proven here, outside the Durable Object, so the DO can trust the header.
  const owned = await characterOwnedBy(createDb(env.DB), session.id, characterId);
  if (!owned) return json({ error: "forbidden" }, { status: 403 });

  const stub = env.WORLD.get(env.WORLD.idFromName(WORLD_NAME));
  return stub.fetch(
    new Request(request, {
      headers: { Upgrade: "websocket", "x-character-id": owned.id },
    }),
  );
}

async function handleListCharacters(request: Request, env: Env): Promise<Response> {
  const session = await currentSession(request, env);
  if (!session) return json({ error: "unauthorized" }, { status: 401 });
  return json(await listCharacters(createDb(env.DB), session.id));
}

async function handleCreateCharacter(request: Request, env: Env): Promise<Response> {
  const session = await currentSession(request, env);
  if (!session) return json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "expected_json" }, { status: 400 });
  }
  const name = (body as { name?: unknown } | null)?.name;
  const appearance = (body as { appearance?: unknown } | null)?.appearance;
  const klass = (body as { class?: unknown } | null)?.class;
  if (!isValidCharacterName(name)) return json({ error: "invalid_name" }, { status: 400 });
  if (!isValidAppearance(appearance)) return json({ error: "invalid_appearance" }, { status: 400 });
  if (!isValidClass(klass)) return json({ error: "invalid_class" }, { status: 400 });

  const created = await createCharacter(createDb(env.DB), session.id, name, appearance, klass);
  if (created === "limit_reached") return json({ error: "limit_reached" }, { status: 409 });
  return json(created);
}

async function handleDeleteCharacter(
  request: Request,
  env: Env,
  characterId: string,
): Promise<Response> {
  const session = await currentSession(request, env);
  if (!session) return json({ error: "unauthorized" }, { status: 401 });
  const deleted = await deleteCharacter(createDb(env.DB), session.id, characterId);
  if (!deleted) return json({ error: "not_found" }, { status: 404 });

  // A deleted character must not keep playing through a socket opened before the delete.
  const stub = env.WORLD.get(env.WORLD.idFromName(WORLD_NAME));
  await stub.fetch(
    new Request("https://world/internal/kick", {
      method: "POST",
      headers: { "x-kick-character-id": characterId },
    }),
  );
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
      const session = await currentSession(request, env);
      if (!session) return json({ error: "unauthorized" }, { status: 401 });
      return json({ id: session.id, username: session.username });
    }

    if (url.pathname === "/api/characters" && request.method === "GET") {
      return handleListCharacters(request, env);
    }
    if (url.pathname === "/api/characters" && request.method === "POST") {
      return handleCreateCharacter(request, env);
    }
    const characterPath = url.pathname.match(/^\/api\/characters\/([0-9a-f-]{36})$/);
    if (characterPath?.[1] && request.method === "DELETE") {
      return handleDeleteCharacter(request, env, characterPath[1]);
    }

    return json({ error: "not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
