import { actionForClassSlot, LUMEN_STEP_MAX_HOLD_MS } from "@lindocara/engine/combat-actions.js";
import { tauntThreat } from "@lindocara/engine/cooperation.js";
import {
  canAct,
  canBeResurrected,
  RESURRECT_COOLDOWN_MS,
  resurrectHp,
} from "@lindocara/engine/death.js";
import {
  circleIntersectsArc,
  firstSegmentImpact,
  frontalArc,
  normalizeGround,
  sweptProjectileEntityImpact,
} from "@lindocara/engine/directional-combat.js";
import {
  INTERACTION_RANGE,
  MAX_MONSTER_BODY_REACH,
  MONSTER_AGGRO_RANGE,
  maxHpForLevel,
  monsterBodyHitbox,
  monsterBodyRadius,
} from "@lindocara/engine/game.js";
import { type GroundVector, groundDistance, withinGroundRange } from "@lindocara/engine/ground.js";
import { isMapSkillEnabled, mapHeroClassSettings } from "@lindocara/engine/map-hero-settings.js";
import type { PartyMaterialAmounts } from "@lindocara/engine/party-harvest-state.js";
import {
  mergePeasantMaterialRewards,
  resolvePeasantHarvestPlan,
  resolvePeasantRallyPlan,
} from "@lindocara/engine/peasant.js";
import type { RogueShadowDanceSequence, ServerMessage } from "@lindocara/engine/protocol.js";
import { canSpendResource, skillResourceCost, spendResource } from "@lindocara/engine/resources.js";
import { ROGUE_BALANCE, roguePoisonTickPower } from "@lindocara/engine/rogue.js";
import {
  CLASS_SKILLS,
  isSkillUnlocked,
  SKILL_UNLOCK_LEVEL,
  type SkillDefinition,
  type SkillSlot,
} from "@lindocara/engine/skills.js";
import {
  evolvedTalent,
  peasantTalentEffects,
  type TalentEffect,
  talentEffect,
  talentEffects,
} from "@lindocara/engine/talents.js";
import {
  BODY_RADIUS,
  canStand,
  groundLineOfSight,
  groundUnder,
  resolveGroundMovement,
  sweptGroundTerrainImpact,
} from "@lindocara/engine/terrain-access.js";
import { buildingAtImpact, buildingIntersectsArc } from "../../world/building-system.js";
import {
  cancelCombatAction,
  finishHeldCombatAction,
  startCombatAction,
} from "../../world/combat-action-system.js";
import { applyDamageOverTime } from "../../world/damage-over-time-system.js";
import { applyMonsterSlow, pushMonsterAwayFrom } from "../../world/monster-system.js";
import {
  createPeasantHarvestJob,
  grantPeasantCarry,
  type PeasantHarvestJob,
  type PeasantHarvestJobTarget,
  revalidatePeasantHarvestTarget,
  rollPeasantHarvestReward,
  selectPeasantHarvestTarget,
  selectPeasantHarvestTargets,
  sheepHarvestTargetForClick,
} from "../../world/peasant-harvest-system.js";
import {
  beginPeasantSupportRequest,
  commitPeasantSupportRequest,
  type PeasantSupportRequest,
  peasantSupportPlans,
  releasePeasantSupportRequest,
  resolvePeasantSupportAction,
} from "../../world/peasant-support-system.js";
import {
  appendLumenTrailPoint,
  cleanseNegativeEffect,
  finishLumenTrail,
  lumenTrailTouches,
  luminousTransfigurationPower,
  nearestMercyCorpse,
  novaJudgmentDamageMultiplier,
  novaSpecializationMultipliers,
  type PolarityOrbRuntime,
  type SanctuaryRuntime,
  startLumenPortal,
  startLumenTrail,
  startPolarityOrb,
  startSanctuary,
} from "../../world/priest-variant-system.js";
import {
  nearestProjectileMonster,
  projectileOrigin,
  spawnProjectile,
} from "../../world/projectile-system.js";
import {
  advanceAdditionalVolleys,
  retreatShotDirections,
  scheduleAdditionalVolleys,
  windstepCanInterrupt,
} from "../../world/ranger-variant-system.js";
import {
  planShadowDance,
  type ShadowDanceStrikePlan,
} from "../../world/rogue-shadow-dance-system.js";
import {
  hasRogueLineOfSight,
  isShadowStepLandingValid,
  isShadowStepPathClear,
  planShadowReturn,
  planShadowStep,
} from "../../world/rogue-skill-system.js";
import {
  applyRogueSmokeProtection,
  armRoguePredatorShiv,
  consumeRoguePredatorShivMultiplier,
  enterRogueStealth,
  exitRogueStealth,
  expireRogueShadowReturn,
  expireRogueStealth,
  grantRogueOpening,
  isRogueStealthed,
  reduceRogueShadowDanceCooldown,
  rogueOpeningBonusRatio,
  rupturePoisonWithShiv,
} from "../../world/rogue-state-system.js";
import { nearestChargeTarget } from "../../world/skill-system.js";
import {
  applyBoundedPowerBuff,
  applyKingsChallenge,
  applyRallyingCry,
  applySeismicImpact,
  applyWarBanner,
  colossusChargeImpacts,
  consumeCounterOffensive,
  cycloneImpactTimes,
  cycloneRecoveryMs,
  startWarriorCyclone,
  startWarriorVortex,
} from "../../world/warrior-variant-system.js";
import {
  type CombatActionRuntime,
  displacePlayer,
  type MonsterRuntime,
  type PlayerRuntime,
} from "../../world/world-runtime.js";
import {
  damageMonster,
  healPlayer,
  monsterHitboxWithin,
  movePlayer,
  safeLumenLanding,
  tauntMonster,
} from "./world-combat.ts";
import type { WorldGlue } from "./world-glue.ts";
import {
  areCombatAllies,
  BODY_DIAMETER,
  buildingDamagePower,
  configuredAttackDamage,
  configuredSkill,
  connectionOf,
  damageBuildingsWithin,
  damageBuildingTarget,
  IMPACT_BACKOFF,
  MINIMUM_PORTAL_SPAN,
  playerById,
  zone,
} from "./world-glue.ts";
import { forgetPlayer, freeze, grantReviveGrace } from "./world-move-life.ts";
import {
  peasantRationMessage,
  sendPeasantRationEvent,
  sendRoomEvent,
  sendSpatialEvent,
  sendSpatialEventAcross,
  sendStateTo,
} from "./world-send.ts";
import type { WorldRoomState } from "./worldState.ts";

/** Port of `#finishHeldPlayerAction` (`world.ts:1982`) — the `skill.release` intent. */
export function finishHeldPlayerAction(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  now: number,
  slot?: number,
): boolean {
  const action = player.action;
  if (!finishHeldCombatAction(player, now, slot)) return false;
  if (action?.skillId === "blink") {
    const terrain = zone(w.state).terrain;
    const landing = safeLumenLanding(w, player, player, now);
    if (landing && (landing.x !== player.x || landing.z !== player.z)) {
      const previous = { x: player.x, z: player.z };
      // The GROUND pair is `x`/`z`; `y` is the elevation the terrain reports under the landing.
      displacePlayer(player, landing);
      w.state.playerGrid.update(player, previous);
    }
    const renewal = talentEffect(player.class, player.talents, "blink_heal", 3);
    if (renewal) {
      healPlayer(
        w,
        connectionId,
        player,
        connectionId,
        player,
        renewal.value + Math.max(0, player.level - 1),
        action.skillId,
        now,
        true,
      );
    }
    const transfiguration = talentEffect(
      player.class,
      player.talents,
      "luminous_transfiguration",
      3,
    );
    if (transfiguration) {
      const power = luminousTransfigurationPower(player.level, transfiguration);
      for (const [targetConnectionId, target] of w.state.players) {
        if (
          target === player ||
          target.life !== "alive" ||
          !areCombatAllies(player, target) ||
          groundDistance(player, target) > transfiguration.radius ||
          !groundLineOfSight(terrain, player, target)
        )
          continue;
        healPlayer(
          w,
          connectionId,
          player,
          targetConnectionId,
          target,
          power,
          action.skillId,
          now,
          false,
        );
      }
    }
    const lumenGate = talentEffect(player.class, player.talents, "lumen_gate", 3);
    const lumenOrigin = action.priestLumenOrigin;
    const lumenTrail = action.priestLumenTrailId
      ? w.state.lumenTrails.find((trail) => trail.id === action.priestLumenTrailId)
      : undefined;
    if (lumenTrail) {
      appendLumenTrailPoint(lumenTrail, { x: player.x, z: player.z });
      const sacredPassage = talentEffect(player.class, player.talents, "sacred_passage", 3);
      finishLumenTrail(lumenTrail, now, sacredPassage?.durationMs ?? 6_000);
      if (lumenTrail.points.length >= 2) {
        const message: ServerMessage = {
          t: "priest.lumen_trail",
          id: lumenTrail.id,
          actorId: player.id,
          points: lumenTrail.points.map((point) => ({ x: point.x, z: point.z })),
          width: lumenTrail.width,
          startedAt: lumenTrail.startedAt,
          endsAt: lumenTrail.expiresAt,
        };
        for (const [recipientConnectionId, recipient] of w.state.players) {
          if (recipient.authorized) w.deps.send(recipientConnectionId, message);
        }
      }
    }
    if (
      lumenGate &&
      lumenOrigin &&
      // "The priest actually moved": one PIXEL in the old world, so a tile-unit `> 1` would have
      // silently demanded a whole 64 px tile of travel before a gate could open.
      groundDistance(lumenOrigin, player) > MINIMUM_PORTAL_SPAN &&
      // Each endpoint is grounded on ITS own level — the origin on the elevation it was remembered
      // at, the priest on the ground under them now. Neither is a step, so neither may climb.
      canStand(terrain, lumenOrigin.x, lumenOrigin.z, BODY_RADIUS, lumenOrigin.y) &&
      canStand(
        terrain,
        player.x,
        player.z,
        BODY_RADIUS,
        groundUnder(terrain, player.x, player.z, player.y),
      )
    ) {
      const sacredPassage = talentEffect(player.class, player.talents, "sacred_passage", 3);
      const portal = startLumenPortal(w.state.lumenPortals, {
        ownerId: player.id,
        from: lumenOrigin,
        to: { x: player.x, y: player.y, z: player.z },
        effect: lumenGate,
        now,
        transfiguration: Boolean(transfiguration),
        healingPower: sacredPassage
          ? sacredPassage.power + Math.max(0, player.level - 1) * sacredPassage.powerPerLevel
          : 0,
      });
      const message: ServerMessage = {
        t: "priest.lumen_portal",
        id: portal.id,
        actorId: player.id,
        from: portal.from,
        to: portal.to,
        startedAt: portal.startedAt,
        endsAt: portal.expiresAt,
      };
      for (const [recipientConnectionId, recipient] of w.state.players) {
        if (recipient.authorized) w.deps.send(recipientConnectionId, message);
      }
    }
  }
  if (action?.skillId === "heartseeker") {
    const target = action.rangerSwornPreyTargetId
      ? w.state.monsters.find(
          (monster) => monster.id === action.rangerSwornPreyTargetId && monster.deadUntil <= now,
        )
      : undefined;
    if (target && groundLineOfSight(zone(w.state).terrain, player, target)) {
      action.direction = normalizeGround(
        { x: target.x - player.x, z: target.z - player.z },
        action.direction,
      );
    }
    if (action.resolved) {
      const skill = configuredSkill(w, player, 5);
      spawnPlayerProjectiles(
        w,
        player,
        action,
        skill,
        actionForClassSlot(player.class, 5),
        "monsters",
        now,
      );
    }
  }
  sendStateTo(w, connectionId, player);
  return true;
}

export function preparePeasantSupportRequest(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  slot: SkillSlot,
): PeasantSupportRequest | null {
  if (player.class !== "peasant" || (slot !== 3 && slot !== 4 && slot !== 5)) return null;
  const skill = configuredSkill(w, player, slot);
  if (!isSkillUnlocked(player.level, slot)) {
    w.deps.send(connectionId, {
      t: "event",
      code: "skill.locked",
      params: { level: SKILL_UNLOCK_LEVEL[slot], skill: skill.id },
      tone: "info",
    });
    return null;
  }
  if (!isMapSkillEnabled(zone(w.state).heroSettings, player.class, slot)) {
    w.deps.send(connectionId, {
      t: "event",
      code: "skill.disabled",
      params: { skill: skill.id },
      tone: "info",
    });
    return null;
  }
  if (!canAct(player.life) || !player.authorized || player.transitioning || !player.partyId)
    return null;
  const plans = peasantSupportPlans({
    ration: configuredSkill(w, player, 3),
    camp: configuredSkill(w, player, 4),
    bomb: configuredSkill(w, player, 5),
    selectedTalents: player.talents,
  });
  const now = w.deps.now();
  const terrain = zone(w.state).terrain;
  const bombTarget =
    slot === 5
      ? nearestProjectileMonster(
          player,
          w.state.monsters,
          plans.bomb.range,
          now,
          terrain.levelHeight,
        )
      : null;
  const bombDirection = bombTarget
    ? normalizeGround({ x: bombTarget.x - player.x, z: bombTarget.z - player.z }, player.facing)
    : normalizeGround(player.facing);
  const result = beginPeasantSupportRequest({
    runtime: w.state.peasantSupport,
    connectionId,
    player,
    slot,
    skill,
    definition: actionForClassSlot(player.class, slot),
    plan: slot === 3 ? plans.ration : slot === 4 ? plans.camp : plans.bomb,
    terrain,
    projectiles: w.state.projectiles,
    now,
    ...(slot === 5 ? { direction: bombDirection } : {}),
  });
  if (result.ok) return result.request;
  if (result.reason === "blocked" || result.reason === "projectile_limit") {
    w.deps.send(connectionId, {
      t: "event",
      code: "skill.blocked",
      params: { skill: skill.id },
      tone: "info",
      x: player.x,
      z: player.z,
    });
  }
  return null;
}

/** Material commit has completed; this synchronous boundary is the point of no refund. */
export function activatePeasantSupportRequest(
  w: WorldGlue,
  player: PlayerRuntime,
  request: PeasantSupportRequest,
): boolean {
  const now = w.deps.now();
  const action = commitPeasantSupportRequest(w.state.peasantSupport, request, player, now);
  if (!action) return false;
  sendStateTo(w, request.connectionId, player);
  w.deps.send(request.connectionId, {
    t: "event",
    code: "skill.cast",
    params: { skill: request.skill.id, slot: request.slot },
    tone: "good",
    x: player.x,
    z: player.z,
  });
  sendSpatialEvent(
    w,
    {
      t: "animation",
      actionId: action.id,
      actorKind: "player",
      actorId: player.id,
      action: "skill",
      skillId: request.skill.id,
      ...(talentEffects(player.class, player.talents, request.slot).length > 0
        ? { talented: true as const }
        : {}),
      ...(evolvedTalent(player.class, player.talents, request.slot)
        ? { evolved: true as const }
        : {}),
      direction: { x: action.direction.x, z: action.direction.z },
      startedAt: action.startedAt,
      impactAt: action.impactAt,
      recoveryEndsAt: action.recoveryEndsAt,
    },
    player,
  );
  return true;
}

export function cancelPeasantSupportRequest(
  state: WorldRoomState,
  request: PeasantSupportRequest,
): void {
  releasePeasantSupportRequest(state.peasantSupport, request);
}

/** Port of `#startPlayerAction` (`world.ts:2012`). Returns whether an action actually started —
 *  the caller checkpoints cooldowns onto the presence lease exactly then. */
export function startPlayerAction(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  slot: SkillSlot,
): boolean {
  const { deps } = w;
  const skill = configuredSkill(w, player, slot);
  if (!isSkillUnlocked(player.level, slot)) {
    deps.send(connectionId, {
      t: "event",
      code: "skill.locked",
      params: { level: SKILL_UNLOCK_LEVEL[slot], skill: skill.id },
      tone: "info",
    });
    return false;
  }
  if (!isMapSkillEnabled(zone(w.state).heroSettings, player.class, slot)) {
    deps.send(connectionId, {
      t: "event",
      code: "skill.disabled",
      params: { skill: skill.id },
      tone: "info",
    });
    return false;
  }
  const now = deps.now();
  if (!canAct(player.life)) return false;
  // Harvest duration is an authoritative channel, not part of the animation cooldown. Reusing a
  // ready-looking tool (or another skill) must not replace the pending reward; movement remains
  // the explicit way to cancel a channel.
  if (w.state.harvestJobs.has(player.id)) return false;
  if (expireRogueStealth(player, now)) sendStateTo(w, connectionId, player);
  if (expireRogueShadowReturn(player, now)) sendStateTo(w, connectionId, player);
  const shadowReturn =
    skill.id === "shadow_step"
      ? talentEffect(player.class, player.talents, "rogue_shadow_return", 2)
      : undefined;
  if (shadowReturn && player.rogueShadowReturn) {
    const planning = planShadowReturn(player.rogueShadowReturn, now, zone(w.state).terrain);
    if (!planning.ok) {
      if (planning.reason === "expired") {
        player.rogueShadowReturn = null;
        sendStateTo(w, connectionId, player);
      } else {
        deps.send(connectionId, {
          t: "event",
          code: "skill.blocked",
          params: { skill: skill.id },
          tone: "info",
          x: player.x,
          z: player.z,
        });
      }
      return false;
    }
    const origin = { x: player.x, y: player.y, z: player.z };
    const predator = talentEffect(player.class, player.talents, "rogue_predator", 3);
    const stealthExited = exitRogueStealth(player, now, {
      offensive: true,
      openingBonusRatio: rogueOpeningBonusRatio(player, 3, predator?.openingBonusRatio),
    });
    if (stealthExited && predator) armRoguePredatorShiv(player, now, predator);
    cancelCombatAction(player);
    displacePlayer(player, planning.destination);
    player.rogueShadowReturn = null;
    w.state.playerGrid.update(player, origin);
    sendStateTo(w, connectionId, player);
    deps.send(connectionId, {
      t: "event",
      code: "skill.cast",
      params: { skill: skill.id, slot },
      tone: "good",
      x: player.x,
      z: player.z,
    });
    sendSpatialEvent(
      w,
      {
        t: "animation",
        actionId: crypto.randomUUID(),
        actorKind: "player",
        actorId: player.id,
        action: "skill",
        skillId: skill.id,
        talented: true,
        evolved: true,
        direction: normalizeGround(
          { x: planning.destination.x - origin.x, z: planning.destination.z - origin.z },
          player.facing,
        ),
        startedAt: now,
        impactAt: now,
        recoveryEndsAt: now + 180,
      },
      player,
    );
    return true;
  }
  const inexorable =
    skill.id === "shield_bash"
      ? talentEffect(player.class, player.talents, "inexorable_breakthrough", 3)
      : undefined;
  if (player.warriorChargeFollowup && player.warriorChargeFollowup.expiresAt <= now)
    player.warriorChargeFollowup = null;
  const chargeFollowup = inexorable ? player.warriorChargeFollowup : null;
  const followupTarget = chargeFollowup
    ? nearestChargeTarget(
        player,
        w.state.monsterGrid
          .queryRadius(player, skill.range + BODY_DIAMETER + MAX_MONSTER_BODY_REACH)
          .filter((monster) => monster.id !== chargeFollowup.excludedTargetId),
        skill.range,
        now,
        (monster) => groundLineOfSight(zone(w.state).terrain, player, monster),
      )
    : null;
  if (chargeFollowup && !followupTarget) {
    deps.send(connectionId, {
      t: "event",
      code: "skill.no_target",
      params: { skill: skill.id },
      tone: "info",
    });
    return false;
  }
  const afterimage =
    skill.id === "dash" ? talentEffect(player.class, player.talents, "afterimage", 4) : undefined;
  if (player.rangerAfterimage && player.rangerAfterimage.expiresAt <= now)
    player.rangerAfterimage = null;
  if (afterimage && player.rangerAfterimage) {
    const terrain = zone(w.state).terrain;
    const destination = player.rangerAfterimage;
    // The afterimage remembers the elevation the ranger left, and the swap back is validated
    // against it: a remembered coordinate is never trusted as a landing, and it may not become a
    // free climb onto ground the ranger could not have walked onto.
    if (!canStand(terrain, destination.x, destination.z, BODY_RADIUS, destination.y)) {
      deps.send(connectionId, {
        t: "event",
        code: "skill.blocked",
        params: { skill: skill.id },
        tone: "info",
        x: destination.x,
        z: destination.z,
      });
      return false;
    }
    const origin = { x: player.x, y: player.y, z: player.z };
    cancelCombatAction(player);
    displacePlayer(player, {
      x: destination.x,
      y: groundUnder(terrain, destination.x, destination.z, destination.y),
      z: destination.z,
    });
    player.rangerAfterimage = null;
    w.state.playerGrid.update(player, origin);
    const swapDirection = normalizeGround(
      { x: destination.x - origin.x, z: destination.z - origin.z },
      player.facing,
    );
    const swapAction: CombatActionRuntime = {
      id: crypto.randomUUID(),
      kind: "skill",
      skillId: skill.id,
      slot,
      direction: swapDirection,
      startedAt: now,
      impactAt: now,
      recoveryEndsAt: now + 180,
      resolved: true,
    };
    if (talentEffect(player.class, player.talents, "dash_invulnerability", 4))
      player.action = swapAction;
    const retreatShot = talentEffect(player.class, player.talents, "retreat_shot", 4);
    if (retreatShot) spawnRetreatShot(w, player, swapAction, skill, retreatShot, now);
    sendStateTo(w, connectionId, player);
    sendSpatialEvent(
      w,
      {
        t: "animation",
        actionId: swapAction.id,
        actorKind: "player",
        actorId: player.id,
        action: "skill",
        skillId: skill.id,
        talented: true,
        evolved: true,
        direction: { x: swapDirection.x, z: swapDirection.z },
        startedAt: now,
        impactAt: now,
        recoveryEndsAt: now + 180,
      },
      player,
    );
    return true;
  }
  const danceMaster =
    skill.id === "shadow_dance"
      ? talentEffect(player.class, player.talents, "rogue_dance_master", 5)
      : undefined;
  player.rogueDanceMarks = player.rogueDanceMarks.filter((mark) => mark.expiresAt > now);
  const availableDanceMarks = player.rogueDanceMarks.filter((mark) => mark.availableAt <= now);
  if (danceMaster && availableDanceMarks.length > 0) {
    const markedIds = new Set(availableDanceMarks.map((mark) => mark.targetId));
    const candidates = w.state.monsters
      .filter(
        (monster) =>
          markedIds.has(monster.id) &&
          monster.deadUntil <= now &&
          hasRogueLineOfSight(
            player,
            monster,
            zone(w.state).terrain,
            groundUnder(zone(w.state).terrain, player.x, player.z, player.y),
          ),
      )
      .sort((left, right) => {
        const leftDirection = normalizeGround(
          { x: left.x - player.x, z: left.z - player.z },
          player.facing,
        );
        const rightDirection = normalizeGround(
          { x: right.x - player.x, z: right.z - player.z },
          player.facing,
        );
        const leftAlignment = leftDirection.x * player.facing.x + leftDirection.z * player.facing.z;
        const rightAlignment =
          rightDirection.x * player.facing.x + rightDirection.z * player.facing.z;
        return (
          rightAlignment - leftAlignment ||
          groundDistance(player, left) - groundDistance(player, right) ||
          left.id.localeCompare(right.id)
        );
      });
    const destination = candidates
      .map((target) =>
        planShadowDance(player, [target], skill.range, 1, now, zone(w.state).terrain, (monster) =>
          monsterBodyRadius(monster.species),
        ),
      )
      .find((result) => result.ok)?.plan.strikes[0]?.landing;
    if (!destination) {
      deps.send(connectionId, {
        t: "event",
        code: "skill.no_target",
        params: { skill: skill.id },
        tone: "info",
      });
      return false;
    }
    const origin = { x: player.x, y: player.y, z: player.z };
    cancelCombatAction(player);
    displacePlayer(player, destination);
    player.rogueDanceMarks = [];
    w.state.playerGrid.update(player, origin);
    sendStateTo(w, connectionId, player);
    sendSpatialEvent(
      w,
      {
        t: "animation",
        actionId: crypto.randomUUID(),
        actorKind: "player",
        actorId: player.id,
        action: "skill",
        skillId: skill.id,
        talented: true,
        evolved: true,
        direction: normalizeGround(
          { x: destination.x - origin.x, z: destination.z - origin.z },
          player.facing,
        ),
        startedAt: now,
        impactAt: now,
        recoveryEndsAt: now + 180,
      },
      player,
    );
    return true;
  }
  if (skill.id === "vanish" && isRogueStealthed(player, now)) return false;
  if (player.guarding) {
    if (skill.id !== "iron_guard") return false;
    cancelCombatAction(player);
    releaseCounterOffensive(w, connectionId, player, skill, now);
    player.guarding = false;
    player.guardActivatedAt = 0;
    player.skillCooldowns[slot - 1] = now + skill.cooldownMs;
    player.dirty = true;
    sendStateTo(w, connectionId, player);
    return true;
  }
  const resourceCost = skillResourceCost(player.class, slot);
  if (!chargeFollowup && !canSpendResource(player.resource, resourceCost)) {
    deps.send(connectionId, { t: "event", code: "resource.insufficient", tone: "info" });
    return false;
  }
  if (slot === 1 && now - player.lastAttackAt < skill.cooldownMs) return false;
  if (skill.id === "mend" && now - player.lastHealAt < skill.cooldownMs) return false;
  if (!chargeFollowup && slot !== 1 && (player.skillCooldowns[slot - 1] ?? 0) > now) return false;
  const definition = actionForClassSlot(player.class, slot);
  const projectileTarget =
    definition.shape === "projectile" || definition.shape === "volley"
      ? nearestProjectileMonster(
          player,
          w.state.monsters,
          skill.range,
          now,
          zone(w.state).terrain.levelHeight,
        )
      : null;
  const shadowStepPhase =
    definition.shape === "shadow_step" &&
    talentEffect(player.class, player.talents, "rogue_shadow_phase", 2) !== undefined;
  const shadowStep =
    definition.shape === "shadow_step"
      ? planShadowStep(
          player,
          w.state.monsterGrid.queryRadius(
            player,
            skill.range + BODY_DIAMETER + MAX_MONSTER_BODY_REACH,
          ),
          skill.range,
          now,
          zone(w.state).terrain,
          (monster) => monsterBodyRadius(monster.species),
          { phaseThroughObstacles: shadowStepPhase },
        )
      : null;
  if (shadowStep && !shadowStep.ok) {
    deps.send(connectionId, {
      t: "event",
      code: shadowStep.reason === "blocked" ? "skill.blocked" : "skill.no_target",
      params: { skill: skill.id },
      tone: "info",
      x: player.x,
      z: player.z,
    });
    return false;
  }
  const shadowDance =
    definition.shape === "shadow_dance"
      ? planShadowDance(
          player,
          w.state.monsters,
          skill.range,
          ROGUE_BALANCE.shadowDance.maximumHits,
          now,
          zone(w.state).terrain,
          (monster) => monsterBodyRadius(monster.species),
          {
            repeatPrimary: Boolean(
              talentEffect(player.class, player.talents, "rogue_thousand_cuts", 5),
            ),
          },
        )
      : null;
  if (shadowDance && !shadowDance.ok) {
    deps.send(connectionId, {
      t: "event",
      code: shadowDance.reason === "blocked" ? "skill.blocked" : "skill.no_target",
      params: { skill: skill.id },
      tone: "info",
      x: player.x,
      z: player.z,
    });
    return false;
  }
  const chargeTarget =
    followupTarget ??
    (definition.shape === "charge"
      ? nearestChargeTarget(
          player,
          w.state.monsterGrid.queryRadius(
            player,
            skill.range + BODY_DIAMETER + MAX_MONSTER_BODY_REACH,
          ),
          skill.range,
          now,
          (monster) => groundLineOfSight(zone(w.state).terrain, player, monster),
        )
      : null);
  const swornPrey =
    skill.id === "heartseeker"
      ? talentEffect(player.class, player.talents, "sworn_prey", slot)
      : undefined;
  const swornTarget = swornPrey ? projectileTarget : null;
  const peasantHarvestTarget =
    player.class === "peasant" && slot === 1
      ? selectPeasantHarvestTarget({
          player,
          slot,
          direction: player.facing,
          skillRange: skill.range,
          // Basic attack means “the resource I am touching”, independent of the previous facing.
          halfAngleRadians: Math.PI,
          view: {
            zoneId: w.state.location?.zoneId ?? zone(w.state).id,
            events: zone(w.state).events ?? [],
            activeEvents: w.state.activeEvents,
            adventureState: w.state.adventureState.state,
            monsters: w.state.monsters,
            terrain: zone(w.state).terrain,
            staticColliderIndex: w.state.staticColliderIndex,
          },
          now,
        })
      : null;
  const shadowDanceTarget =
    shadowDance?.ok === true ? shadowDance.plan.strikes[0]?.targetPosition : undefined;
  const direction =
    shadowStep?.ok === true
      ? normalizeGround(
          {
            x: shadowStep.plan.targetPosition.x - player.x,
            z: shadowStep.plan.targetPosition.z - player.z,
          },
          player.facing,
        )
      : shadowDanceTarget
        ? normalizeGround(
            { x: shadowDanceTarget.x - player.x, z: shadowDanceTarget.z - player.z },
            player.facing,
          )
        : projectileTarget
          ? normalizeGround(
              { x: projectileTarget.x - player.x, z: projectileTarget.z - player.z },
              player.facing,
            )
          : chargeTarget
            ? normalizeGround(
                { x: chargeTarget.x - player.x, z: chargeTarget.z - player.z },
                player.facing,
              )
            : peasantHarvestTarget
              ? normalizeGround(
                  {
                    x: peasantHarvestTarget.position.x - player.x,
                    z: peasantHarvestTarget.position.z - player.z,
                  },
                  player.facing,
                )
              : player.facing;
  const cyclone =
    definition.shape === "area_damage"
      ? talentEffect(player.class, player.talents, "cyclone", slot)
      : undefined;
  const windstep =
    definition.shape === "dash"
      ? talentEffect(player.class, player.talents, "windstep", slot)
      : undefined;
  if (windstep && windstepCanInterrupt(player.action, now)) cancelCombatAction(player);
  if (chargeFollowup) cancelCombatAction(player);
  const action = startCombatAction(player, {
    kind: slot === 1 ? "basic" : "skill",
    skillId: skill.id,
    slot,
    direction,
    now,
    anticipationMs: definition.anticipationMs,
    recoveryMs: cyclone ? cycloneRecoveryMs(cyclone, definition.recoveryMs) : definition.recoveryMs,
    ...(definition.shape === "teleport"
      ? {
          mobilityDistance: skill.distance ?? 0,
          channelDurationMs: LUMEN_STEP_MAX_HOLD_MS,
        }
      : swornPrey
        ? { channelDurationMs: swornPrey.maximumHoldMs }
        : {}),
  });
  if (!action) return false;
  if (peasantHarvestTarget) action.peasantTool = peasantHarvestTarget.profile.tool;
  if (chargeFollowup) {
    action.warriorChargeFollowup = { excludedTargetId: chargeFollowup.excludedTargetId };
    player.warriorChargeFollowup = null;
  }
  if (swornTarget) action.rangerSwornPreyTargetId = swornTarget.id;
  if (shadowStep?.ok === true) {
    action.rogueShadowStep = {
      targetId: shadowStep.plan.targetId,
      destination: { ...shadowStep.plan.destination },
      phaseThroughObstacles: shadowStepPhase,
    };
  }
  const sacredPassage = talentEffect(player.class, player.talents, "sacred_passage", slot);
  if (skill.id === "blink" && sacredPassage) {
    const trail = startLumenTrail(w.state.lumenTrails, {
      id: action.id,
      ownerId: player.id,
      origin: { x: player.x, z: player.z },
      effect: sacredPassage,
      power: sacredPassage.power + Math.max(0, player.level - 1) * sacredPassage.powerPerLevel,
      now,
    });
    action.priestLumenTrailId = trail.id;
  }
  if (skill.id === "blink") action.priestLumenOrigin = { x: player.x, y: player.y, z: player.z };

  if (skill.id !== "vanish") {
    const predator = talentEffect(player.class, player.talents, "rogue_predator", 3);
    const stealthExited = exitRogueStealth(player, now, {
      offensive: true,
      openingBonusRatio: rogueOpeningBonusRatio(player, 3, predator?.openingBonusRatio),
    });
    if (stealthExited && predator) armRoguePredatorShiv(player, now, predator);
  }
  // Attacking breaks invisibility only once the action has actually been accepted.
  player.invisibleUntil = 0;

  if (slot === 1) player.lastAttackAt = now;
  else if (!chargeFollowup && skill.id !== "iron_guard" && skill.id !== "vanish")
    player.skillCooldowns[slot - 1] = now + skill.cooldownMs;
  if (skill.id === "mend") player.lastHealAt = now;
  if (!chargeFollowup) spendResource(player.resource, resourceCost);
  player.dirty = true;
  sendStateTo(w, connectionId, player);
  deps.send(connectionId, {
    t: "event",
    code: "skill.cast",
    params: { skill: skill.id, slot },
    tone: "good",
    x: player.x,
    z: player.z,
  });
  const animation: ServerMessage = {
    t: "animation",
    actionId: action.id,
    actorKind: "player",
    actorId: player.id,
    action: slot === 1 ? "attack" : "skill",
    skillId: skill.id,
    ...(action.peasantTool ? { peasantTool: action.peasantTool } : {}),
    ...(peasantHarvestTarget ? { peasantResource: peasantHarvestTarget.profile.resource } : {}),
    ...(slot > 1 && talentEffects(player.class, player.talents, slot).length > 0
      ? { talented: true as const }
      : {}),
    ...(slot > 1 && evolvedTalent(player.class, player.talents, slot)
      ? { evolved: true as const }
      : {}),
    direction: { x: action.direction.x, z: action.direction.z },
    startedAt: action.startedAt,
    impactAt: action.impactAt,
    ...(cyclone ? { impactTimes: cycloneImpactTimes(cyclone, action.impactAt) } : {}),
    recoveryEndsAt: action.recoveryEndsAt,
  };
  if (skill.id === "prospectors_pick") sendRoomEvent(w, animation);
  else sendSpatialEvent(w, animation, player);
  return true;
}

/** Port of `#applyRoguePoison` (`world.ts:2829`). */
export function applyRoguePoison(
  w: WorldGlue,
  player: PlayerRuntime,
  target: MonsterRuntime,
  skill: SkillDefinition,
  now: number,
): void {
  const baseSkill = CLASS_SKILLS.rogue[3];
  const talentPowerRatio = baseSkill ? skill.power / Math.max(1, baseSkill.power) : 1;
  const predator = talentEffect(player.class, player.talents, "rogue_predator", 3);
  const predatorPowerMultiplier = consumeRoguePredatorShivMultiplier(player, now, predator);
  const concentratedVenom = talentEffect(
    player.class,
    player.talents,
    "rogue_concentrated_venom",
    4,
  );
  applyDamageOverTime(w.state.damageOverTime, {
    kind: "poison",
    sourceId: player.id,
    sourceSkillId: skill.id,
    targetKind: "monster",
    targetId: target.id,
    now,
    tickCount: ROGUE_BALANCE.poisonedShiv.poisonTicks,
    tickPower: Math.max(
      1,
      Math.round(roguePoisonTickPower(player.level) * talentPowerRatio * predatorPowerMultiplier),
    ),
    intervalMs: ROGUE_BALANCE.poisonedShiv.poisonIntervalMs,
    maxStacks: concentratedVenom?.maxStacks ?? 1,
  });
}

/** Port of `#resolveShadowDance` (`world.ts:2857`). */
export function resolveShadowDance(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  action: CombatActionRuntime,
  skill: SkillDefinition,
  now: number,
): void {
  const thousandCuts = talentEffect(player.class, player.talents, "rogue_thousand_cuts", 5);
  const planning = planShadowDance(
    player,
    w.state.monsters,
    skill.range,
    ROGUE_BALANCE.shadowDance.maximumHits,
    now,
    zone(w.state).terrain,
    (monster) => monsterBodyRadius(monster.species),
    { repeatPrimary: Boolean(thousandCuts) },
  );
  if (!planning.ok) {
    w.deps.send(connectionId, {
      t: "event",
      code: planning.reason === "blocked" ? "skill.blocked" : "skill.no_target",
      params: { skill: skill.id },
      tone: "info",
      x: player.x,
      z: player.z,
    });
    return;
  }

  const origin = { x: player.x, y: player.y, z: player.z };
  const strikes: RogueShadowDanceSequence["strikes"] = [];
  // The wire copies above are two-axis (`Vec2`) by protocol, so the route the SERVER still has to
  // read — the final landing, the facing it looks at, the AOI points the sequence is broadcast
  // across — is kept here in ground coordinates rather than read back out of the payload.
  const landed: ShadowDanceStrikePlan[] = [];
  for (const planned of planning.plan.strikes) {
    const target = w.state.monsters.find((monster) => monster.id === planned.targetId);
    if (!target || target.deadUntil > now) continue;
    displacePlayer(player, planned.landing);
    const repeatedPower =
      planned.repeated && thousandCuts
        ? Math.max(
            1,
            Math.round(
              (skill.power + Math.max(0, player.level - 1) * 2) * thousandCuts.repeatPowerRatio,
            ),
          )
        : undefined;
    const result = damageMonster(
      w,
      connectionId,
      player,
      target,
      skill,
      now,
      false,
      repeatedPower,
      {
        suppressHitEvent: true,
      },
    );
    if (!result) continue;
    strikes.push({
      targetId: target.id,
      from: { x: planned.from.x, z: planned.from.z },
      targetPosition: { x: planned.targetPosition.x, z: planned.targetPosition.z },
      landing: { x: planned.landing.x, z: planned.landing.z },
      impactAt: now + strikes.length * ROGUE_BALANCE.shadowDance.strikeIntervalMs,
      damage: result.actualDamage,
      killed: result.killed,
      ...(planned.repeated ? { repeated: true as const } : {}),
    });
    landed.push(planned);
  }
  const last = landed.at(-1);
  if (!last) {
    displacePlayer(player, origin);
    return;
  }

  displacePlayer(player, last.landing);
  player.facing = normalizeGround(
    { x: last.targetPosition.x - player.x, z: last.targetPosition.z - player.z },
    action.direction,
  );
  w.state.playerGrid.update(player, origin);
  const endsAt = now + Math.max(1, strikes.length) * ROGUE_BALANCE.shadowDance.strikeIntervalMs;
  player.rogueShadowDanceInvulnerableUntil = endsAt;
  player.dirty = true;
  const darkHarvest = talentEffect(player.class, player.talents, "rogue_dark_harvest", 5);
  if (darkHarvest) {
    const kills = strikes.filter((strike) => strike.killed).length;
    if (kills > 0) {
      reduceRogueShadowDanceCooldown(player, now, kills, darkHarvest);
      sendStateTo(w, connectionId, player);
    }
  }
  const danceMaster = talentEffect(player.class, player.talents, "rogue_dance_master", 5);
  if (danceMaster) {
    player.rogueDanceMarks = [...new Set(strikes.map((strike) => strike.targetId))]
      .filter((targetId) => {
        const target = w.state.monsters.find((monster) => monster.id === targetId);
        return Boolean(target && target.deadUntil <= now);
      })
      .map((targetId) => ({
        targetId,
        availableAt: endsAt,
        expiresAt: endsAt + Math.max(0, danceMaster.markDurationMs),
      }));
    sendStateTo(w, connectionId, player);
  }

  const sequence: RogueShadowDanceSequence = {
    t: "rogue.shadow_dance",
    actionId: action.id,
    actorId: player.id,
    startedAt: now,
    endsAt,
    strikes,
    finalPosition: { x: player.x, z: player.z },
  };
  sendSpatialEventAcross(w, sequence, [
    origin,
    ...landed.flatMap((strike) => [strike.targetPosition, strike.landing]),
  ]);
}

/** Port of `#resolveShieldBash` (`world.ts:2559`). */
export function resolveShieldBash(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  action: CombatActionRuntime,
  skill: SkillDefinition,
  now: number,
): void {
  const terrain = zone(w.state).terrain;
  const distance = skill.distance ?? 0;
  const start: GroundVector = { x: player.x, z: player.z };
  const end = {
    x: start.x + action.direction.x * distance,
    z: start.z + action.direction.z * distance,
  };
  // The charge is a swept BODY, and its ceiling is the ground the warrior is standing on: a bash
  // stops at a cliff face rather than carrying its owner up one.
  const terrainImpact = sweptGroundTerrainImpact(
    terrain,
    start,
    end,
    BODY_RADIUS,
    groundUnder(terrain, player.x, player.z, player.y),
  );
  const midpoint = { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 };
  const monsterImpacts = w.state.monsterGrid
    .queryRadius(midpoint, distance / 2 + BODY_DIAMETER + MAX_MONSTER_BODY_REACH)
    .filter(
      (monster) =>
        monster.deadUntil <= now && monster.id !== action.warriorChargeFollowup?.excludedTargetId,
    )
    .map((monster) => ({
      monster,
      impact: sweptProjectileEntityImpact(
        start,
        end,
        BODY_RADIUS,
        monsterBodyHitbox(monster.species, monster),
        monster.id,
      ),
    }))
    .filter(
      (entry): entry is { monster: MonsterRuntime; impact: NonNullable<typeof entry.impact> } =>
        entry.impact !== null,
    );
  const colossus = talentEffect(player.class, player.talents, "colossus_charge", skill.slot);
  if (colossus) {
    const terrainFraction = terrainImpact?.fraction ?? 1;
    const contacts = colossusChargeImpacts(
      monsterImpacts.map(({ monster, impact }) => ({
        target: monster,
        fraction: impact.fraction,
      })),
      terrainFraction,
      colossus,
    );
    movePlayer(
      w,
      player,
      action.direction,
      Math.max(0, distance * terrainFraction - IMPACT_BACKOFF),
    );
    const basePower = skill.power + Math.max(0, player.level - 1) * 2;
    for (const contact of contacts) {
      damageMonster(
        w,
        connectionId,
        player,
        contact.target,
        skill,
        now,
        false,
        Math.max(1, Math.round(basePower * contact.powerRatio)),
      );
    }
    const firstTargetId = contacts[0]?.target.id;
    const inexorable = talentEffect(
      player.class,
      player.talents,
      "inexorable_breakthrough",
      skill.slot,
    );
    if (firstTargetId && inexorable && !action.warriorChargeFollowup) {
      player.warriorChargeFollowup = {
        excludedTargetId: firstTargetId,
        expiresAt: now + Math.max(0, inexorable.reactivationWindowMs),
      };
    }
    if (terrainImpact) {
      const building = buildingAtImpact(w.state.buildings, terrainImpact.point, BODY_RADIUS);
      if (building) {
        damageBuildingTarget(w, building, buildingDamagePower(w, player, skill, false));
      }
      w.deps.send(connectionId, {
        t: "event",
        code: "skill.blocked",
        params: { skill: skill.id },
        tone: "info",
        x: terrainImpact.point.x,
        z: terrainImpact.point.z,
      });
    }
    return;
  }
  const first = firstSegmentImpact([terrainImpact, ...monsterImpacts.map(({ impact }) => impact)]);
  const travel = Math.max(0, distance * (first?.fraction ?? 1) - IMPACT_BACKOFF);
  movePlayer(w, player, action.direction, travel);
  let directTargetId: string | null = null;
  if (first?.kind === "entity") {
    const target = monsterImpacts.find(({ impact }) => impact.id === first.id)?.monster;
    if (target) {
      directTargetId = target.id;
      damageMonster(w, connectionId, player, target, skill, now, false);
      const inexorable = talentEffect(
        player.class,
        player.talents,
        "inexorable_breakthrough",
        skill.slot,
      );
      if (inexorable && !action.warriorChargeFollowup) {
        player.warriorChargeFollowup = {
          excludedTargetId: target.id,
          expiresAt: now + Math.max(0, inexorable.reactivationWindowMs),
        };
      }
    }
  } else if (first?.kind === "terrain") {
    const building = buildingAtImpact(w.state.buildings, first.point, BODY_RADIUS);
    if (building) {
      damageBuildingTarget(w, building, buildingDamagePower(w, player, skill, false));
    }
    w.deps.send(connectionId, {
      t: "event",
      code: "skill.blocked",
      params: { skill: skill.id },
      tone: "info",
      x: first.point.x,
      z: first.point.z,
    });
  }
  const seismic = talentEffect(player.class, player.talents, "seismic_impact", skill.slot);
  if (!seismic) return;
  applySeismicImpact(
    w.state.monsterGrid.queryRadius(
      player,
      seismic.radius + BODY_DIAMETER + MAX_MONSTER_BODY_REACH,
    ),
    directTargetId,
    seismic,
    (target, radius) =>
      target.deadUntil <= now &&
      monsterHitboxWithin(player, target, radius) &&
      groundLineOfSight(terrain, player, target),
    (target, powerRatio) =>
      damageMonster(
        w,
        connectionId,
        player,
        target,
        skill,
        now,
        false,
        Math.max(1, Math.round((skill.power + Math.max(0, player.level - 1) * 2) * powerRatio)),
      ),
  );
}

/** Port of `#spawnPlayerProjectiles` (`world.ts:2646`). */
export function spawnPlayerProjectiles(
  w: WorldGlue,
  player: PlayerRuntime,
  action: CombatActionRuntime,
  skill: SkillDefinition,
  definition: ReturnType<typeof actionForClassSlot>,
  targetFilter: "monsters" | "wounded_allies",
  now: number,
): void {
  const projectileDefinition = definition.projectile;
  if (!projectileDefinition) return;
  const extraProjectiles = talentEffect(
    player.class,
    player.talents,
    "extra_projectiles",
    skill.slot,
  );
  const focusedVolley = talentEffect(player.class, player.talents, "focused_volley", skill.slot);
  const returningArrow = talentEffect(player.class, player.talents, "returning_arrow", skill.slot);
  const swornPrey = talentEffect(player.class, player.talents, "sworn_prey", skill.slot);
  // Direction is frozen at wind-up, but projectile origin is frozen only when the projectile
  // actually appears. A moving ranger/priest therefore fires from their active-frame position.
  const count = Math.max(1, (projectileDefinition.count ?? 1) + (extraProjectiles?.value ?? 0));
  const spread = (projectileDefinition.spreadRadians ?? 0) * (focusedVolley?.spreadMultiplier ?? 1);
  const activationHitEntityIds = count > 1 && !focusedVolley ? new Set<string>() : undefined;
  const activationHitCounts = focusedVolley ? new Map<string, number>() : undefined;
  for (let index = 0; index < count; index++) {
    const offset = count === 1 ? 0 : -spread / 2 + (spread * index) / (count - 1);
    const cosine = Math.cos(offset);
    const sine = Math.sin(offset);
    const direction = normalizeGround({
      x: action.direction.x * cosine - action.direction.z * sine,
      z: action.direction.x * sine + action.direction.z * cosine,
    });
    const healStats = mapHeroClassSettings(zone(w.state).heroSettings, player.class).stats.heal;
    const power =
      targetFilter === "wounded_allies"
        ? (skill.allyPower ?? skill.power) +
          Math.max(0, player.level - 1) * (healStats?.perLevel ?? 3)
        : skill.slot === 1
          ? configuredAttackDamage(w, player)
          : skill.power + Math.max(0, player.level - 1) * 2;
    spawnProjectile(w.state.projectiles, {
      actionId: action.id,
      owner: player,
      roomKey: player.roomKey,
      // `projectileOrigin` owns the muzzle offset — one body radius, the shot's own radius and the
      // historical 2 px of daylight — so the pixel path's hand-rolled copy of it, and the
      // `+ PLAYER_SIZE / 2` recentring it was built on, both go.
      origin: projectileOrigin(player, direction, projectileDefinition.radius),
      direction,
      definition: projectileDefinition,
      range: skill.range,
      power,
      targetFilter,
      sourceSkillId: skill.id,
      basic: skill.slot === 1,
      now,
      ricochetRemaining: talentEffect(player.class, player.talents, "ricochet", skill.slot) ? 1 : 0,
      ...(returningArrow
        ? { returnRange: skill.range * Math.max(0, returningArrow.returnRangeMultiplier) }
        : {}),
      ...(swornPrey && action.rangerSwornPreyTargetId
        ? {
            homingTargetId: action.rangerSwornPreyTargetId,
            homingTurnRateRadians: swornPrey.turnRateRadians,
          }
        : {}),
      ...(activationHitEntityIds ? { activationHitEntityIds } : {}),
      ...(activationHitCounts ? { activationHitCounts } : {}),
    });
  }
}

/** Port of `#spawnRetreatShot` (`world.ts:2718`). */
export function spawnRetreatShot(
  w: WorldGlue,
  player: PlayerRuntime,
  action: CombatActionRuntime,
  skill: SkillDefinition,
  effect: Extract<TalentEffect, { kind: "retreat_shot" }>,
  now: number,
): void {
  const arrow = actionForClassSlot("ranger", 1).projectile;
  if (!arrow) return;
  const power = Math.max(
    1,
    Math.round(configuredAttackDamage(w, player) * Math.max(0, effect.powerRatio)),
  );
  for (const direction of retreatShotDirections(action.direction, effect)) {
    spawnProjectile(w.state.projectiles, {
      actionId: action.id,
      owner: player,
      roomKey: player.roomKey,
      origin: projectileOrigin(player, direction, arrow.radius),
      direction,
      definition: { ...arrow, pierce: 0 },
      range: effect.range,
      power,
      targetFilter: "monsters",
      sourceSkillId: skill.id,
      basic: false,
      now,
    });
  }
}

/** Port of `#resolvePlayerAction` (`world.ts:2291`): the active frame of a player action. */
export function resolvePlayerAction(
  w: WorldGlue,
  player: PlayerRuntime,
  action: CombatActionRuntime,
  now: number,
): void {
  if (!player.authorized || player.transitioning || !canAct(player.life)) return;
  const connectionId = connectionOf(w.state, player.id);
  const slot = action.slot;
  if (connectionId === undefined || slot === undefined || slot < 1 || slot > 5) return;
  const peasantSupport = resolvePeasantSupportAction(
    w.state.peasantSupport,
    w.state.projectiles,
    player,
    action,
    player.roomKey,
    now,
    zone(w.state).terrain,
  );
  if (peasantSupport) {
    if (peasantSupport.kind === "ration") {
      for (const ration of peasantSupport.rations) {
        sendPeasantRationEvent(w, peasantRationMessage(ration));
      }
    }
    if (peasantSupport.kind === "camp" && peasantSupport.placement) {
      const { camp, replaced } = peasantSupport.placement;
      if (replaced) {
        sendSpatialEvent(w, { t: "peasant.camp_removed", id: replaced.id }, replaced);
      }
      sendSpatialEvent(
        w,
        {
          t: "peasant.camp",
          id: camp.id,
          actorId: camp.ownerId,
          x: camp.x,
          z: camp.z,
          radius: camp.radius,
          startedAt: camp.startedAt,
          expiresAt: camp.expiresAt,
        },
        camp,
      );
    }
    return;
  }
  const skill = configuredSkill(w, player, slot as SkillSlot);
  const definition = actionForClassSlot(player.class, slot);
  // A tile-unit position IS the body's centre; the pixel `+ PLAYER_SIZE / 2` recentring is gone.
  const center: GroundVector = { x: player.x, z: player.z };
  const terrain = zone(w.state).terrain;
  // The actor's OWN ground, read once: every sight test, sweep and landing below is grounded on
  // where the body IS, never on where it is going — `MAX_STEP` is 0 and none of these climb.
  const groundY = groundUnder(terrain, player.x, player.z, player.y);

  if (definition.shape === "stealth") {
    if (enterRogueStealth(player, now)) {
      const silhouette = talentEffect(player.class, player.talents, "rogue_silhouette", 3);
      if (silhouette) {
        player.rogueSilhouette = {
          x: player.x,
          y: player.y,
          z: player.z,
          hp: Math.max(1, silhouette.health),
          expiresAt: now + Math.max(0, silhouette.durationMs),
        };
        // The decoy is a real priority target, including for monsters that had not aggroed the
        // Rogue before Vanish. Threat remains attributed to the hero only as an AI routing key;
        // attacks resolve against the decoy position and health while stealth is active.
        for (const monster of w.state.monsters) {
          if (
            monster.deadUntil <= now &&
            groundDistance(monster, player.rogueSilhouette) <= MONSTER_AGGRO_RANGE
          ) {
            tauntThreat(monster.threat, player.id, now);
          }
        }
      }
      const smokeScreen = talentEffect(player.class, player.talents, "rogue_smoke_screen", 3);
      if (smokeScreen) applyRogueSmokeProtection(player, now, smokeScreen);
      if (!silhouette) forgetPlayer(w, player);
      sendStateTo(w, connectionId, player);
    }
    return;
  }

  if (definition.shape === "shadow_step") {
    const planned = action.rogueShadowStep;
    const target = planned
      ? w.state.monsters.find((monster) => monster.id === planned.targetId)
      : undefined;
    const destinationValid = planned
      ? planned.phaseThroughObstacles
        ? isShadowStepLandingValid(planned.destination, terrain, groundY)
        : isShadowStepPathClear(player, planned.destination, terrain, groundY)
      : false;
    if (
      !planned ||
      !target ||
      target.deadUntil > now ||
      !withinGroundRange(player, target, skill.range) ||
      (!planned.phaseThroughObstacles && !hasRogueLineOfSight(player, target, terrain, groundY)) ||
      !destinationValid
    ) {
      w.deps.send(connectionId, {
        t: "event",
        code: target ? "skill.blocked" : "skill.no_target",
        params: { skill: skill.id },
        tone: "info",
        x: player.x,
        z: player.z,
      });
      return;
    }
    const previousPosition = { x: player.x, y: player.y, z: player.z };
    const shadowReturn = talentEffect(player.class, player.talents, "rogue_shadow_return", 2);
    if (shadowReturn) {
      player.rogueShadowReturn = {
        ...previousPosition,
        expiresAt: now + Math.max(0, shadowReturn.windowMs),
      };
    }
    displacePlayer(player, planned.destination);
    player.facing = normalizeGround(
      { x: target.x - player.x, z: target.z - player.z },
      action.direction,
    );
    w.state.playerGrid.update(player, previousPosition);
    const executor = talentEffect(player.class, player.talents, "rogue_executor", 2);
    grantRogueOpening(
      player,
      "shadow_step",
      now,
      rogueOpeningBonusRatio(player, 2, executor?.openingBonusRatio),
    );
    sendStateTo(w, connectionId, player);
    return;
  }

  if (definition.shape === "shadow_dance") {
    resolveShadowDance(w, connectionId, player, action, skill, now);
    return;
  }

  if (definition.shape === "arc") {
    const arc = frontalArc(
      center,
      action.direction,
      skill.range,
      definition.halfAngleRadians ?? Math.PI / 3,
    );
    const targets = w.state.monsterGrid
      .queryRadius(center, skill.range + BODY_DIAMETER + MAX_MONSTER_BODY_REACH)
      .filter(
        (monster) =>
          monster.deadUntil <= now &&
          circleIntersectsArc(monsterBodyHitbox(monster.species, monster), arc) &&
          (player.class === "rogue"
            ? hasRogueLineOfSight(player, monster, terrain, groundY)
            : groundLineOfSight(terrain, player, monster)),
      )
      .sort((left, right) => {
        const distance = groundDistance(left, player) - groundDistance(right, player);
        return distance || left.id.localeCompare(right.id);
      });
    const resolvedTargets = player.class === "rogue" ? targets.slice(0, 1) : targets;
    for (const monster of resolvedTargets) {
      const result = damageMonster(w, connectionId, player, monster, skill, now, slot === 1);
      if (skill.id === "poisoned_shiv" && result && !result.killed) {
        const rupture = talentEffect(player.class, player.talents, "rogue_rupture", 4);
        if (rupture) {
          const detonation = rupturePoisonWithShiv(
            w.state.damageOverTime,
            player.id,
            monster.id,
            rupture,
          );
          if (detonation.damage > 0) {
            const ruptureResult = damageMonster(
              w,
              connectionId,
              player,
              monster,
              skill,
              now,
              false,
              detonation.damage,
              { poisonRupture: true },
            );
            if (ruptureResult?.killed) continue;
          }
        }
        applyRoguePoison(w, player, monster, skill, now);
      }
    }
    const buildingPower = buildingDamagePower(w, player, skill, slot === 1);
    for (const building of w.state.buildings) {
      if (buildingIntersectsArc(building, arc)) {
        damageBuildingTarget(w, building, buildingPower);
      }
    }
    if (player.class === "peasant") {
      const harvestTargets = selectPeasantHarvestTargets({
        player,
        slot: slot as SkillSlot,
        ...(action.peasantTool ? { tool: action.peasantTool } : {}),
        direction: action.direction,
        skillRange: skill.range,
        halfAngleRadians: definition.halfAngleRadians ?? Math.PI / 3,
        view: {
          zoneId: w.state.location?.zoneId ?? zone(w.state).id,
          events: zone(w.state).events ?? [],
          activeEvents: w.state.activeEvents,
          adventureState: w.state.adventureState.state,
          monsters: w.state.monsters,
          terrain,
          staticColliderIndex: w.state.staticColliderIndex,
        },
        now,
      });
      if (harvestTargets.length > 0) {
        const job = createPeasantHarvestJob({
          player,
          connectionId,
          slot: slot as SkillSlot,
          direction: action.direction,
          targets: harvestTargets,
          now,
        });
        // One job per hero. The acceptance boundary rejects new actions during a live channel;
        // keep the existing job if a duplicate resolution is ever replayed defensively.
        if (job && !w.state.harvestJobs.has(player.id)) w.state.harvestJobs.set(player.id, job);
      }
    }
    return;
  }
  if (definition.shape === "charge") {
    resolveShieldBash(w, connectionId, player, action, skill, now);
    return;
  }
  if (definition.shape === "guard") {
    player.guardUntil = 0;
    player.guarding = true;
    player.guardReduction = skill.reduction ?? 0;
    player.guardActivatedAt = now;
    player.dirty = true;
    sendStateTo(w, connectionId, player);
    return;
  }
  if (definition.shape === "dash") {
    const origin = { x: player.x, y: player.y, z: player.z };
    movePlayer(w, player, { x: -action.direction.x, z: -action.direction.z }, skill.distance ?? 0);
    const afterimage = talentEffect(player.class, player.talents, "afterimage", slot as SkillSlot);
    if (afterimage) {
      player.rangerAfterimage = {
        ...origin,
        expiresAt: now + Math.max(0, afterimage.durationMs),
      };
      for (const monster of w.state.monsterGrid.queryRadius(origin, afterimage.aggroRadius)) {
        if (
          monster.deadUntil <= now &&
          groundDistance(origin, monster) <= afterimage.aggroRadius &&
          groundLineOfSight(terrain, origin, monster)
        )
          tauntMonster(player, monster, now);
      }
      sendStateTo(w, connectionId, player);
    }
    const retreatShot = talentEffect(
      player.class,
      player.talents,
      "retreat_shot",
      slot as SkillSlot,
    );
    if (retreatShot) spawnRetreatShot(w, player, action, skill, retreatShot, now);
    return;
  }
  if (definition.shape === "teleport") {
    // Lumen Step moves through ordinary authoritative input while held. The active frame only
    // completes the fade-out; release (or a server bound) controls rematerialization.
    return;
  }
  if (definition.shape === "projectile" || definition.shape === "volley") {
    if (
      skill.id === "heartseeker" &&
      action.channelMaxEndsAt !== undefined &&
      action.channelEndsAt === undefined
    )
      return;
    spawnPlayerProjectiles(w, player, action, skill, definition, "monsters", now);
    if (definition.shape === "volley") {
      const tripleVolley = talentEffect(
        player.class,
        player.talents,
        "triple_volley",
        slot as SkillSlot,
      );
      if (tripleVolley)
        player.rangerVolleySequence = scheduleAdditionalVolleys(action, tripleVolley);
    }
    return;
  }
  if (definition.shape === "heal_projectile") {
    spawnPlayerProjectiles(w, player, action, skill, definition, "wounded_allies", now);
    return;
  }
  if (definition.shape === "area_buff") {
    const rally = resolvePeasantRallyPlan(
      peasantTalentEffects(player.talents, slot as SkillSlot),
      skill,
    );
    for (const [targetConnectionId, target] of w.state.players) {
      if (
        target.life !== "alive" ||
        !target.authorized ||
        !areCombatAllies(player, target) ||
        groundDistance(player, target) > rally.radius ||
        !groundLineOfSight(terrain, player, target)
      )
        continue;
      applyBoundedPowerBuff(target, rally.powerBonusRatio, rally.durationMs, now);
      sendStateTo(w, targetConnectionId, target);
    }
    return;
  }
  if (definition.shape === "area_taunt") {
    const rally = talentEffect(player.class, player.talents, "rallying_cry", slot as SkillSlot);
    const banner = talentEffect(player.class, player.talents, "war_banner", slot as SkillSlot);
    const radius = skill.radius ?? skill.range;
    if (rally) {
      applyRallyingCry(
        player,
        w.state.players.values(),
        rally,
        radius,
        now,
        (source, target) => areCombatAllies(source, target),
        (source, target) => groundLineOfSight(terrain, source, target),
      );
      if (banner) {
        applyWarBanner(
          player,
          w.state.players.values(),
          rally,
          undefined,
          banner.durationMs,
          now,
          (source, target) => areCombatAllies(source, target),
          (target) =>
            groundDistance(player, target) <= radius && groundLineOfSight(terrain, player, target),
        );
      }
      return;
    }
    let taunted = 0;
    for (const monster of w.state.monsterGrid.queryRadius(
      center,
      radius + BODY_DIAMETER + MAX_MONSTER_BODY_REACH,
    )) {
      if (
        monster.deadUntil <= now &&
        // Reach the monster's BODY, not its centre: a troll standing with its bulk inside the ring
        // and its centre just outside is visibly in the area, so it must answer for being there.
        monsterHitboxWithin(center, monster, radius) &&
        groundLineOfSight(terrain, player, monster)
      ) {
        tauntMonster(player, monster, now);
        taunted += 1;
      }
    }
    const challenge = talentEffect(
      player.class,
      player.talents,
      "king_challenge",
      slot as SkillSlot,
    );
    if (challenge) applyKingsChallenge(player, taunted, challenge, now);
    if (banner && challenge) {
      applyWarBanner(
        player,
        w.state.players.values(),
        undefined,
        challenge,
        banner.durationMs,
        now,
        (source, target) => areCombatAllies(source, target),
        () => true,
      );
    }
    return;
  }
  const judgment = talentEffect(player.class, player.talents, "nova_judgment", slot as SkillSlot);
  const mercy = talentEffect(player.class, player.talents, "nova_mercy", slot as SkillSlot);
  const novaMultipliers = novaSpecializationMultipliers(judgment, mercy);
  if (
    definition.shape === "nova" &&
    mercy?.reviveNearest &&
    now - player.lastResurrectAt >= RESURRECT_COOLDOWN_MS
  ) {
    const radius = skill.radius ?? skill.range;
    const corpse = nearestMercyCorpse(
      w.state.players.values(),
      (candidate) => groundDistance(player, candidate.corpse ?? candidate),
      (candidate) =>
        candidate !== player &&
        candidate.life === "corpse" &&
        candidate.corpse !== null &&
        areCombatAllies(player, candidate) &&
        groundDistance(player, candidate.corpse) <= radius &&
        groundLineOfSight(terrain, player, candidate.corpse),
    );
    if (corpse) {
      const targetConnectionId = connectionOf(w.state, corpse.id);
      if (targetConnectionId !== undefined) {
        player.lastResurrectAt = now;
        revivePlayerByPriest(w, connectionId, player, targetConnectionId, corpse, now);
      }
    }
  }
  const polarityOrb = talentEffect(player.class, player.talents, "polarity_orb", slot as SkillSlot);
  if (definition.shape === "nova" && polarityOrb) {
    const orb = startPolarityOrb(
      w.state.polarityOrbs,
      player.id,
      { x: player.x, y: player.y, z: player.z },
      skill.radius ?? skill.range,
      polarityOrb,
      now,
    );
    sendSpatialEvent(
      w,
      {
        t: "priest.polarity_orb",
        id: orb.id,
        actorId: player.id,
        x: orb.x,
        z: orb.z,
        maximumRadius: orb.maximumRadius,
        startedAt: orb.startedAt,
        returnsAt: orb.returnsAt,
        endsAt: orb.endsAt,
      },
      orb,
    );
    return;
  }
  if (definition.shape === "area_damage" || definition.shape === "nova") {
    const cyclone = talentEffect(player.class, player.talents, "cyclone", slot as SkillSlot);
    const eyeOfTheStorm = talentEffect(
      player.class,
      player.talents,
      "eye_of_the_storm",
      slot as SkillSlot,
    );
    if (cyclone) {
      damageBuildingsWithin(w, player, skill, center, skill.radius ?? skill.range);
      startWarriorCyclone(player, action.id, skill, cyclone, now);
      if (eyeOfTheStorm) {
        startWarriorVortex(
          player,
          { x: player.x, y: player.y, z: player.z },
          skill.radius ?? skill.range,
          {
            ...eyeOfTheStorm,
            durationMs: cyclone.ticks * cyclone.intervalMs,
          },
          now,
          true,
        );
      }
      return;
    }
    const steelTempest = talentEffect(
      player.class,
      player.talents,
      "steel_tempest",
      slot as SkillSlot,
    );
    const radius = skill.radius ?? skill.range;
    damageBuildingsWithin(w, player, skill, center, radius);
    for (const monster of w.state.monsterGrid.queryRadius(
      center,
      radius + BODY_DIAMETER + MAX_MONSTER_BODY_REACH,
    )) {
      if (
        monster.deadUntil <= now &&
        monsterHitboxWithin(center, monster, radius) &&
        groundLineOfSight(terrain, player, monster)
      ) {
        const result = damageMonster(
          w,
          connectionId,
          player,
          monster,
          skill,
          now,
          false,
          Math.max(
            1,
            Math.round(
              (skill.power + Math.max(0, player.level - 1) * 2) *
                (judgment
                  ? novaJudgmentDamageMultiplier(monster.hp, monster.maxHp, judgment)
                  : novaMultipliers.damage),
            ),
          ),
        );
        if (result && !result.killed && steelTempest) tauntMonster(player, monster, now);
      }
    }
    if (steelTempest && eyeOfTheStorm) {
      startWarriorVortex(
        player,
        { x: player.x, y: player.y, z: player.z },
        radius,
        eyeOfTheStorm,
        now,
        false,
      );
    }
  }
  if (definition.shape === "area_heal" || definition.shape === "nova") {
    areaHeal(w, connectionId, player, skill, now, novaMultipliers.healing);
    const soulAnchor = talentEffect(player.class, player.talents, "soul_anchor", slot as SkillSlot);
    if (skill.id === "prayer" && soulAnchor) {
      const radius = skill.radius ?? skill.range;
      const cleansePoison = Boolean(
        talentEffect(player.class, player.talents, "absolution", slot as SkillSlot),
      );
      for (const target of w.state.players.values()) {
        if (
          target.life !== "alive" ||
          !areCombatAllies(player, target) ||
          groundDistance(player, target) > radius ||
          !groundLineOfSight(terrain, player, target)
        )
          continue;
        target.priestSoulAnchor = {
          ownerId: player.id,
          x: player.x,
          y: player.y,
          z: player.z,
          expiresAt: now + soulAnchor.durationMs,
          cleansePoison,
        };
      }
    }
    const sanctuary = talentEffect(player.class, player.talents, "sanctuary", slot as SkillSlot);
    if (sanctuary) {
      startSanctuary(w.state.sanctuaries, {
        ownerId: player.id,
        x: player.x,
        y: player.y,
        z: player.z,
        radius: skill.radius ?? skill.range,
        power: skill.power + Math.max(0, player.level - 1) * 2,
        effect: sanctuary,
        now,
      });
    }
  }
}

export function harvestTargetForJob(
  w: WorldGlue,
  job: PeasantHarvestJob,
  target: PeasantHarvestJobTarget,
  now: number,
): ReturnType<typeof revalidatePeasantHarvestTarget> {
  const player = playerById(w.state, job.heroId);
  if (!player || connectionOf(w.state, player.id) !== job.connectionId) return null;
  const skill = configuredSkill(w, player, job.slot);
  const definition = actionForClassSlot(player.class, job.slot);
  if (definition.shape !== "arc") return null;
  return revalidatePeasantHarvestTarget({
    player,
    slot: job.slot,
    tool: job.tool,
    direction: job.direction,
    skillRange: skill.range,
    halfAngleRadians: definition.halfAngleRadians ?? Math.PI / 3,
    areaCenter: job.areaCenter,
    areaRadius: job.areaRadius,
    target,
    view: {
      zoneId: w.state.location?.zoneId ?? zone(w.state).id,
      events: zone(w.state).events ?? [],
      activeEvents: w.state.activeEvents,
      adventureState: w.state.adventureState.state,
      monsters: w.state.monsters,
      terrain: zone(w.state).terrain,
      staticColliderIndex: w.state.staticColliderIndex,
    },
    now,
  });
}

export function harvestJobHasValidTarget(
  w: WorldGlue,
  job: PeasantHarvestJob,
  now: number,
): boolean {
  return job.targets.some((target) => harvestTargetForJob(w, job, target, now) !== null);
}

export function removeHarvestJobIfCurrent(w: WorldGlue, job: PeasantHarvestJob): void {
  if (w.state.harvestJobs.get(job.heroId) === job) w.state.harvestJobs.delete(job.heroId);
}

export async function commitPeasantHarvestJob(w: WorldGlue, job: PeasantHarvestJob): Promise<void> {
  const actor = playerById(w.state, job.heroId);
  if (!actor || w.state.harvestJobs.get(job.heroId) !== job) return;
  let materialReward: PartyMaterialAmounts = {};
  let goldValue = 0;
  let rewarded = false;
  try {
    for (const target of job.targets) {
      if (w.state.harvestJobs.get(job.heroId) !== job) break;
      let reservationId: string | null = null;
      try {
        const liveTarget = harvestTargetForJob(w, job, target, w.deps.now());
        if (!liveTarget) continue;
        const rolledReward = rollPeasantHarvestReward(liveTarget.profile, target.plan);
        const reserved = await w.deps.reserveHarvestNode({
          heroId: job.heroId,
          sessionEpoch: actor.sessionEpoch,
          eventId: target.nodeId,
          generation: target.generation,
          requiredHits: target.plan.hitsRequired,
          reward: rolledReward.materialReward,
          goldValue: rolledReward.goldValue,
          respawnDelayMs:
            liveTarget.profile.respawn === "timed" && liveTarget.respawnAt === null
              ? liveTarget.profile.respawnDelayMs
              : null,
          respawnAt: liveTarget.profile.respawn === "timed" ? liveTarget.respawnAt : null,
        });
        if (!reserved.ok) continue;
        reservationId = reserved.reservationId;

        // Every target owns a distinct coordinator token. Revalidate tool, range/area, LOS,
        // generation and live state after that await; a movement or disconnect deletes the whole
        // job and stops all targets that have not yet spent their token.
        const currentTarget = harvestTargetForJob(w, job, target, w.deps.now());
        if (!currentTarget || w.state.harvestJobs.get(job.heroId) !== job) {
          await w.deps.cancelHarvestNode({
            heroId: job.heroId,
            eventId: target.nodeId,
            reservationId,
          });
          reservationId = null;
          if (w.state.harvestJobs.get(job.heroId) !== job) break;
          continue;
        }

        const hit = await w.deps.hitHarvestNode(
          {
            heroId: job.heroId,
            eventId: target.nodeId,
            reservationId,
          },
          target.plan.resource,
        );
        reservationId = null;
        if (!hit.ok || !hit.rewarded) {
          if (w.state.harvestJobs.get(job.heroId) !== job) break;
          continue;
        }
        if (hit.goldValue > 0) {
          goldValue += hit.goldValue;
        } else {
          materialReward = mergePeasantMaterialRewards(materialReward, rolledReward.materialReward);
        }
        rewarded = true;
        if (w.state.harvestJobs.get(job.heroId) !== job) break;
      } finally {
        if (reservationId) {
          await w.deps.cancelHarvestNode({
            heroId: job.heroId,
            eventId: target.nodeId,
            reservationId,
          });
        }
      }
    }
    if (rewarded) grantPeasantCarry(actor, materialReward, goldValue, w.deps.now());
  } finally {
    removeHarvestJobIfCurrent(w, job);
  }
}

export function advancePeasantHarvestJobs(w: WorldGlue, now: number): void {
  for (const job of w.state.harvestJobs.values()) {
    if (job.committing || now < job.completesAt) continue;
    if (!harvestJobHasValidTarget(w, job, now)) {
      removeHarvestJobIfCurrent(w, job);
      continue;
    }
    job.committing = true;
    w.deps.waitUntil(commitPeasantHarvestJob(w, job));
  }
}

/** Warcraft-style critter poke: four individually validated clicks, with the existing durable
 * harvest transition owning the final disappearance, reward and client feedback. */
export async function handleSheepHit(
  w: WorldGlue,
  player: PlayerRuntime,
  eventId: string,
): Promise<void> {
  const now = w.deps.now();
  const view = {
    zoneId: w.state.location?.zoneId ?? zone(w.state).id,
    events: zone(w.state).events ?? [],
    activeEvents: w.state.activeEvents,
    adventureState: w.state.adventureState.state,
    monsters: w.state.monsters,
    terrain: zone(w.state).terrain,
    staticColliderIndex: w.state.staticColliderIndex,
  };
  const target = sheepHarvestTargetForClick({ player, eventId, view, now });
  if (!target) return;
  const plan = resolvePeasantHarvestPlan(target.profile, []);
  const rolledReward = rollPeasantHarvestReward(target.profile, plan);
  const reserved = await w.deps.reserveHarvestNode({
    heroId: player.id,
    sessionEpoch: player.sessionEpoch,
    eventId: target.nodeId,
    generation: target.generation,
    requiredHits: plan.hitsRequired,
    reward: rolledReward.materialReward,
    goldValue: rolledReward.goldValue,
    respawnDelayMs:
      target.profile.respawn === "timed" && target.respawnAt === null
        ? target.profile.respawnDelayMs
        : null,
    respawnAt: target.profile.respawn === "timed" ? target.respawnAt : null,
  });
  if (!reserved.ok) return;
  let reservationId: string | null = reserved.reservationId;
  try {
    const current = sheepHarvestTargetForClick({
      player,
      eventId,
      view: {
        ...view,
        activeEvents: w.state.activeEvents,
        adventureState: w.state.adventureState.state,
      },
      now: w.deps.now(),
    });
    if (!current || current.generation !== target.generation) return;
    await w.deps.hitHarvestNode(
      { heroId: player.id, eventId: target.nodeId, reservationId },
      plan.resource,
    );
    reservationId = null;
  } finally {
    if (reservationId) {
      await w.deps.cancelHarvestNode({
        heroId: player.id,
        eventId: target.nodeId,
        reservationId,
      });
    }
  }
}

export function pruneInvalidPeasantHarvestJobs(w: WorldGlue, now: number): void {
  for (const job of w.state.harvestJobs.values()) {
    // A hit may synchronously push its own depleted-node snapshot back into this room while the
    // same area job still has valid targets to commit. The commit loop revalidates each remaining
    // target itself, so pruning a committing job here would mistake its own success for a cancel.
    if (job.committing) continue;
    if (!harvestJobHasValidTarget(w, job, now)) removeHarvestJobIfCurrent(w, job);
  }
}

/** Port of `#resolveWarriorCycloneStrike` (`world.ts:2973`). */
export function resolveWarriorCycloneStrike(
  w: WorldGlue,
  player: PlayerRuntime,
  radius: number,
  power: number,
  now: number,
): void {
  const connectionId = connectionOf(w.state, player.id);
  if (connectionId === undefined) return;
  const skill = configuredSkill(w, player, 5);
  for (const monster of w.state.monsterGrid
    .queryRadius(player, radius + BODY_DIAMETER + MAX_MONSTER_BODY_REACH)
    .sort((left, right) => left.id.localeCompare(right.id))) {
    if (
      monster.deadUntil > now ||
      !monsterHitboxWithin(player, monster, radius) ||
      !groundLineOfSight(zone(w.state).terrain, player, monster)
    )
      continue;
    damageMonster(w, connectionId, player, monster, skill, now, false, power);
  }
}

export function advanceRangerVolley(w: WorldGlue, player: PlayerRuntime, now: number): void {
  const sequence = player.rangerVolleySequence;
  if (!sequence) return;
  advanceAdditionalVolleys(
    player,
    now,
    (salvo) => {
      sendSpatialEvent(
        w,
        {
          t: "animation",
          actionId: salvo.actionId,
          actorKind: "player",
          actorId: player.id,
          action: "skill",
          skillId: "volley",
          talented: true,
          evolved: true,
          direction: { x: sequence.direction.x, z: sequence.direction.z },
          startedAt: salvo.animationAt,
          impactAt: salvo.impactAt,
          recoveryEndsAt: salvo.recoveryEndsAt,
        },
        player,
      );
    },
    (salvo) => {
      const action: CombatActionRuntime = {
        id: salvo.actionId,
        kind: "skill",
        skillId: "volley",
        slot: 3,
        direction: { ...sequence.direction },
        startedAt: salvo.animationAt,
        impactAt: salvo.impactAt,
        recoveryEndsAt: salvo.recoveryEndsAt,
        resolved: true,
      };
      spawnPlayerProjectiles(
        w,
        player,
        action,
        configuredSkill(w, player, 3),
        actionForClassSlot(player.class, 3),
        "monsters",
        now,
      );
    },
  );
}

export function releaseCounterOffensive(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  skill: SkillDefinition,
  now: number,
): void {
  const effect = talentEffect(player.class, player.talents, "counter_offensive", 2);
  if (!effect) {
    player.warriorCounterReserve = 0;
    return;
  }
  const power = consumeCounterOffensive(player);
  if (power <= 0) return;
  const center = { x: player.x, y: player.y, z: player.z };
  for (const monster of w.state.monsterGrid
    .queryRadius(center, effect.radius + BODY_DIAMETER + MAX_MONSTER_BODY_REACH)
    .sort((left, right) => left.id.localeCompare(right.id))) {
    if (
      monster.deadUntil > now ||
      !monsterHitboxWithin(player, monster, effect.radius) ||
      !groundLineOfSight(zone(w.state).terrain, player, monster)
    )
      continue;
    const result = damageMonster(w, connectionId, player, monster, skill, now, false, power);
    if (!result?.killed) {
      pushMonsterAwayFrom(
        monster,
        center,
        effect.knockbackDistance,
        zone(w.state).terrain,
        w.state.monsterGrid,
      );
      tauntMonster(player, monster, now);
    }
  }
  sendSpatialEvent(
    w,
    {
      t: "animation",
      actionId: crypto.randomUUID(),
      actorKind: "player",
      actorId: player.id,
      action: "skill",
      skillId: skill.id,
      talented: true,
      evolved: true,
      direction: { x: player.facing.x, z: player.facing.z },
      startedAt: now,
      impactAt: now,
      recoveryEndsAt: now + 240,
    },
    player,
  );
}

export function pulseWarriorVortex(
  w: WorldGlue,
  player: PlayerRuntime,
  center: GroundVector,
  effect: Extract<TalentEffect, { kind: "eye_of_the_storm" }>,
  now: number,
): void {
  const terrain = zone(w.state).terrain;
  const radius = player.warriorVortex?.radius ?? 0;
  for (const monster of w.state.monsterGrid
    .queryRadius(center, radius + BODY_DIAMETER + MAX_MONSTER_BODY_REACH)
    .sort((left, right) => left.id.localeCompare(right.id))) {
    if (
      monster.deadUntil > now ||
      !monsterHitboxWithin(center, monster, radius) ||
      !groundLineOfSight(terrain, center, monster)
    )
      continue;
    const previous = { x: monster.x, y: monster.y, z: monster.z };
    const direction = normalizeGround(
      { x: center.x - monster.x, z: center.z - monster.z },
      monster.facing,
    );
    // The pull is a MOVE, so it is grounded on where the body IS. A pull can be a whole tile —
    // far more than the body's radius — so grounding it on the destination would drag a monster
    // straight up a cliff face, deterministically rather than by luck.
    const moved = resolveGroundMovement(
      terrain,
      monster,
      {
        x: monster.x + direction.x * effect.pullDistance,
        z: monster.z + direction.z * effect.pullDistance,
      },
      groundUnder(terrain, monster.x, monster.z, monster.y),
    );
    monster.x = moved.x;
    monster.z = moved.z;
    monster.y = groundUnder(terrain, moved.x, moved.z, monster.y);
    applyMonsterSlow(monster, effect.slowRatio, effect.slowDurationMs, now);
    w.state.monsterGrid.update(monster, previous);
  }
}

export function extendSacredPassage(w: WorldGlue, caster: PlayerRuntime): void {
  const action = caster.action;
  if (action?.skillId !== "blink" || !action.priestLumenTrailId) return;
  const trail = w.state.lumenTrails.find((candidate) => candidate.id === action.priestLumenTrailId);
  if (trail) {
    appendLumenTrailPoint(trail, { x: caster.x, z: caster.z });
  }
}

export function healSacredPassageCrossings(w: WorldGlue, now: number): void {
  for (const trail of w.state.lumenTrails) {
    if (trail.expiresAt <= now || trail.points.length < 2) continue;
    const ownerConnectionId = connectionOf(w.state, trail.ownerId);
    if (ownerConnectionId === undefined) continue;
    const owner = w.state.players.get(ownerConnectionId);
    if (!owner?.authorized || owner.life !== "alive") continue;
    for (const [targetConnectionId, target] of w.state.players) {
      if (
        target === owner ||
        target.life !== "alive" ||
        !areCombatAllies(owner, target) ||
        trail.healedPlayerIds.has(target.id) ||
        target.hp >= maxHpForLevel(target.level) ||
        !lumenTrailTouches(trail, target)
      )
        continue;
      trail.healedPlayerIds.add(target.id);
      healPlayer(
        w,
        ownerConnectionId,
        owner,
        targetConnectionId,
        target,
        trail.power,
        "blink",
        now,
        false,
      );
    }
  }
}

export function applyLumenPortal(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  now: number,
): void {
  for (const portal of [...w.state.lumenPortals].sort((a, b) => a.id.localeCompare(b.id))) {
    if (portal.expiresAt <= now || portal.usedPlayerIds.has(player.id)) continue;
    const ownerConnectionId = connectionOf(w.state, portal.ownerId);
    if (ownerConnectionId === undefined) continue;
    const owner = w.state.players.get(ownerConnectionId);
    if (!owner?.authorized || owner.life !== "alive" || !areCombatAllies(owner, player)) continue;
    const atFrom = groundDistance(player, portal.from) <= portal.triggerRadius;
    const atTo = groundDistance(player, portal.to) <= portal.triggerRadius;
    if (portal.waitingForExitIds.has(player.id)) {
      if (!atFrom && !atTo) portal.waitingForExitIds.delete(player.id);
      continue;
    }
    if (!atFrom && !atTo) continue;
    const destination = safeLumenLanding(w, player, atFrom ? portal.to : portal.from, now);
    if (!destination) continue;
    portal.usedPlayerIds.add(player.id);
    const previous = { x: player.x, y: player.y, z: player.z };
    displacePlayer(player, destination);
    w.state.playerGrid.update(player, previous);
    if (portal.healingPower > 0)
      healPlayer(
        w,
        ownerConnectionId,
        owner,
        connectionId,
        player,
        portal.healingPower,
        "blink",
        now,
        false,
      );
    sendStateTo(w, connectionId, player);
    return;
  }
}

export function crossedRing(
  distance: number,
  fromRadius: number,
  toRadius: number,
  bodyRadius: number,
): boolean {
  const minimum = Math.min(fromRadius, toRadius) - bodyRadius;
  const maximum = Math.max(fromRadius, toRadius) + bodyRadius;
  return distance >= Math.max(0, minimum) && distance <= maximum;
}

export function resolvePolarityOrbStep(
  w: WorldGlue,
  orb: PolarityOrbRuntime,
  fromRadius: number,
  toRadius: number,
  returning: boolean,
  now: number,
): void {
  const ownerConnectionId = connectionOf(w.state, orb.ownerId);
  if (ownerConnectionId === undefined) return;
  const owner = w.state.players.get(ownerConnectionId);
  if (!owner?.authorized || owner.life !== "alive") return;
  const skill = configuredSkill(w, owner, 5);
  const judgment = talentEffect(owner.class, owner.talents, "nova_judgment", 5);
  const mercy = talentEffect(owner.class, owner.talents, "nova_mercy", 5);
  const multipliers = novaSpecializationMultipliers(judgment, mercy);
  const hitIds = returning ? orb.returnHitIds : orb.outwardHitIds;
  const center: GroundVector = { x: orb.x, z: orb.z };
  for (const monster of [...w.state.monsters].sort((a, b) => a.id.localeCompare(b.id))) {
    const hitId = `monster:${monster.id}`;
    if (
      monster.deadUntil > now ||
      hitIds.has(hitId) ||
      !crossedRing(
        groundDistance(center, monsterBodyHitbox(monster.species, monster).center),
        fromRadius,
        toRadius,
        monsterBodyHitbox(monster.species, monster).radius,
      ) ||
      !groundLineOfSight(zone(w.state).terrain, center, monster)
    )
      continue;
    hitIds.add(hitId);
    damageMonster(
      w,
      ownerConnectionId,
      owner,
      monster,
      skill,
      now,
      false,
      Math.max(
        1,
        Math.round(
          (skill.power + Math.max(0, owner.level - 1) * 2) *
            (judgment
              ? novaJudgmentDamageMultiplier(monster.hp, monster.maxHp, judgment)
              : multipliers.damage),
        ),
      ),
    );
  }
  for (const [targetConnectionId, target] of [...w.state.players].sort(([, a], [, b]) =>
    a.id.localeCompare(b.id),
  )) {
    const hitId = `player:${target.id}`;
    if (
      target.life !== "alive" ||
      !areCombatAllies(owner, target) ||
      hitIds.has(hitId) ||
      !crossedRing(groundDistance(center, target), fromRadius, toRadius, BODY_RADIUS) ||
      !groundLineOfSight(zone(w.state).terrain, center, target)
    )
      continue;
    hitIds.add(hitId);
    healPlayer(
      w,
      ownerConnectionId,
      owner,
      targetConnectionId,
      target,
      Math.max(
        1,
        Math.round((skill.power + Math.max(0, owner.level - 1) * 2) * multipliers.healing),
      ),
      skill.id,
      now,
      target === owner,
    );
  }
}

/** Port of `#areaHeal` (`world.ts:3035`). */
export function areaHeal(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  skill: SkillDefinition,
  now: number,
  powerMultiplier = 1,
): number {
  let healed = 0;
  const absolution = talentEffect(player.class, player.talents, "absolution", skill.slot);
  for (const [targetConnectionId, target] of w.state.players) {
    if (
      target.life !== "alive" ||
      !areCombatAllies(player, target) ||
      groundDistance(player, target) > (skill.radius ?? skill.range)
    )
      continue;
    if (!groundLineOfSight(zone(w.state).terrain, player, target)) continue;
    if (absolution) cleanseNegativeEffect(target, absolution.cleanse);
    const amount = Math.max(
      0,
      Math.round((skill.power + Math.max(0, player.level - 1) * 2) * Math.max(0, powerMultiplier)),
    );
    if (
      healPlayer(
        w,
        connectionId,
        player,
        targetConnectionId,
        target,
        amount,
        skill.id,
        now,
        target === player,
      ) > 0
    )
      healed += 1;
  }
  return healed;
}

/** Port of `#resolveSanctuaryTick` (`world.ts:3076`). */
export function resolveSanctuaryTick(w: WorldGlue, sanctuary: SanctuaryRuntime, now: number): void {
  const casterConnectionId = connectionOf(w.state, sanctuary.ownerId);
  const caster =
    casterConnectionId === undefined ? undefined : w.state.players.get(casterConnectionId);
  if (casterConnectionId === undefined || !caster) return;
  for (const [targetConnectionId, target] of w.state.players) {
    if (
      target.life !== "alive" ||
      !areCombatAllies(caster, target) ||
      groundDistance(sanctuary, target) > sanctuary.radius ||
      !groundLineOfSight(zone(w.state).terrain, sanctuary, target)
    )
      continue;
    healPlayer(
      w,
      casterConnectionId,
      caster,
      targetConnectionId,
      target,
      sanctuary.power,
      "prayer",
      now,
      target === caster,
    );
  }
}

// -------------------------------------------------------------------------------------------------
// Interact, quests, consumables, merchant
// -------------------------------------------------------------------------------------------------

export function revivePlayerByPriest(
  w: WorldGlue,
  casterConnectionId: string,
  caster: PlayerRuntime,
  targetConnectionId: string,
  target: PlayerRuntime,
  now: number,
): void {
  target.life = "alive";
  target.resurrectionAt = 0;
  target.corpse = null;
  target.hp = resurrectHp(target.level);
  grantReviveGrace(w, target, now);
  freeze(w, target);

  w.deps.send(casterConnectionId, {
    t: "event",
    code: "resurrect.cast",
    params: { name: target.nick },
    tone: "good",
    x: target.x,
    z: target.z,
  });
  w.deps.send(targetConnectionId, {
    t: "event",
    code: "death.resurrected",
    params: { name: caster.nick },
    tone: "good",
    x: target.x,
    z: target.z,
  });
  sendStateTo(w, targetConnectionId, target);
}

/** Port of `#resurrectNearbyCorpse` (`world.ts:3748`): the interact key is the priest's revive. */
export function resurrectNearbyCorpse(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  now: number,
): { handled: boolean; cooldownStarted: boolean } {
  const heal = mapHeroClassSettings(zone(w.state).heroSettings, player.class).stats.heal;
  let target: PlayerRuntime | undefined;
  let targetConnectionId: string | undefined;
  let distance = heal?.range ?? INTERACTION_RANGE;

  for (const [candidateConnectionId, candidate] of w.state.players) {
    if (
      candidateConnectionId === connectionId ||
      !canBeResurrected(candidate.life) ||
      candidate.corpse === null
    )
      continue;
    const candidateDistance = groundDistance(player, candidate.corpse);
    if (candidateDistance > distance) continue;
    target = candidate;
    targetConnectionId = candidateConnectionId;
    distance = candidateDistance;
  }
  if (!target || targetConnectionId === undefined)
    return { handled: false, cooldownStarted: false };

  // Only now that we know a body is in reach is it worth telling a warrior he cannot help.
  if (!heal) {
    w.deps.send(connectionId, { t: "event", code: "resurrect.not_priest", tone: "info" });
    return { handled: true, cooldownStarted: false };
  }
  if (now - player.lastResurrectAt < RESURRECT_COOLDOWN_MS) {
    w.deps.send(connectionId, { t: "event", code: "resurrect.nobody", tone: "info" });
    return { handled: true, cooldownStarted: false };
  }

  player.lastResurrectAt = now;
  revivePlayerByPriest(w, connectionId, player, targetConnectionId, target, now);
  return { handled: true, cooldownStarted: true };
}
