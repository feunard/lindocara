import { isUuid } from "./identifiers.js";

/**
 * Party-wide crafting materials. Gold deliberately does not live here: it remains part of the
 * existing hero economy and must be credited through its fenced server path.
 */
export const PARTY_MATERIAL_TYPES = ["wood", "stone", "iron", "meat"] as const;

export type PartyMaterialType = (typeof PARTY_MATERIAL_TYPES)[number];

export interface PartyMaterials {
  wood: number;
  stone: number;
  iron: number;
  meat: number;
}

/** Sparse reward/cost shape used by trusted server-side business operations. */
export type PartyMaterialAmounts = Partial<Record<PartyMaterialType, number>>;

export const MAX_PARTY_MATERIAL_AMOUNT = 999_999;

export const EMPTY_PARTY_MATERIALS: PartyMaterials = {
  wood: 0,
  stone: 0,
  iron: 0,
  meat: 0,
};

export interface HarvestNodeState {
  /** Stable authored map-event identity. Never inferred from an asset. */
  eventId: string;
  /** Increments after a timed respawn, fencing stale harvest attempts. */
  generation: number;
  /** Authoritative successful hits in this generation. */
  hits: number;
  /** Authoritative completion time of the latest hit, for one-shot local impact presentation. */
  lastHitAt: number | null;
  depleted: boolean;
  /** Exact final-hit time; the client may anchor its authored fade without inventing a clock. */
  depletedAt: number | null;
  /** Unix milliseconds, or null for a permanently depleted node. */
  respawnAt: number | null;
}

export type HarvestNodeStates = Record<string, HarvestNodeState>;

export const MAX_HARVEST_NODE_ENTRIES = 2_048;
export const MAX_HARVEST_HITS = 10_000;
export const MAX_HARVEST_RESPAWN_DELAY_MS = 365 * 24 * 60 * 60 * 1_000;

/**
 * Authored nodes keep their UUID. Compile-time monster spawns have stable human-readable ids, so
 * carcasses use one tightly bounded namespace instead of weakening this persistence boundary to
 * arbitrary strings. Both components intentionally share the wire-id alphabet.
 */
const CARCASS_HARVEST_NODE_ID = /^carcass:[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,64}$/;
export const MAX_HARVEST_NODE_ID_LENGTH = 137;

export function isHarvestNodeId(value: unknown): value is string {
  return (
    isUuid(value) ||
    (typeof value === "string" &&
      value.length <= MAX_HARVEST_NODE_ID_LENGTH &&
      CARCASS_HARVEST_NODE_ID.test(value))
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedAmount(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= MAX_PARTY_MATERIAL_AMOUNT
  );
}

function isKnownMaterialType(value: string): value is PartyMaterialType {
  return (PARTY_MATERIAL_TYPES as readonly string[]).includes(value);
}

/**
 * Decode persisted stock. Missing keys are normalized to zero for forward/backward compatibility;
 * unknown keys (including `gold`) are rejected instead of silently creating a second economy.
 */
export function parsePartyMaterials(value: unknown): PartyMaterials | null {
  if (value === undefined) return { ...EMPTY_PARTY_MATERIALS };
  if (!isPlainObject(value)) return null;
  for (const [key, amount] of Object.entries(value)) {
    if (!isKnownMaterialType(key) || !isBoundedAmount(amount)) return null;
  }
  return {
    wood: (value.wood as number | undefined) ?? 0,
    stone: (value.stone as number | undefined) ?? 0,
    iron: (value.iron as number | undefined) ?? 0,
    meat: (value.meat as number | undefined) ?? 0,
  };
}

/** Wire/runtime guard: unlike persisted-state decoding, every material key must be explicit. */
export function isPartyMaterials(value: unknown): value is PartyMaterials {
  return (
    parsePartyMaterials(value) !== null &&
    isPlainObject(value) &&
    PARTY_MATERIAL_TYPES.every((type) => Object.hasOwn(value, type))
  );
}

/** Strict sparse parser for a server-side reward or cost. */
export function parsePartyMaterialAmounts(value: unknown): PartyMaterialAmounts | null {
  if (!isPlainObject(value)) return null;
  const amounts: PartyMaterialAmounts = {};
  for (const [key, amount] of Object.entries(value)) {
    if (!isKnownMaterialType(key) || !isBoundedAmount(amount)) return null;
    amounts[key] = amount;
  }
  return amounts;
}

export function hasPartyMaterialAmount(amounts: PartyMaterialAmounts): boolean {
  return PARTY_MATERIAL_TYPES.some((type) => (amounts[type] ?? 0) > 0);
}

/** Add a reward without exceeding the durable stock bound. */
export function addPartyMaterials(
  materials: PartyMaterials,
  reward: PartyMaterialAmounts,
): PartyMaterials | null {
  const next = { ...materials };
  for (const type of PARTY_MATERIAL_TYPES) {
    const amount = reward[type] ?? 0;
    const total = next[type] + amount;
    if (!Number.isSafeInteger(total) || total > MAX_PARTY_MATERIAL_AMOUNT) return null;
    next[type] = total;
  }
  return next;
}

/** Consume one party operation's costs as a single all-or-nothing pure transition. */
export function spendPartyMaterials(
  materials: PartyMaterials,
  costs: PartyMaterialAmounts,
): PartyMaterials | null {
  for (const type of PARTY_MATERIAL_TYPES) {
    if (materials[type] < (costs[type] ?? 0)) return null;
  }
  return {
    wood: materials.wood - (costs.wood ?? 0),
    stone: materials.stone - (costs.stone ?? 0),
    iron: materials.iron - (costs.iron ?? 0),
    meat: materials.meat - (costs.meat ?? 0),
  };
}

function parseHarvestNodeState(eventId: string, value: unknown): HarvestNodeState | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (
    (keys.length !== 5 && keys.length !== 7) ||
    keys.some(
      (key) =>
        key !== "eventId" &&
        key !== "generation" &&
        key !== "hits" &&
        key !== "lastHitAt" &&
        key !== "depleted" &&
        key !== "depletedAt" &&
        key !== "respawnAt",
    )
  ) {
    return null;
  }
  if (value.eventId !== eventId || !isHarvestNodeId(eventId)) return null;
  if (
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 0 ||
    !Number.isSafeInteger(value.hits) ||
    (value.hits as number) < 0 ||
    (value.hits as number) > MAX_HARVEST_HITS ||
    typeof value.depleted !== "boolean"
  ) {
    return null;
  }
  const lastHitAt = value.lastHitAt === undefined ? null : value.lastHitAt;
  const depletedAt = value.depletedAt === undefined ? null : value.depletedAt;
  if (
    (lastHitAt !== null && (!Number.isSafeInteger(lastHitAt) || (lastHitAt as number) < 0)) ||
    (depletedAt !== null && (!Number.isSafeInteger(depletedAt) || (depletedAt as number) < 0)) ||
    (!value.depleted && depletedAt !== null) ||
    (depletedAt !== null && lastHitAt !== depletedAt)
  ) {
    return null;
  }
  if (
    value.respawnAt !== null &&
    (!Number.isSafeInteger(value.respawnAt) || (value.respawnAt as number) < 0)
  ) {
    return null;
  }
  // A live node cannot carry a stale respawn deadline.
  if (!value.depleted && value.respawnAt !== null) return null;
  return {
    eventId,
    generation: value.generation as number,
    hits: value.hits as number,
    lastHitAt: lastHitAt as number | null,
    depleted: value.depleted,
    depletedAt: depletedAt as number | null,
    respawnAt: value.respawnAt as number | null,
  };
}

/** Decode persisted node state; old saves with no column normalize to an empty map. */
export function parseHarvestNodeStates(value: unknown): HarvestNodeStates | null {
  if (value === undefined) return {};
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_HARVEST_NODE_ENTRIES) return null;
  const nodes: HarvestNodeStates = {};
  for (const [eventId, raw] of entries) {
    const node = parseHarvestNodeState(eventId, raw);
    if (!node) return null;
    nodes[eventId] = node;
  }
  return nodes;
}

export function initialHarvestNodeState(eventId: string): HarvestNodeState {
  return {
    eventId,
    generation: 0,
    hits: 0,
    lastHitAt: null,
    depleted: false,
    depletedAt: null,
    respawnAt: null,
  };
}

export interface RefreshedHarvestNode {
  nodes: HarvestNodeStates;
  node: HarvestNodeState;
  changed: boolean;
}

/**
 * Advance a due timed respawn. The generation bump makes any reservation minted before the
 * respawn unusable even if it arrives late.
 */
export function refreshHarvestNode(
  nodes: HarvestNodeStates,
  eventId: string,
  now: number,
): RefreshedHarvestNode | null {
  if (!isHarvestNodeId(eventId) || !Number.isSafeInteger(now) || now < 0) return null;
  const current = nodes[eventId] ?? initialHarvestNodeState(eventId);
  if (!current.depleted || current.respawnAt === null || current.respawnAt > now) {
    return { nodes, node: current, changed: false };
  }
  if (current.generation === Number.MAX_SAFE_INTEGER) return null;
  const node: HarvestNodeState = {
    eventId,
    generation: current.generation + 1,
    hits: 0,
    lastHitAt: null,
    depleted: false,
    depletedAt: null,
    respawnAt: null,
  };
  return { nodes: { ...nodes, [eventId]: node }, node, changed: true };
}

export interface ApplyHarvestHitInput {
  eventId: string;
  generation: number;
  requiredHits: number;
  reward: PartyMaterialAmounts;
  respawnDelayMs: number | null;
  now: number;
}

export type ApplyHarvestHitResult =
  | {
      ok: true;
      nodes: HarvestNodeStates;
      materials: PartyMaterials;
      node: HarvestNodeState;
      rewarded: boolean;
    }
  | { ok: false; reason: "invalid" | "generation" | "depleted" | "overflow" };

/**
 * Apply exactly one already-reserved authoritative hit. The depletion transition and material
 * reward are returned together so `PartyRoom` can persist both in one versioned state write.
 */
export function applyHarvestHit(
  materials: PartyMaterials,
  nodes: HarvestNodeStates,
  input: ApplyHarvestHitInput,
): ApplyHarvestHitResult {
  if (
    !isHarvestNodeId(input.eventId) ||
    !Number.isSafeInteger(input.generation) ||
    input.generation < 0 ||
    !Number.isSafeInteger(input.requiredHits) ||
    input.requiredHits < 1 ||
    input.requiredHits > MAX_HARVEST_HITS ||
    !Number.isSafeInteger(input.now) ||
    input.now < 0 ||
    (input.respawnDelayMs !== null &&
      (!Number.isSafeInteger(input.respawnDelayMs) ||
        input.respawnDelayMs < 0 ||
        input.respawnDelayMs > MAX_HARVEST_RESPAWN_DELAY_MS))
  ) {
    return { ok: false, reason: "invalid" };
  }
  const parsedReward = parsePartyMaterialAmounts(input.reward);
  // Gold profiles intentionally carry an empty material reward. The trusted PartyRoom request
  // parser enforces that exactly one of material reward or existing-economy gold is positive.
  if (!parsedReward) {
    return { ok: false, reason: "invalid" };
  }
  const current = nodes[input.eventId] ?? initialHarvestNodeState(input.eventId);
  if (current.generation !== input.generation) return { ok: false, reason: "generation" };
  if (current.depleted) return { ok: false, reason: "depleted" };

  const hits = current.hits + 1;
  const rewarded = hits >= input.requiredHits;
  let respawnAt: number | null = null;
  if (rewarded && input.respawnDelayMs !== null) {
    respawnAt = input.now + input.respawnDelayMs;
    if (!Number.isSafeInteger(respawnAt)) return { ok: false, reason: "overflow" };
  }
  const node: HarvestNodeState = {
    ...current,
    hits: Math.min(hits, input.requiredHits),
    lastHitAt: input.now,
    depleted: rewarded,
    depletedAt: rewarded ? input.now : null,
    respawnAt,
  };
  const nextMaterials = rewarded ? addPartyMaterials(materials, parsedReward) : materials;
  if (!nextMaterials) return { ok: false, reason: "overflow" };
  return {
    ok: true,
    nodes: { ...nodes, [input.eventId]: node },
    materials: nextMaterials,
    node,
    rewarded,
  };
}
