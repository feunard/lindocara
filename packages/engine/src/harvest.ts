import type { MonsterRespawnMode, MonsterSpecies, Rect } from "./game.js";
import { TILE_SIZE } from "./tilemap.js";
import { type EditorAssetId, isEditorAssetId } from "./tiny-swords-catalog.js";

export const HARVEST_RESOURCE_KINDS = ["wood", "stone", "gold", "meat"] as const;
export type HarvestResourceKind = (typeof HARVEST_RESOURCE_KINDS)[number];

/** Pawn carry-sheet variants that actually exist; stone deliberately has no fake. */
export const PEASANT_CARRY_KINDS = ["wood", "meat", "gold"] as const;
export type PeasantCarryKind = (typeof PEASANT_CARRY_KINDS)[number];
export const PEASANT_CARRY_DURATION_MS = 3_000;

export const HARVEST_TOOLS = ["axe", "pickaxe", "knife"] as const;
export type HarvestTool = (typeof HARVEST_TOOLS)[number];

export const HARVEST_EXHAUSTION_BEHAVIORS = ["replace", "fade", "hide"] as const;
export type HarvestExhaustionBehavior = (typeof HARVEST_EXHAUSTION_BEHAVIORS)[number];

export const HARVEST_RESPAWN_MODES = ["permanent", "timed"] as const;
export type HarvestRespawnMode = (typeof HARVEST_RESPAWN_MODES)[number];

export const HARVEST_ACTOR_BEHAVIORS = ["static", "wander"] as const;
export type HarvestActorBehavior = (typeof HARVEST_ACTOR_BEHAVIORS)[number];

/** Shared authoring/runtime bounds. Every persisted quantity is an integer. */
export const HARVEST_PROFILE_LIMITS = {
  yieldAmount: { min: 0, max: 10_000 },
  goldValue: { min: 0, max: 1_000_000 },
  hitsRequired: { min: 1, max: 100 },
  range: { min: 16, max: 512 },
  harvestDurationMs: { min: 0, max: 60_000 },
  respawnDelayMs: { min: 0, max: 7 * 24 * 60 * 60 * 1_000 },
  fadeDurationMs: { min: 0, max: 10_000 },
  collisionOffset: { min: -512, max: 512 },
  collisionSize: { min: 1, max: 512 },
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
  gold: "pickaxe",
  meat: "knife",
};

/**
 * One collision box authored in event-foot space. `offsetX`/`offsetY` locate the rectangle's
 * top-left corner relative to the event's bottom-centre ground point. This is gameplay data: it
 * never comes from an asset crop, filename or catalogue path.
 */
export interface HarvestCollisionBox {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export interface HarvestCollisionProfile {
  /** Solid footprint while the resource can be harvested. */
  intact: HarvestCollisionBox;
  /** Optional footprint of an explicit replacement (for example a stump). */
  depleted: HarvestCollisionBox | null;
}

export interface HarvestAmountRange {
  min: number;
  max: number;
}

/**
 * Compatibility defaults for maps authored before harvest collision became configurable. They
 * are keyed only by the explicit resource kind. New profiles should persist their own collision
 * geometry so tree/rock sizes can vary independently from their artwork.
 */
export const DEFAULT_HARVEST_COLLISIONS: Readonly<
  Record<HarvestResourceKind, HarvestCollisionProfile>
> = {
  wood: {
    intact: { offsetX: -22, offsetY: -30, width: 44, height: 30 },
    depleted: { offsetX: -18, offsetY: -14, width: 36, height: 14 },
  },
  stone: {
    intact: { offsetX: -24, offsetY: -22, width: 48, height: 22 },
    depleted: { offsetX: -20, offsetY: -12, width: 40, height: 12 },
  },
  gold: {
    intact: { offsetX: -24, offsetY: -22, width: 48, height: 22 },
    depleted: { offsetX: -20, offsetY: -12, width: 40, height: 12 },
  },
  meat: {
    intact: { offsetX: -20, offsetY: -16, width: 40, height: 16 },
    depleted: null,
  },
};

export interface HarvestProfile {
  resource: HarvestResourceKind;
  tool: HarvestTool;
  /** Material units granted on completion. Gold profiles keep this at zero. */
  yieldAmount: number;
  /** Optional authoritative random base range. Missing authored profiles keep their fixed amount. */
  yieldRange?: HarvestAmountRange;
  /** Existing hero-gold currency granted on completion. Non-gold profiles keep this at zero. */
  goldValue: number;
  /** Optional authoritative random currency range for native gold deposits. */
  goldValueRange?: HarvestAmountRange;
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
  /** Optional harmless-actor motion. Missing legacy data remains a static resource. */
  actorBehavior?: HarvestActorBehavior;
  /**
   * Explicit gameplay footprint. Optional only at the type boundary so legacy in-memory fixtures
   * and persisted maps remain readable; `parseHarvestProfile` always fills it before runtime use.
   */
  collision?: HarvestCollisionProfile;
}

/**
 * Explicit carcass gameplay catalogue. Species opt in here; artwork, display names and monster
 * kinds are deliberately irrelevant. Native sheep scenery is curated in `harvest-presets.ts` with
 * its own meat profile, while a defeated war pig uses this server-owned default.
 */
export const HARVESTABLE_ANIMAL_SPECIES = ["war_pig"] as const satisfies readonly MonsterSpecies[];

const WAR_PIG_CARCASS_PROFILE: HarvestProfile = {
  resource: "meat",
  tool: "knife",
  yieldAmount: 3,
  yieldRange: { min: 1, max: 5 },
  goldValue: 0,
  hitsRequired: 2,
  range: 50,
  harvestDurationMs: 0,
  exhaustedAssetId: null,
  exhaustionBehavior: "hide",
  respawn: "timed",
  respawnDelayMs: MIN_TIMED_HARVEST_RESPAWN_MS,
  fadeDurationMs: 300,
  collision: DEFAULT_HARVEST_COLLISIONS.meat,
};

const ANIMAL_CARCASS_PROFILES: Readonly<Partial<Record<MonsterSpecies, HarvestProfile>>> = {
  war_pig: WAR_PIG_CARCASS_PROFILE,
};

export function animalCarcassHarvestProfile(
  species: MonsterSpecies,
  respawnMode: MonsterRespawnMode,
  remainingRespawnMs: number,
): HarvestProfile | null {
  const profile = ANIMAL_CARCASS_PROFILES[species];
  if (!profile) return null;
  return {
    ...profile,
    respawn: respawnMode === "never" ? "permanent" : "timed",
    respawnDelayMs:
      respawnMode === "never"
        ? 0
        : Math.min(
            HARVEST_PROFILE_LIMITS.respawnDelayMs.max,
            Math.max(MIN_TIMED_HARVEST_RESPAWN_MS, Math.floor(remainingRespawnMs)),
          ),
  };
}

export function isHarvestResourceKind(value: unknown): value is HarvestResourceKind {
  return typeof value === "string" && (HARVEST_RESOURCE_KINDS as readonly string[]).includes(value);
}

export function isPeasantCarryKind(value: unknown): value is PeasantCarryKind {
  return typeof value === "string" && (PEASANT_CARRY_KINDS as readonly string[]).includes(value);
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

export function isHarvestActorBehavior(value: unknown): value is HarvestActorBehavior {
  return (
    typeof value === "string" && (HARVEST_ACTOR_BEHAVIORS as readonly string[]).includes(value)
  );
}

export function harvestActorBehavior(profile: HarvestProfile): HarvestActorBehavior {
  return profile.actorBehavior ?? "static";
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

function boundedAmountRange(
  value: unknown,
  limits: { readonly min: number; readonly max: number },
): HarvestAmountRange | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "min" && key !== "max")) return null;
  const min = boundedInteger(record.min, limits);
  const max = boundedInteger(record.max, limits);
  return min === null || max === null || min > max ? null : { min, max };
}

type LegacyHarvestTimingSignature = Omit<
  Pick<
    HarvestProfile,
    "resource" | "tool" | "harvestDurationMs" | "exhaustionBehavior" | "respawn"
  >,
  "resource"
> & { resource: HarvestResourceKind | "iron" };

/**
 * Exact gameplay signatures shipped by the original eight editor presets. Those presets added a
 * hidden post-animation channel; their replacement hits on the authoritative active frame. A
 * profile without collision is the old schema. Resource quantities, hit counts and respawn delays
 * were per-instance overrides, so they do not prevent the inherited timing from migrating. A
 * genuinely custom non-historical duration remains intact. Visual asset ids are deliberately absent.
 */
const LEGACY_DEFERRED_HARVEST_PRESETS: readonly LegacyHarvestTimingSignature[] = [
  {
    resource: "wood",
    tool: "axe",
    harvestDurationMs: 900,
    exhaustionBehavior: "replace",
    respawn: "permanent",
  },
  {
    resource: "stone",
    tool: "pickaxe",
    harvestDurationMs: 1_100,
    exhaustionBehavior: "fade",
    respawn: "permanent",
  },
  {
    resource: "iron",
    tool: "pickaxe",
    harvestDurationMs: 1_200,
    exhaustionBehavior: "fade",
    respawn: "permanent",
  },
  {
    resource: "gold",
    tool: "pickaxe",
    harvestDurationMs: 1_000,
    exhaustionBehavior: "fade",
    respawn: "permanent",
  },
  {
    resource: "gold",
    tool: "pickaxe",
    harvestDurationMs: 1_200,
    exhaustionBehavior: "fade",
    respawn: "permanent",
  },
  {
    resource: "meat",
    tool: "knife",
    harvestDurationMs: 700,
    exhaustionBehavior: "hide",
    respawn: "permanent",
  },
  {
    resource: "meat",
    tool: "knife",
    harvestDurationMs: 900,
    exhaustionBehavior: "replace",
    respawn: "timed",
  },
  {
    resource: "meat",
    tool: "knife",
    harvestDurationMs: 1_000,
    exhaustionBehavior: "replace",
    respawn: "timed",
  },
];

function migrateLegacyHarvestDuration(
  profile: LegacyHarvestTimingSignature,
  collision: unknown,
): number {
  if (collision !== undefined) return profile.harvestDurationMs;
  const historical = LEGACY_DEFERRED_HARVEST_PRESETS.some((signature) =>
    (Object.keys(signature) as (keyof LegacyHarvestTimingSignature)[]).every(
      (key) => signature[key] === profile[key],
    ),
  );
  return historical ? 0 : profile.harvestDurationMs;
}

function parseHarvestCollisionBox(value: unknown): HarvestCollisionBox | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const offsetX = boundedInteger(record.offsetX, HARVEST_PROFILE_LIMITS.collisionOffset);
  const offsetY = boundedInteger(record.offsetY, HARVEST_PROFILE_LIMITS.collisionOffset);
  const width = boundedInteger(record.width, HARVEST_PROFILE_LIMITS.collisionSize);
  const height = boundedInteger(record.height, HARVEST_PROFILE_LIMITS.collisionSize);
  if (offsetX === null || offsetY === null || width === null || height === null) return null;
  return { offsetX, offsetY, width, height };
}

function parseHarvestCollisionProfile(
  value: unknown,
  resource: HarvestResourceKind,
  exhaustionBehavior: HarvestExhaustionBehavior,
): HarvestCollisionProfile | null {
  // Compatibility read: old persisted maps did not carry collision. Resolve them from explicit
  // gameplay semantics once, then return the same normalized shape as newly-authored profiles.
  if (value === undefined) {
    const defaults = DEFAULT_HARVEST_COLLISIONS[resource];
    return {
      intact: { ...defaults.intact },
      depleted:
        exhaustionBehavior === "replace" && defaults.depleted ? { ...defaults.depleted } : null,
    };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const intact = parseHarvestCollisionBox(record.intact);
  if (!intact) return null;
  const depleted = record.depleted === null ? null : parseHarvestCollisionBox(record.depleted);
  if (depleted === null && record.depleted !== null) return null;
  // Fade/hide remove collision at depletion. Keeping a hidden collider would be an invisible wall.
  if (exhaustionBehavior !== "replace" && depleted !== null) return null;
  // A replacement may retain or shrink the already-solid footprint, but must never materialize
  // new solid ground around the actor that delivered the exhausting hit.
  if (
    depleted &&
    (depleted.offsetX < intact.offsetX ||
      depleted.offsetY < intact.offsetY ||
      depleted.offsetX + depleted.width > intact.offsetX + intact.width ||
      depleted.offsetY + depleted.height > intact.offsetY + intact.height)
  ) {
    return null;
  }
  return { intact, depleted };
}

/** Resolve legacy in-memory profiles without ever consulting their visual asset. */
export function harvestCollisionProfile(profile: HarvestProfile): HarvestCollisionProfile {
  const collision = profile.collision;
  if (collision) return collision;
  const defaults = DEFAULT_HARVEST_COLLISIONS[profile.resource];
  return {
    intact: { ...defaults.intact },
    depleted:
      profile.exhaustionBehavior === "replace" && defaults.depleted
        ? { ...defaults.depleted }
        : null,
  };
}

/** Detached profile for editor drafts and placed instances, including nested collision boxes. */
export function cloneHarvestProfile(profile: HarvestProfile): HarvestProfile {
  const collision = harvestCollisionProfile(profile);
  return {
    ...profile,
    ...(profile.yieldRange ? { yieldRange: { ...profile.yieldRange } } : {}),
    ...(profile.goldValueRange ? { goldValueRange: { ...profile.goldValueRange } } : {}),
    collision: {
      intact: { ...collision.intact },
      depleted: collision.depleted ? { ...collision.depleted } : null,
    },
  };
}

/** The authored box for one lifecycle state, before any coordinate frame is chosen. */
function harvestCollisionBoxAt(
  profile: HarvestProfile,
  state: "intact" | "depleted",
): HarvestCollisionBox | null {
  const collision = harvestCollisionProfile(profile);
  return state === "intact"
    ? collision.intact
    : profile.exhaustionBehavior === "replace"
      ? collision.depleted
      : null;
}

/** Authoritative world-space rectangle for one node lifecycle state. */
export function harvestColliderAt(
  profile: HarvestProfile,
  col: number,
  row: number,
  state: "intact" | "depleted",
): Rect | null {
  const box = harvestCollisionBoxAt(profile, state);
  if (!box) return null;
  const footX = col * TILE_SIZE + TILE_SIZE / 2;
  const footY = (row + 1) * TILE_SIZE;
  return {
    x: footX + box.offsetX,
    y: footY + box.offsetY,
    width: box.width,
    height: box.height,
  };
}

/**
 * The same authoritative rectangle on the GROUND PLANE, in tile units with the grid centre as the
 * origin — `harvestColliderAt`'s successor for everything the server collides against, exactly as
 * `authoredCellCentreGround` is `eventCellCentre`'s.
 *
 * `harvestColliderAt` above stays: its pixel rectangle is what the wire still carries as
 * `events[].harvest.collider`. This is the producer-side crossing for the room's own collision, and
 * the ONLY place a stored collision box is divided by `TILE_SIZE` — the authored offsets and sizes
 * remain PIXELS in storage and in the editor's bounds, the same decision `authoredPatrolRadius`
 * records. A box divided at a use site is how half a conversion hides.
 *
 * `gridSize` is the map's own `size`, which is what turns a top-left cell index into a grid-centred
 * coordinate. The result is `ColliderIndex`'s `{x, z, w, h}` shape rather than the pixel `Rect`, so
 * the two can never be handed to each other by accident.
 */
export function harvestGroundColliderAt(
  profile: HarvestProfile,
  col: number,
  row: number,
  state: "intact" | "depleted",
  gridSize: number,
): { x: number; z: number; w: number; h: number } | null {
  const box = harvestCollisionBoxAt(profile, state);
  if (!box) return null;
  const half = gridSize / 2;
  // The authored box is anchored at the event's FOOT: the cell's horizontal centre and its far
  // edge, which is `col + 0.5` and `row + 1` once a cell is one unit wide.
  const footX = col + 0.5 - half;
  const footZ = row + 1 - half;
  return {
    x: footX + box.offsetX / TILE_SIZE,
    z: footZ + box.offsetY / TILE_SIZE,
    w: box.width / TILE_SIZE,
    h: box.height / TILE_SIZE,
  };
}

/**
 * Whether every footprint this authored node can expose stays inside its map. Both the intact
 * resource and an explicit depleted replacement are checked: accepting a tree whose stump would
 * become an out-of-bounds invisible wall is no safer than accepting an out-of-bounds tree.
 */
export function harvestFootprintFitsMap(
  profile: HarvestProfile,
  col: number,
  row: number,
  cols: number,
  rows: number,
): boolean {
  if (
    !Number.isSafeInteger(col) ||
    !Number.isSafeInteger(row) ||
    !Number.isSafeInteger(cols) ||
    !Number.isSafeInteger(rows) ||
    col < 0 ||
    row < 0 ||
    cols <= 0 ||
    rows <= 0 ||
    col >= cols ||
    row >= rows
  ) {
    return false;
  }
  const mapWidth = cols * TILE_SIZE;
  const mapHeight = rows * TILE_SIZE;
  if (!Number.isSafeInteger(mapWidth) || !Number.isSafeInteger(mapHeight)) return false;

  const fits = (rect: Rect | null): boolean =>
    rect === null ||
    (Number.isSafeInteger(rect.x) &&
      Number.isSafeInteger(rect.y) &&
      Number.isSafeInteger(rect.width) &&
      Number.isSafeInteger(rect.height) &&
      rect.x >= 0 &&
      rect.y >= 0 &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.x <= mapWidth - rect.width &&
      rect.y <= mapHeight - rect.height);

  return (
    fits(harvestColliderAt(profile, col, row, "intact")) &&
    fits(harvestColliderAt(profile, col, row, "depleted"))
  );
}

/** Total parser for untrusted authored or persisted harvest configuration. */
export function parseHarvestProfile(value: unknown): HarvestProfile | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const {
    resource,
    tool,
    yieldAmount,
    yieldRange,
    goldValue,
    goldValueRange,
    hitsRequired,
    range,
    harvestDurationMs,
    exhaustedAssetId,
    exhaustionBehavior,
    respawn,
    respawnDelayMs,
    fadeDurationMs,
    collision,
    actorBehavior,
  } = record;

  const normalizedResource = resource === "iron" ? "stone" : resource;
  if (!isHarvestResourceKind(normalizedResource) || !isHarvestTool(tool)) return null;
  if (!harvestToolMatchesResource(normalizedResource, tool)) return null;
  if (!isHarvestExhaustionBehavior(exhaustionBehavior) || !isHarvestRespawnMode(respawn)) {
    return null;
  }
  if (actorBehavior !== undefined && !isHarvestActorBehavior(actorBehavior)) return null;
  if (exhaustedAssetId !== null && !isEditorAssetId(exhaustedAssetId)) return null;
  if (exhaustionBehavior === "replace" && exhaustedAssetId === null) return null;
  if (exhaustionBehavior === "hide" && exhaustedAssetId !== null) return null;

  const parsedYield = boundedInteger(yieldAmount, HARVEST_PROFILE_LIMITS.yieldAmount);
  const parsedGold = boundedInteger(goldValue, HARVEST_PROFILE_LIMITS.goldValue);
  const parsedYieldRange = boundedAmountRange(yieldRange, HARVEST_PROFILE_LIMITS.yieldAmount);
  const parsedGoldRange = boundedAmountRange(goldValueRange, HARVEST_PROFILE_LIMITS.goldValue);
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
    parsedYieldRange === null ||
    parsedGoldRange === null ||
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
  if (normalizedResource === "gold") {
    if (
      parsedYield !== 0 ||
      parsedGold < 1 ||
      parsedYieldRange !== undefined ||
      (parsedGoldRange !== undefined && parsedGoldRange.min < 1)
    )
      return null;
  } else if (parsedYield < 1 || parsedGold !== 0) {
    return null;
  } else if (
    parsedGoldRange !== undefined ||
    (parsedYieldRange !== undefined && parsedYieldRange.min < 1)
  ) {
    return null;
  }

  if (respawn === "permanent") {
    if (parsedRespawnDelay !== 0) return null;
  } else if (parsedRespawnDelay < MIN_TIMED_HARVEST_RESPAWN_MS) {
    return null;
  }

  // The two originally shipped sheep profiles left a meat sprite behind and had no movement
  // field. Their exact gameplay signature is sufficient for a compatibility repair; visual ids
  // remain presentation-only and never participate in this decision.
  const legacySheep =
    actorBehavior === undefined &&
    normalizedResource === "meat" &&
    tool === "knife" &&
    parsedGold === 0 &&
    parsedRange === 80 &&
    parsedRespawnDelay === 300_000 &&
    parsedFadeDuration === 450 &&
    exhaustionBehavior === "replace" &&
    respawn === "timed" &&
    ((parsedYield === 6 && parsedHits === 3) || (parsedYield === 8 && parsedHits === 4));
  const parsedCollision = parseHarvestCollisionProfile(
    collision,
    normalizedResource,
    exhaustionBehavior,
  );
  if (!parsedCollision) return null;
  const normalizedDuration = migrateLegacyHarvestDuration(
    {
      resource: resource as HarvestResourceKind | "iron",
      tool,
      harvestDurationMs: parsedDuration,
      exhaustionBehavior,
      respawn,
    },
    collision,
  );

  return {
    resource: normalizedResource,
    tool,
    yieldAmount: parsedYield,
    ...(parsedYieldRange === undefined ? {} : { yieldRange: parsedYieldRange }),
    goldValue: parsedGold,
    ...(parsedGoldRange === undefined ? {} : { goldValueRange: parsedGoldRange }),
    // The lab's critter contract is four clicks. Normalize the one shipped three-hit sheep profile
    // while it is already being identified for its movement/exhaustion compatibility repair.
    hitsRequired: legacySheep ? 4 : parsedHits,
    range: parsedRange,
    harvestDurationMs: normalizedDuration,
    exhaustedAssetId: legacySheep ? null : (exhaustedAssetId as EditorAssetId | null),
    exhaustionBehavior: legacySheep ? "hide" : exhaustionBehavior,
    respawn,
    respawnDelayMs: parsedRespawnDelay,
    fadeDurationMs: parsedFadeDuration,
    collision: legacySheep ? { intact: parsedCollision.intact, depleted: null } : parsedCollision,
    ...(legacySheep
      ? { actorBehavior: "wander" as const }
      : actorBehavior === undefined
        ? {}
        : { actorBehavior }),
  };
}
