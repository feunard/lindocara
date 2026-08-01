import { isUuid } from "@lindocara/engine/identifiers.js";
import {
  hasPartyMaterialAmount,
  PARTY_MATERIAL_TYPES,
  type PartyMaterialAmounts,
  parsePartyMaterialAmounts,
} from "@lindocara/engine/party-harvest-state.js";

export const MAX_SUPPORT_SPEND_ENTRIES = 128;
export const SUPPORT_SPEND_OUTCOME_TTL_MS = 60_000;

export type SupportSpendStatus = "committed" | "settled" | "refunded" | "released";

/**
 * Private coordinator journal entry. This shape is persisted beside the public adventure state,
 * but never becomes part of `PartyAdventureState` or a server message.
 */
export interface SupportSpendEntry {
  readonly heroId: string;
  readonly roomKey: string;
  readonly costs: PartyMaterialAmounts;
  readonly status: SupportSpendStatus;
  readonly createdAt: number;
  readonly resolvedAt: number | null;
}

export type SupportSpendJournal = Record<string, SupportSpendEntry>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSupportSpendRoomKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const separator = value.indexOf(":");
  return (
    separator > 0 &&
    value.indexOf(":", separator + 1) === -1 &&
    isUuid(value.slice(0, separator)) &&
    isUuid(value.slice(separator + 1))
  );
}

export function supportSpendRoomBelongsToParty(roomKey: string, partyId: string): boolean {
  return isUuid(partyId) && isSupportSpendRoomKey(roomKey) && roomKey.startsWith(`${partyId}:`);
}

function isSupportSpendStatus(value: unknown): value is SupportSpendStatus {
  return (
    value === "committed" || value === "settled" || value === "refunded" || value === "released"
  );
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Strict decoder: uncertainty about a committed spend must stop reconciliation, never erase it. */
export function parseSupportSpendJournal(value: unknown): SupportSpendJournal | null {
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_SUPPORT_SPEND_ENTRIES) return null;
  const journal: SupportSpendJournal = {};
  for (const [reservationId, rawEntry] of entries) {
    if (!isUuid(reservationId) || !isPlainObject(rawEntry)) return null;
    const keys = Object.keys(rawEntry);
    if (
      keys.length !== 6 ||
      keys.some(
        (key) =>
          key !== "heroId" &&
          key !== "roomKey" &&
          key !== "costs" &&
          key !== "status" &&
          key !== "createdAt" &&
          key !== "resolvedAt",
      )
    ) {
      return null;
    }
    const costs = parsePartyMaterialAmounts(rawEntry.costs);
    if (
      !isUuid(rawEntry.heroId) ||
      !isSupportSpendRoomKey(rawEntry.roomKey) ||
      !costs ||
      !hasPartyMaterialAmount(costs) ||
      !isSupportSpendStatus(rawEntry.status) ||
      !isTimestamp(rawEntry.createdAt)
    ) {
      return null;
    }
    const resolvedAt = rawEntry.resolvedAt;
    if (
      (rawEntry.status === "committed" && resolvedAt !== null) ||
      (rawEntry.status !== "committed" &&
        (!isTimestamp(resolvedAt) || resolvedAt < rawEntry.createdAt))
    ) {
      return null;
    }
    journal[reservationId] = {
      heroId: rawEntry.heroId,
      roomKey: rawEntry.roomKey,
      costs,
      status: rawEntry.status,
      createdAt: rawEntry.createdAt,
      resolvedAt: resolvedAt as number | null,
    };
  }
  return journal;
}

export function sameSupportSpend(
  entry: { heroId: string; roomKey: string; costs: PartyMaterialAmounts },
  request: { heroId: string; roomKey: string; costs: PartyMaterialAmounts },
): boolean {
  if (entry.heroId !== request.heroId || entry.roomKey !== request.roomKey) return false;
  return PARTY_MATERIAL_TYPES.every(
    (type) => (entry.costs[type] ?? 0) === (request.costs[type] ?? 0),
  );
}

export function committedSupportSpendTotals(journal: SupportSpendJournal): PartyMaterialAmounts {
  const totals: PartyMaterialAmounts = {};
  for (const entry of Object.values(journal)) {
    if (entry.status !== "committed") continue;
    for (const type of PARTY_MATERIAL_TYPES) {
      totals[type] = (totals[type] ?? 0) + (entry.costs[type] ?? 0);
    }
  }
  return totals;
}

/**
 * Prune only resolved tombstones. A committed entry is never inferred settled/refunded from age;
 * if committed entries fill the bound, new support actions fail closed until a room reconciles.
 */
export function pruneSupportSpendOutcomes(
  journal: SupportSpendJournal,
  now: number,
  slotsNeeded = 0,
): SupportSpendJournal | null {
  if (!isTimestamp(now) || !Number.isSafeInteger(slotsNeeded) || slotsNeeded < 0) return null;
  const next = { ...journal };
  const resolved = Object.entries(next)
    .filter((entry): entry is [string, SupportSpendEntry & { resolvedAt: number }] => {
      return entry[1].status !== "committed" && entry[1].resolvedAt !== null;
    })
    .sort((left, right) => left[1].resolvedAt - right[1].resolvedAt);
  for (const [id, entry] of resolved) {
    if (entry.resolvedAt <= now - SUPPORT_SPEND_OUTCOME_TTL_MS) delete next[id];
  }
  for (const [id] of resolved) {
    if (Object.keys(next).length + slotsNeeded <= MAX_SUPPORT_SPEND_ENTRIES) break;
    delete next[id];
  }
  return Object.keys(next).length + slotsNeeded <= MAX_SUPPORT_SPEND_ENTRIES ? next : null;
}
