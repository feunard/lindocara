import type { PartyAdventureState } from "@lindocara/engine/adventure-state.js";
import { circleIntersectsArc, frontalArc } from "@lindocara/engine/directional-combat.js";
import { hasLineOfSight, monsterBodyRadius, type TerrainGeometry } from "@lindocara/engine/game.js";
import {
  animalCarcassHarvestProfile,
  type HarvestProfile,
  type HarvestTool,
  PEASANT_CARRY_DURATION_MS,
  type PeasantCarryKind,
} from "@lindocara/engine/harvest.js";
import { isUuid } from "@lindocara/engine/identifiers.js";
import { eventCellCentre, harvestableEvents, type MapEvent } from "@lindocara/engine/map-events.js";
import {
  isHarvestNodeId,
  type PartyMaterialAmounts,
  refreshHarvestNode,
} from "@lindocara/engine/party-harvest-state.js";
import { type PeasantHarvestPlan, resolvePeasantHarvestPlan } from "@lindocara/engine/peasant.js";
import { PLAYER_SIZE, type Vec2 } from "@lindocara/engine/simulation.js";
import type { SkillSlot } from "@lindocara/engine/skills.js";
import { peasantTalentEffects } from "@lindocara/engine/talents.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import type { ActiveWorldEvent, MonsterRuntime, PlayerRuntime } from "./world-runtime.js";

const PEASANT_TOOL_BY_SLOT: Readonly<Partial<Record<SkillSlot, HarvestTool>>> = {
  1: "axe",
  2: "pickaxe",
  3: "knife",
};

export type HarvestTargetKind = "map_event" | "animal_carcass";

export interface PeasantHarvestTarget {
  kind: HarvestTargetKind;
  runtimeId: string;
  nodeId: string;
  generation: number;
  position: Vec2;
  radius: number;
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
  direction: Vec2;
  areaCenter: Vec2;
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
  terrain: TerrainGeometry;
}

export function cancelPeasantHarvestJob(
  jobs: Map<string, PeasantHarvestJob>,
  heroId: string,
): boolean {
  return jobs.delete(heroId);
}

export function peasantHarvestTool(player: PlayerRuntime, slot: SkillSlot): HarvestTool | null {
  if (player.class !== "peasant") return null;
  return PEASANT_TOOL_BY_SLOT[slot] ?? null;
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
    return [
      {
        kind: "map_event" as const,
        runtimeId: event.id,
        nodeId: event.id,
        generation: node.generation,
        position: eventCellCentre(active),
        radius: TILE_SIZE / 2,
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
      monster.respawnDelayMs,
    );
    if (!profile) return [];
    const nodeId = carcassNodeId(view.zoneId, monster);
    if (!nodeId) return [];
    const node = effectiveGeneration(view.adventureState, nodeId, now);
    if (!node || node.depleted) return [];
    return [
      {
        kind: "animal_carcass" as const,
        runtimeId: monster.id,
        nodeId,
        generation: node.generation,
        position: { x: monster.x + PLAYER_SIZE / 2, y: monster.y + PLAYER_SIZE / 2 },
        radius: monsterBodyRadius(monster.species),
        profile,
      },
    ];
  });
}

export function peasantHarvestTargets(
  view: PeasantHarvestView,
  now: number,
): PeasantHarvestTarget[] {
  return [...mapTargets(view, now), ...carcassTargets(view, now)];
}

function targetMatchesAction(
  player: PlayerRuntime,
  direction: Vec2,
  tool: HarvestTool,
  skillRange: number,
  halfAngleRadians: number,
  target: PeasantHarvestTarget,
  terrain: TerrainGeometry,
): boolean {
  if (target.profile.tool !== tool) return false;
  const center = { x: player.x + PLAYER_SIZE / 2, y: player.y + PLAYER_SIZE / 2 };
  const range = Math.min(skillRange, target.profile.range);
  return (
    circleIntersectsArc(
      { center: target.position, radius: target.radius },
      frontalArc(center, direction, range, halfAngleRadians),
    ) && hasLineOfSight(center, target.position, terrain.tiles, 0)
  );
}

export function selectPeasantHarvestTarget(input: {
  player: PlayerRuntime;
  slot: SkillSlot;
  direction: Vec2;
  skillRange: number;
  halfAngleRadians: number;
  view: PeasantHarvestView;
  now: number;
}): PeasantHarvestTarget | null {
  const tool = peasantHarvestTool(input.player, input.slot);
  if (
    !tool ||
    !input.player.authorized ||
    input.player.transitioning ||
    input.player.life !== "alive"
  ) {
    return null;
  }
  const candidates = peasantHarvestTargets(input.view, input.now)
    .filter((target) =>
      targetMatchesAction(
        input.player,
        input.direction,
        tool,
        input.skillRange,
        input.halfAngleRadians,
        target,
        input.view.terrain,
      ),
    )
    .sort((left, right) => {
      const leftDistance = Math.hypot(
        left.position.x - input.player.x,
        left.position.y - input.player.y,
      );
      const rightDistance = Math.hypot(
        right.position.x - input.player.x,
        right.position.y - input.player.y,
      );
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
  direction: Vec2;
  skillRange: number;
  halfAngleRadians: number;
  view: PeasantHarvestView;
  now: number;
}): PlannedPeasantHarvestTarget[] {
  const primary = selectPeasantHarvestTarget(input);
  if (!primary) return [];
  const tool = peasantHarvestTool(input.player, input.slot);
  if (!tool) return [];
  const effects = peasantTalentEffects(input.player.talents, input.slot);
  const primaryPlan = resolvePeasantHarvestPlan(primary.profile, effects);
  const plannedPrimary: PlannedPeasantHarvestTarget = {
    ...primary,
    primary: true,
    plan: primaryPlan,
  };
  if (primaryPlan.areaRadius <= 0 || primaryPlan.maximumTargets <= 1) return [plannedPrimary];

  const playerCenter = {
    x: input.player.x + PLAYER_SIZE / 2,
    y: input.player.y + PLAYER_SIZE / 2,
  };
  const additional = peasantHarvestTargets(input.view, input.now)
    .filter(
      (target) =>
        target.nodeId !== primary.nodeId &&
        target.profile.tool === tool &&
        Math.hypot(
          target.position.x - primary.position.x,
          target.position.y - primary.position.y,
        ) <= primaryPlan.areaRadius &&
        hasLineOfSight(playerCenter, target.position, input.view.terrain.tiles, 0),
    )
    .sort((left, right) => {
      const leftDistance = Math.hypot(
        left.position.x - primary.position.x,
        left.position.y - primary.position.y,
      );
      const rightDistance = Math.hypot(
        right.position.x - primary.position.x,
        right.position.y - primary.position.y,
      );
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
  direction: Vec2;
  skillRange: number;
  halfAngleRadians: number;
  areaCenter: Vec2;
  areaRadius: number;
  target: PeasantHarvestJobTarget;
  view: PeasantHarvestView;
  now: number;
}): PeasantHarvestTarget | null {
  const tool = peasantHarvestTool(input.player, input.slot);
  if (
    !tool ||
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
  if (!target || target.profile.tool !== tool) return null;
  if (input.target.primary) {
    return targetMatchesAction(
      input.player,
      input.direction,
      tool,
      input.skillRange,
      input.halfAngleRadians,
      target,
      input.view.terrain,
    )
      ? target
      : null;
  }
  const playerCenter = {
    x: input.player.x + PLAYER_SIZE / 2,
    y: input.player.y + PLAYER_SIZE / 2,
  };
  return Math.hypot(
    target.position.x - input.areaCenter.x,
    target.position.y - input.areaCenter.y,
  ) <= input.areaRadius &&
    hasLineOfSight(playerCenter, target.position, input.view.terrain.tiles, 0)
    ? target
    : null;
}

export function createPeasantHarvestJob(input: {
  player: PlayerRuntime;
  connectionId: string;
  slot: SkillSlot;
  direction: Vec2;
  target?: PeasantHarvestTarget;
  targets?: readonly PlannedPeasantHarvestTarget[];
  now: number;
}): PeasantHarvestJob | null {
  const tool = peasantHarvestTool(input.player, input.slot);
  const effects = peasantTalentEffects(input.player.talents, input.slot);
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
  if (!tool || !primary || plannedTargets.length > primary.plan.maximumTargets) return null;
  const completesAt =
    input.now + Math.max(...plannedTargets.map((target) => target.plan.harvestDurationMs));
  if (!Number.isSafeInteger(completesAt)) return null;
  return {
    id: crypto.randomUUID(),
    heroId: input.player.id,
    connectionId: input.connectionId,
    slot: input.slot,
    tool,
    direction: { ...input.direction },
    areaCenter: { ...primary.position },
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
