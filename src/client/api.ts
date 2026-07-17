import type { AdventureGraph, AdventureInput } from "../shared/adventure.js";
import type { CharacterAppearance, Equipment } from "../shared/character.js";
import type { PlayerClass } from "../shared/game.js";
import type { MessageKey } from "../shared/i18n/index.js";
import type { MapElement, MapMarkers } from "../shared/map-data.js";
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

/** The client can only create as many characters as the server's per-account cap allows.
 *  Kept in sync with `MAX_CHARACTERS_PER_ACCOUNT` in `src/server/characters.ts` — not
 *  imported, since client code must not import server code. */
export const MAX_CHARACTERS = 3;

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
export const fetchCharacters = () => api<CharacterSummary[]>("/api/characters");

export interface MapSummary {
  id: string;
  name: string;
  isFirst: boolean;
}

export interface MapPayload {
  id: string;
  name: string;
  blocks: string[];
  elements: MapElement[];
  spawn: { col: number; row: number };
  markers: MapMarkers;
}

/** What create/update send: everything but the server-minted id. */
export type MapSaveInput = Omit<MapPayload, "id">;

export const fetchMaps = () => api<MapSummary[]>("/api/maps");
export const fetchMap = (id: string) => api<MapPayload>(`/api/maps/${id}`);
export const createMapApi = (input: MapSaveInput) =>
  api<MapPayload>("/api/maps", { method: "POST", body: JSON.stringify(input) });
export const updateMapApi = (id: string, input: MapSaveInput) =>
  api<MapPayload>(`/api/maps/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const deleteMapApi = (id: string) => api<void>(`/api/maps/${id}`, { method: "DELETE" });
export const flagFirstMapApi = (id: string) =>
  api<void>(`/api/maps/${id}/first`, { method: "POST" });

export interface AdventureSummary {
  id: string;
  title: string;
  maxPlayers: number;
}

export interface AdventurePayload {
  id: string;
  accountId: string;
  title: string;
  maxPlayers: number;
  version: number;
  mapIds: string[];
  graph: AdventureGraph;
}

export const fetchAdventures = () => api<AdventureSummary[]>("/api/adventures");
export const fetchAdventure = (id: string) => api<AdventurePayload>(`/api/adventures/${id}`);
export const createAdventureApi = (input: AdventureInput) =>
  api<AdventurePayload>("/api/adventures", { method: "POST", body: JSON.stringify(input) });
export const updateAdventureApi = (id: string, input: AdventureInput) =>
  api<AdventurePayload>(`/api/adventures/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const deleteAdventureApi = (id: string) =>
  api<void>(`/api/adventures/${id}`, { method: "DELETE" });

/** Stable machine codes (from ApiError, or synthesized client-side) mapped to i18n keys. */
export const ERROR_KEYS: Record<string, MessageKey> = {
  username_taken: "auth.error.username_taken",
  invalid_credentials: "auth.error.invalid_credentials",
  invalid_username: "auth.error.invalid_username",
  invalid_password: "auth.error.invalid_password",
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
  party_invalid: "party.error.invalid",
  party_not_found: "party.error.not_found",
  party_adventure: "party.error.adventure",
  party_color_taken: "party.error.color_taken",
  party_full: "party.error.full",
  party_already_member: "party.error.already_member",
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
  await fetch("/api/session", { method: "DELETE" });
  window.location.reload();
}
