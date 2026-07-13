export const MAX_THREAT_ENTRIES = 16;
export const THREAT_EXPIRES_MS = 15_000;
export const THREAT_LEASH_DISTANCE = 1_100;
export const PROXIMITY_THREAT = 5;
export const HEAL_THREAT_FACTOR = 0.5;
export const TAUNT_MARGIN = 25;
export const CONTRIBUTION_EXPIRES_MS = 30_000;
export const REWARD_DISTANCE = 900;

export function usefulHealingThreat(actualHealing: number): number {
  return Number.isFinite(actualHealing) && actualHealing > 0
    ? actualHealing * HEAL_THREAT_FACTOR
    : 0;
}

export function initialProximityThreat(distance: number, aggroRange: number): number {
  if (
    !Number.isFinite(distance) ||
    !Number.isFinite(aggroRange) ||
    aggroRange <= 0 ||
    distance >= aggroRange
  )
    return 0;
  return PROXIMITY_THREAT + (aggroRange - Math.max(0, distance)) / aggroRange;
}

export interface ThreatEntry {
  playerId: string;
  amount: number;
  updatedAt: number;
}

export interface CombatContribution {
  playerId: string;
  damage: number;
  usefulHealing: number;
  relevantThreat: number;
  updatedAt: number;
}

export function addThreat(
  table: Map<string, ThreatEntry>,
  playerId: string,
  amount: number,
  now: number,
): number {
  if (!Number.isFinite(amount) || amount <= 0) return table.get(playerId)?.amount ?? 0;
  const next = (table.get(playerId)?.amount ?? 0) + amount;
  table.set(playerId, { playerId, amount: next, updatedAt: now });
  trimOldest(table, MAX_THREAT_ENTRIES);
  return next;
}

export function tauntThreat(
  table: Map<string, ThreatEntry>,
  playerId: string,
  now: number,
): number {
  let maximum = 0;
  for (const entry of table.values()) maximum = Math.max(maximum, entry.amount);
  const amount = Math.max(table.get(playerId)?.amount ?? 0, maximum + TAUNT_MARGIN);
  table.set(playerId, { playerId, amount, updatedAt: now });
  trimOldest(table, MAX_THREAT_ENTRIES);
  return amount;
}

export function highestThreat(
  table: ReadonlyMap<string, ThreatEntry>,
  eligible: (playerId: string) => boolean,
): ThreatEntry | undefined {
  return [...table.values()]
    .filter((entry) => eligible(entry.playerId))
    .sort((a, b) => b.amount - a.amount || a.playerId.localeCompare(b.playerId))[0];
}

export function recordContribution(
  table: Map<string, CombatContribution>,
  playerId: string,
  values: Partial<Pick<CombatContribution, "damage" | "usefulHealing" | "relevantThreat">>,
  now: number,
): CombatContribution {
  const previous = table.get(playerId);
  const next = {
    playerId,
    damage: (previous?.damage ?? 0) + positive(values.damage),
    usefulHealing: (previous?.usefulHealing ?? 0) + positive(values.usefulHealing),
    relevantThreat: (previous?.relevantThreat ?? 0) + positive(values.relevantThreat),
    updatedAt: now,
  };
  table.set(playerId, next);
  trimOldest(table, MAX_THREAT_ENTRIES);
  return next;
}

export function isMeaningfulContribution(value: CombatContribution): boolean {
  return value.damage > 0 || value.usefulHealing > 0 || value.relevantThreat > PROXIMITY_THREAT;
}

export function splitExperience(total: number, playerIds: readonly string[]): Map<string, number> {
  const ids = [...new Set(playerIds)].sort();
  const result = new Map<string, number>();
  if (ids.length === 0 || total <= 0) return result;
  const base = Math.floor(total / ids.length);
  let remainder = total % ids.length;
  for (const id of ids) {
    result.set(id, base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder -= 1;
  }
  return result;
}

function positive(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

function trimOldest<T extends { updatedAt: number }>(table: Map<string, T>, limit: number): void {
  if (table.size <= limit) return;
  const oldest = [...table.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
  if (oldest) table.delete(oldest[0]);
}
