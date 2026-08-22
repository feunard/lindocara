import type { PlayerActionDefinition } from "@lindocara/engine/combat-actions.js";
import { normalizeGround } from "@lindocara/engine/directional-combat.js";
import {
  INTERACTION_RANGE,
  MAX_MONSTER_BODY_REACH,
  maxHpForLevel,
  monsterBodyHitbox,
} from "@lindocara/engine/game.js";
import { type GroundVector, groundDistance, type WorldPosition } from "@lindocara/engine/ground.js";
import type { PartyMaterialAmounts } from "@lindocara/engine/party-harvest-state.js";
import {
  PEASANT_RATION_ARC_HEIGHT,
  PEASANT_RATION_DROP_COUNT,
  PEASANT_RATION_FADE_MS,
  PEASANT_RATION_FLIGHT_MS,
  PEASANT_RATION_GROUND_LIFETIME_MS,
  PEASANT_RATION_LAUNCH_RADIUS,
  PEASANT_SUPPORT_SKILLS,
} from "@lindocara/engine/peasant-support.js";
import {
  type PeasantBombPlan as EnginePeasantBombPlan,
  type PeasantConstructionPlan,
  type PeasantRationPlan,
  resolvePeasantBombPlan,
  resolvePeasantConstructionPlan,
  resolvePeasantRationPlan,
} from "@lindocara/engine/peasant.js";
import type { SkillDefinition, SkillSlot } from "@lindocara/engine/skills.js";
import { peasantTalentEffects } from "@lindocara/engine/talents.js";
import {
  BODY_RADIUS,
  canStand,
  groundLineOfSight,
  groundUnder,
  groundUnderBody,
  type ZoneTerrain,
} from "@lindocara/engine/terrain-access.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";

import { startCombatAction } from "./combat-action-system.js";
import {
  canSpawnProjectile,
  projectileOrigin,
  sameProjectileElevation,
  spawnProjectile,
} from "./projectile-system.js";
import type {
  CombatActionRuntime,
  GroundIndexQuery,
  MonsterRuntime,
  PlayerRuntime,
  ProjectileRuntime,
} from "./world-runtime.js";

export const PEASANT_CAMP_SIZE = 24 / TILE_SIZE;
export const PEASANT_CAMP_PULSE_INTERVAL_MS = 2_000;
export const PEASANT_CAMP_PROTECTION_RATIO = 0.12;
export const PEASANT_CAMP_MANA_RATIO = 0.6;
export const PEASANT_CAMP_GOLD_LIMIT = 999_999_999;
export const PEASANT_BOMB_SPEED = 520 / TILE_SIZE;
export const PEASANT_RATION_PICKUP_RADIUS = 22 / TILE_SIZE;
/** Lets the volley visibly clear the caster before an overlapping ally may catch it. */
export const PEASANT_RATION_CATCH_DELAY_MS = 350;
/** The ration may touch any point from the hero's feet to just above their upper body. */
export const PEASANT_RATION_CATCH_HEIGHT = 1.55;
export const PEASANT_RATION_CATCH_MARGIN = 0.2;

export interface PeasantCampPlan {
  readonly kind: "camp";
  readonly cost: Readonly<PartyMaterialAmounts>;
  readonly placementDistance: number;
  readonly pulseIntervalMs: number;
  readonly construction: Readonly<PeasantConstructionPlan>;
  readonly ration: Readonly<PeasantRationPlan>;
}

export interface PeasantRationSupportPlan {
  readonly kind: "ration";
  readonly cost: Readonly<PartyMaterialAmounts>;
  readonly count: number;
  readonly launchRadius: number;
  readonly flightMs: number;
  readonly groundLifetimeMs: number;
  readonly fadeMs: number;
  readonly ration: Readonly<PeasantRationPlan>;
}

export interface PeasantBombSupportPlan {
  readonly kind: "bomb";
  readonly cost: Readonly<PartyMaterialAmounts>;
  readonly range: number;
  readonly projectileSpeed: number;
  readonly projectileRadius: number;
  readonly bomb: Readonly<EnginePeasantBombPlan>;
}

export type PeasantSupportPlan =
  | PeasantRationSupportPlan
  | PeasantCampPlan
  | PeasantBombSupportPlan;

export interface PeasantSupportPlans {
  readonly ration: PeasantRationSupportPlan;
  readonly camp: PeasantCampPlan;
  readonly bomb: PeasantBombSupportPlan;
}

/** Resolves and freezes the complete typed talent plan before material reservation begins. */
export function peasantSupportPlans(skills: {
  readonly ration?: SkillDefinition;
  readonly camp: SkillDefinition;
  readonly bomb: SkillDefinition;
  readonly selectedTalents: readonly string[];
}): PeasantSupportPlans {
  const construction = resolvePeasantConstructionPlan(
    peasantTalentEffects(skills.selectedTalents, 4),
    {
      ...PEASANT_SUPPORT_SKILLS[4],
      power: skills.camp.power,
      radius: skills.camp.radius ?? PEASANT_SUPPORT_SKILLS[4].radius,
      durationMs: skills.camp.durationMs ?? PEASANT_SUPPORT_SKILLS[4].durationMs,
    },
  );
  const bomb = resolvePeasantBombPlan(peasantTalentEffects(skills.selectedTalents, 5), {
    ...PEASANT_SUPPORT_SKILLS[5],
    power: skills.bomb.power,
    radius: skills.bomb.radius ?? PEASANT_SUPPORT_SKILLS[5].radius,
    durationMs: skills.bomb.durationMs ?? PEASANT_SUPPORT_SKILLS[5].durationMs,
  });
  return {
    ration: {
      kind: "ration",
      cost: PEASANT_SUPPORT_SKILLS[3].cost,
      count: PEASANT_RATION_DROP_COUNT,
      launchRadius: PEASANT_RATION_LAUNCH_RADIUS,
      flightMs: PEASANT_RATION_FLIGHT_MS,
      groundLifetimeMs: PEASANT_RATION_GROUND_LIFETIME_MS,
      fadeMs: PEASANT_RATION_FADE_MS,
      ration: resolvePeasantRationPlan(peasantTalentEffects(skills.selectedTalents, 3)),
    },
    camp: {
      kind: "camp",
      cost: construction.cost,
      placementDistance: Math.max(0, skills.camp.range),
      pulseIntervalMs: PEASANT_CAMP_PULSE_INTERVAL_MS,
      construction,
      ration: resolvePeasantRationPlan(peasantTalentEffects(skills.selectedTalents, 3)),
    },
    bomb: {
      kind: "bomb",
      cost: bomb.cost,
      range: Math.max(0, skills.bomb.range),
      projectileSpeed: PEASANT_BOMB_SPEED,
      projectileRadius: 9 / TILE_SIZE,
      bomb,
    },
  };
}

export interface PeasantCampRuntime extends WorldPosition {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerPartyId: string;
  readonly radius: number;
  readonly healPower: number;
  readonly manaPower: number;
  readonly protectionRatio: number;
  readonly slowRatio: number;
  readonly rationHealing: number;
  readonly rationRadius: number;
  readonly rationBuffDurationMs: number;
  readonly rationPowerBonusRatio: number;
  rationPortionsRemaining: number;
  storedGold: number;
  readonly rationServedIds: Set<string>;
  readonly startedAt: number;
  readonly expiresAt: number;
  nextPulseAt: number;
  readonly pulseIntervalMs: number;
}

export interface PeasantBombRuntime {
  readonly projectileId: string;
  readonly actionId: string;
  readonly ownerId: string;
  readonly radius: number;
  readonly power: number;
  readonly fragments: number;
  readonly fragmentPower: number;
  readonly slowRatio: number;
  readonly slowDurationMs: number;
  readonly knockbackDistance: number;
}

export interface PeasantRationRuntime extends WorldPosition {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerPartyId: string;
  readonly originX: number;
  readonly originY: number;
  readonly originZ: number;
  readonly launchedAt: number;
  readonly landsAt: number;
  readonly fadeAt: number;
  readonly expiresAt: number;
  readonly powerBonusRatio: number;
  readonly buffDurationMs: number;
}

export interface PeasantSupportRequest {
  readonly id: string;
  readonly ownerId: string;
  readonly connectionId: string;
  readonly sessionEpoch: number;
  readonly roomKey: string;
  readonly partyId: string;
  readonly actorPosition: WorldPosition;
  readonly actorFacing: GroundVector;
  readonly slot: 3 | 4 | 5;
  readonly skill: SkillDefinition;
  readonly definition: PlayerActionDefinition;
  readonly direction: GroundVector;
  readonly plan: PeasantSupportPlan;
  readonly campPosition?: WorldPosition;
}

export interface PeasantSupportActionPlan {
  readonly ownerId: string;
  readonly plan: PeasantSupportPlan;
  readonly campPosition?: WorldPosition;
}

export interface PeasantSupportRuntime {
  readonly rations: PeasantRationRuntime[];
  readonly camps: PeasantCampRuntime[];
  readonly bombs: Map<string, PeasantBombRuntime>;
  readonly pendingByOwner: Map<string, PeasantSupportRequest>;
  readonly actions: Map<string, PeasantSupportActionPlan>;
}

export function createPeasantSupportRuntime(): PeasantSupportRuntime {
  return {
    rations: [],
    camps: [],
    bombs: new Map(),
    pendingByOwner: new Map(),
    actions: new Map(),
  };
}

/**
 * The camp's collision disc. `PEASANT_CAMP_SIZE` was a square SIDE in the pixel world and
 * `isWalkable` took it as a box; `canStand` answers for a disc, so half the side is the radius —
 * the same footprint, in the shape the heightfield collision speaks.
 */
const CAMP_RADIUS = PEASANT_CAMP_SIZE / 2;

/**
 * `centerOfPlayer` is gone: a tile-unit position IS the body's centre. Every site that used to add
 * `PLAYER_SIZE / 2` now reads the position directly, and adding it back would place a camp,
 * a sight line or a blast measurement half a body off.
 */
export function peasantCampPosition(
  player: PlayerRuntime,
  direction: GroundVector,
  plan: PeasantCampPlan,
  terrain: ZoneTerrain,
): WorldPosition | null {
  const facing = normalizeGround(direction, player.facing);
  const center = {
    x: player.x + facing.x * Math.max(0, plan.placementDistance),
    z: player.z + facing.z * Math.max(0, plan.placementDistance),
  };
  const groundY = groundUnderBody(terrain, player.x, player.z, player.y);
  if (!canStand(terrain, center.x, center.z, CAMP_RADIUS, groundY)) return null;
  if (!groundLineOfSight(terrain, player, center)) return null;
  return { x: center.x, y: groundUnder(terrain, center.x, center.z, groundY), z: center.z };
}

export type BeginPeasantSupportResult =
  | { readonly ok: true; readonly request: PeasantSupportRequest }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "busy" | "cooldown" | "blocked" | "projectile_limit";
    };

export function beginPeasantSupportRequest(options: {
  readonly runtime: PeasantSupportRuntime;
  readonly connectionId: string;
  readonly player: PlayerRuntime;
  readonly slot: SkillSlot;
  readonly skill: SkillDefinition;
  readonly definition: PlayerActionDefinition;
  readonly plan: PeasantSupportPlan;
  readonly terrain: ZoneTerrain;
  readonly projectiles: readonly ProjectileRuntime[];
  readonly now: number;
  readonly direction?: GroundVector;
}): BeginPeasantSupportResult {
  const { runtime, player, slot, skill, definition, plan, now } = options;
  if (
    player.class !== "peasant" ||
    (slot !== 3 && slot !== 4 && slot !== 5) ||
    skill.slot !== slot ||
    (slot === 3) !== (plan.kind === "ration") ||
    (slot === 4) !== (plan.kind === "camp") ||
    (slot === 5) !== (plan.kind === "bomb") ||
    skill.id !== (slot === 3 ? "butchers_cut" : slot === 4 ? "makeshift_camp" : "homemade_bomb")
  )
    return { ok: false, reason: "invalid" };
  if (runtime.pendingByOwner.has(player.id) || (player.action?.recoveryEndsAt ?? 0) > now)
    return { ok: false, reason: "busy" };
  if ((player.skillCooldowns[slot - 1] ?? 0) > now) return { ok: false, reason: "cooldown" };
  if (plan.kind === "bomb" && !canSpawnProjectile(options.projectiles, player.id))
    return { ok: false, reason: "projectile_limit" };

  const direction =
    plan.kind === "bomb" && options.direction
      ? normalizeGround(options.direction, player.facing)
      : normalizeGround(player.facing);
  const campPosition =
    plan.kind === "camp"
      ? peasantCampPosition(player, direction, plan, options.terrain)
      : undefined;
  if (plan.kind === "camp" && campPosition === null) return { ok: false, reason: "blocked" };

  const request: PeasantSupportRequest = {
    id: crypto.randomUUID(),
    ownerId: player.id,
    connectionId: options.connectionId,
    sessionEpoch: player.sessionEpoch,
    roomKey: player.roomKey,
    partyId: player.partyId ?? "",
    actorPosition: { x: player.x, y: player.y, z: player.z },
    actorFacing: { x: player.facing.x, z: player.facing.z },
    slot,
    skill,
    definition,
    direction,
    plan,
    ...(campPosition ? { campPosition } : {}),
  };
  runtime.pendingByOwner.set(player.id, request);
  return { ok: true, request };
}

export function isCurrentPeasantSupportRequest(
  runtime: PeasantSupportRuntime,
  request: PeasantSupportRequest,
): boolean {
  return runtime.pendingByOwner.get(request.ownerId)?.id === request.id;
}

/** Revalidation used after every coordinator await, before any irreversible local action. */
export function canActivatePeasantSupportRequest(options: {
  readonly runtime: PeasantSupportRuntime;
  readonly request: PeasantSupportRequest;
  readonly connectionId: string;
  readonly player: PlayerRuntime;
  readonly terrain: ZoneTerrain;
  readonly projectiles: readonly ProjectileRuntime[];
}): boolean {
  const { runtime, request, connectionId, player } = options;
  if (
    !isCurrentPeasantSupportRequest(runtime, request) ||
    request.connectionId !== connectionId ||
    player.connectionId !== connectionId ||
    player.id !== request.ownerId ||
    player.sessionEpoch !== request.sessionEpoch ||
    player.roomKey !== request.roomKey ||
    player.partyId !== request.partyId ||
    !player.authorized ||
    player.transitioning ||
    player.life !== "alive" ||
    player.x !== request.actorPosition.x ||
    player.z !== request.actorPosition.z ||
    player.facing.x !== request.actorFacing.x ||
    player.facing.z !== request.actorFacing.z ||
    player.action !== null
  )
    return false;
  if (request.plan.kind === "bomb") return canSpawnProjectile(options.projectiles, player.id);
  if (request.plan.kind === "ration") return true;
  const placement = peasantCampPosition(player, request.direction, request.plan, options.terrain);
  return (
    placement !== null &&
    request.campPosition !== undefined &&
    placement.x === request.campPosition.x &&
    placement.z === request.campPosition.z
  );
}

export function releasePeasantSupportRequest(
  runtime: PeasantSupportRuntime,
  request: PeasantSupportRequest,
): void {
  if (isCurrentPeasantSupportRequest(runtime, request))
    runtime.pendingByOwner.delete(request.ownerId);
}

/** Commits only room-local action state. Material reservation commit happens before this call. */
export function commitPeasantSupportRequest(
  runtime: PeasantSupportRuntime,
  request: PeasantSupportRequest,
  player: PlayerRuntime,
  now: number,
): CombatActionRuntime | null {
  if (!isCurrentPeasantSupportRequest(runtime, request) || player.id !== request.ownerId)
    return null;
  const action = startCombatAction(player, {
    kind: "skill",
    skillId: request.skill.id,
    slot: request.slot,
    direction: request.direction,
    now,
    anticipationMs: request.definition.anticipationMs,
    recoveryMs: request.definition.recoveryMs,
  });
  if (!action) return null;
  runtime.pendingByOwner.delete(request.ownerId);
  runtime.actions.set(action.id, {
    ownerId: request.ownerId,
    plan: request.plan,
    ...(request.campPosition ? { campPosition: request.campPosition } : {}),
  });
  player.skillCooldowns[request.slot - 1] = now + request.skill.cooldownMs;
  player.dirty = true;
  return action;
}

export interface PeasantCampPlacementResult {
  readonly camp: PeasantCampRuntime;
  readonly replaced: PeasantCampRuntime | null;
}

export function placePeasantCamp(
  runtime: PeasantSupportRuntime,
  owner: PlayerRuntime,
  actionId: string,
  position: WorldPosition,
  plan: PeasantCampPlan,
  now: number,
): PeasantCampPlacementResult | null {
  if (!owner.partyId) return null;
  const effectiveDurationMs = Math.max(
    1,
    Math.round(plan.construction.durationMs * plan.construction.durabilityMultiplier),
  );
  const pulses = Math.max(1, Math.ceil(effectiveDurationMs / plan.pulseIntervalMs));
  const replacedIndex = runtime.camps.findIndex((camp) => camp.ownerId === owner.id);
  const replaced = replacedIndex === -1 ? null : (runtime.camps[replacedIndex] ?? null);
  if (replacedIndex !== -1) runtime.camps.splice(replacedIndex, 1);
  const camp: PeasantCampRuntime = {
    id: actionId,
    ownerId: owner.id,
    ownerPartyId: owner.partyId,
    x: position.x,
    y: position.y,
    z: position.z,
    // The floor was 1 PIXEL — "a camp has some extent" — not one whole tile.
    radius: Math.max(1 / TILE_SIZE, plan.construction.radius),
    healPower: Math.max(0, Math.ceil(plan.construction.power / pulses)),
    manaPower: Math.max(0, Math.ceil((plan.construction.power * PEASANT_CAMP_MANA_RATIO) / pulses)),
    protectionRatio: Math.min(
      0.5,
      Math.max(0, PEASANT_CAMP_PROTECTION_RATIO + plan.construction.protectionRatio),
    ),
    slowRatio: Math.min(0.75, Math.max(0, plan.construction.slowRatio)),
    rationHealing: Math.max(0, Math.round(plan.ration.healing)),
    rationRadius: Math.max(0, plan.ration.radius),
    rationBuffDurationMs: Math.max(0, plan.ration.buffDurationMs),
    rationPowerBonusRatio: Math.max(0, plan.ration.powerBonusRatio),
    rationPortionsRemaining: Math.max(1, Math.floor(plan.ration.portions)),
    // Rebuilding an owner's unique camp moves its chest atomically instead of dropping currency
    // on the floor or requiring a refund race between the old removal and the new placement.
    storedGold: replaced?.storedGold ?? 0,
    rationServedIds: new Set(),
    startedAt: now,
    expiresAt: now + effectiveDurationMs,
    nextPulseAt: now,
    pulseIntervalMs: Math.max(250, plan.pulseIntervalMs),
  };
  runtime.camps.push(camp);
  return { camp, replaced };
}

function rationAngleSeed(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return ((hash >>> 0) / 0xffff_ffff) * Math.PI * 2;
}

function rationLanding(
  owner: PlayerRuntime,
  actionId: string,
  index: number,
  total: number,
  radius: number,
  terrain: ZoneTerrain,
): WorldPosition {
  const baseAngle = rationAngleSeed(actionId) + (index * Math.PI * 2) / Math.max(1, total);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    // Keep the three default landings inside the visible play area (roughly 3.6, 5 and 6.4 metres)
    // while respecting the authoritative 20 m cap. Wider rings made the outer ration leave the
    // camera before its short flight had visually established the three-piece volley.
    const preferredRing = 0.18 + (index % 3) * 0.07;
    const ring = Math.max(0.12, preferredRing - Math.floor(attempt / 4) * 0.08);
    const angle = baseAngle + (attempt % 4) * 0.41;
    const x = owner.x + Math.cos(angle) * radius * ring;
    const z = owner.z + Math.sin(angle) * radius * ring;
    const y = terrain.query.heightAt(x, z);
    if (y !== null) return { x, y, z };
  }
  const fallbackAngle = baseAngle + 0.27;
  const x = owner.x + Math.cos(fallbackAngle) * 0.6;
  const z = owner.z + Math.sin(fallbackAngle) * 0.6;
  return { x, y: terrain.query.heightAt(x, z) ?? owner.y, z };
}

export function launchPeasantRations(
  runtime: PeasantSupportRuntime,
  owner: PlayerRuntime,
  action: CombatActionRuntime,
  plan: PeasantRationSupportPlan,
  terrain: ZoneTerrain,
  now: number,
): PeasantRationRuntime[] {
  if (!owner.partyId) return [];
  const extraTalentPortions = Math.max(0, Math.floor(plan.ration.portions) - 1);
  const count = Math.max(1, Math.floor(plan.count) + extraTalentPortions);
  const created: PeasantRationRuntime[] = [];
  for (let index = 0; index < count; index += 1) {
    const landing = rationLanding(
      owner,
      action.id,
      index,
      count,
      Math.max(0, plan.launchRadius),
      terrain,
    );
    const ration: PeasantRationRuntime = {
      // Wire ids deliberately reject punctuation such as `:`. Keep this deterministic replay id
      // inside the protocol's `[A-Za-z0-9_-]` alphabet so the client does not discard the ration.
      id: `${action.id}-ration-${index}`,
      ownerId: owner.id,
      ownerPartyId: owner.partyId,
      originX: owner.x,
      originY: owner.y + 0.9,
      originZ: owner.z,
      ...landing,
      launchedAt: now,
      landsAt: now + Math.max(1, plan.flightMs),
      fadeAt: now + Math.max(1, plan.flightMs) + Math.max(0, plan.groundLifetimeMs),
      expiresAt:
        now +
        Math.max(1, plan.flightMs) +
        Math.max(0, plan.groundLifetimeMs) +
        Math.max(1, plan.fadeMs),
      powerBonusRatio: Math.max(0, plan.ration.powerBonusRatio),
      buffDurationMs: Math.max(0, plan.ration.buffDurationMs),
    };
    runtime.rations.push(ration);
    created.push(ration);
  }
  return created;
}

export function spawnPeasantBomb(
  runtime: PeasantSupportRuntime,
  projectiles: ProjectileRuntime[],
  owner: PlayerRuntime,
  action: CombatActionRuntime,
  plan: PeasantBombSupportPlan,
  roomKey: string,
  now: number,
): ProjectileRuntime | null {
  const projectile = spawnProjectile(projectiles, {
    actionId: action.id,
    owner,
    roomKey,
    origin: projectileOrigin(owner, action.direction, plan.projectileRadius),
    direction: action.direction,
    definition: {
      kind: "homemade_bomb",
      speed: Math.max(1 / TILE_SIZE, plan.projectileSpeed),
      radius: Math.max(1 / TILE_SIZE, plan.projectileRadius),
      pierce: 0,
    },
    range: Math.max(1 / TILE_SIZE, plan.range),
    power: 0,
    targetFilter: "monsters",
    sourceSkillId: "homemade_bomb",
    basic: false,
    now,
  });
  if (!projectile) return null;
  projectile.expiresAt = Math.min(
    projectile.expiresAt,
    now + Math.max(0, plan.bomb.fuseDurationMs),
  );
  runtime.bombs.set(projectile.id, {
    projectileId: projectile.id,
    actionId: action.id,
    ownerId: owner.id,
    radius: Math.max(1 / TILE_SIZE, plan.bomb.radius),
    power: Math.max(0, Math.round(plan.bomb.power)),
    fragments: Math.max(0, Math.floor(plan.bomb.fragments)),
    fragmentPower: Math.max(
      0,
      Math.round(plan.bomb.power * Math.max(0, plan.bomb.fragmentPowerRatio)),
    ),
    slowRatio: Math.min(0.75, Math.max(0, plan.bomb.slowRatio)),
    slowDurationMs: Math.max(0, plan.bomb.slowDurationMs),
    knockbackDistance: Math.max(0, plan.bomb.knockbackDistance),
  });
  return projectile;
}

export type ResolvePeasantSupportResult =
  | { readonly kind: "ration"; readonly rations: readonly PeasantRationRuntime[] }
  | { readonly kind: "camp"; readonly placement: PeasantCampPlacementResult | null }
  | { readonly kind: "bomb"; readonly projectile: ProjectileRuntime | null }
  | null;

export function resolvePeasantSupportAction(
  runtime: PeasantSupportRuntime,
  projectiles: ProjectileRuntime[],
  owner: PlayerRuntime,
  action: CombatActionRuntime,
  roomKey: string,
  now: number,
  terrain?: ZoneTerrain,
): ResolvePeasantSupportResult {
  const frozen = runtime.actions.get(action.id);
  if (!frozen || frozen.ownerId !== owner.id) return null;
  runtime.actions.delete(action.id);
  if (frozen.plan.kind === "camp") {
    const position = frozen.campPosition;
    return {
      kind: "camp",
      placement: position
        ? placePeasantCamp(runtime, owner, action.id, position, frozen.plan, now)
        : null,
    };
  }
  if (frozen.plan.kind === "ration") {
    return {
      kind: "ration",
      rations: terrain
        ? launchPeasantRations(runtime, owner, action, frozen.plan, terrain, now)
        : [],
    };
  }
  return {
    kind: "bomb",
    projectile: spawnPeasantBomb(runtime, projectiles, owner, action, frozen.plan, roomKey, now),
  };
}

function playerCenterDistance(point: GroundVector, player: GroundVector): number {
  return groundDistance(point, player);
}

export function nearbyAlliedPeasantCamp(
  runtime: PeasantSupportRuntime,
  player: PlayerRuntime,
  _terrain: ZoneTerrain,
  now: number,
): PeasantCampRuntime | null {
  if (!player.partyId || player.life !== "alive" || !player.authorized) return null;
  return (
    runtime.camps
      .filter(
        (camp) =>
          camp.expiresAt > now &&
          camp.ownerPartyId === player.partyId &&
          playerCenterDistance(camp, player) <= INTERACTION_RANGE,
      )
      .sort(
        (left, right) =>
          playerCenterDistance(left, player) - playerCenterDistance(right, player) ||
          left.id.localeCompare(right.id),
      )[0] ?? null
  );
}

export type PeasantCampGoldOperation = "deposit" | "withdraw";
export type PeasantCampGoldResult =
  | { readonly ok: true; readonly camp: PeasantCampRuntime }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "unavailable" | "insufficient" | "capacity";
    };

/** Authoritative chest transfer. The client supplies intent and an amount, never a resulting sum. */
export function transferPeasantCampGold(options: {
  readonly runtime: PeasantSupportRuntime;
  readonly player: PlayerRuntime;
  readonly terrain: ZoneTerrain;
  readonly campId: string;
  readonly operation: PeasantCampGoldOperation;
  readonly amount: number;
  readonly now: number;
}): PeasantCampGoldResult {
  if (!Number.isSafeInteger(options.amount) || options.amount < 1 || options.amount > 1_000_000)
    return { ok: false, reason: "invalid" };
  const camp = nearbyAlliedPeasantCamp(
    options.runtime,
    options.player,
    options.terrain,
    options.now,
  );
  if (!camp || camp.id !== options.campId) return { ok: false, reason: "unavailable" };

  if (options.operation === "deposit") {
    if (options.player.inventory.gold < options.amount)
      return { ok: false, reason: "insufficient" };
    if (camp.storedGold + options.amount > PEASANT_CAMP_GOLD_LIMIT)
      return { ok: false, reason: "capacity" };
    options.player.inventory.gold -= options.amount;
    camp.storedGold += options.amount;
  } else {
    if (camp.storedGold < options.amount) return { ok: false, reason: "insufficient" };
    if (options.player.inventory.gold + options.amount > Number.MAX_SAFE_INTEGER)
      return { ok: false, reason: "capacity" };
    camp.storedGold -= options.amount;
    options.player.inventory.gold += options.amount;
  }
  options.player.dirty = true;
  return { ok: true, camp };
}

/** Camps are room-local; every removal returns their balance to the owner before persistence. */
export function refundPeasantCampGold(camp: PeasantCampRuntime, owner: PlayerRuntime): number {
  const refunded = Math.min(
    camp.storedGold,
    Math.max(0, Number.MAX_SAFE_INTEGER - owner.inventory.gold),
  );
  owner.inventory.gold += refunded;
  camp.storedGold -= refunded;
  if (refunded > 0) owner.dirty = true;
  return refunded;
}

function campSeesMonster(camp: PeasantCampRuntime, monster: MonsterRuntime, terrain: ZoneTerrain) {
  return groundLineOfSight(terrain, camp, monster);
}

function rationTargets(
  camp: PeasantCampRuntime,
  owner: PlayerRuntime,
  players: readonly PlayerRuntime[],
  _terrain: ZoneTerrain,
  areAllies: (owner: PlayerRuntime, target: PlayerRuntime) => boolean,
  now: number,
): PlayerRuntime[] {
  if (camp.rationPortionsRemaining <= 0) return [];
  const candidates = players.filter((target) => {
    if (
      target.life !== "alive" ||
      !target.authorized ||
      camp.rationServedIds.has(target.id) ||
      !areAllies(owner, target)
    )
      return false;
    const healingUseful = camp.rationHealing > 0 && target.hp < maxHpForLevel(target.level);
    const currentPowerBonus =
      target.rallyPowerUntil > now ? Math.max(0, target.rallyPowerMultiplier) : 0;
    const buffUseful =
      camp.rationBuffDurationMs > 0 && camp.rationPowerBonusRatio > currentPowerBonus;
    if (!healingUseful && !buffUseful) return false;

    // A radius of zero means an owner-only ration, not an infinite-range delivery. The owner must
    // still be standing inside the camp when the portion is actually served.
    if (camp.rationRadius <= 0 && target.id !== owner.id) return false;
    const effectiveRadius = camp.rationRadius > 0 ? camp.rationRadius : camp.radius;
    return playerCenterDistance(camp, target) <= effectiveRadius;
  });
  return candidates
    .sort((left, right) => {
      const leftRatio = left.hp / Math.max(1, maxHpForLevel(left.level));
      const rightRatio = right.hp / Math.max(1, maxHpForLevel(right.level));
      return leftRatio - rightRatio || left.id.localeCompare(right.id);
    })
    .slice(0, camp.rationPortionsRemaining);
}

export function advancePeasantCamps(options: {
  readonly runtime: PeasantSupportRuntime;
  readonly players: Iterable<PlayerRuntime>;
  readonly monsters: Iterable<MonsterRuntime>;
  readonly terrain: ZoneTerrain;
  readonly now: number;
  readonly isOwnerActive: (ownerId: string) => boolean;
  readonly areAllies: (owner: PlayerRuntime, target: PlayerRuntime) => boolean;
  readonly markHealingZone?: (
    camp: PeasantCampRuntime,
    owner: PlayerRuntime,
    target: PlayerRuntime,
  ) => void;
  readonly heal: (camp: PeasantCampRuntime, owner: PlayerRuntime, target: PlayerRuntime) => void;
  readonly restoreResource: (
    camp: PeasantCampRuntime,
    owner: PlayerRuntime,
    target: PlayerRuntime,
  ) => void;
  readonly serveRation: (
    camp: PeasantCampRuntime,
    owner: PlayerRuntime,
    target: PlayerRuntime,
  ) => void;
  readonly slowMonster: (
    camp: PeasantCampRuntime,
    owner: PlayerRuntime,
    monster: MonsterRuntime,
  ) => void;
  readonly removed?: (camp: PeasantCampRuntime) => void;
}): void {
  const players = [...options.players];
  const monsters = [...options.monsters];
  for (let index = options.runtime.camps.length - 1; index >= 0; index--) {
    const camp = options.runtime.camps[index];
    if (!camp) continue;
    const owner = players.find((candidate) => candidate.id === camp.ownerId);
    if (!owner || !options.isOwnerActive(camp.ownerId) || camp.expiresAt <= options.now) {
      options.runtime.camps.splice(index, 1);
      options.removed?.(camp);
      continue;
    }
    const healingTargets = players.filter(
      (target) =>
        !(
          target.life !== "alive" ||
          !target.authorized ||
          !options.areAllies(owner, target) ||
          playerCenterDistance(camp, target) > camp.radius
        ),
    );
    for (const target of healingTargets) options.markHealingZone?.(camp, owner, target);
    if (camp.nextPulseAt > options.now) continue;
    camp.nextPulseAt = options.now + camp.pulseIntervalMs;
    for (const target of healingTargets) {
      options.heal(camp, owner, target);
      options.restoreResource(camp, owner, target);
    }
    for (const target of rationTargets(
      camp,
      owner,
      players,
      options.terrain,
      options.areAllies,
      options.now,
    )) {
      camp.rationServedIds.add(target.id);
      camp.rationPortionsRemaining -= 1;
      options.serveRation(camp, owner, target);
    }
    if (camp.slowRatio > 0) {
      for (const monster of monsters) {
        const hitbox = monsterBodyHitbox(monster.species, monster);
        if (
          monster.deadUntil > options.now ||
          groundDistance(hitbox.center, camp) > camp.radius + hitbox.radius ||
          !campSeesMonster(camp, monster, options.terrain)
        )
          continue;
        options.slowMonster(camp, owner, monster);
      }
    }
  }
}

export function advancePeasantRations(options: {
  readonly runtime: PeasantSupportRuntime;
  readonly players: Iterable<PlayerRuntime>;
  readonly now: number;
  readonly consumed: (ration: PeasantRationRuntime, target: PlayerRuntime) => void;
  readonly removed: (ration: PeasantRationRuntime) => void;
}): void {
  const players = [...options.players];
  for (let index = options.runtime.rations.length - 1; index >= 0; index -= 1) {
    const ration = options.runtime.rations[index];
    if (!ration) continue;
    if (ration.expiresAt <= options.now) {
      options.runtime.rations.splice(index, 1);
      options.removed(ration);
      continue;
    }
    if (options.now < ration.launchedAt + PEASANT_RATION_CATCH_DELAY_MS) continue;
    const position = peasantRationPositionAt(ration, options.now);
    const target = players.find(
      (candidate) =>
        candidate.authorized &&
        candidate.life === "alive" &&
        candidate.partyId === ration.ownerPartyId &&
        // The volley originates inside the caster's body. The caster may collect their own ration
        // once it lands, but only allies intercept it in flight; otherwise ordinary server ticks
        // vacuum all three pieces back into an idle caster before the launch is readable.
        (candidate.id !== ration.ownerId || options.now >= ration.landsAt) &&
        groundDistance(candidate, position) <= BODY_RADIUS + PEASANT_RATION_PICKUP_RADIUS &&
        position.y >= candidate.y - PEASANT_RATION_CATCH_MARGIN &&
        position.y <= candidate.y + PEASANT_RATION_CATCH_HEIGHT + PEASANT_RATION_CATCH_MARGIN,
    );
    if (!target) continue;
    options.runtime.rations.splice(index, 1);
    options.consumed(ration, target);
    options.removed(ration);
  }
}

/** The shared authoritative catapult curve used for in-flight collection checks. */
export function peasantRationPositionAt(ration: PeasantRationRuntime, now: number): WorldPosition {
  const duration = Math.max(1, ration.landsAt - ration.launchedAt);
  const progress = Math.max(0, Math.min(1, (now - ration.launchedAt) / duration));
  return {
    x: ration.originX + (ration.x - ration.originX) * progress,
    y:
      ration.originY +
      (ration.y - ration.originY) * progress +
      Math.sin(progress * Math.PI) * PEASANT_RATION_ARC_HEIGHT,
    z: ration.originZ + (ration.z - ration.originZ) * progress,
  };
}

/** Strongest camp only; protection never stacks and never reduces a positive hit below one. */
export function damageAfterPeasantCampProtection(
  target: PlayerRuntime,
  rawDamage: number,
  camps: readonly PeasantCampRuntime[],
  _terrain: ZoneTerrain,
  now: number,
): number {
  if (rawDamage <= 0) return 0;
  let reduction = 0;
  for (const camp of camps) {
    if (
      camp.expiresAt <= now ||
      target.partyId === null ||
      camp.ownerPartyId !== target.partyId ||
      playerCenterDistance(camp, target) > camp.radius
    )
      continue;
    reduction = Math.max(reduction, camp.protectionRatio);
  }
  return Math.max(1, Math.ceil(Math.max(0, rawDamage) * (1 - Math.min(0.5, reduction))));
}

export interface PeasantBombExplosion extends WorldPosition {
  readonly actionId: string;
  readonly ownerId: string;
  readonly radius: number;
  readonly power: number;
}

export function resolvePeasantBombImpact(options: {
  readonly runtime: PeasantSupportRuntime;
  readonly projectile: ProjectileRuntime;
  /** Where the fuse ran out, on the GROUND plane; the blast's elevation is the bomb's own. */
  readonly point: GroundVector;
  readonly monsterGrid: GroundIndexQuery<MonsterRuntime>;
  readonly terrain: ZoneTerrain;
  readonly now: number;
  readonly damage: (
    monster: MonsterRuntime,
    power: number,
  ) => { readonly killed: boolean } | undefined;
  readonly control?: (
    monster: MonsterRuntime,
    effect: Pick<PeasantBombRuntime, "slowRatio" | "slowDurationMs" | "knockbackDistance">,
  ) => void;
}): PeasantBombExplosion | null {
  const bomb = options.runtime.bombs.get(options.projectile.id);
  if (!bomb || bomb.actionId !== options.projectile.actionId) return null;
  options.runtime.bombs.delete(options.projectile.id);
  const candidates = options.monsterGrid
    .queryRadius(options.point, bomb.radius + MAX_MONSTER_BODY_REACH)
    .filter((monster) => monster.deadUntil <= options.now)
    .filter((monster) => {
      const hitbox = monsterBodyHitbox(monster.species, monster);
      return (
        sameProjectileElevation(options.projectile.y, monster.y, options.terrain.levelHeight) &&
        groundDistance(hitbox.center, options.point) <= bomb.radius + hitbox.radius &&
        groundLineOfSight(options.terrain, options.point, monster)
      );
    })
    .sort((left, right) => {
      const leftCenter = monsterBodyHitbox(left.species, left).center;
      const rightCenter = monsterBodyHitbox(right.species, right).center;
      const leftDistance = groundDistance(leftCenter, options.point);
      const rightDistance = groundDistance(rightCenter, options.point);
      return leftDistance - rightDistance || left.id.localeCompare(right.id);
    });
  const fragmentTargetIds = new Set(
    candidates.slice(0, bomb.fragments).map((monster) => monster.id),
  );
  for (const monster of candidates) {
    const fragmentPower = fragmentTargetIds.has(monster.id) ? bomb.fragmentPower : 0;
    const result = options.damage(monster, bomb.power + fragmentPower);
    if (result !== undefined && !result.killed) options.control?.(monster, bomb);
  }
  return {
    actionId: bomb.actionId,
    ownerId: bomb.ownerId,
    x: options.point.x,
    y: options.projectile.y,
    z: options.point.z,
    radius: bomb.radius,
    power: bomb.power,
  };
}

export function isPeasantBombProjectile(
  runtime: PeasantSupportRuntime,
  projectile: ProjectileRuntime,
): boolean {
  return runtime.bombs.has(projectile.id);
}

export function removePeasantSupportByOwner(
  runtime: PeasantSupportRuntime,
  ownerId: string,
): PeasantCampRuntime[] {
  runtime.pendingByOwner.delete(ownerId);
  for (const [actionId, action] of runtime.actions) {
    if (action.ownerId === ownerId) runtime.actions.delete(actionId);
  }
  for (const [projectileId, bomb] of runtime.bombs) {
    if (bomb.ownerId === ownerId) runtime.bombs.delete(projectileId);
  }
  const removed = runtime.camps.filter((camp) => camp.ownerId === ownerId);
  for (let index = runtime.camps.length - 1; index >= 0; index--) {
    if (runtime.camps[index]?.ownerId === ownerId) runtime.camps.splice(index, 1);
  }
  return removed;
}
