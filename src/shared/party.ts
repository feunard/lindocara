/**
 * A party is one live playthrough of an adventure — like a private server. Colour belongs to a
 * player's slot in the party (blue/red/yellow/purple); black is reserved for NPCs and is not a
 * PartyColor. Pure rules only: D1 lives in server/parties.ts.
 */
export const PARTY_COLORS = ["blue", "red", "yellow", "purple"] as const;
export type PartyColor = (typeof PARTY_COLORS)[number];

export const PARTY_NAME_MAX = 48;

/** Matches server-minted adventure/map uuids. */
const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export function isPartyColor(value: unknown): value is PartyColor {
  return typeof value === "string" && (PARTY_COLORS as readonly string[]).includes(value);
}

export interface CreatePartyInput {
  adventureId: string;
  name: string | null;
  color: PartyColor;
}

export interface JoinPartyInput {
  color: PartyColor;
}

export function parseCreatePartyInput(value: unknown): CreatePartyInput | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { adventureId, name, color } = record;
  if (typeof adventureId !== "string" || !ID_PATTERN.test(adventureId)) return null;
  let cleanName: string | null = null;
  if (name !== undefined && name !== null) {
    if (typeof name !== "string" || name.length > PARTY_NAME_MAX) return null;
    const trimmed = name.trim();
    cleanName = trimmed.length === 0 ? null : trimmed;
  }
  let cleanColor: PartyColor = "blue";
  if (color !== undefined) {
    if (!isPartyColor(color)) return null;
    cleanColor = color;
  }
  return { adventureId, name: cleanName, color: cleanColor };
}

export function parseJoinPartyInput(value: unknown): JoinPartyInput | null {
  if (typeof value !== "object" || value === null) return null;
  const { color } = value as Record<string, unknown>;
  if (!isPartyColor(color)) return null;
  return { color };
}
