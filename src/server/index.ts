/**
 * Worker entry: the API surface and the front door to the world.
 *
 * Static assets are served by Cloudflare before this ever runs — `run_worker_first` in
 * wrangler.jsonc routes only `/api/*` here, so the SPA fallback can never swallow an API
 * call and this handler never has to think about serving files.
 */

import {
  clearSessionCookie,
  createSession,
  isValidNickname,
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

async function handleLogin(request: Request, env: Env, url: URL): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "expected a JSON body" }, { status: 400 });
  }

  const nick = (body as { nickname?: unknown } | null)?.nickname;
  if (!isValidNickname(nick)) {
    return json(
      { error: "nickname must be 2-16 characters: letters, digits, underscore or hyphen" },
      { status: 400 },
    );
  }

  const session = createSession(nick);
  const token = await signSession(session, env.SESSION_SECRET);

  return json(
    { id: session.id, nick: session.nick },
    { headers: { "Set-Cookie": serializeSessionCookie(token, isSecure(url)) } },
  );
}

async function handleJoin(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("expected a websocket upgrade", { status: 426 });
  }

  const session = await currentSession(request, env);
  if (!session) return new Response("unauthorized", { status: 401 });

  const stub = env.WORLD.get(env.WORLD.idFromName(WORLD_NAME));

  // Re-issue the request with the identity we just proved. The Durable Object is not
  // publicly reachable, so it can trust these headers.
  return stub.fetch(
    new Request(request, {
      headers: {
        Upgrade: "websocket",
        "x-player-id": session.id,
        "x-player-nick": session.nick,
      },
    }),
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/ws") {
      return handleJoin(request, env);
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
      return json({ id: session.id, nick: session.nick });
    }

    return json({ error: "not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
