/**
 * Worker entry: the API surface and the front door to the world.
 *
 * Static assets are served by Cloudflare before this ever runs — `run_worker_first` in
 * wrangler.jsonc routes only `/api/*` here, so the SPA fallback can never swallow an API
 * call and this handler never has to think about serving files.
 */

import { parseAdventureInput, parseCreateAdventureInput } from "../shared/adventure.js";
import { normalizeAppearance } from "../shared/character.js";
import { WS_CLOSE } from "../shared/close-codes.js";
import { isValidClass } from "../shared/game.js";
import { parseCreateHeroInput } from "../shared/hero.js";
import { isUuid } from "../shared/identifiers.js";
import { mapSpawnPoint, parseMapData } from "../shared/map-data.js";
import { eventCellCentre, parseMapEvents } from "../shared/map-events.js";
import { parseCreatePartyInput, parseJoinPartyInput } from "../shared/party.js";
import { encodeTileLayer } from "../shared/tile-layer-codec.js";
import {
  isKnownZone,
  isValidInstanceId,
  resolveZoneLocation,
  type ZoneLocation,
} from "../shared/zones.js";
import { accountExists, createAccount, verifyCredentials } from "./accounts.js";
import {
  createAdventureWithDefaultMap,
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
import { loadHeroProfile, relocateHero } from "./hero-profile.js";
import { createHero, deleteHero, listHeroes, loadOwnedHero } from "./heroes.js";
import {
  createMap,
  deleteMap,
  listMapsForAdventure,
  loadMap,
  loadOwnedMap,
  type MapInput,
  resolveMapFor,
  type StoredMap,
  setFirstMap,
  updateMap,
} from "./maps.js";
import {
  createParty,
  deleteParty,
  joinParty,
  listPublicParties,
  loadPartyForMember,
} from "./parties.js";
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
export { GameSession } from "./game-session.js";
export { HeroPresence } from "./hero-presence.js";
export { World } from "./world.js";

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

const MAX_API_JSON_BYTES = 4_096;
/**
 * `parseTileLayer`'s own contract (shared/tile-layer-codec.ts) accepts an id up to
 * `Number.MAX_SAFE_INTEGER` — it has no tileset to check against — but no *valid* map can ever
 * carry one that large: `parseMapData` (shared/map-data.ts) and `validateMapInput`
 * (server/maps.ts) both now reject any id `tileIdInTileset` (shared/tileset.ts) cannot resolve to
 * a declared autotile slot or fixed-tile index. That turns "the id space" into "the ids this
 * tileset actually ships", and this cap is sized against the latter.
 *
 * The shipped `tiny-swords` tileset declares 4 autotiles and 4 fixed tiles. The largest valid id
 * is `fixedId(3) = FIXED_BASE + 3 = 1025 + 3 = 1028` (the largest autotile id,
 * `autotileId(3, 15) = 1 + 3*16 + 15 = 64`, is smaller) — 4 digits, not the 16 an unbounded id
 * would need.
 *
 * Worst-case layer: a run-length multiplier only ever shrinks the string, so the longest legal
 * encoding is one bare, uncompressed run per cell (alternating between two 4-digit ids so no two
 * neighbours share a run). At the 100x100 map-size cap (`MAP_MAX_COLS * MAP_MAX_ROWS` =
 * 10,000 cells): 10,000 * 4 + (10,000 - 1) separating commas = 49,999 characters per layer. Three
 * of those, JSON-quoted inside the `layers` array (2 quote chars per string, 2 commas, 2
 * brackets): 3 * (49,999 + 2) + 2 + 2 = 150,007 bytes.
 *
 * The rest of a maximal legal body adds to that: 400 elements (`MAX_MAP_ELEMENTS`) at up to
 * 105 bytes each (the longest catalogue asset id is 72 characters) = 42,001 bytes; markers at
 * their per-field caps (8 entries + 8 exits + 32 monster spawns, each with a 32-character id and a
 * 48-character label) = 4,057 bytes; name (`MAP_NAME_MAX`, 48 characters), tilesetId, cols/rows,
 * spawn and the JSON envelope add the remaining 168 bytes. That much alone measures 196,233 bytes.
 *
 * Tranche 3 adds authored events (`shared/map-events.ts`) to the same PUT body, and they dominate.
 * Worst case per event page, every field present at its widest: `condSwitchId`/`condVariableId` as
 * 4-digit strings, `condVariableMin` a 10-digit int, `condSelfSwitch` one letter, `graphicAssetId`
 * the 72-character longest catalogue id, `moveType` "approach" (8), `trigger` "player-touch" (12),
 * two 1-digit move numbers and five `true` options — 352 bytes per page including braces and
 * commas. A page array of `MAX_PAGES_PER_EVENT` = 8: 8*352 + 7 commas + 2 brackets = 2,825 bytes.
 * One event wraps that in `{"id":"<36>","col":99,"row":99,"name":"<32>","ordinal":63,"pages":[...]}`
 * = 2,952 bytes. `MAX_EVENTS_PER_MAP` = 64 of them: 64*2,952 + 63 commas + 2 brackets + the
 * `"events":` key = 189,001 bytes.
 *
 * Tranche 3's structural worst case: 196,233 + 189,001 = 385,234 bytes.
 *
 * Tranche 5 adds a `commands` program to every page (`shared/event-commands.ts`), and here the
 * honest arithmetic breaks the "cap sits above the per-field worst case" property the tranches
 * before it could keep. The naive fear — that nesting compounds, 200 commands at each of 8 depth
 * levels — is wrong: `MAX_COMMANDS_PER_PAGE` (200) is counted RECURSIVELY, so a page holds at most
 * 200 command nodes no matter how they nest. But the widest single node is a `choices` with a
 * 200-char prompt and `MAX_CHOICE_OPTIONS` (4) options each with a 200-char label and an empty body
 * — `{"t":"choices","prompt":"<200>","options":[{"label":"<200>","body":[]}, x4]}` = 1,131 bytes,
 * and it counts as one node. A page packed with 200 of them is 200*1,131 + 199 commas + 2 brackets
 * = 226,401 bytes of commands; with the `"commands":` key that is ~226,412 bytes ON TOP of the 352
 * the page already justified. Across `MAX_EVENTS_PER_MAP` (64) x `MAX_PAGES_PER_EVENT` (8) = 512
 * pages: 512 * 226,412 = 115,922,944 bytes. Total per-field worst case: 385,234 + 115,922,944 =
 * ~116.3 MB, ~110.9 MiB.
 *
 * That exceeds a Cloudflare Worker's 128 MiB memory budget, so — unlike every prior tranche — the
 * byte cap CANNOT be raised above the per-field worst case: `readJson` buffers the body, and a
 * ~111 MiB request would pressure the isolate before parsing. The protective bound on command
 * volume is therefore the PARSER's recursive `MAX_COMMANDS_PER_PAGE` and `MAX_COMMAND_DEPTH` caps
 * (which stop a single page from running the interpreter away), not this byte cap. This cap is
 * raised to 4 MiB — 10x the pre-commands 400 KiB — which holds the 385,234-byte structural worst
 * case plus ~3.8 MiB of commands: room for ~34,000 max-width `choices` nodes, or every one of a
 * 64-event map's ~512 pages carrying ~65 max-width commands, far past any realistic authored scene
 * (an ambitiously scripted map runs to hundreds of KB, not megabytes). A pathological map that
 * packs every page to the 200-node ceiling with max-width choices is rejected by SIZE here rather
 * than accepted into memory — a deliberate, documented departure from the old "never 413 legal
 * content" aspiration, forced by the runtime's memory reality.
 */
const MAX_MAP_JSON_BYTES = 4_194_304;
// An adventure body is ids and bindings only (no map payloads): 16 links × a few uuids each.
const MAX_ADVENTURE_JSON_BYTES = 65_536;

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

async function handleJoinCharacter(request: Request, env: Env, url: URL): Promise<Response> {
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
    const stored = await resolveMapFor(createDb(env.DB), session.id, profile.zoneId);
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

async function handleJoinHero(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("expected a websocket upgrade", { status: 426 });
  }
  const token = readSessionCookie(request);
  if (!token) return json({ error: "unauthorized" }, { status: 401 });
  const session = await verifySessionState(token, env.SESSION_SECRET);
  if (session === "expired") return closedWebSocket(WS_CLOSE.SESSION_EXPIRED, "session expired");
  if (!session) return json({ error: "unauthorized" }, { status: 401 });
  const db = createDb(env.DB);
  if (!(await accountExists(db, session.id))) {
    return closedWebSocket(WS_CLOSE.SESSION_EXPIRED, "session expired");
  }

  const partyId = url.searchParams.get("party");
  const heroId = url.searchParams.get("hero");
  if (!partyId || !heroId) return json({ error: "missing_hero" }, { status: 400 });
  if (!isUuid(partyId) || !isUuid(heroId)) return json({ error: "invalid_hero" }, { status: 400 });
  const partyRow = await loadPartyForMember(db, session.id, partyId);
  if (!partyRow) return json({ error: "forbidden" }, { status: 403 });
  const owned = await loadOwnedHero(db, session.id, partyId, heroId);
  if (!owned) return json({ error: "forbidden" }, { status: 403 });
  const adventure = await loadAdventure(db, partyRow.hostAccountId, partyRow.adventureId);
  if (!adventure) return closedWebSocket(WS_CLOSE.INVALID_LOCATION, "party adventure missing");

  const start = adventure.graph.start;
  let mapId = owned.mapId;
  let stored = adventure.mapIds.includes(mapId) ? await loadMap(db, mapId) : null;
  let fallbackPosition: { x: number; y: number } | null = null;
  if (!stored) {
    // A draft adventure (no start) has no room to admit the hero into.
    if (!start) return closedWebSocket(WS_CLOSE.INVALID_LOCATION, "adventure has no start");
    mapId = start.mapId;
    stored = await loadMap(db, mapId);
    if (!stored) return closedWebSocket(WS_CLOSE.INVALID_LOCATION, "adventure start missing");
    const entry = stored.events.find(
      (event) => event.kind === "entry" && event.id === start.entryId,
    );
    fallbackPosition = entry ? eventCellCentre(entry) : mapSpawnPoint(stored);
  }

  const roomKey = `${partyId}:${mapId}`;
  const connectionId = crypto.randomUUID();
  let sessionEpoch: number;
  try {
    const lease = await env.HERO_PRESENCE.getByName(heroId).acquire({
      characterId: heroId,
      connectionId,
      roomKey,
      zoneId: mapId,
      instanceId: "main",
    });
    sessionEpoch = lease.sessionEpoch;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "hero_presence_acquisition_failed",
        heroId,
        partyId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return closedWebSocket(WS_CLOSE.PRESENCE_ERROR, "presence acquisition failed");
  }

  if (fallbackPosition) {
    const moved = await relocateHero(
      db,
      { id: heroId, sessionEpoch },
      { mapId, ...fallbackPosition },
    );
    if (!moved) return closedWebSocket(WS_CLOSE.PRESENCE_ERROR, "relocation lost the lease");
  }
  const profile = await loadHeroProfile(db, heroId);
  if (!profile || profile.sessionEpoch !== sessionEpoch || profile.zoneId !== mapId) {
    return closedWebSocket(WS_CLOSE.PRESENCE_ERROR, "hero profile changed during admission");
  }

  return env.GAME_SESSION.getByName(partyId).fetch(
    new Request(request, {
      headers: {
        Upgrade: "websocket",
        "x-identity-kind": "hero",
        "x-hero-id": heroId,
        "x-party-id": partyId,
        "x-connection-id": connectionId,
        "x-session-epoch": String(sessionEpoch),
        "x-room-key": roomKey,
        "x-zone-id": mapId,
        "x-instance-id": "main",
      },
    }),
  );
}

async function handleJoin(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.searchParams.has("hero") || url.searchParams.has("party")) {
    return handleJoinHero(request, env, url);
  }
  // Kept only as a rollback/test seam while the legacy character data remains recoverable.
  return handleJoinCharacter(request, env, url);
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
    code === "markers" ||
    code === "events"
  ) {
    return json({ error: `map_${code}` }, { status: 400 });
  }
  // Unreachable from the wire — `parseMapData` rejects an unknown tileset and a layer count that is
  // not three before create/update sees the body — but a semantic gate must never answer 500.
  if (code === "tileset" || code === "layers") {
    return json({ error: "map_invalid" }, { status: 400 });
  }
  throw error;
}

/**
 * Shape only — `parseMapData` already validates the tileset, the three run-length encoded layers,
 * element bounds and the spawn defensively, and `validateMapInput` inside create/update remains the
 * one semantic gate.
 *
 * Every layer the client authored is carried through untouched. There is deliberately no
 * projection here: flattening layers back to a single occupancy grid before storing would discard
 * everything on layers 1 and 2 — cliff walls above all — with no error anyone could see.
 */
function parseMapBody(body: unknown): MapInput | null {
  const name = (body as { name?: unknown } | null)?.name;
  if (typeof name !== "string") return null;
  const data = parseMapData(body);
  if (!data) return null;
  // Events are optional so an old client that never sends the field still saves: absent is an empty
  // event set, not a malformed body. Present-but-malformed is rejected (null -> map_invalid) exactly
  // like the layers or markers would be. `parseMapEvents` needs the grid dimensions to bounds-check
  // each event's cell.
  const rawEvents = (body as { events?: unknown }).events;
  const events = rawEvents === undefined ? [] : parseMapEvents(rawEvents, data.cols, data.rows);
  if (events === null) return null;
  return {
    name,
    tilesetId: data.tilesetId,
    cols: data.cols,
    rows: data.rows,
    layers: data.layers,
    elements: data.elements,
    spawn: data.spawn,
    markers: data.markers,
    events,
  };
}

/**
 * A stored map as it goes out over HTTP: layers as the same run-length encoded strings the client
 * sends back. The wire is symmetric on purpose — a payload read from `GET /api/maps/:id` is a
 * legal body for `PUT` without a re-encode step nobody would remember to keep in step. `events`
 * rides through the spread unchanged: `StoredMap.events` is already exactly the `MapEvent[]` shape
 * `parseMapEvents` accepts, so a GET response re-PUTs verbatim, events included.
 */
function mapResponseBody(stored: StoredMap): Record<string, unknown> {
  return { ...stored, layers: stored.layers.map(encodeTileLayer) };
}

async function handleListMaps(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  // Maps are listed per-adventure (UX wave #5). The `adventure` query param is required; without it
  // there is no library to list.
  const adventureId = url.searchParams.get("adventure");
  if (!adventureId || !isUuid(adventureId)) {
    return json({ error: "map_invalid" }, { status: 400 });
  }
  return json(await listMapsForAdventure(createDb(env.DB), auth.session.id, adventureId));
}

/** The `{ adventureId, name }` body of a new-map request — the only two fields a client sends now,
 *  since the terrain is always the server-built template. */
function parseCreateMapBody(body: unknown): { adventureId: string; name: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const { adventureId, name } = body as Record<string, unknown>;
  if (typeof adventureId !== "string" || !isUuid(adventureId)) return null;
  if (typeof name !== "string") return null;
  return { adventureId, name };
}

async function handleCreateMap(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  const parsed = await readJson(request, MAX_MAP_JSON_BYTES);
  if (parsed instanceof Response) return parsed;
  const input = parseCreateMapBody(parsed.value);
  if (!input) return json({ error: "map_invalid" }, { status: 400 });
  try {
    return json(
      mapResponseBody(
        await createMap(createDb(env.DB), auth.session.id, input.adventureId, input.name),
      ),
      { status: 201 },
    );
  } catch (error) {
    return mapErrorResponse(error);
  }
}

async function handleGetMap(request: Request, env: Env, url: URL, id: string): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  // The built-in floor is never a D1 row, so loadMap returns null for it — no special case needed.
  const stored = await loadOwnedMap(createDb(env.DB), auth.session.id, id);
  if (!stored) return json({ error: "map_not_found" }, { status: 404 });
  return json(mapResponseBody(stored));
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
    return json(mapResponseBody(await updateMap(createDb(env.DB), auth.session.id, id, input)));
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
    await deleteMap(createDb(env.DB), auth.session.id, id);
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
    await setFirstMap(createDb(env.DB), auth.session.id, id);
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
  if (code === "referenced") return json({ error: "adventure_referenced" }, { status: 409 });
  if (code === "in_use") return json({ error: "adventure_in_use" }, { status: 409 });
  if (code === "title" || code === "players" || code === "maps" || code === "graph") {
    return json({ error: `adventure_${code}` }, { status: 400 });
  }
  throw error;
}

/** `parties.ts` throws "prefix: message" — the prefix is the machine code. */
function partyErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "";
  const code = message.split(":")[0];
  if (code === "not_found") return json({ error: "party_not_found" }, { status: 404 });
  if (code === "adventure") return json({ error: "party_adventure" }, { status: 404 });
  if (code === "not_playable") return json({ error: "adventure_not_playable" }, { status: 409 });
  if (code === "already_member" || code === "full" || code === "color_taken") {
    return json({ error: `party_${code}` }, { status: 409 });
  }
  throw error;
}

/** `heroes.ts` throws "prefix: message" — the prefix is the machine code. */
function heroErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "";
  const code = message.split(":")[0];
  if (code === "not_found") return json({ error: "hero_not_found" }, { status: 404 });
  if (code === "not_member") return json({ error: "hero_not_member" }, { status: 403 });
  if (code === "cap") return json({ error: "hero_cap" }, { status: 409 });
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
  const input = parseCreateAdventureInput(parsed.value);
  if (!input) return json({ error: "adventure_invalid" }, { status: 400 });
  try {
    // Atomic: the adventure and its default map are created in one transaction, and both ride the
    // response so the client lands straight in the editor (UX wave #2/#3/#4).
    const { adventure, map } = await createAdventureWithDefaultMap(
      createDb(env.DB),
      auth.session.id,
      input,
    );
    return json({ ...adventure, defaultMap: mapResponseBody(map) }, { status: 201 });
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

async function handleListParties(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  return json(await listPublicParties(createDb(env.DB), auth.session.id));
}

async function handleCreateParty(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const input = parseCreatePartyInput(parsed.value);
  if (!input) return json({ error: "party_invalid" }, { status: 400 });
  try {
    return json(await createParty(createDb(env.DB), auth.session.id, input), { status: 201 });
  } catch (error) {
    return partyErrorResponse(error);
  }
}

async function handleJoinParty(
  request: Request,
  env: Env,
  url: URL,
  id: string,
): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const input = parseJoinPartyInput(parsed.value);
  if (!input) return json({ error: "party_invalid" }, { status: 400 });
  try {
    await joinParty(createDb(env.DB), auth.session.id, id, input.color);
    return new Response(null, { status: 204 });
  } catch (error) {
    return partyErrorResponse(error);
  }
}

async function handleDeleteParty(
  request: Request,
  env: Env,
  url: URL,
  id: string,
): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  try {
    const deletedHeroIds = await deleteParty(createDb(env.DB), auth.session.id, id);
    await Promise.all(
      deletedHeroIds.map((heroId) =>
        env.HERO_PRESENCE.getByName(heroId).revoke(WS_CLOSE.CHARACTER_DELETED, "party deleted"),
      ),
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return partyErrorResponse(error);
  }
}

async function handleListHeroes(
  request: Request,
  env: Env,
  url: URL,
  partyId: string,
): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  return json(await listHeroes(createDb(env.DB), auth.session.id, partyId));
}

async function handleCreateHero(
  request: Request,
  env: Env,
  url: URL,
  partyId: string,
): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const input = parseCreateHeroInput(parsed.value);
  if (!input) return json({ error: "hero_invalid" }, { status: 400 });
  try {
    return json(await createHero(createDb(env.DB), auth.session.id, partyId, input), {
      status: 201,
    });
  } catch (error) {
    return heroErrorResponse(error);
  }
}

async function handleDeleteHero(
  request: Request,
  env: Env,
  url: URL,
  partyId: string,
  heroId: string,
): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  try {
    await deleteHero(createDb(env.DB), auth.session.id, partyId, heroId);
    await env.HERO_PRESENCE.getByName(heroId).revoke(WS_CLOSE.CHARACTER_DELETED, "hero deleted");
    return new Response(null, { status: 204 });
  } catch (error) {
    return heroErrorResponse(error);
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

    if (url.pathname === "/api/parties" && request.method === "GET") {
      return handleListParties(request, env, url);
    }
    if (url.pathname === "/api/parties" && request.method === "POST") {
      return handleCreateParty(request, env, url);
    }
    const partyJoinRoute = url.pathname.match(/^\/api\/parties\/([A-Za-z0-9-]{1,64})\/join$/);
    if (partyJoinRoute?.[1] && request.method === "POST") {
      return handleJoinParty(request, env, url, partyJoinRoute[1]);
    }
    const partyRoute = url.pathname.match(/^\/api\/parties\/([A-Za-z0-9-]{1,64})$/);
    if (partyRoute?.[1] && request.method === "DELETE") {
      return handleDeleteParty(request, env, url, partyRoute[1]);
    }

    const heroListRoute = url.pathname.match(/^\/api\/parties\/([A-Za-z0-9-]{1,64})\/heroes$/);
    if (heroListRoute?.[1]) {
      const partyId = heroListRoute[1];
      if (request.method === "GET") return handleListHeroes(request, env, url, partyId);
      if (request.method === "POST") return handleCreateHero(request, env, url, partyId);
    }
    const heroItemRoute = url.pathname.match(
      /^\/api\/parties\/([A-Za-z0-9-]{1,64})\/heroes\/([A-Za-z0-9-]{1,64})$/,
    );
    if (heroItemRoute?.[1] && heroItemRoute[2] && request.method === "DELETE") {
      return handleDeleteHero(request, env, url, heroItemRoute[1], heroItemRoute[2]);
    }

    return json({ error: "not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
