/**
 * Where a hero's position and life state are validated. `applyReportedMove` is the fence for the
 * one decision the client owns: it bounds a reported position against the real map and refuses a
 * corpse's frames outright. Death, corpse reclaim and loot collection follow, because they are the
 * same state machine (see `engine/death.ts`).
 *
 * Extracted from `worldTick.ts`, which had grown to 7100 lines and 136 declarations while its own
 * docblock still called it "the tick order". Same functions, same explicit-dependency shape; only
 * the file boundary is new.
 */

import { normalizeConsumables } from "@lindocara/engine/consumables.js";
import { REVIVE_AGGRO_GRACE_MS, resurrectHp } from "@lindocara/engine/death.js";
import { MONSTER_AGGRO_RANGE } from "@lindocara/engine/game.js";
import { type GroundVector, groundDistance } from "@lindocara/engine/ground.js";
import type { MoveMessage } from "@lindocara/engine/protocol.js";
import { mapEntryPosition } from "@lindocara/engine/terrain-access.js";
import type { ZoneDefinition } from "@lindocara/engine/zones.js";
import { cancelCombatAction } from "../../world/combat-action-system.js";
import { removeDamageOverTimeBySource } from "../../world/damage-over-time-system.js";
import { abortRunsForHero } from "../../world/event-run-system.js";
import { collectLoot } from "../../world/loot-system.js";
import { forgetPlayerFromMonsters } from "../../world/monster-system.js";
import { cancelPeasantHarvestJob } from "../../world/peasant-harvest-system.js";
import {
  refundPeasantCampGold,
  removePeasantSupportByOwner,
} from "../../world/peasant-support-system.js";
import {
  removeLumenPortalsByOwner,
  removeLumenTrailsByOwner,
  removePolarityOrbsByOwner,
  removeSanctuariesByOwner,
} from "../../world/priest-variant-system.js";
import { removeProjectilesByOwner } from "../../world/projectile-system.js";
import { clearRogueTransientState, exitRogueStealth } from "../../world/rogue-state-system.js";
import { displacePlayer, type PlayerRuntime } from "../../world/world-runtime.js";
import { applyLumenPortal, extendSacredPassage } from "./world-actions.ts";
import type { WorldGlue } from "./world-glue.ts";
import {
  connectionOf,
  REPORTED_ELEVATION_SLACK,
  recordActorQuestEvent,
  zone,
} from "./world-glue.ts";
import { sendSpatialEvent, sendStateTo } from "./world-send.ts";
import { detectPlayerTouch } from "./worldEvents.ts";

/**
 * Does this reported position describe a point on THIS map?
 *
 * `MOVE_COORDINATE_LIMIT` (`protocol.ts`) is a stateless wire bound — half the largest grid any
 * heightfield may declare — so a hero on a 40-cell map can report a position a hundred tiles off it
 * and the parser will happily hand it over. Only the room knows which grid it owns, so only the room
 * can ask this, and it must: every index downstream (the spatial grid, `heightAt`, navigation) is
 * addressed by a cell, and a position that addresses no cell of this map is not a hero anywhere.
 *
 * This is VALIDITY, not authority. The spec gave up deciding *where a hero is* (decision 4) — a
 * modified client may still walk through a wall or across water, and this deliberately does not
 * refuse that. It refuses only what could describe no position on this map at all, and it refuses it
 * the way every malformed frame is refused: by dropping it, silently.
 */
export function withinRoomBounds(terrain: ZoneDefinition["terrain"], move: MoveMessage): boolean {
  const half = terrain.size / 2;
  if (Math.abs(move.x) > half || Math.abs(move.z) > half) return false;
  // The tallest relief a grid of this side could carry, plus the slack above. Derived from the map
  // rather than restated as a constant: a bigger map is allowed to be taller.
  if (move.y > half * terrain.levelHeight + REPORTED_ELEVATION_SLACK) return false;
  // Nothing goes below the water plane: entering the water pins the hero to it (`enterWater`,
  // `hero-step.ts`), and swimming holds it there.
  return move.y >= terrain.waterLevel - REPORTED_ELEVATION_SLACK;
}

/**
 * Does this reported position know about every displacement the room has performed?
 *
 * The client owns where its hero is, but the room still MOVES one — a ghost release, a Pas de Lumen
 * landing, an authored teleport, a charge. For one round trip after it does, the client is still
 * computing and sending positions from where the hero used to be, and a room that stored them would
 * see the displacement quietly undone by the last stale frame: nothing throws, nothing logs, the
 * hero is simply back where it was.
 *
 * `displacePlayer` stamps every such write with a monotone counter, `SelfState.displacement` ships
 * it to the owner together with the position it stamps, and a frame echoes the stamp it was computed
 * under. A mismatch means the sender has not seen the room's newest displacement yet.
 *
 * Like {@link withinRoomBounds}, this is VALIDITY and not authority. It grants a client nothing: the
 * echo can only ever repeat a number the room issued, so a stamp AHEAD of the room's — a value it
 * never sent — mismatches exactly as a stale one does, and is dropped the same silent way. What the
 * client decides remains where it is; this decides only which of its claims are still about the
 * present.
 */
export function knowsCurrentDisplacement(player: PlayerRuntime, move: MoveMessage): boolean {
  return move.displacement === player.displacement;
}

/**
 * The client's report of where its own hero now is — the one fact a client supplies rather than an
 * intent (the S3 spec, decision 4). The room stores it and relays it; it never recomputes it.
 *
 * This is where the per-move choreography that used to hang off the tick's `onPlayerMoved` runs
 * now: it fires where the position actually changes, which for a client-owned hero is on message
 * arrival rather than once a tick.
 *
 * A corpse does not move, and a hero mid-handoff has had its position decided by the transition
 * itself — both drop the frame rather than answering it, exactly as the retired command path did.
 * A frame that predates a displacement the room performed is dropped for the same reason and in the
 * same silent way — see {@link knowsCurrentDisplacement}.
 */
export function applyReportedMove(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  move: MoveMessage,
): void {
  if (player.life === "corpse" || player.transitioning || player.disconnecting) return;
  if (!withinRoomBounds(zone(w.state).terrain, move)) return;
  if (!knowsCurrentDisplacement(player, move)) return;

  const previousPosition = { x: player.x, z: player.z };
  const moved = move.x !== player.x || move.z !== player.z;
  // All three axes, every time: `x`/`z` are the ground and `y` is ELEVATION. A write that carries
  // two of them puts the world on its side.
  player.x = move.x;
  player.y = move.y;
  player.z = move.z;
  player.vy = move.vy;
  player.facing = { x: move.facing.x, z: move.facing.z };
  player.airborne = move.airborne;
  player.swimming = move.swimming;
  player.gliding = move.gliding;
  player.dirty = true;
  if (!moved) return;

  w.state.playerGrid.update(player, previousPosition);
  debitHeldMobility(player, previousPosition);
  // Harvest channels require a stationary actor; the completion path also revalidates after its
  // coordinator await, so movement cannot race a delayed credit.
  cancelPeasantHarvestJob(w.state.harvestJobs, player.id);
  detectPlayerTouch(w.state, player, previousPosition);
  extendSacredPassage(w, player);
  applyLumenPortal(w, connectionId, player, w.deps.now());
}

/**
 * What a held mobility grant has been spent on, measured from the reported positions.
 *
 * The DISPLACEMENT is the client's (the S3 spec, decision 6) and this does not second-guess it: it
 * refuses nothing, corrects nothing and moves nobody. It keeps the one thing the grant is measured
 * in, so the tick's own bound (`mobilityDistance <= 0` -> `finishHeldPlayerAction`) still ends the
 * channel where it always did — the instant the granted distance runs out, rather than 2.5 seconds
 * later. Without it the priest walks out the rest of the hold with an empty budget and no
 * rematerialisation, which is not the skill.
 *
 * A report is a straight line between two 20 Hz samples, so this can only ever under-count the path
 * actually walked. That direction is the safe one: the channel may end a hair late, never early.
 */
export function debitHeldMobility(player: PlayerRuntime, from: GroundVector): void {
  const action = player.action;
  if (
    action?.skillId !== "blink" ||
    action.channelMaxEndsAt === undefined ||
    action.channelEndsAt !== undefined ||
    action.mobilityDistance === undefined
  ) {
    return;
  }
  action.mobilityDistance = Math.max(0, action.mobilityDistance - groundDistance(player, from));
}

/**
 * Drowning: the client REPORTS that the movement rule it owns ran out of breath, and the room
 * decides what that costs.
 *
 * The cost is death, in place — the state machine `death.ts` already owns (`alive -> corpse ->
 * ghost -> alive`), with the body left where it went under and `RESURRECT_HP_RATIO` on the way
 * back. It replaces the client-side teleport to the map's entry point that came over from the lab,
 * where the same line is a debug reset: in the game that landing is in bounds and indistinguishable
 * from an ordinary move, so it was a free ride home past any cliff, any monster, at any distance.
 *
 * The claim itself is worth nothing. It names no damage and no position, and it is refused unless
 * the position stream this same client is sending says the hero is in the water and alive. A
 * modified client that fabricates one drowns itself; a modified client that never sends one has
 * done no more than one that never reports a position at all (decision 4's accepted cost).
 */
export function applyDrowning(w: WorldGlue, connectionId: string, player: PlayerRuntime): void {
  if (!player.authorized || player.transitioning || player.disconnecting) return;
  // Only a living swimmer drowns. `swimming` is the flag from this client's own last accepted
  // `move`, so the report has to agree with the position stream that carried it.
  if (player.life !== "alive" || !player.swimming) return;
  player.hp = 0;
  killPlayer(w, connectionId, player);
  sendStateTo(w, connectionId, player);
}

// -------------------------------------------------------------------------------------------------
// Life-state transitions
// -------------------------------------------------------------------------------------------------

/**
 * Port of `#freeze` (`world.ts:5674`). The command-queue clear it opened with is gone with the
 * queue itself — the client owns movement now and there is nothing buffered here to half-apply;
 * `applyReportedMove` refuses a corpse's frames instead. What remains is what a life transition
 * always also did: end any open quest conversation and abort the hero's event runs — a panel opened
 * in one life state must not linger into another, and a run buffered across a death/revive must not
 * resume against a different life state.
 */
export function freeze(w: WorldGlue, player: PlayerRuntime): void {
  cancelPeasantHarvestJob(w.state.harvestJobs, player.id);
  player.peasantCarry = null;
  exitRogueStealth(player, w.deps.now());
  const staleConversation = w.state.questConversations.get(player.id);
  if (staleConversation) {
    w.state.questConversations.delete(player.id);
    const connectionId = connectionOf(w.state, player.id);
    if (connectionId !== undefined) {
      w.deps.send(connectionId, { t: "quest.close", conversationId: staleConversation.id });
    }
  }
  abortRunsForHero(w.state.eventRuns, player.id);
  cancelCombatAction(player);
  player.guarding = false;
  player.guardActivatedAt = 0;
  player.challengeReductionUntil = 0;
  player.challengeReduction = 0;
  player.rallyPowerUntil = 0;
  player.rallyPowerMultiplier = 0;
  player.warriorCyclone = null;
  player.warriorChargeFollowup = null;
  player.warriorCounterReserve = 0;
  player.warriorBannerChallengeUntil = 0;
  player.warriorBannerChallengeReduction = 0;
  player.warriorBannerPower.clear();
  player.warriorVortex = null;
  player.rangerVolleySequence = null;
  player.rangerAfterimage = null;
  player.priestLifeLinks = [];
  player.priestSoulAnchor = null;
  clearRogueTransientState(player);
  player.negativeEffects.clear();
  removeDamageOverTimeBySource(w.state.damageOverTime, player.id);
  removeSanctuariesByOwner(w.state.sanctuaries, player.id);
  removeLumenPortalsByOwner(w.state.lumenPortals, player.id);
  removeLumenTrailsByOwner(w.state.lumenTrails, player.id);
  removePolarityOrbsByOwner(w.state.polarityOrbs, player.id);
  removeProjectilesByOwner(w.state.projectiles, player.id);
  for (const camp of removePeasantSupportByOwner(w.state.peasantSupport, player.id)) {
    refundPeasantCampGold(camp, player);
    sendSpatialEvent(w, { t: "peasant.camp_removed", id: camp.id }, camp);
  }
  player.dirty = true;
}

/** Port of `#forgetPlayer` (`world.ts:4051`). */
export function forgetPlayer(w: WorldGlue, player: PlayerRuntime): void {
  forgetPlayerFromMonsters(w.state.monsters, player.id);
}

/** Port of `#grantReviveGrace` (`world.ts:5708`). */
export function grantReviveGrace(w: WorldGlue, player: PlayerRuntime, now: number): void {
  player.forgottenUntil = Math.max(player.forgottenUntil, now + REVIVE_AGGRO_GRACE_MS);
  forgetPlayer(w, player);
  for (const monster of w.state.monsters) {
    if (groundDistance(monster, player) <= MONSTER_AGGRO_RANGE) {
      monster.lastAttackAt = Math.max(monster.lastAttackAt, now);
    }
  }
}

/** Port of `#killPlayer` (`world.ts:5650`): dying does not move you — your body stays put. */
export function killPlayer(w: WorldGlue, connectionId: string, player: PlayerRuntime): void {
  player.life = "corpse";
  player.corpse = { x: player.x, y: player.y, z: player.z };
  for (const monster of w.state.monsters) monster.threat.delete(player.id);
  freeze(w, player);
  sendSpatialEvent(
    w,
    {
      t: "event",
      code: "player.down",
      params: { name: player.nick },
      tone: "bad",
      x: player.x,
      z: player.z,
    },
    player,
  );
  w.deps.send(connectionId, {
    t: "event",
    code: "death.fallen",
    tone: "bad",
    x: player.x,
    z: player.z,
  });
}

/** Temporary release policy: resurrect immediately at the current map's authored entry point.
 * Ghost/corpse-run types remain for persisted compatibility, but ordinary release bypasses them.
 * `mapEntryPosition` provides the same standable fallback used by room admission. */
export function handleRelease(w: WorldGlue, connectionId: string, player: PlayerRuntime): void {
  if (player.life !== "corpse" || player.corpse === null) return;
  player.resurrectionAt = 0;
  const definition = zone(w.state);
  const terrain = definition.terrain;
  const entry = mapEntryPosition(terrain, definition.spawns?.[0]);
  const previousPosition = { x: player.x, y: player.y, z: player.z };
  player.life = "alive";
  player.corpse = null;
  player.hp = resurrectHp(player.level);
  displacePlayer(player, entry);
  w.state.playerGrid.update(player, previousPosition);
  grantReviveGrace(w, player, w.deps.now());
  freeze(w, player);
  w.deps.send(connectionId, {
    t: "event",
    code: "death.released",
    tone: "good",
    x: player.x,
    z: player.z,
  });
  sendStateTo(w, connectionId, player);
}

/** Port of `#reclaimCorpse` (`world.ts:5778`): walking your ghost onto your own body. */
export function reclaimCorpse(w: WorldGlue, connectionId: string, player: PlayerRuntime): void {
  player.life = "alive";
  player.resurrectionAt = 0;
  player.corpse = null;
  player.hp = resurrectHp(player.level);
  grantReviveGrace(w, player, w.deps.now());
  freeze(w, player);
  w.deps.send(connectionId, {
    t: "event",
    code: "death.reclaimed",
    tone: "good",
    x: player.x,
    z: player.z,
  });
  sendStateTo(w, connectionId, player);
}

/** Port of `#collectLoot` (`world.ts:5789`), including the itemAcquired quest-event record. */
export function collectLootFor(w: WorldGlue, connectionId: string, player: PlayerRuntime): void {
  const before = normalizeConsumables(
    player.inventory.consumables,
    player.inventory.potions,
  ).health_potion;
  collectLoot(
    {
      loot: w.state.loot,
      lootGrid: w.state.lootGrid,
      send: (recipient, message) => w.deps.send(recipient, message),
      sendState: (recipient, target) => sendStateTo(w, recipient, target),
    },
    connectionId,
    player,
  );
  const counts = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
  player.inventory.consumables = counts;
  const acquired = counts.health_potion - before;
  if (acquired > 0) {
    recordActorQuestEvent(w, player, ({ id, mapId, actor }) => ({
      id,
      mapId,
      actor,
      type: "itemAcquired",
      itemId: "health_potion",
      amount: acquired,
      inventoryQuantity: counts.health_potion,
    }));
  }
}

// -------------------------------------------------------------------------------------------------
// Contribution, rewards and monster defeat
// -------------------------------------------------------------------------------------------------
