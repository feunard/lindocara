import type {
  AdventureGraph,
  AdventureInput,
  CreateAdventureInput,
} from "@lindocara/engine/adventure.js";
import type { AdventureRegistry } from "@lindocara/engine/adventure-state.js";
import type { CreateAdventureTestSessionInput } from "@lindocara/engine/adventure-test.js";
import type { AdventureAudioConfig, MapAudioConfig } from "@lindocara/engine/audio-catalog.js";
import type { CharacterAppearance, Equipment } from "@lindocara/engine/character.js";
import type { PlayerClass } from "@lindocara/engine/game.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import type { MapElement, MapMarkers } from "@lindocara/engine/map-data.js";
import type { MapEvent } from "@lindocara/engine/map-events.js";
import type { PartyColor } from "@lindocara/engine/party.js";
import type { QuestDiagnostic } from "@lindocara/engine/quests.js";
import { t } from "./i18n.js";
import { onUnauthorized } from "./state/navigation.js";

export interface Me {
  id: string;
  username: string;
}

export interface CharacterSummary {
  id: string;
  name: string;
  appearance: CharacterAppearance;
  level: number;
  class: PlayerClass;
  equipment: Equipment;
}

/** API errors carry stable machine codes the UI maps to i18n keys. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : "generic";
    // The 401 seam (`state/navigation.ts`'s docblock): a dead/expired session — never a wrong
    // password (`InvalidCredentialsError`), which must not bounce the auth form back onto itself.
    // `UnauthorizedError` is Alepha's own `$secure()` class name (the framework port's routes);
    // `session_expired` is the legacy hand-rolled Worker's equivalent code — both mean the same
    // thing to a caller of this function.
    if (code === "UnauthorizedError" || code === "session_expired") onUnauthorized();
    throw new ApiError(code, body);
  }
  return body as T;
}

/** The shape `/_auth/userinfo` echoes back — only the fields `fetchMe`/`login`/`register` read. */
interface AlephaUserInfo {
  id: string;
  username?: string;
}

function toMe(user: AlephaUserInfo): Me {
  // The realm registers every account with a username (`AppSecurityProvider`'s `username:
  // "required"`), so the fallback below is defensive only — it never fires against this server.
  return { id: user.id, username: user.username ?? user.id };
}

/**
 * `GET /_auth/userinfo` (Alepha's own route, not `/api/*`): 200 with `{ user: undefined }` when
 * signed out rather than a 401, since the same route also serves an anonymous caller's public API
 * links. `fetchMe` folds that "no user" shape onto the old `null` contract every caller already
 * expects.
 */
export const fetchMe = () =>
  api<{ user?: AlephaUserInfo }>("/_auth/userinfo")
    .then((response) => (response.user ? toMe(response.user) : null))
    .catch(() => null);

/**
 * Signs in through Alepha's credentials provider (`POST /_auth/token?provider=credentials`). The
 * server sets the session as an httpOnly cookie; the JSON body only echoes the authenticated user,
 * which is all this client tracks. Wrong credentials come back as a framework-level
 * `InvalidCredentialsError` (401) rather than this app's legacy `invalid_credentials` code — see
 * `ERROR_KEYS`, which maps the class name onto the SAME dictionary entry.
 */
export const login = (username: string, password: string) =>
  api<{ user: AlephaUserInfo }>("/_auth/token?provider=credentials", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  }).then((response) => toMe(response.user));

/**
 * Two-phase registration (`alepha/api/users`): phase 1 (`POST /api/users/register`) validates and
 * mints an intent from username+password — this realm collects neither email nor phone, so
 * nothing else is required to complete it. Phase 2 (`POST /api/users/register/complete`) creates
 * the account from that intent. Neither phase authenticates the browser, unlike the legacy single
 * `/api/register` call, so `register` finishes with an explicit `login()` to keep returning an
 * authenticated `Me` the way every caller already expects. A taken username surfaces as a
 * framework-level `ConflictError` (409) — see `ERROR_KEYS`.
 */
export async function register(username: string, password: string): Promise<Me> {
  const intent = await api<{ intentId: string }>("/api/users/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  await api<unknown>("/api/users/register/complete", {
    method: "POST",
    body: JSON.stringify({ intentId: intent.intentId }),
  });
  return login(username, password);
}

export interface MapSummary {
  id: string;
  name: string;
  revision: number;
  cols: number;
  rows: number;
  isFirst: boolean;
}

/**
 * The wire shape of a map, both ways: `layers` is exactly three run-length encoded layer strings
 * (`shared/tile-layer-codec.ts`), ground first, each `cols * rows` cells. `parseMapData` turns a
 * payload straight into `MapData` — GET's response is a legal PUT body, no re-encode in between.
 */
export interface MapPayload {
  id: string;
  name: string;
  revision: number;
  tilesetId: string;
  cols: number;
  rows: number;
  layers: string[];
  elements: MapElement[];
  spawn: { col: number; row: number };
  markers: MapMarkers;
  /** Per-channel map overrides. Missing fields inherit the owning adventure. */
  audio?: MapAudioConfig;
  /** Authored events, ordered by ordinal; pages ordered by position. Empty for maps saved before
   *  events existed. Nothing here executes this tranche. */
  events: readonly MapEvent[];
}

/** What create/update send: everything but the server-minted id. */
export type MapSaveInput = Omit<MapPayload, "id" | "revision">;

export const fetchMaps = (adventureId: string) =>
  api<MapSummary[]>(`/api/maps?adventure=${adventureId}`);
export const fetchMap = (id: string) => api<MapPayload>(`/api/maps/${id}`);
export const createMapApi = (adventureId: string, name: string, cols: number, rows: number) =>
  api<MapPayload>("/api/maps", {
    method: "POST",
    body: JSON.stringify({ adventureId, name, cols, rows }),
  });
export const updateMapApi = (
  id: string,
  input: MapSaveInput,
  adventure?: AdventureInput,
  expectedRevision?: number,
) =>
  api<MapPayload>(`/api/maps/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      ...input,
      ...(adventure ? { adventure } : {}),
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    }),
  });
export const deleteMapApi = (id: string, force = false) =>
  api<void>(`/api/maps/${id}${force ? "?force=true" : ""}`, { method: "DELETE" });

export interface AdventureSummary {
  id: string;
  title: string;
  maxPlayers: number;
  /** How many maps the adventure owns — shown on the picker card. */
  mapCount: number;
  /** Whether a start is authored: a playable adventure vs a draft. Badges the picker card. */
  playable: boolean;
  /** Author username — present only in the server-wide `scope=play` listing. */
  author?: string;
}

/** The atomic create response (UX wave #2/#3): the adventure plus the default map it was born with,
 *  so the picker can drop the author straight into the editor with no second fetch. */
export interface CreatedAdventure extends AdventurePayload {
  defaultMap: MapPayload;
}

export interface AdventurePayload {
  id: string;
  accountId: string;
  title: string;
  maxPlayers: number;
  version: number;
  mapIds: string[];
  graph: AdventureGraph;
  audio?: AdventureAudioConfig;
  /** The switch/variable registry, editable through `RegistryDialog` and saved on the adventure
   *  PUT. Empty for adventures whose registry was never authored. */
  registry: AdventureRegistry;
}

export const fetchAdventures = () => api<AdventureSummary[]>("/api/adventures");
/** Server-wide playable adventures (any author) — the "New adventure" carousel. */
export const fetchPlayableAdventures = () => api<AdventureSummary[]>("/api/adventures?scope=play");
/** Every adventure on the server, drafts included — the collaborative editor's picker. */
export const fetchAllAdventures = () => api<AdventureSummary[]>("/api/adventures?scope=all");
export const fetchAdventure = (id: string) => api<AdventurePayload>(`/api/adventures/${id}`);
export const createAdventureApi = (input: CreateAdventureInput) =>
  api<CreatedAdventure>("/api/adventures", { method: "POST", body: JSON.stringify(input) });
export const updateAdventureApi = (id: string, input: AdventureInput) =>
  api<AdventurePayload>(`/api/adventures/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const deleteAdventureApi = (id: string, force = false) =>
  api<void>(`/api/adventures/${id}${force ? "?force=true" : ""}`, { method: "DELETE" });

export interface AdventureTestSession {
  id: string;
  adventureId: string;
  startMapId: string | null;
  expiresAt: number;
  party: PartyListing;
  hero: StoredHero;
  diagnostics: QuestDiagnostic[];
}

export const createAdventureTestSessionApi = (
  adventureId: string,
  input: CreateAdventureTestSessionInput,
) =>
  api<AdventureTestSession>(`/api/adventures/${adventureId}/test-sessions`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const deleteAdventureTestSessionApi = (sessionId: string) =>
  api<void>(`/api/adventure-test-sessions/${sessionId}`, { method: "DELETE" });

export interface PartyListing {
  id: string;
  name: string | null;
  adventureId: string;
  adventureTitle: string;
  maxPlayers: number;
  status: "open" | "completed";
  hostAccountId: string;
  colors: PartyColor[];
  mine: boolean;
  myColor: PartyColor | null;
}

export interface StoredParty {
  id: string;
  adventureId: string;
  adventureVersion: number;
  maxPlayers: number;
  hostAccountId: string;
  name: string | null;
  status: "open" | "completed";
}

export interface StoredHero {
  id: string;
  partyId: string;
  accountId: string;
  name: string;
  class: PlayerClass;
  mapId: string;
  x: number;
  y: number;
  level: number;
  xp: number;
  hp: number;
  life: "alive" | "corpse" | "ghost";
}

interface PartyListingPage {
  items: PartyListing[];
  nextCursor: string | null;
}

/** Fetch bounded server pages. The array fallback keeps local mocks and an older Worker usable. */
export async function fetchParties(): Promise<PartyListing[]> {
  const parties: PartyListing[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const suffix: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const response: PartyListingPage | PartyListing[] = await api<
      PartyListingPage | PartyListing[]
    >(`/api/parties${suffix}`);
    if (Array.isArray(response)) return response;
    parties.push(...response.items);
    if (!response.nextCursor) return parties;
    cursor = response.nextCursor;
  }
  return parties;
}
export const createPartyApi = (input: { adventureId: string; name?: string | null }) =>
  api<StoredParty>("/api/parties", { method: "POST", body: JSON.stringify(input) });
export const joinPartyApi = (partyId: string) =>
  api<void>(`/api/parties/${partyId}/join`, { method: "POST" });
export const deletePartyApi = (partyId: string) =>
  api<void>(`/api/parties/${partyId}`, { method: "DELETE" });
export const fetchHeroes = (partyId: string) => api<StoredHero[]>(`/api/parties/${partyId}/heroes`);
export const createHeroApi = (partyId: string, input: { name: string; class: PlayerClass }) =>
  api<StoredHero>(`/api/parties/${partyId}/heroes`, {
    method: "POST",
    body: JSON.stringify(input),
  });
export const deleteHeroApi = (partyId: string, heroId: string) =>
  api<void>(`/api/parties/${partyId}/heroes/${heroId}`, { method: "DELETE" });

/** What `GET /api/join` answers with: the room to dial and the channel it lives on. */
export interface JoinResolution {
  roomId: string;
  channelPath: string;
}

/**
 * `GET /api/join?party=<uuid>&hero=<uuid>` (`JoinController.resolveJoin`, `$secure({})`) — the
 * realtime admission hint. Runs the same membership/ownership/map reads the room's own `onJoin`
 * re-derives from D1, so this response is a HINT the socket revalidates, never an authorization; a
 * stale or forged value here can only fail admission, not grant one. `WorldClient.connect()` calls
 * this before every socket open, including every reconnect (a 4008 zone-transition reconnect gets
 * a fresh call, so it reads the hero's map AFTER the transition, never the room it just left).
 */
export const resolveJoin = (partyId: string, heroId: string) =>
  api<JoinResolution>(
    `/api/join?party=${encodeURIComponent(partyId)}&hero=${encodeURIComponent(heroId)}`,
  );

/** Stable machine codes (from ApiError, or synthesized client-side) mapped to i18n keys. */
export const ERROR_KEYS: Record<string, MessageKey> = {
  // Alepha's own auth routes (`/api/users/register*`, `/_auth/token`) are framework code, not this
  // app's `src/api/controllers/*`, so they throw generic HttpError subclasses rather than our
  // snake_case machine codes. These three wire the class names `auth.test.ts` observes back onto
  // the SAME dictionary entries the legacy hand-rolled server used, so player-facing text is
  // unchanged. Every OTHER `/api/*` route (maps, adventures, parties, heroes, ...) still throws its
  // own explicit `error:` code (see e.g. `mapAuthoring.ts`), so this mapping cannot shadow those.
  ConflictError: "auth.error.username_taken",
  InvalidCredentialsError: "auth.error.invalid_credentials",
  UnauthorizedError: "auth.error.session_expired",
  username_taken: "auth.error.username_taken",
  invalid_credentials: "auth.error.invalid_credentials",
  invalid_username: "auth.error.invalid_username",
  invalid_password: "auth.error.invalid_password",
  auth_rate_limited: "auth.error.rate_limited",
  password_mismatch: "auth.error.password_mismatch",
  limit_reached: "chars.error.limit_reached",
  invalid_name: "chars.error.invalid_name",
  invalid_appearance: "chars.error.invalid_appearance",
  invalid_class: "chars.error.invalid_class",
  session_expired: "auth.error.session_expired",
  presence_error: "auth.error.presence",
  map_placement: "editor.error.placement",
  map_spawn: "editor.error.spawn",
  map_size: "editor.error.size",
  map_name: "editor.error.name",
  map_invalid: "editor.error.invalid",
  map_not_found: "editor.error.not_found",
  last_map: "editor.error.last_map",
  map_limit: "editor.error.limit",
  map_conflict: "editor.error.conflict",
  map_elements: "editor.error.elements",
  map_markers: "editor.error.markers",
  map_referenced: "editor.error.referenced",
  map_in_use: "editor.error.in_use",
  request_too_large: "editor.error.too_large",
  adventure_invalid: "adventure.error.invalid",
  adventure_title: "adventure.error.title",
  adventure_players: "adventure.error.players",
  adventure_maps: "adventure.error.maps",
  adventure_graph: "adventure.error.graph",
  adventure_not_found: "adventure.error.not_found",
  adventure_not_playable: "adventure.error.not_playable",
  adventure_in_use: "adventure.error.in_use",
  adventure_test_invalid: "editor.test.error.invalid",
  adventure_test_not_found: "editor.test.error.expired",
  party_invalid: "party.error.invalid",
  party_not_found: "party.error.not_found",
  party_adventure: "party.error.adventure",
  party_color_taken: "party.error.color_taken",
  party_full: "party.error.full",
  party_already_member: "party.error.already_member",
  party_cap: "party.error.cap",
  adventure_referenced: "adventure.error.referenced",
  hero_invalid: "hero.error.invalid",
  hero_not_found: "hero.error.not_found",
  hero_not_member: "hero.error.not_member",
  hero_cap: "hero.error.cap",
};

/**
 * `error instanceof ApiError` covers this file's own plain-`fetch` failures (`.code`). Anything
 * that instead went through Alepha's `HttpClient` (`ReactAuth.login()`/`ping()`, a future task's
 * `$client<T>()`) throws a structurally different `HttpError` — never imported here (it would drag
 * `alepha/server` into this plain, non-`alepha` tsconfig program, see `AGENTS.md`'s per-package
 * tsconfig split) — so it is recognised by duck-typing its own `.error` field instead, which the
 * server serializes with the SAME machine-code vocabulary (`HttpError.toJSON`/`errorNameByStatus`:
 * a class name like `InvalidCredentialsError`/`ConflictError`/`UnauthorizedError`) `ERROR_KEYS`
 * already maps.
 */
export function errorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  if (
    error &&
    typeof error === "object" &&
    "error" in error &&
    typeof (error as { error?: unknown }).error === "string"
  ) {
    return (error as { error: string }).error;
  }
  return "generic";
}

export function authErrorText(code: string): string {
  return t(ERROR_KEYS[code] ?? "auth.error.generic");
}
