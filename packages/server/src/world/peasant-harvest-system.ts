import type { PartyAdventureState } from "@lindocara/engine/adventure-state.js";
import {
  circleIntersectsArc,
  frontalArc,
  segmentIntersectsRect,
} from "@lindocara/engine/directional-combat.js";
import { monsterBodyHitbox } from "@lindocara/engine/game.js";
import { type GroundVector, groundDistance } from "@lindocara/engine/ground.js";
import {
  animalCarcassHarvestProfile,
  HARVEST_PROFILE_LIMITS,
  type HarvestProfile,
  type HarvestTool,
  PEASANT_CARRY_DURATION_MS,
  type PeasantCarryKind,
} from "@lindocara/engine/harvest.js";
import type { ColliderIndex, ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import { isUuid } from "@lindocara/engine/identifiers.js";
import { harvestableEvents, type MapEvent } from "@lindocara/engine/map-events.js";
import {
  isHarvestNodeId,
  type PartyMaterialAmounts,
  refreshHarvestNode,
} from "@lindocara/engine/party-harvest-state.js";
import {
  mergePeasantMaterialRewards,
  type PeasantHarvestPlan,
  resolvePeasantHarvestPlan,
} from "@lindocara/engine/peasant.js";
import { isSheepAssetId } from "@lindocara/engine/sheep.js";
import type { SkillSlot } from "@lindocara/engine/skills.js";
import { peasantTalentEffects } from "@lindocara/engine/talents.js";
import { sweptGroundTerrainImpact, type ZoneTerrain } from "@lindocara/engine/terrain-access.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import type { ActiveWorldEvent, MonsterRuntime, PlayerRuntime } from "./world-runtime.js";

/**
 * **The authored-harvest boundary.** A map event's `harvest.collider` tuple, its cell foot and its
 * `HarvestProfile.range` are authored, stored and parsed in the pixel, top-left-origin space the
 * editor writes (`HARVEST_PROFILE_LIMITS` bounds them there, and narrowing those bounds would
 * refuse every stored map — the same call `MONSTER_TUNING_LIMITS` makes). The three helpers below
 * are therefore the SINGLE place this system crosses from that space into tile units, so the
 * crossing is countable rather than smeared across every call site.
 *
 * A pixel rectangle's top-left corner maps to the tile grid's TOP-LEFT ORIGIN, so the grid-centre
 * shift is `- size / 2` on both ground axes. A length carries no origin and only divides.
 */
function authoredRect(
  tuple: readonly [number, number, number, number],
  gridSize: number,
): ColliderRect {
  const half = gridSize / 2;
  return {
    x: tuple[0] / TILE_SIZE - half,
    z: tuple[1] / TILE_SIZE - half,
    w: tuple[2] / TILE_SIZE,
    h: tuple[3] / TILE_SIZE,
  };
}

/** The authored cell's foot, on the grid-centred ground plane. */
function authoredCellFoot(event: { col: number; row: number }, gridSize: number): GroundVector {
  const half = gridSize / 2;
  return { x: event.col + 0.5 - half, z: event.row + 1 - half };
}

/**
 * An authored node's own reach, in tile units.
 *
 * Without it `Math.min(skillRange, target.profile.range)` takes the minimum of a tile reach (~0.84)
 * and a pixel one (tens), so the skill reach always wins and a node authored deliberately short is
 * harvestable from the full swing — a live behaviour change, not a dormant one.
 */
function authoredReach(pixels: number): number {
  return pixels / TILE_SIZE;
}

export type HarvestTargetKind = "map_event" | "animal_carcass";

export interface PeasantHarvestTarget {
  kind: HarvestTargetKind;
  runtimeId: string;
  nodeId: string;
  generation: number;
  position: GroundVector;
  radius: number;
  /** Explicit gameplay footprint for authored nodes; animal bodies use their combat radius. */
  collider: ColliderRect | null;
  /** Absolute corpse deadline; map resources keep their authored relative respawn delay. */
  respawnAt: number | null;
  profile: HarvestProfile;
}

export interface PlannedPeasantHarvestTarget extends PeasantHarvestTarget {
  primary: boolean;
  plan: PeasantHarvestPlan;
}

export interface PeasantHarvestJobTarget {
  primary: boolean;
  targetKind: HarvestTargetKind;
  targetRuntimeId: string;
  nodeId: string;
  generation: number;
  plan: PeasantHarvestPlan;
}

export interface PeasantHarvestJob {
  id: string;
  heroId: string;
  connectionId: string;
  slot: SkillSlot;
  tool: HarvestTool;
  direction: GroundVector;
  areaCenter: GroundVector;
  areaRadius: number;
  targets: PeasantHarvestJobTarget[];
  startedAt: number;
  completesAt: number;
  committing: boolean;
}

export interface PeasantHarvestView {
  zoneId: string;
  events: readonly MapEvent[];
  activeEvents: readonly ActiveWorldEvent[];
  adventureState: PartyAdventureState;
  monsters: readonly MonsterRuntime[];
  terrain: ZoneTerrain;
  /** Prebuilt immutable map/element index; never rebuilt per harvest candidate. */
  staticColliderIndex: ColliderIndex;
}

export function cancelPeasantHarvestJob(
  jobs: Map<string, PeasantHarvestJob>,
  heroId: string,
): boolean {
  return jobs.delete(heroId);
}

export function canPeasantHarvest(player: PlayerRuntime, slot: SkillSlot): boolean {
  return player.class === "peasant" && slot === 1;
}

export interface RolledPeasantHarvestReward {
  goldValue: number;
  materialReward: PartyMaterialAmounts;
}

function randomInteger(minimum: number, maximum: number, random: () => number): number {
  const sample = random();
  const normalized = Number.isFinite(sample) ? Math.max(0, Math.min(0.999_999_999, sample)) : 0;
  return minimum + Math.floor(normalized * (maximum - minimum + 1));
}

/** Rolls only the base native range. Talent multipliers and bonus ore remain those of the frozen
 * authoritative plan, so reconnects and client messages can never influence the result. */
export function rollPeasantHarvestReward(
  profile: HarvestProfile,
  plan: PeasantHarvestPlan,
  random: () => number = Math.random,
): RolledPeasantHarvestReward {
  if (profile.resource === "gold") {
    const range = profile.goldValueRange ?? { min: profile.goldValue, max: profile.goldValue };
    const base = randomInteger(range.min, range.max, random);
    const multiplier = profile.goldValue > 0 ? plan.goldValue / profile.goldValue : 0;
    return {
      goldValue: Math.min(
        HARVEST_PROFILE_LIMITS.goldValue.max,
        Math.max(0, Math.ceil(base * multiplier)),
      ),
      materialReward: {},
    };
  }
  const range = profile.yieldRange ?? { min: profile.yieldAmount, max: profile.yieldAmount };
  const base = randomInteger(range.min, range.max, random);
  const multiplier = profile.yieldAmount > 0 ? plan.yieldAmount / profile.yieldAmount : 0;
  const amount = Math.min(
    HARVEST_PROFILE_LIMITS.yieldAmount.max,
    Math.max(0, Math.ceil(base * multiplier)),
  );
  const primary = amount > 0 ? ({ [profile.resource]: amount } as PartyMaterialAmounts) : {};
  return {
    goldValue: 0,
    materialReward: mergePeasantMaterialRewards(primary, plan.bonusMaterialReward),
  };
}

/** Explicit reward-to-sheet mapping. Gold wins over meat, then wood; unsupported ore has no fake. */
export function peasantCarryKindForReward(
  reward: Readonly<PartyMaterialAmounts>,
  goldValue: number,
): PeasantCarryKind | null {
  if (goldValue > 0) return "gold";
  if ((reward.meat ?? 0) > 0) return "meat";
  if ((reward.wood ?? 0) > 0) return "wood";
  return null;
}

export function grantPeasantCarry(
  player: PlayerRuntime,
  reward: Readonly<PartyMaterialAmounts>,
  goldValue: number,
  now: number,
): PeasantCarryKind | null {
  const kind = peasantCarryKindForReward(reward, goldValue);
  const until = now + PEASANT_CARRY_DURATION_MS;
  if (player.class !== "peasant" || !kind || !Number.isSafeInteger(until)) {
    player.peasantCarry = null;
    return null;
  }
  player.peasantCarry = { kind, until };
  return kind;
}

export function expirePeasantCarry(player: PlayerRuntime, now: number): boolean {
  if (!player.peasantCarry || player.peasantCarry.until > now) return false;
  player.peasantCarry = null;
  return true;
}

/** Stable, bounded identity for catalogue spawns that do not carry authored UUIDs. */
export function catalogueCarcassNodeId(zoneId: string, spawnId: string): string | null {
  const nodeId = `carcass:${zoneId}:${spawnId}`;
  return isHarvestNodeId(nodeId) ? nodeId : null;
}

function carcassNodeId(zoneId: string, monster: MonsterRuntime): string | null {
  if (monster.id.startsWith("mon-") && isUuid(monster.id.slice(4))) return monster.id.slice(4);
  return catalogueCarcassNodeId(zoneId, monster.id);
}

function effectiveGeneration(
  state: PartyAdventureState,
  nodeId: string,
  now: number,
): { generation: number; depleted: boolean } | null {
  const refreshed = refreshHarvestNode(state.harvestNodes ?? {}, nodeId, now);
  if (!refreshed) return null;
  return { generation: refreshed.node.generation, depleted: refreshed.node.depleted };
}

function mapTargets(view: PeasantHarvestView, now: number): PeasantHarvestTarget[] {
  const activeById = new Map(view.activeEvents.map((event) => [event.id, event]));
  return harvestableEvents(view.events).flatMap((event) => {
    const active = activeById.get(event.id);
    if (!active) return [];
    const node = effectiveGeneration(view.adventureState, event.id, now);
    if (!node || node.depleted) return [];
    const activeCollider = active.harvest?.collider;
    // An intact node can temporarily advertise no collider while a timed respawn waits for an
    // overlapping actor to leave. It must not be harvestable during that authoritative gap.
    if (
      active.harvest?.state !== "intact" ||
      active.harvest.generation !== node.generation ||
      !activeCollider
    ) {
      return [];
    }
    const collider = authoredRect(activeCollider, view.terrain.size);
    const foot = authoredCellFoot(active, view.terrain.size);
    return [
      {
        kind: "map_event" as const,
        runtimeId: event.id,
        nodeId: event.id,
        generation: node.generation,
        position: collider
          ? { x: collider.x + collider.w / 2, z: collider.z + collider.h / 2 }
          : foot,
        radius: collider ? Math.hypot(collider.w, collider.h) / 2 : 0.5,
        collider,
        respawnAt: null,
        profile: event.harvestProfile,
      },
    ];
  });
}

function carcassTargets(view: PeasantHarvestView, now: number): PeasantHarvestTarget[] {
  return view.monsters.flatMap((monster) => {
    if (monster.hp > 0 || monster.deadUntil <= now) return [];
    const profile = animalCarcassHarvestProfile(
      monster.species,
      monster.respawnMode,
      Math.max(0, monster.deadUntil - now),
    );
    if (!profile) return [];
    const nodeId = carcassNodeId(view.zoneId, monster);
    if (!nodeId) return [];
    const node = effectiveGeneration(view.adventureState, nodeId, now);
    if (!node || node.depleted) return [];
    const hitbox = monsterBodyHitbox(monster.species, monster);
    return [
      {
        kind: "animal_carcass" as const,
        runtimeId: monster.id,
        nodeId,
        generation: node.generation,
        position: hitbox.center,
        radius: hitbox.radius,
        collider: null,
        respawnAt: monster.respawnMode === "never" ? null : monster.deadUntil,
        profile,
      },
    ];
  });
}

/**
 * Collision-aware sight rebuilt from collider provenance. The target event id removes exactly one
 * dynamic footprint; a static or second event collider with identical geometry remains opaque.
 */
export function hasPeasantHarvestLineOfSight(
  from: GroundVector,
  target: PeasantHarvestTarget,
  view: PeasantHarvestView,
  /**
   * The harvester's own ground. Relief at or below it does not block sight; anything above it
   * does. Every caller inside this module passes `player.y` — the elevation the movement system
   * keeps under the body — never the ground under the TARGET, which would make the test
   * self-satisfying in exactly the way `resolveGroundMovement`'s docblock describes.
   *
   * Required, with no default: a `= 0` here is a silent invitation to forget it, and forgetting it
   * once already blocked a harvester's sight with the ground it was standing on.
   */
  groundY: number,
): boolean {
  if (
    sweptGroundTerrainImpact(
      { ...view.terrain, colliders: view.staticColliderIndex },
      from,
      target.position,
      0,
      groundY,
    ) !== null
  ) {
    return false;
  }
  return !view.activeEvents.some((event) => {
    if (target.kind === "map_event" && event.id === target.runtimeId) return false;
    const tuple = event.harvest?.collider;
    return tuple
      ? segmentIntersectsRect(from, target.position, authoredRect(tuple, view.terrain.size))
      : false;
  });
}

export function peasantHarvestTargets(
  view: PeasantHarvestView,
  now: number,
): PeasantHarvestTarget[] {
  return [...mapTargets(view, now), ...carcassTargets(view, now)];
}

/** Re-derives a clicked critter from live authored state. The client supplies only the event id it
 * raycasted; asset identity, generation, reach and sight all remain server-owned. */
export function sheepHarvestTargetForClick(input: {
  player: PlayerRuntime;
  eventId: string;
  view: PeasantHarvestView;
  now: number;
}): PeasantHarvestTarget | null {
  if (
    !input.player.authorized ||
    input.player.transitioning ||
    input.player.disconnecting ||
    input.player.life !== "alive"
  ) {
    return null;
  }
  const active = input.view.activeEvents.find((event) => event.id === input.eventId);
  if (!active || !isSheepAssetId(active.graphicAssetId)) return null;
  const target = mapTargets(input.view, input.now).find(
    (candidate) => candidate.runtimeId === input.eventId,
  );
  if (!target) return null;
  const playerGround = { x: input.player.x, z: input.player.z };
  if (
    groundDistance(playerGround, target.position) >
    authoredReach(target.profile.range) + target.radius
  ) {
    return null;
  }
  return hasPeasantHarvestLineOfSight(input.player, target, input.view, input.player.y)
    ? target
    : null;
}

function targetMatchesAction(
  player: PlayerRuntime,
  direction: GroundVector,
  skillRange: number,
  halfAngleRadians: number,
  target: PeasantHarvestTarget,
  view: PeasantHarvestView,
): boolean {
  // A tile-unit position IS the body's centre; the old `+ PLAYER_SIZE / 2` recentred a corner.
  const center = { x: player.x, z: player.z };
  // The narrower of the swing's reach and the node's own, both in tile units — see `authoredReach`.
  const range = Math.min(skillRange, authoredReach(target.profile.range));
  return (
    circleIntersectsArc(
      { center: target.position, radius: target.radius },
      frontalArc(center, direction, range, halfAngleRadians),
    ) && hasPeasantHarvestLineOfSight(center, target, view, player.y)
  );
}

export function selectPeasantHarvestTarget(input: {
  player: PlayerRuntime;
  slot: SkillSlot;
  /** Omitted while choosing the contextual tool; frozen for impact/revalidation. */
  tool?: HarvestTool;
  direction: GroundVector;
  skillRange: number;
  halfAngleRadians: number;
  view: PeasantHarvestView;
  now: number;
}): PeasantHarvestTarget | null {
  if (
    !canPeasantHarvest(input.player, input.slot) ||
    !input.player.authorized ||
    input.player.transitioning ||
    input.player.life !== "alive"
  ) {
    return null;
  }
  const candidates = peasantHarvestTargets(input.view, input.now)
    .filter((target) => input.tool === undefined || target.profile.tool === input.tool)
    .filter((target) =>
      targetMatchesAction(
        input.player,
        input.direction,
        input.skillRange,
        input.halfAngleRadians,
        target,
        input.view,
      ),
    )
    .sort((left, right) => {
      const leftDistance = groundDistance(left.position, input.player);
      const rightDistance = groundDistance(right.position, input.player);
      return leftDistance - rightDistance || left.nodeId.localeCompare(right.nodeId);
    });
  return candidates[0] ?? null;
}

/**
 * Resolve one accepted tool swing into a deterministic, bounded target list. The ordinary frontal
 * action chooses the primary node; an explicit area talent may then add compatible nodes around
 * that primary impact. Asset names never participate, and every candidate must remain visible
 * from the authoritative player position.
 */
export function selectPeasantHarvestTargets(input: {
  player: PlayerRuntime;
  slot: SkillSlot;
  direction: GroundVector;
  skillRange: number;
  halfAngleRadians: number;
  view: PeasantHarvestView;
  now: number;
}): PlannedPeasantHarvestTarget[] {
  const primary = selectPeasantHarvestTarget(input);
  if (!primary) return [];
  const tool = primary.profile.tool;
  // Every old tool branch now modifies the contextual base attack for its matching resource.
  const effects = peasantTalentEffects(input.player.talents);
  const primaryPlan = resolvePeasantHarvestPlan(primary.profile, effects);
  const plannedPrimary: PlannedPeasantHarvestTarget = {
    ...primary,
    primary: true,
    plan: primaryPlan,
  };
  if (primaryPlan.areaRadius <= 0 || primaryPlan.maximumTargets <= 1) return [plannedPrimary];

  const additional = peasantHarvestTargets(input.view, input.now)
    .filter(
      (target) =>
        target.nodeId !== primary.nodeId &&
        target.profile.tool === tool &&
        groundDistance(target.position, primary.position) <= primaryPlan.areaRadius &&
        hasPeasantHarvestLineOfSight(input.player, target, input.view, input.player.y),
    )
    .sort((left, right) => {
      const leftDistance = groundDistance(left.position, primary.position);
      const rightDistance = groundDistance(right.position, primary.position);
      return leftDistance - rightDistance || left.nodeId.localeCompare(right.nodeId);
    })
    .slice(0, primaryPlan.maximumTargets - 1)
    .map(
      (target): PlannedPeasantHarvestTarget => ({
        ...target,
        primary: false,
        plan: resolvePeasantHarvestPlan(target.profile, effects),
      }),
    );
  return [plannedPrimary, ...additional];
}

/** Revalidate one captured job target against live state without reselecting a different node. */
export function revalidatePeasantHarvestTarget(input: {
  player: PlayerRuntime;
  slot: SkillSlot;
  tool: HarvestTool;
  direction: GroundVector;
  skillRange: number;
  halfAngleRadians: number;
  areaCenter: GroundVector;
  areaRadius: number;
  target: PeasantHarvestJobTarget;
  view: PeasantHarvestView;
  now: number;
}): PeasantHarvestTarget | null {
  if (
    !canPeasantHarvest(input.player, input.slot) ||
    !input.player.authorized ||
    input.player.transitioning ||
    input.player.life !== "alive"
  ) {
    return null;
  }
  const target = peasantHarvestTargets(input.view, input.now).find(
    (candidate) =>
      candidate.kind === input.target.targetKind &&
      candidate.runtimeId === input.target.targetRuntimeId &&
      candidate.nodeId === input.target.nodeId &&
      candidate.generation === input.target.generation,
  );
  if (!target || target.profile.tool !== input.tool) return null;
  if (input.target.primary) {
    return targetMatchesAction(
      input.player,
      input.direction,
      input.skillRange,
      input.halfAngleRadians,
      target,
      input.view,
    )
      ? target
      : null;
  }
  return groundDistance(target.position, input.areaCenter) <= input.areaRadius &&
    hasPeasantHarvestLineOfSight(input.player, target, input.view, input.player.y)
    ? target
    : null;
}

export function createPeasantHarvestJob(input: {
  player: PlayerRuntime;
  connectionId: string;
  slot: SkillSlot;
  direction: GroundVector;
  target?: PeasantHarvestTarget;
  targets?: readonly PlannedPeasantHarvestTarget[];
  now: number;
}): PeasantHarvestJob | null {
  const effects = peasantTalentEffects(input.player.talents);
  const plannedTargets =
    input.targets ??
    (input.target
      ? [
          {
            ...input.target,
            primary: true,
            plan: resolvePeasantHarvestPlan(input.target.profile, effects),
          },
        ]
      : []);
  const primary = plannedTargets[0];
  if (
    !canPeasantHarvest(input.player, input.slot) ||
    !primary ||
    plannedTargets.length > primary.plan.maximumTargets
  )
    return null;
  const tool = primary.profile.tool;
  const completesAt =
    input.now + Math.max(...plannedTargets.map((target) => target.plan.harvestDurationMs));
  if (!Number.isSafeInteger(completesAt)) return null;
  return {
    id: crypto.randomUUID(),
    heroId: input.player.id,
    connectionId: input.connectionId,
    slot: input.slot,
    tool,
    direction: { x: input.direction.x, z: input.direction.z },
    areaCenter: { x: primary.position.x, z: primary.position.z },
    areaRadius: primary.plan.areaRadius,
    targets: plannedTargets.map((target) => ({
      primary: target.primary,
      targetKind: target.kind,
      targetRuntimeId: target.runtimeId,
      nodeId: target.nodeId,
      generation: target.generation,
      plan: {
        ...target.plan,
        primaryMaterialReward: { ...target.plan.primaryMaterialReward },
        bonusMaterialReward: { ...target.plan.bonusMaterialReward },
        materialReward: { ...target.plan.materialReward },
      },
    })),
    startedAt: input.now,
    completesAt,
    committing: false,
  };
}
