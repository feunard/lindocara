import type {
  AdventureGraph,
  AdventureInput,
  CreateAdventureInput,
} from "@lindocara/engine/adventure.js";
import type { AdventureRegistry } from "@lindocara/engine/adventure-state.js";
import type { CharacterAppearance, Equipment } from "@lindocara/engine/character.js";
import type { PlayerClass } from "@lindocara/engine/game.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import type { MapElement, MapMarkers } from "@lindocara/engine/map-data.js";
import type { MapEvent } from "@lindocara/engine/map-events.js";
import type { PartyColor } from "@lindocara/engine/party.js";
import { t } from "./i18n.js";

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
  constructor(readonly code: string) {
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
    throw new ApiError(code);
  }
  return body as T;
}

export const fetchMe = () => api<Me>("/api/me").catch(() => null);

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
  /** Authored events, ordered by ordinal; pages ordered by position. Empty for maps saved before
   *  events existed. Nothing here executes this tranche. */
  events: readonly MapEvent[];
}

/** What create/update send: everything but the server-minted id. */
export type MapSaveInput = Omit<MapPayload, "id" | "revision">;

export const fetchMaps = (adventureId: string) =>
  api<MapSummary[]>(`/api/maps?adventure=${adventureId}`);
export const fetchMap = (id: string) => api<MapPayload>(`/api/maps/${id}`);
export const createMapApi = (adventureId: string, name: string) =>
  api<MapPayload>("/api/maps", { method: "POST", body: JSON.stringify({ adventureId, name }) });
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
export const deleteMapApi = (id: string) => api<void>(`/api/maps/${id}`, { method: "DELETE" });

export interface AdventureSummary {
  id: string;
  title: string;
  maxPlayers: number;
  /** How many maps the adventure owns — shown on the picker card. */
  mapCount: number;
  /** Whether a start is authored: a playable adventure vs a draft. Badges the picker card. */
  playable: boolean;
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
  /** The switch/variable registry, editable through `RegistryDialog` and saved on the adventure
   *  PUT. Empty for adventures whose registry was never authored. */
  registry: AdventureRegistry;
}

export const fetchAdventures = () => api<AdventureSummary[]>("/api/adventures");
export const fetchAdventure = (id: string) => api<AdventurePayload>(`/api/adventures/${id}`);
export const createAdventureApi = (input: CreateAdventureInput) =>
  api<CreatedAdventure>("/api/adventures", { method: "POST", body: JSON.stringify(input) });
export const updateAdventureApi = (id: string, input: AdventureInput) =>
  api<AdventurePayload>(`/api/adventures/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const deleteAdventureApi = (id: string) =>
  api<void>(`/api/adventures/${id}`, { method: "DELETE" });

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
export const createPartyApi = (input: {
  adventureId: string;
  name?: string | null;
  color: PartyColor;
}) => api<StoredParty>("/api/parties", { method: "POST", body: JSON.stringify(input) });
export const joinPartyApi = (partyId: string, color: PartyColor) =>
  api<void>(`/api/parties/${partyId}/join`, { method: "POST", body: JSON.stringify({ color }) });
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

/** Stable machine codes (from ApiError, or synthesized client-side) mapped to i18n keys. */
export const ERROR_KEYS: Record<string, MessageKey> = {
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
  request_too_large: "editor.error.too_large",
  adventure_invalid: "adventure.error.invalid",
  adventure_title: "adventure.error.title",
  adventure_players: "adventure.error.players",
  adventure_maps: "adventure.error.maps",
  adventure_graph: "adventure.error.graph",
  adventure_not_found: "adventure.error.not_found",
  adventure_not_playable: "adventure.error.not_playable",
  adventure_in_use: "adventure.error.in_use",
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

export function errorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : "generic";
}

export function authErrorText(code: string): string {
  return t(ERROR_KEYS[code] ?? "auth.error.generic");
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/session", { method: "DELETE" });
  } catch (error) {
    // A failed best-effort revocation must not strand the user in a half-closed game session.
    // Reloading still clears all in-memory authority; an unexpired cookie can then be retried.
    console.warn("session logout request failed", error);
  } finally {
    window.location.reload();
  }
}
