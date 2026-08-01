import { type EditorAssetId, isEditorAssetId } from "./tiny-swords-catalog.js";

export const HARVEST_RESOURCE_KINDS = ["wood", "stone", "iron", "gold", "meat"] as const;
export type HarvestResourceKind = (typeof HARVEST_RESOURCE_KINDS)[number];

export const HARVEST_TOOLS = ["axe", "pickaxe", "knife"] as const;
export type HarvestTool = (typeof HARVEST_TOOLS)[number];

export const HARVEST_EXHAUSTION_BEHAVIORS = ["replace", "fade", "hide"] as const;
export type HarvestExhaustionBehavior = (typeof HARVEST_EXHAUSTION_BEHAVIORS)[number];

export const HARVEST_RESPAWN_MODES = ["permanent", "timed"] as const;
export type HarvestRespawnMode = (typeof HARVEST_RESPAWN_MODES)[number];

/** Shared authoring/runtime bounds. Every persisted quantity is an integer. */
export const HARVEST_PROFILE_LIMITS = {
  yieldAmount: { min: 0, max: 10_000 },
  goldValue: { min: 0, max: 1_000_000 },
  hitsRequired: { min: 1, max: 100 },
  range: { min: 16, max: 512 },
  harvestDurationMs: { min: 0, max: 60_000 },
  respawnDelayMs: { min: 0, max: 7 * 24 * 60 * 60 * 1_000 },
  fadeDurationMs: { min: 0, max: 10_000 },
} as const;

/** A timed resource may not respawn on the same simulation beat that exhausts it. */
export const MIN_TIMED_HARVEST_RESPAWN_MS = 1_000;

/**
 * Gameplay semantics are keyed by resource kind, never by an appearance id, filename or path.
 * Gold deliberately uses the existing currency path; it is mined with the same tool as ore.
 */
export const HARVEST_TOOL_BY_RESOURCE: Readonly<Record<HarvestResourceKind, HarvestTool>> = {
  wood: "axe",
  stone: "pickaxe",
  iron: "pickaxe",
  gold: "pickaxe",
  meat: "knife",
};

export interface HarvestProfile {
  resource: HarvestResourceKind;
  tool: HarvestTool;
  /** Material units granted on completion. Gold profiles keep this at zero. */
  yieldAmount: number;
  /** Existing hero-gold currency granted on completion. Non-gold profiles keep this at zero. */
  goldValue: number;
  hitsRequired: number;
  range: number;
  harvestDurationMs: number;
  /** Visual replacement only. It never selects the resource kind or required tool. */
  exhaustedAssetId: EditorAssetId | null;
  exhaustionBehavior: HarvestExhaustionBehavior;
  /** `permanent` means the exhausted state does not respawn. */
  respawn: HarvestRespawnMode;
  respawnDelayMs: number;
  fadeDurationMs: number;
}

export function isHarvestResourceKind(value: unknown): value is HarvestResourceKind {
  return typeof value === "string" && (HARVEST_RESOURCE_KINDS as readonly string[]).includes(value);
}

export function isHarvestTool(value: unknown): value is HarvestTool {
  return typeof value === "string" && (HARVEST_TOOLS as readonly string[]).includes(value);
}

export function isHarvestExhaustionBehavior(value: unknown): value is HarvestExhaustionBehavior {
  return (
    typeof value === "string" && (HARVEST_EXHAUSTION_BEHAVIORS as readonly string[]).includes(value)
  );
}

export function isHarvestRespawnMode(value: unknown): value is HarvestRespawnMode {
  return typeof value === "string" && (HARVEST_RESPAWN_MODES as readonly string[]).includes(value);
}

export function harvestToolForResource(resource: HarvestResourceKind): HarvestTool {
  return HARVEST_TOOL_BY_RESOURCE[resource];
}

export function harvestToolMatchesResource(
  resource: HarvestResourceKind,
  tool: HarvestTool,
): boolean {
  return harvestToolForResource(resource) === tool;
}

function boundedInteger(
  value: unknown,
  limits: { readonly min: number; readonly max: number },
): number | null {
  if (!Number.isSafeInteger(value)) return null;
  const amount = value as number;
  return amount >= limits.min && amount <= limits.max ? amount : null;
}

/** Total parser for untrusted authored or persisted harvest configuration. */
export function parseHarvestProfile(value: unknown): HarvestProfile | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const {
    resource,
    tool,
    yieldAmount,
    goldValue,
    hitsRequired,
    range,
    harvestDurationMs,
    exhaustedAssetId,
    exhaustionBehavior,
    respawn,
    respawnDelayMs,
    fadeDurationMs,
  } = record;

  if (!isHarvestResourceKind(resource) || !isHarvestTool(tool)) return null;
  if (!harvestToolMatchesResource(resource, tool)) return null;
  if (!isHarvestExhaustionBehavior(exhaustionBehavior) || !isHarvestRespawnMode(respawn)) {
    return null;
  }
  if (exhaustedAssetId !== null && !isEditorAssetId(exhaustedAssetId)) return null;
  if (exhaustionBehavior === "replace" && exhaustedAssetId === null) return null;
  if (exhaustionBehavior === "hide" && exhaustedAssetId !== null) return null;

  const parsedYield = boundedInteger(yieldAmount, HARVEST_PROFILE_LIMITS.yieldAmount);
  const parsedGold = boundedInteger(goldValue, HARVEST_PROFILE_LIMITS.goldValue);
  const parsedHits = boundedInteger(hitsRequired, HARVEST_PROFILE_LIMITS.hitsRequired);
  const parsedRange = boundedInteger(range, HARVEST_PROFILE_LIMITS.range);
  const parsedDuration = boundedInteger(
    harvestDurationMs,
    HARVEST_PROFILE_LIMITS.harvestDurationMs,
  );
  const parsedRespawnDelay = boundedInteger(respawnDelayMs, HARVEST_PROFILE_LIMITS.respawnDelayMs);
  const parsedFadeDuration = boundedInteger(fadeDurationMs, HARVEST_PROFILE_LIMITS.fadeDurationMs);
  if (
    parsedYield === null ||
    parsedGold === null ||
    parsedHits === null ||
    parsedRange === null ||
    parsedDuration === null ||
    parsedRespawnDelay === null ||
    parsedFadeDuration === null
  ) {
    return null;
  }

  // Gold enters the existing economy, never a second material counter. Every other profile yields
  // material units and cannot silently mint currency as a side effect.
  if (resource === "gold") {
    if (parsedYield !== 0 || parsedGold < 1) return null;
  } else if (parsedYield < 1 || parsedGold !== 0) {
    return null;
  }

  if (respawn === "permanent") {
    if (parsedRespawnDelay !== 0) return null;
  } else if (parsedRespawnDelay < MIN_TIMED_HARVEST_RESPAWN_MS) {
    return null;
  }

  return {
    resource,
    tool,
    yieldAmount: parsedYield,
    goldValue: parsedGold,
    hitsRequired: parsedHits,
    range: parsedRange,
    harvestDurationMs: parsedDuration,
    exhaustedAssetId: exhaustedAssetId as EditorAssetId | null,
    exhaustionBehavior,
    respawn,
    respawnDelayMs: parsedRespawnDelay,
    fadeDurationMs: parsedFadeDuration,
  };
}
