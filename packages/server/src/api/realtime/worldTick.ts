/**
 * The authoritative tick order, and only that. It reads as a list of beats because everything a
 * beat DOES lives beside it:
 *
 * - `world-glue.ts` — {@link WorldGlue}, {@link WorldTickDeps} and the accessors on a room's
 *   collections. Imports no sibling, which is what keeps the split acyclic at the type level.
 * - `world-send.ts` — everything the room sends: state, spatial/room events, chat, resync.
 * - `world-move-life.ts` — `applyReportedMove` (the fence on the one decision the client owns),
 *   drowning, death, corpse reclaim, loot collection.
 * - `world-combat.ts` — damage, healing, monster defeat, projectiles.
 * - `world-actions.ts` — the player-action timeline and the class variants.
 * - `world-interactions.ts` — interact, consumables, talents, chat, cheats, authored events, quests.
 *
 * That is a mechanical split of a file that had reached 7100 lines and 136 declarations while this
 * docblock still called it "the tick order" — same functions, same explicit-dependency shape, one
 * new file boundary. The rule it restores: a beat's name is here, its body is one file away.
 *
 * This is tranche β of the legacy `World` Durable Object, kept out of the room shell so `WorldRoom`
 * stays a thin transport adapter. Every function is a line-for-line port of the matching `world.ts`
 * private method (the source line is cited on each), re-keyed from workerd `WebSocket` to the
 * Alepha connection-id string and fed its cross-boundary seams through {@link WorldTickDeps}.
 *
 * `advanceWorldTick` reproduces the legacy `#advanceTick` order (`world.ts:4259-4421`) verbatim:
 * consumable effects → rogue expirations (+sendState) → damage-over-time → players (+player-touch
 * triggers) → npc events → held-action ends → adventure exits → combat actions (players) → warrior
 * cyclones → sanctuaries → projectiles → periodic resource state → monsters (+contact teleporters)
 * → combat actions (monsters) → guards → expired loot → event-run drain → every 2nd tick deltas +
 * party-state broadcasts → queued resyncs.
 *
 * Task 7 filled the event/quest slots: the budgeted event-run drain and its effect dispatch, the
 * authored `action`/`player-touch`/`monster` triggers, quest conversations, cheat commands and the
 * real D1-backed quest-reward claim / potion decrement (through `WorldTickDeps`). Page
 * EVALUATION stays out of the tick entirely — `worldEvents.ts`'s `evaluateActiveEvents` runs on
 * state install and hero join only. Task 8 filled the last two deps stubs: adventure-exit
 * transitions and authored cross-map teleports both ride `WorldRoom`'s epoch-fenced handoff
 * choreography (freeze → checkpoint → forced save → `PresenceRoom.handoff` → remove → close 4008),
 * reached through `deps.transitionAdventureExit`/`deps.teleportCrossMap`; the detection and dispatch
 * in this file were already correct and are unchanged. Deliberately NOT ported here: the legacy
 * runtime-party (`party.*`) mechanic — rollback-only per CLAUDE.md (hero sessions must not expose
 * it), not ported at all.
 */

import { canAct, resurrectHp } from "@lindocara/engine/death.js";
import { maxHpForLevel } from "@lindocara/engine/game.js";
import { exitEvents } from "@lindocara/engine/map-events.js";
import {
  PEASANT_RATION_HEAL_RATIO,
  PEASANT_RATION_MANA_RATIO,
} from "@lindocara/engine/peasant-support.js";
import { NETWORK_TICKS_PER_SNAPSHOT, TICK_HZ } from "@lindocara/engine/simulation.js";
import { CLASS_SKILLS } from "@lindocara/engine/skills.js";

import { buildingAtImpact } from "../../world/building-system.js";
import { advanceCombatActions } from "../../world/combat-action-system.js";
import { applyGuardDamage } from "../../world/combat-system.js";
import { advanceDamageOverTime } from "../../world/damage-over-time-system.js";
import { worldView } from "../../world/interest-system.js";
import { advanceLavaHazard } from "../../world/lava-hazard-system.js";
import { processExpiredLoot } from "../../world/loot-system.js";
import {
  advanceGuards,
  advanceMonsters,
  applyMonsterSlow,
  type MonsterSystemContext,
  pushMonsterAwayFrom,
} from "../../world/monster-system.js";
import { advancePlayers } from "../../world/movement-system.js";
import { advanceNpcEvents } from "../../world/npc-movement-system.js";
import { expirePeasantCarry } from "../../world/peasant-harvest-system.js";
import {
  advancePeasantCamps,
  advancePeasantRations,
  isPeasantBombProjectile,
  refundPeasantCampGold,
  resolvePeasantBombImpact,
} from "../../world/peasant-support-system.js";
import {
  advancePolarityOrbs,
  advanceSanctuaries,
  expireLumenPortals,
  expireLumenTrails,
} from "../../world/priest-variant-system.js";
import { advanceProjectiles } from "../../world/projectile-system.js";
import {
  expireRogueExecution,
  expireRogueOpening,
  expireRoguePredatorShiv,
  expireRogueShadowDanceProtection,
  expireRogueShadowReturn,
  expireRogueSmokeProtection,
  expireRogueStealth,
  isRogueStealthed,
} from "../../world/rogue-state-system.js";
import { advanceSeaGuardian } from "../../world/sea-guardian-system.js";
import { broadcastNetworkUpdates } from "../../world/snapshot-system.js";
import {
  advanceWarriorCyclones,
  advanceWarriorVortices,
  applyBoundedPowerBuff,
} from "../../world/warrior-variant-system.js";
import { ATTACHMENT_EVERY_TICKS, D1_SAVE_EVERY_TICKS } from "../../world/world-runtime.js";
import {
  advancePeasantHarvestJobs,
  advanceRangerVolley,
  finishHeldPlayerAction,
  healSacredPassageCrossings,
  pulseWarriorVortex,
  resolvePlayerAction,
  resolvePolarityOrbStep,
  resolveSanctuaryTick,
  resolveWarriorCycloneStrike,
} from "./world-actions.ts";
import {
  broadcastHeroPartyStates,
  damageMonster,
  damagePlayerFromEvent,
  damagePlayer,
  healPlayer,
  markMonsterDead,
  projectileBlocked,
  projectileDamage,
  projectileHeal,
  projectileOwner,
  resolveMonsterAction,
  startMonsterAttack,
} from "./world-combat.ts";
import type { WorldGlue } from "./world-glue.ts";
import {
  areCombatAllies,
  configuredSkill,
  connectionOf,
  damageBuildingsWithin,
  damageBuildingTarget,
  navigationRuntime,
  playerById,
  zone,
} from "./world-glue.ts";
import { drainEventRuns } from "./world-interactions.ts";
import {
  collectLootFor,
  forgetPlayer,
  freeze,
  grantReviveGrace,
  killPlayer,
  reclaimCorpse,
} from "./world-move-life.ts";
import {
  announceDisplacements,
  flushQueuedResyncs,
  interestContext,
  sendPeasantCampsTo,
  sendPeasantRationEvent,
  sendPeasantRationsTo,
  sendSpatialEvent,
  sendStateTo,
} from "./world-send.ts";
import {
  detectEventTouch,
  detectMonsterTouch,
  refreshHarvestEventVisuals,
  startAutomaticEventRuns,
} from "./worldEvents.ts";

/** Port of `#advanceConsumableEffects` (`world.ts:4423`): the resurrection draught fires. */
function advanceConsumableEffects(w: WorldGlue, now: number): void {
  for (const [connectionId, player] of w.state.players) {
    if (player.resurrectionAt <= 0 || player.resurrectionAt > now) continue;
    player.resurrectionAt = 0;
    if (player.life !== "corpse") continue;
    player.life = "alive";
    player.corpse = null;
    player.hp = resurrectHp(player.level);
    grantReviveGrace(w, player, now);
    freeze(w, player);
    w.deps.send(connectionId, {
      t: "event",
      code: "item.resurrected",
      tone: "good",
      x: player.x,
      z: player.z,
    });
    sendStateTo(w, connectionId, player);
  }
}

/** Port of `#detectAdventureExits` (`world.ts:5220`). Detection runs in its legacy slot; the
 *  transition itself is `deps.transitionAdventureExit` (`WorldRoom.transitionAdventureExit`). */
function detectAdventureExits(w: WorldGlue, now: number): void {
  const exits = exitEvents(zone(w.state).events ?? []);
  if (exits.length === 0) return;
  for (const [connectionId, player] of w.state.players) {
    if (
      player.identityKind !== "hero" ||
      player.life !== "alive" ||
      !player.authorized ||
      player.transitioning
    ) {
      w.state.occupiedExitByPlayerId.delete(player.id);
      continue;
    }
    // Cell indices are top-left and the grid is centred, so the cell a body stands in is its
    // ground coordinate shifted back by half the grid — never a division by `TILE_SIZE`, and never
    // the elevation `y`.
    const half = zone(w.state).terrain.size / 2;
    const col = Math.floor(player.x + half);
    const row = Math.floor(player.z + half);
    const exit = exits.find((candidate) => candidate.col === col && candidate.row === row);
    if (!exit) {
      w.state.occupiedExitByPlayerId.delete(player.id);
      continue;
    }
    const key = `${w.state.location?.zoneId ?? ""}:${exit.id}`;
    if (
      w.state.occupiedExitByPlayerId.get(player.id) === key ||
      now - player.lastTransitionAt < 750
    ) {
      continue;
    }
    w.state.occupiedExitByPlayerId.set(player.id, key);
    w.deps.transitionAdventureExit(connectionId, player, exit.id, now);
  }
}

/**
 * The full authoritative tick, in the legacy `#advanceTick` order (`world.ts:4259-4421`). See the
 * module docblock for the slot list and which slots are later-task stubs. SYNCHRONOUS end-to-end:
 * an async tick slower than its 50ms period silently skips beats (RoomEngine's reentrancy guard).
 */
export function advanceWorldTick(w: WorldGlue): void {
  const { state, deps } = w;
  if (state.players.size === 0 || state.location === null) return;
  state.tick += 1;
  const now = deps.now();
  const writeResourceState = state.tick % ATTACHMENT_EVERY_TICKS === 0;
  const writeD1 = state.tick % D1_SAVE_EVERY_TICKS === 0;

  advanceConsumableEffects(w, now);
  for (const [connectionId, player] of state.players) {
    expirePeasantCarry(player, now);
    if (player.warriorChargeFollowup && player.warriorChargeFollowup.expiresAt <= now)
      player.warriorChargeFollowup = null;
    expireRogueOpening(player, now);
    expireRogueExecution(player, now);
    expireRoguePredatorShiv(player, now);
    expireRogueShadowDanceProtection(player, now);
    player.priestLifeLinks = player.priestLifeLinks.filter((link) => link.expiresAt > now);
    if (player.priestSoulAnchor && player.priestSoulAnchor.expiresAt <= now)
      player.priestSoulAnchor = null;
    const shadowReturnExpired = expireRogueShadowReturn(player, now);
    const smokeProtectionExpired = expireRogueSmokeProtection(player, now);
    const silhouetteExpired = Boolean(
      player.rogueSilhouette && player.rogueSilhouette.expiresAt <= now,
    );
    if (silhouetteExpired) player.rogueSilhouette = null;
    const marksBefore = player.rogueDanceMarks.length;
    player.rogueDanceMarks = player.rogueDanceMarks.filter((mark) => mark.expiresAt > now);
    const selfStateChanged =
      shadowReturnExpired ||
      smokeProtectionExpired ||
      silhouetteExpired ||
      marksBefore !== player.rogueDanceMarks.length;
    if (expireRogueStealth(player, now) || selfStateChanged) sendStateTo(w, connectionId, player);
  }
  advanceDamageOverTime(state.damageOverTime, now, {
    sourceIsActive: (sourceId) => {
      const source = playerById(state, sourceId);
      return Boolean(
        source?.authorized &&
        !source.transitioning &&
        source.life === "alive" &&
        source.roomKey === state.location?.roomKey,
      );
    },
    targetIsActive: (targetKind, targetId) =>
      targetKind === "monster" &&
      state.monsters.some((monster) => monster.id === targetId && monster.deadUntil <= now),
    resolveTick: (effect, _stack, tick) => {
      const sourceConnectionId = connectionOf(state, effect.sourceId);
      const source =
        sourceConnectionId === undefined ? undefined : state.players.get(sourceConnectionId);
      const target = state.monsters.find((monster) => monster.id === effect.targetId);
      const baseSkill = source
        ? CLASS_SKILLS[source.class].find((skill) => skill.id === effect.sourceSkillId)
        : undefined;
      if (sourceConnectionId === undefined || !source || !target || !baseSkill) return;
      const skill = configuredSkill(w, source, baseSkill.slot);
      damageMonster(w, sourceConnectionId, source, target, skill, now, false, tick.power, {
        damageOverTime: true,
        persistentOwnerCredit: true,
      });
    },
  });

  advancePlayers<string>({
    players: state.players,
    now,
    presenceHeartbeatMs: deps.presenceHeartbeatMs,
    writeAttachment: false,
    writeD1,
    waitUntil: deps.waitUntil,
    renewPresence: (player) => deps.renewPresence(player),
    reclaimCorpse: (connectionId, player) => reclaimCorpse(w, connectionId, player),
    collectLoot: (connectionId, player) => collectLootFor(w, connectionId, player),
    savePlayer: (player, connectionId) => deps.savePlayer(player, connectionId),
    // No `onPlayerMoved`: the tick no longer moves anyone. The same choreography now runs in
    // `applyReportedMove`, where a client-owned hero's position actually changes.
  });
  advanceLavaHazard({
    exposureTicks: state.lavaExposureTicks,
    players: state.players.values(),
    monsters: state.monsters,
    terrain: zone(state).terrain,
    damagePlayer: (player, amount) => {
      const connectionId = connectionOf(state, player.id);
      if (connectionId !== undefined) {
        damagePlayerFromEvent(w, connectionId, player, amount, false, now);
      }
    },
    damageMonster: (monster, amount) => {
      monster.hp = Math.max(0, monster.hp - amount);
      if (monster.hp === 0) markMonsterDead(w, monster, now);
    },
  });
  // The guardian is a room-owned hazard, not a monster: no HP, no threat entry and no combat
  // target path can ever reach it. It reads the last accepted swimming positions and kills through
  // the same authoritative life transition as every other lethal outcome.
  advanceSeaGuardian(state.seaGuardian, {
    now,
    dt: 1 / TICK_HZ,
    players: state.players.values(),
    devour: (player, guardian) => {
      if (player.life !== "alive" || !player.swimming) return;
      const connectionId = connectionOf(state, player.id);
      if (connectionId === undefined) return;
      player.hp = 0;
      killPlayer(w, connectionId, player);
      sendStateTo(w, connectionId, player);
      sendSpatialEvent(
        w,
        {
          t: "sea_guardian.devour",
          guardianId: guardian.id,
          victimId: player.id,
          x: guardian.x,
          z: guardian.z,
          at: now,
        },
        guardian,
      );
    },
  });
  healSacredPassageCrossings(w, now);
  expireLumenTrails(state.lumenTrails, now);
  expireLumenPortals(state.lumenPortals, now);
  // NPCs held by a live event run or an open quest conversation stand still for the exchange.
  const pausedNpcIds = new Set([
    ...state.eventRuns.contexts.keys(),
    ...[...state.questConversations.values()].map((conversation) => conversation.target.eventId),
  ]);
  state.activeEvents = advanceNpcEvents({
    events: state.activeEvents,
    movement: state.npcMovement,
    players: [...state.players.values()],
    terrain: zone(state).terrain,
    tick: state.tick,
    pausedEventIds: pausedNpcIds,
  });
  for (const [connectionId, player] of state.players) {
    const action = player.action;
    if (
      action?.channelMaxEndsAt !== undefined &&
      action.channelEndsAt === undefined &&
      (now >= action.channelMaxEndsAt || (action.mobilityDistance ?? 0) <= 0)
    )
      finishHeldPlayerAction(w, connectionId, player, now);
  }
  detectAdventureExits(w, now);
  advanceCombatActions(state.players.values(), now, (player, action) =>
    resolvePlayerAction(w, player, action, now),
  );
  advancePeasantHarvestJobs(w, now);
  refreshHarvestEventVisuals(state, now);
  for (const player of state.players.values()) advanceRangerVolley(w, player, now);
  advanceWarriorCyclones(state.players.values(), now, (player, radius, power) =>
    resolveWarriorCycloneStrike(w, player, radius, power, now),
  );
  advanceWarriorVortices(state.players.values(), now, (player, center, effect) =>
    pulseWarriorVortex(w, player, center, effect, now),
  );
  advanceSanctuaries(
    state.sanctuaries,
    now,
    (ownerId) => {
      const owner = playerById(state, ownerId);
      return Boolean(owner?.authorized && !owner.transitioning && owner.life === "alive");
    },
    (sanctuary) => resolveSanctuaryTick(w, sanctuary, now),
  );
  advancePeasantRations({
    runtime: state.peasantSupport,
    players: state.players.values(),
    now,
    consumed: (ration, target) => {
      const maximumHealth = maxHpForLevel(target.level);
      target.hp = Math.min(
        maximumHealth,
        target.hp + Math.max(1, Math.ceil(maximumHealth * PEASANT_RATION_HEAL_RATIO)),
      );
      if (target.resource?.kind === "mana") {
        target.resource.current = Math.min(
          target.resource.max,
          target.resource.current +
            Math.max(1, Math.ceil(target.resource.max * PEASANT_RATION_MANA_RATIO)),
        );
      }
      applyBoundedPowerBuff(target, ration.powerBonusRatio, ration.buffDurationMs, now);
      target.dirty = true;
      const targetConnectionId = connectionOf(state, target.id);
      if (targetConnectionId !== undefined) sendStateTo(w, targetConnectionId, target);
    },
    removed: (ration) => sendPeasantRationEvent(w, { t: "peasant.ration_removed", id: ration.id }),
  });
  advancePeasantCamps({
    runtime: state.peasantSupport,
    players: state.players.values(),
    monsters: state.monsters,
    terrain: zone(state).terrain,
    now,
    isOwnerActive: (ownerId) => {
      const owner = playerById(state, ownerId);
      return Boolean(owner?.authorized && !owner.transitioning && owner.life === "alive");
    },
    areAllies: (owner, target) => areCombatAllies(owner, target),
    markHealingZone: (_camp, _owner, target) => {
      target.campHealingUntil = now + Math.ceil(3_000 / TICK_HZ);
    },
    heal: (camp, owner, target) => {
      const ownerConnectionId = connectionOf(state, owner.id);
      const targetConnectionId = connectionOf(state, target.id);
      if (ownerConnectionId === undefined || targetConnectionId === undefined) return;
      healPlayer(
        w,
        ownerConnectionId,
        owner,
        targetConnectionId,
        target,
        camp.healPower,
        "makeshift_camp",
        now,
        owner.id === target.id,
      );
    },
    restoreResource: (camp, _owner, target) => {
      if (target.resource?.kind !== "mana" || target.resource.current >= target.resource.max)
        return;
      const restored = Math.min(
        target.resource.max - target.resource.current,
        Math.max(0, camp.manaPower),
      );
      if (restored <= 0) return;
      target.resource.current += restored;
      target.dirty = true;
      const targetConnectionId = connectionOf(state, target.id);
      if (targetConnectionId !== undefined) sendStateTo(w, targetConnectionId, target);
    },
    serveRation: (camp, owner, target) => {
      const ownerConnectionId = connectionOf(state, owner.id);
      const targetConnectionId = connectionOf(state, target.id);
      if (ownerConnectionId === undefined || targetConnectionId === undefined) return;
      healPlayer(
        w,
        ownerConnectionId,
        owner,
        targetConnectionId,
        target,
        camp.rationHealing,
        "butchers_cut",
        now,
        owner.id === target.id,
      );
      applyBoundedPowerBuff(target, camp.rationPowerBonusRatio, camp.rationBuffDurationMs, now);
    },
    slowMonster: (camp, _owner, monster) =>
      applyMonsterSlow(monster, camp.slowRatio, camp.pulseIntervalMs + 1_000 / TICK_HZ, now),
    removed: (camp) => {
      const owner = playerById(state, camp.ownerId);
      if (owner) {
        refundPeasantCampGold(camp, owner);
        const ownerConnectionId = connectionOf(state, owner.id);
        if (ownerConnectionId !== undefined) sendStateTo(w, ownerConnectionId, owner);
      }
      sendSpatialEvent(w, { t: "peasant.camp_removed", id: camp.id }, camp);
    },
  });
  if (state.tick % TICK_HZ === 0) {
    for (const [connectionId, player] of state.players) {
      if (player.authorized) {
        sendPeasantCampsTo(w, connectionId, now);
        sendPeasantRationsTo(w, connectionId, now);
      }
    }
  }
  advancePolarityOrbs(state.polarityOrbs, now, (orb, fromRadius, toRadius, returning) =>
    resolvePolarityOrbStep(w, orb, fromRadius, toRadius, returning, now),
  );
  advanceProjectiles<string>(
    {
      projectiles: state.projectiles,
      terrain: zone(state).terrain,
      monsters: state.monsters,
      players: state.players,
      guards: state.guards,
      monsterGrid: state.monsterGrid,
      playerGrid: state.playerGrid,
      canHeal: (owner, target) => areCombatAllies(owner, target),
      damageMonster: (projectile, monster, impactAt) => {
        if (!isPeasantBombProjectile(state.peasantSupport, projectile))
          projectileDamage(w, projectile, monster, impactAt);
      },
      healPlayer: (projectile, connectionId, target, impactAt) =>
        projectileHeal(w, projectile, connectionId, target, impactAt),
      damagePlayer: (projectile, connectionId, target, impactAt) => {
        const attacker = state.monsters.find((monster) => monster.id === projectile.ownerId);
        if (attacker)
          damagePlayer(
            w,
            connectionId,
            target,
            projectile.power,
            attacker.species,
            attacker.id,
            impactAt,
            undefined,
            attacker.oneHitKill,
          );
      },
      damageRogueSilhouette: (projectile, target, impactAt) => {
        const silhouette = target.rogueSilhouette;
        if (!silhouette || silhouette.expiresAt <= impactAt || !isRogueStealthed(target, impactAt))
          return;
        silhouette.hp = Math.max(0, silhouette.hp - Math.max(0, projectile.power));
        if (silhouette.hp <= 0) {
          target.rogueSilhouette = null;
          forgetPlayer(w, target);
        }
        target.dirty = true;
        const targetConnectionId = connectionOf(state, target.id);
        if (targetConnectionId !== undefined) sendStateTo(w, targetConnectionId, target);
      },
      damageGuard: (projectile, guard) => {
        applyGuardDamage(guard, projectile.power);
      },
      blocked: (projectile, point) => {
        if (!isPeasantBombProjectile(state.peasantSupport, projectile)) {
          const building = buildingAtImpact(state.buildings, point, projectile.radius);
          const owner = projectileOwner(w, projectile);
          if (building && owner && canAct(owner.player.life)) {
            damageBuildingTarget(w, building, projectile.power);
          }
          projectileBlocked(w, projectile, point);
        }
      },
      removed: (projectile, point, _reason, impactAt) => {
        const owner = projectileOwner(w, projectile);
        const explosion = resolvePeasantBombImpact({
          runtime: state.peasantSupport,
          projectile,
          point,
          monsterGrid: state.monsterGrid,
          terrain: zone(state).terrain,
          now: impactAt,
          damage: (monster, power) => {
            if (!owner || !canAct(owner.player.life)) return;
            return (
              damageMonster(
                w,
                owner.connectionId,
                owner.player,
                monster,
                configuredSkill(w, owner.player, 5),
                impactAt,
                false,
                power,
              ) ?? undefined
            );
          },
          control: (monster, effect) => {
            if (effect.slowRatio > 0 && effect.slowDurationMs > 0) {
              applyMonsterSlow(monster, effect.slowRatio, effect.slowDurationMs, impactAt);
            }
            if (effect.knockbackDistance > 0) {
              pushMonsterAwayFrom(
                monster,
                point,
                effect.knockbackDistance,
                zone(state).terrain,
                state.monsterGrid,
              );
            }
          },
        });
        if (!explosion) return;
        if (owner && canAct(owner.player.life)) {
          damageBuildingsWithin(
            w,
            owner.player,
            configuredSkill(w, owner.player, 5),
            explosion,
            explosion.radius,
            explosion.power,
          );
        }
        sendSpatialEvent(
          w,
          {
            t: "peasant.bomb_impact",
            actionId: explosion.actionId,
            actorId: explosion.ownerId,
            // The GROUND point. `explosion.y` beside it would be the ELEVATION, and shipping it as
            // the second wire axis is exactly the half-conversion this increment keeps finding.
            x: explosion.x,
            z: explosion.z,
            radius: explosion.radius,
            impactAt,
          },
          explosion,
        );
      },
    },
    now,
  );
  if (writeResourceState) {
    for (const [connectionId, player] of state.players) {
      if (player.authorized && player.resource) sendStateTo(w, connectionId, player);
    }
  }

  const monsterContext: MonsterSystemContext<string> = {
    players: state.players,
    monsters: state.monsters,
    guards: state.guards,
    monsterGrid: state.monsterGrid,
    zone: zone(state),
    tick: state.tick,
    navigation: navigationRuntime(state),
    startAttack: (monster, target, attackedAt) =>
      startMonsterAttack(w, monster, target, attackedAt),
    killPlayerOnContact: (monster, connectionId, player, contactedAt) =>
      damagePlayer(
        w,
        connectionId,
        player,
        monster.damage,
        monster.species,
        monster.id,
        contactedAt,
        undefined,
        true,
      ),
    defeatMonster: (monster, defeatedAt) => markMonsterDead(w, monster, defeatedAt),
    onMonsterMoved: (monster, previous) => detectMonsterTouch(state, monster, previous),
  };
  advanceMonsters(monsterContext, now);
  advanceCombatActions(state.monsters, now, (monster, action) =>
    resolveMonsterAction(w, monster, action, now),
  );
  advanceGuards(monsterContext, now);
  processExpiredLoot(state.loot, state.lootGrid, now);
  // Autonomous pages share the existing event-id lock and global command budget. Event-touch is
  // sampled here, after both cell-stepped NPCs and continuously moving guards reached this tick's
  // final positions, so only an actor-created contact edge can start it.
  detectEventTouch(state);
  startAutomaticEventRuns(state);
  // Drain event runs AFTER all authoritative simulation (movement, combat, monsters, loot) and
  // BEFORE the network flush: a run's teleport acts on final positions and rides out THIS tick's
  // snapshot, and the budget guarantees the drain returns so the tick never hangs.
  drainEventRuns(w, now);
  announceDisplacements(w);
  if (state.tick % NETWORK_TICKS_PER_SNAPSHOT === 0) {
    broadcastNetworkUpdates(
      state.players,
      state.tick,
      (player) => worldView(interestContext(w), player),
      (connectionId, message) => deps.send(connectionId, message),
      state.activeEvents,
    );
    // The legacy runtime-party pass (`broadcastPartyStateIfChanged`) is rollback-only and absent;
    // hero rooms rebuild the roster from the persistent party.
    broadcastHeroPartyStates(w);
  }
  flushQueuedResyncs(w, now);
}
