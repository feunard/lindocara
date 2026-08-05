import { type GroundVector, withinGroundRange } from "./ground.js";

export const MAX_THREAT_ENTRIES = 16;
export const THREAT_EXPIRES_MS = 15_000;
/** Tile units: the exact quotient of the former 1100 px. */
export const THREAT_LEASH_DISTANCE = 1_100 / 64;
export const PROXIMITY_THREAT = 5;
export const HEAL_THREAT_FACTOR = 0.5;
export const TAUNT_MARGIN = 25;
export const CONTRIBUTION_EXPIRES_MS = 30_000;
/**
 * How near a contributor (or a party member of one) has to be to a monster's body to earn from it.
 *
 * Tile units: the exact quotient of the former 900 px, exactly like `THREAT_LEASH_DISTANCE` four
 * lines up. It was left at a bare `900` while the three gates that read it moved to
 * `groundDistance` (`worldTick.ts`), and 900 TILES is roughly fourteen times the widest grid — so
 * every gate was permanently true and every alive contributor, the killer, and every alive party
 * member anywhere on the map earned from every kill. Nothing failed, because a distance test that
 * always passes looks exactly like a distance test that is satisfied.
 */
export const REWARD_DISTANCE = 900 / 64;

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

/** Keeps an already-established threat entry alive while authoritative AI is still pursuing it. */
export function refreshThreat(
  table: Map<string, ThreatEntry>,
  playerId: string,
  now: number,
): boolean {
  const entry = table.get(playerId);
  if (!entry || !Number.isFinite(now)) return false;
  entry.updatedAt = now;
  return true;
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

/**
 * Is `actor` near enough to `body` to earn from the kill?
 *
 * The distance half of reward eligibility, as one named rule rather than as `groundDistance(…) <=
 * REWARD_DISTANCE` written out at each of the three gates in `worldTick.ts`'s kill path (the
 * contributor filter, the killer's own credit, and the party fan-out). It lives here, beside
 * `isMeaningfulContribution` — the other half of the same question — so both halves are pure and
 * both are reachable from a unit test.
 *
 * That reachability is the point. When `REWARD_DISTANCE` kept its pixel value through the tile-unit
 * conversion, all three gates became permanently true and nothing anywhere could notice: the rule
 * only existed as three inline comparisons inside a 6,600-line tick file, where the only way to
 * exercise it was to boot a room and stand two heroes apart.
 *
 * Across the GROUND — `groundDistance`, never a `Vec2` distance. Elevation does not put a hero out
 * of reward range; standing on the plateau above the kill still counts.
 */
export function withinRewardDistance(actor: GroundVector, body: GroundVector): boolean {
  return withinGroundRange(actor, body, REWARD_DISTANCE);
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
