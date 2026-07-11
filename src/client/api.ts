import type { CharacterAppearance, Equipment } from "../shared/character.js";
import type { PlayerClass } from "../shared/game.js";
import type { MessageKey } from "../shared/i18n/index.js";
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
