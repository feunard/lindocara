import type { PlayerActionDefinition } from "@lindocara/engine/combat-actions.js";
import { normalizeDirection } from "@lindocara/engine/directional-combat.js";
import {
  hasLineOfSight,
  isWalkable,
  MAX_MONSTER_BODY_RADIUS,
  maxHpForLevel,
  monsterBodyRadius,
  type TerrainGeometry,
} from "@lindocara/engine/game.js";
import type { PartyMaterialAmounts } from "@lindocara/engine/party-harvest-state.js";
import {
  type PeasantBombPlan as EnginePeasantBombPlan,
  type PeasantConstructionPlan,
  type PeasantRationPlan,
  resolvePeasantBombPlan,
  resolvePeasantConstructionPlan,
  resolvePeasantRationPlan,
} from "@lindocara/engine/peasant.js";
import { PEASANT_SUPPORT_SKILLS } from "@lindocara/engine/peasant-support.js";
import { PLAYER_SIZE, type Vec2 } from "@lindocara/engine/simulation.js";
import type { SkillDefinition, SkillSlot } from "@lindocara/engine/skills.js";
import { peasantTalentEffects } from "@lindocara/engine/talents.js";
import { startCombatAction } from "./combat-action-system.js";
import { canSpawnProjectile, projectileOrigin, spawnProjectile } from "./projectile-system.js";
import type { SpatialGrid } from "./spatial-grid.js";
import type {
  CombatActionRuntime,
  MonsterRuntime,
  PlayerRuntime,
  ProjectileRuntime,
} from "./world-runtime.js";

export const PEASANT_CAMP_SIZE = 24;
export const PEASANT_CAMP_PULSE_INTERVAL_MS = 2_000;
export const PEASANT_CAMP_PROTECTION_RATIO = 0.12;
export const PEASANT_BOMB_SPEED = 400;

export interface PeasantCampPlan {
  readonly kind: "camp";
  readonly cost: Readonly<PartyMaterialAmounts>;
  readonly placementDistance: number;
  readonly pulseIntervalMs: number;
  readonly construction: Readonly<PeasantConstructionPlan>;
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

export type PeasantSupportPlan = PeasantCampPlan | PeasantBombSupportPlan;

export interface PeasantSupportPlans {
  readonly camp: PeasantCampPlan;
  readonly bomb: PeasantBombSupportPlan;
}

/** Resolves and freezes the complete typed talent plan before material reservation begins. */
export function peasantSupportPlans(skills: {
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
      projectileRadius: 9,
      bomb,
    },
  };
}

export interface PeasantCampRuntime extends Vec2 {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerPartyId: string;
  readonly radius: number;
  readonly healPower: number;
  readonly protectionRatio: number;
  readonly slowRatio: number;
  readonly rationHealing: number;
  readonly rationRadius: number;
  readonly rationBuffDurationMs: number;
  readonly rationPowerBonusRatio: number;
  rationPortionsRemaining: number;
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

export interface PeasantSupportRequest {
  readonly id: string;
  readonly ownerId: string;
  readonly connectionId: string;
  readonly sessionEpoch: number;
  readonly roomKey: string;
  readonly partyId: string;
  readonly actorPosition: Vec2;
  readonly slot: 4 | 5;
  readonly skill: SkillDefinition;
  readonly definition: PlayerActionDefinition;
  readonly direction: Vec2;
  readonly plan: PeasantSupportPlan;
  readonly campPosition?: Vec2;
}

export interface PeasantSupportActionPlan {
  readonly ownerId: string;
  readonly plan: PeasantSupportPlan;
  readonly campPosition?: Vec2;
}

export interface PeasantSupportRuntime {
  readonly camps: PeasantCampRuntime[];
  readonly bombs: Map<string, PeasantBombRuntime>;
  readonly pendingByOwner: Map<string, PeasantSupportRequest>;
  readonly actions: Map<string, PeasantSupportActionPlan>;
}

export function createPeasantSupportRuntime(): PeasantSupportRuntime {
  return {
    camps: [],
    bombs: new Map(),
    pendingByOwner: new Map(),
    actions: new Map(),
  };
}

function centerOfPlayer(player: Vec2): Vec2 {
  return { x: player.x + PLAYER_SIZE / 2, y: player.y + PLAYER_SIZE / 2 };
}

function campTopLeft(center: Vec2): Vec2 {
  return { x: center.x - PEASANT_CAMP_SIZE / 2, y: center.y - PEASANT_CAMP_SIZE / 2 };
}

export function peasantCampPosition(
  player: PlayerRuntime,
  direction: Vec2,
  plan: PeasantCampPlan,
  terrain: TerrainGeometry,
): Vec2 | null {
  const facing = normalizeDirection(direction, player.facing);
  const origin = centerOfPlayer(player);
  const center = {
    x: origin.x + facing.x * Math.max(0, plan.placementDistance),
    y: origin.y + facing.y * Math.max(0, plan.placementDistance),
  };
  const topLeft = campTopLeft(center);
  if (!isWalkable(topLeft, PEASANT_CAMP_SIZE, terrain)) return null;
  if (!hasLineOfSight(origin, center, terrain.tiles, 0)) return null;
  return center;
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
  readonly terrain: TerrainGeometry;
  readonly projectiles: readonly ProjectileRuntime[];
  readonly now: number;
}): BeginPeasantSupportResult {
  const { runtime, player, slot, skill, definition, plan, now } = options;
  if (
    player.class !== "peasant" ||
    (slot !== 4 && slot !== 5) ||
    skill.slot !== slot ||
    (slot === 4) !== (plan.kind === "camp") ||
    skill.id !== (slot === 4 ? "makeshift_camp" : "homemade_bomb")
  )
    return { ok: false, reason: "invalid" };
  if (runtime.pendingByOwner.has(player.id) || (player.action?.recoveryEndsAt ?? 0) > now)
    return { ok: false, reason: "busy" };
  if ((player.skillCooldowns[slot - 1] ?? 0) > now) return { ok: false, reason: "cooldown" };
  if (plan.kind === "bomb" && !canSpawnProjectile(options.projectiles, player.id))
    return { ok: false, reason: "projectile_limit" };

  const direction = normalizeDirection(player.facing);
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
    actorPosition: { x: player.x, y: player.y },
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
  readonly terrain: TerrainGeometry;
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
    player.y !== request.actorPosition.y ||
    player.facing.x !== request.direction.x ||
    player.facing.y !== request.direction.y ||
    player.action !== null
  )
    return false;
  if (request.plan.kind === "bomb") return canSpawnProjectile(options.projectiles, player.id);
  const placement = peasantCampPosition(player, request.direction, request.plan, options.terrain);
  return (
    placement !== null &&
    request.campPosition !== undefined &&
    placement.x === request.campPosition.x &&
    placement.y === request.campPosition.y
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
  position: Vec2,
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
    radius: Math.max(1, plan.construction.radius),
    healPower: Math.max(0, Math.ceil(plan.construction.power / pulses)),
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
    rationServedIds: new Set(),
    startedAt: now,
    expiresAt: now + effectiveDurationMs,
    nextPulseAt: now,
    pulseIntervalMs: Math.max(250, plan.pulseIntervalMs),
  };
  runtime.camps.push(camp);
  return { camp, replaced };
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
      speed: Math.max(1, plan.projectileSpeed),
      radius: Math.max(1, plan.projectileRadius),
      pierce: 0,
    },
    range: Math.max(1, plan.range),
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
    radius: Math.max(1, plan.bomb.radius),
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
  return {
    kind: "bomb",
    projectile: spawnPeasantBomb(runtime, projectiles, owner, action, frozen.plan, roomKey, now),
  };
}

function playerCenterDistance(point: Vec2, player: Vec2): number {
  const center = centerOfPlayer(player);
  return Math.hypot(point.x - center.x, point.y - center.y);
}

function campSeesPlayer(camp: PeasantCampRuntime, player: PlayerRuntime, terrain: TerrainGeometry) {
  return hasLineOfSight(camp, centerOfPlayer(player), terrain.tiles, 0);
}

function campSeesMonster(
  camp: PeasantCampRuntime,
  monster: MonsterRuntime,
  terrain: TerrainGeometry,
) {
  return hasLineOfSight(camp, centerOfPlayer(monster), terrain.tiles, 0);
}

function rationTargets(
  camp: PeasantCampRuntime,
  owner: PlayerRuntime,
  players: readonly PlayerRuntime[],
  terrain: TerrainGeometry,
  areAllies: (owner: PlayerRuntime, target: PlayerRuntime) => boolean,
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
    if (camp.rationRadius <= 0) return target.id === owner.id;
    return (
      playerCenterDistance(camp, target) <= camp.rationRadius &&
      campSeesPlayer(camp, target, terrain)
    );
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
  readonly terrain: TerrainGeometry;
  readonly now: number;
  readonly isOwnerActive: (ownerId: string) => boolean;
  readonly areAllies: (owner: PlayerRuntime, target: PlayerRuntime) => boolean;
  readonly heal: (camp: PeasantCampRuntime, owner: PlayerRuntime, target: PlayerRuntime) => void;
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
    if (camp.nextPulseAt > options.now) continue;
    camp.nextPulseAt = options.now + camp.pulseIntervalMs;
    for (const target of players) {
      if (
        target.life !== "alive" ||
        !target.authorized ||
        !options.areAllies(owner, target) ||
        playerCenterDistance(camp, target) > camp.radius ||
        !campSeesPlayer(camp, target, options.terrain)
      )
        continue;
      options.heal(camp, owner, target);
    }
    for (const target of rationTargets(camp, owner, players, options.terrain, options.areAllies)) {
      camp.rationServedIds.add(target.id);
      camp.rationPortionsRemaining -= 1;
      options.serveRation(camp, owner, target);
    }
    if (camp.slowRatio > 0) {
      for (const monster of monsters) {
        if (
          monster.deadUntil > options.now ||
          playerCenterDistance(camp, monster) > camp.radius + monsterBodyRadius(monster.species) ||
          !campSeesMonster(camp, monster, options.terrain)
        )
          continue;
        options.slowMonster(camp, owner, monster);
      }
    }
  }
}

/** Strongest camp only; protection never stacks and never reduces a positive hit below one. */
export function damageAfterPeasantCampProtection(
  target: PlayerRuntime,
  rawDamage: number,
  camps: readonly PeasantCampRuntime[],
  terrain: TerrainGeometry,
  now: number,
): number {
  if (rawDamage <= 0) return 0;
  let reduction = 0;
  for (const camp of camps) {
    if (
      camp.expiresAt <= now ||
      target.partyId === null ||
      camp.ownerPartyId !== target.partyId ||
      playerCenterDistance(camp, target) > camp.radius ||
      !campSeesPlayer(camp, target, terrain)
    )
      continue;
    reduction = Math.max(reduction, camp.protectionRatio);
  }
  return Math.max(1, Math.ceil(Math.max(0, rawDamage) * (1 - Math.min(0.5, reduction))));
}

export interface PeasantBombExplosion {
  readonly actionId: string;
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly power: number;
}

export function resolvePeasantBombImpact(options: {
  readonly runtime: PeasantSupportRuntime;
  readonly projectile: ProjectileRuntime;
  readonly point: Vec2;
  readonly monsterGrid: SpatialGrid<MonsterRuntime>;
  readonly terrain: TerrainGeometry;
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
    .queryRadius(options.point, bomb.radius + MAX_MONSTER_BODY_RADIUS)
    .filter((monster) => monster.deadUntil <= options.now)
    .filter((monster) => {
      const center = centerOfPlayer(monster);
      return (
        Math.hypot(center.x - options.point.x, center.y - options.point.y) <=
          bomb.radius + monsterBodyRadius(monster.species) &&
        hasLineOfSight(options.point, center, options.terrain.tiles, 0)
      );
    })
    .sort((left, right) => {
      const leftCenter = centerOfPlayer(left);
      const rightCenter = centerOfPlayer(right);
      const leftDistance = Math.hypot(
        leftCenter.x - options.point.x,
        leftCenter.y - options.point.y,
      );
      const rightDistance = Math.hypot(
        rightCenter.x - options.point.x,
        rightCenter.y - options.point.y,
      );
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
    y: options.point.y,
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
