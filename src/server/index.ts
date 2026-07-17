/**
 * Worker entry: the API surface and the front door to the world.
 *
 * Static assets are served by Cloudflare before this ever runs — `run_worker_first` in
 * wrangler.jsonc routes only `/api/*` here, so the SPA fallback can never swallow an API
 * call and this handler never has to think about serving files.
 */

import { parseAdventureInput } from "../shared/adventure.js";
import { normalizeAppearance } from "../shared/character.js";
import { WS_CLOSE } from "../shared/close-codes.js";
import { isValidClass } from "../shared/game.js";
import { isUuid } from "../shared/identifiers.js";
import { mapSpawnPoint, parseMapData } from "../shared/map-data.js";
import {
  isKnownZone,
  isValidInstanceId,
  resolveZoneLocation,
  type ZoneLocation,
} from "../shared/zones.js";
import { accountExists, createAccount, verifyCredentials } from "./accounts.js";
import {
  createAdventure,
  deleteAdventure,
  listAdventures,
  loadAdventure,
  updateAdventure,
} from "./adventures.js";
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
  createMap,
  deleteMap,
  listMaps,
  loadMap,
  type MapInput,
  resolveMapFor,
  type StoredMap,
  setFirstMap,
  updateMap,
} from "./maps.js";
import { loadProfile, relocateProfile } from "./profile.js";
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
// A 100x100 map is ~10 KB of blocks plus elements — the maps route gets its own, larger cap.
const MAX_MAP_JSON_BYTES = 32_768;
// An adventure body is ids and bindings only (no map payloads): 16 links × a few uuids each.
const MAX_ADVENTURE_JSON_BYTES = 16_384;

async function readJson(
  request: Request,
  limit: number = MAX_API_JSON_BYTES,
): Promise<{ value: unknown } | Response> {
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
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
    if (bytes > limit) {
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
  if (!isValidInstanceId(profile.instanceId)) {
    return closedWebSocket(WS_CLOSE.INVALID_LOCATION, "invalid character location");
  }
  // Hybrid routing: a catalogue id keeps its compiled-in zone — content, quests, tests and all.
  // Anything else is a D1 map id, resolved HERE and only here; the room trusts what it was
  // admitted for. `resolveMapFor` never throws: own map, or the front door, or the built-in floor.
  let location: ZoneLocation;
  let fallbackMap: StoredMap | null = null;
  if (isKnownZone(profile.zoneId)) {
    const legacy = resolveZoneLocation(profile.zoneId, profile.instanceId);
    if (!legacy) return closedWebSocket(WS_CLOSE.INVALID_LOCATION, "invalid character location");
    location = legacy;
  } else {
    const stored = await resolveMapFor(createDb(env.DB), profile.zoneId);
    fallbackMap = stored.id !== profile.zoneId ? stored : null;
    location = locationFromMap(stored, fallbackMap ? "main" : profile.instanceId);
  }

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

  if (fallbackMap) {
    // The requirement "their map is gone → move to the first map" is a real move: persist it under
    // the lease we just acquired, or the room will (rightly) refuse the profile/location mismatch.
    const spawn = mapSpawnPoint(fallbackMap);
    const moved = await relocateProfile(
      createDb(env.DB),
      { id: owned.id, sessionEpoch },
      { zoneId: fallbackMap.id, instanceId: "main", x: spawn.x, y: spawn.y },
    );
    if (!moved) return closedWebSocket(WS_CLOSE.PRESENCE_ERROR, "relocation lost the lease");
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

/** `maps.ts` throws "prefix: message" — the prefix is the machine code, the message is for logs. */
function mapErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "";
  const code = message.split(":")[0];
  if (code === "not_found") return json({ error: "map_not_found" }, { status: 404 });
  if (code === "last_map") return json({ error: "last_map" }, { status: 409 });
  if (code === "referenced") return json({ error: "map_referenced" }, { status: 409 });
  if (
    code === "placement" ||
    code === "spawn" ||
    code === "size" ||
    code === "name" ||
    code === "elements" ||
    code === "markers"
  ) {
    return json({ error: `map_${code}` }, { status: 400 });
  }
  throw error;
}

/** Shape only — `parseMapData` already validates blocks/chars/bounds/spawn defensively, and
 *  `validateMapInput` inside create/update remains the one semantic gate. */
function parseMapBody(body: unknown): MapInput | null {
  const name = (body as { name?: unknown } | null)?.name;
  if (typeof name !== "string") return null;
  const data = parseMapData(body);
  if (!data) return null;
  return {
    name,
    blocks: data.blocks,
    elements: data.elements,
    spawn: data.spawn,
    markers: data.markers,
  };
}

async function handleListMaps(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  return json(await listMaps(createDb(env.DB)));
}

async function handleCreateMap(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  const parsed = await readJson(request, MAX_MAP_JSON_BYTES);
  if (parsed instanceof Response) return parsed;
  const input = parseMapBody(parsed.value);
  if (!input) return json({ error: "map_invalid" }, { status: 400 });
  try {
    return json(await createMap(createDb(env.DB), input), { status: 201 });
  } catch (error) {
    return mapErrorResponse(error);
  }
}

async function handleGetMap(request: Request, env: Env, url: URL, id: string): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  // The built-in floor is never a D1 row, so loadMap returns null for it — no special case needed.
  const stored = await loadMap(createDb(env.DB), id);
  if (!stored) return json({ error: "map_not_found" }, { status: 404 });
  return json(stored);
}

async function handleUpdateMap(
  request: Request,
  env: Env,
  url: URL,
  id: string,
): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  const parsed = await readJson(request, MAX_MAP_JSON_BYTES);
  if (parsed instanceof Response) return parsed;
  const input = parseMapBody(parsed.value);
  if (!input) return json({ error: "map_invalid" }, { status: 400 });
  try {
    return json(await updateMap(createDb(env.DB), id, input));
  } catch (error) {
    return mapErrorResponse(error);
  }
}

async function handleDeleteMap(
  request: Request,
  env: Env,
  url: URL,
  id: string,
): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  try {
    await deleteMap(createDb(env.DB), id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return mapErrorResponse(error);
  }
}

async function handleSetFirstMap(
  request: Request,
  env: Env,
  url: URL,
  id: string,
): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  try {
    await setFirstMap(createDb(env.DB), id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return mapErrorResponse(error);
  }
}

/** `adventures.ts`/`shared/adventure.ts` throw "prefix: message" — prefix is the machine code. */
function adventureErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "";
  const code = message.split(":")[0];
  if (code === "not_found") return json({ error: "adventure_not_found" }, { status: 404 });
  if (code === "title" || code === "players" || code === "maps" || code === "graph") {
    return json({ error: `adventure_${code}` }, { status: 400 });
  }
  throw error;
}

async function handleListAdventures(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  return json(await listAdventures(createDb(env.DB), auth.session.id));
}

async function handleCreateAdventure(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  const parsed = await readJson(request, MAX_ADVENTURE_JSON_BYTES);
  if (parsed instanceof Response) return parsed;
  const input = parseAdventureInput(parsed.value);
  if (!input) return json({ error: "adventure_invalid" }, { status: 400 });
  try {
    return json(await createAdventure(createDb(env.DB), auth.session.id, input), { status: 201 });
  } catch (error) {
    return adventureErrorResponse(error);
  }
}

async function handleGetAdventure(
  request: Request,
  env: Env,
  url: URL,
  id: string,
): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  const stored = await loadAdventure(createDb(env.DB), auth.session.id, id);
  if (!stored) return json({ error: "adventure_not_found" }, { status: 404 });
  return json(stored);
}

async function handleUpdateAdventure(
  request: Request,
  env: Env,
  url: URL,
  id: string,
): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  const parsed = await readJson(request, MAX_ADVENTURE_JSON_BYTES);
  if (parsed instanceof Response) return parsed;
  const input = parseAdventureInput(parsed.value);
  if (!input) return json({ error: "adventure_invalid" }, { status: 400 });
  try {
    return json(await updateAdventure(createDb(env.DB), auth.session.id, id, input));
  } catch (error) {
    return adventureErrorResponse(error);
  }
}

async function handleDeleteAdventure(
  request: Request,
  env: Env,
  url: URL,
  id: string,
): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  try {
    await deleteAdventure(createDb(env.DB), auth.session.id, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return adventureErrorResponse(error);
  }
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

    if (url.pathname === "/api/maps" && request.method === "GET") {
      return handleListMaps(request, env, url);
    }
    if (url.pathname === "/api/maps" && request.method === "POST") {
      return handleCreateMap(request, env, url);
    }
    const mapRoute = url.pathname.match(/^\/api\/maps\/([A-Za-z0-9-]{1,64})$/);
    if (mapRoute?.[1]) {
      const id = mapRoute[1];
      if (request.method === "GET") return handleGetMap(request, env, url, id);
      if (request.method === "PUT") return handleUpdateMap(request, env, url, id);
      if (request.method === "DELETE") return handleDeleteMap(request, env, url, id);
    }
    const firstRoute = url.pathname.match(/^\/api\/maps\/([A-Za-z0-9-]{1,64})\/first$/);
    if (firstRoute?.[1] && request.method === "POST") {
      return handleSetFirstMap(request, env, url, firstRoute[1]);
    }

    if (url.pathname === "/api/adventures" && request.method === "GET") {
      return handleListAdventures(request, env, url);
    }
    if (url.pathname === "/api/adventures" && request.method === "POST") {
      return handleCreateAdventure(request, env, url);
    }
    const adventureRoute = url.pathname.match(/^\/api\/adventures\/([A-Za-z0-9-]{1,64})$/);
    if (adventureRoute?.[1]) {
      const id = adventureRoute[1];
      if (request.method === "GET") return handleGetAdventure(request, env, url, id);
      if (request.method === "PUT") return handleUpdateAdventure(request, env, url, id);
      if (request.method === "DELETE") return handleDeleteAdventure(request, env, url, id);
    }

    return json({ error: "not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
