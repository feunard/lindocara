/**
 * The intents a player can express that are not movement or an attack: interact, consumables,
 * talents, chat, cheats, the authored-event interpreter's dispatch, and quests.
 *
 * Extracted from `worldTick.ts`, which had grown to 7100 lines and 136 declarations while its own
 * docblock still called it "the tick order". Same functions, same explicit-dependency shape; only
 * the file boundary is new.
 */

import { activePageIndex } from "@lindocara/engine/adventure-state.js";
import type { AmbienceState } from "@lindocara/engine/ambience.js";
import {
  BUILDING_DOOR_INTERACTION_RANGE,
  distanceToBuildingDoor,
} from "@lindocara/engine/buildings.js";
import { parseCheatCommand } from "@lindocara/engine/cheats.js";
import {
  CONSUMABLE_COOLDOWN_MS,
  CONSUMABLE_MAX_STACK,
  CONSUMABLES,
  type ConsumableId,
  isConsumableId,
  normalizeConsumables,
} from "@lindocara/engine/consumables.js";
import { canAct } from "@lindocara/engine/death.js";
import { DIALOGUE_CLOSE_RADIUS, type EventCommand } from "@lindocara/engine/event-commands.js";
import type { StateMutation } from "@lindocara/engine/event-interpreter.js";
import {
  applyExperience,
  INTERACTION_RANGE,
  maxHpForLevel,
  QUEST_RUN_LIMIT_MS,
  QUEST_SITE_RESPAWN_MS,
  type QuestChapter,
  type QuestSite,
} from "@lindocara/engine/game.js";
import { type GroundVector, groundDistance, groundOf } from "@lindocara/engine/ground.js";
import {
  authoredCellCentreGround,
  isInteractiveWorldEventKind,
  type MapEvent,
} from "@lindocara/engine/map-events.js";
import { merchantForRuntimeRoom } from "@lindocara/engine/merchant.js";
import type { ClientMessage, QuestDialogueEntry } from "@lindocara/engine/protocol.js";
import {
  authoredQuestRuntimeState,
  buildQuestInteractionIndex,
  completedQuestIds,
  type QuestBusinessEvent,
  questTargetCandidates,
} from "@lindocara/engine/quest-runtime.js";
import type { QuestEventReference } from "@lindocara/engine/quests.js";
import { unlockTalent } from "@lindocara/engine/talents.js";
import { BODY_RADIUS, canStand, groundUnder } from "@lindocara/engine/terrain-access.js";
import { editorAsset } from "@lindocara/engine/tiny-swords-catalog.js";

import type { AuthoredQuestChange } from "../../authored-quest-system.js";
import { executeCheatCommand } from "../../world/cheat-command-system.js";
import {
  advanceRun,
  chooseRun,
  closeDistantDialogues,
  type DispatchEffect,
  drainRuns,
  resetEventRunRuntime,
  startRun,
} from "../../world/event-run-system.js";
import {
  nearbyAlliedPeasantCamp,
  transferPeasantCampGold,
} from "../../world/peasant-support-system.js";
import {
  removeLumenPortalsByOwner,
  removeLumenTrailsByOwner,
  removePolarityOrbsByOwner,
} from "../../world/priest-variant-system.js";
import { nextQuestChapter, questDefinition } from "../../world/quest-system.js";
import { CHAT_MAX_LENGTH, displacePlayer, type PlayerRuntime } from "../../world/world-runtime.js";
import type { QuestTurnInResult } from "./PartyRoom.ts";
import { resurrectNearbyCorpse } from "./world-actions.ts";
import { damagePlayerFromEvent } from "./world-combat.ts";
import type { WorldGlue } from "./world-glue.ts";
import {
  configuredSkill,
  connectionOf,
  playerById,
  questActor,
  recordActorQuestEvent,
  zone,
} from "./world-glue.ts";
import {
  forgetPlayer,
  freeze,
  grantReviveGrace,
  handleRelease,
  killPlayer,
} from "./world-move-life.ts";
import {
  questDefinitionsForPlayer,
  questProgressForPlayer,
  sendCampBankToParty,
  sendLocalChat,
  sendSpatialEvent,
  sendStateTo,
} from "./world-send.ts";
import {
  activeEventCentre,
  consumeMovementPickup,
  logGoldRefusedOnce,
  logItemRefusedOnce,
  logTeleportRefusedOnce,
  runnablePage,
} from "./worldEvents.ts";
import type { PendingQuestConversation } from "./worldState.ts";

/** Port of `#interactQuestSite` (`world.ts:3806`). */
export function interactQuestSite(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  chapter: QuestChapter,
  site: QuestSite,
  now: number,
): void {
  const definition = questDefinition(zone(w.state), chapter);
  if (!definition) return;
  const { order } = site;
  if (chapter === "ward_run") {
    if (player.wardRunExpiresAt !== null && player.wardRunExpiresAt <= now) {
      player.quest.progress = 0;
      player.wardRunExpiresAt = null;
      w.deps.send(connectionId, { t: "event", code: "quest.run_expired", tone: "bad" });
      sendStateTo(w, connectionId, player);
      player.dirty = true;
      return;
    }
    if (order === 0 && player.quest.progress === 0) {
      player.wardRunExpiresAt = now + QUEST_RUN_LIMIT_MS;
      w.deps.send(connectionId, {
        t: "event",
        code: "quest.run_started",
        params: { seconds: QUEST_RUN_LIMIT_MS / 1_000 },
        tone: "good",
      });
    }
  }

  if (order !== player.quest.progress) {
    if (chapter === "mire_runes" || chapter === "ward_run") {
      player.quest.progress = 0;
      player.wardRunExpiresAt = null;
    }
    w.deps.send(connectionId, { t: "event", code: "quest.site_wrong", tone: "bad" });
    sendStateTo(w, connectionId, player);
    player.dirty = true;
    return;
  }

  if (site.kind === "resource") {
    w.state.siteRespawnAt.set(site.id, now + QUEST_SITE_RESPAWN_MS);
    sendSpatialEvent(
      w,
      {
        t: "event",
        code: "quest.site_harvested",
        params: { site: site.id, seconds: QUEST_SITE_RESPAWN_MS / 1_000 },
        tone: "good",
        // A `QuestSite` is compiled CATALOGUE content and still a pixel `Vec2` whose `y` is a
        // ground axis, so `groundOf` is the conversion — the same one the spatial anchor below
        // already uses. Unreachable on any live room: `zoneFromMapPayload` bakes `questSites: []`.
        ...groundOf(site),
      },
      groundOf(site),
    );
  }
  player.quest.progress += 1;
  if (player.quest.progress >= definition.target) {
    player.quest.status = "ready";
    player.wardRunExpiresAt = null;
    w.deps.send(connectionId, { t: "event", code: "quest.chapter_ready", tone: "good" });
  } else {
    w.deps.send(connectionId, {
      t: "event",
      code: "quest.site_progress",
      params: { progress: player.quest.progress, target: definition.target },
      tone: "good",
    });
  }
  player.dirty = true;
  sendStateTo(w, connectionId, player);
}

/** Port of `#completeQuestChapter` (`world.ts:3878`). The idempotent D1 claim is a Task 6 seam;
 *  its stub returns `false`, which lands on the legacy already-claimed "blessing" path. */
export async function completeQuestChapter(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  chapter: QuestChapter,
): Promise<void> {
  const definition = questDefinition(zone(w.state), chapter);
  if (!definition) return;
  const result = applyExperience(player.level, player.xp, definition.rewardXp);
  const resultingHp = maxHpForLevel(result.level);
  if (!(await w.deps.savePlayer(player, connectionId))) return;
  const claimed = await w.deps.claimQuestReward(player, {
    sessionEpoch: player.sessionEpoch,
    questId: chapter,
    rewardGold: definition.rewardGold,
    rewardPotions: 1,
    resultingLevel: result.level,
    resultingXp: result.xp,
    resultingHp,
  });
  if (!claimed) {
    w.deps.send(connectionId, { t: "event", code: "quest.blessing", tone: "good" });
    return;
  }
  player.inventory.potions += 1;
  player.inventory.gold += definition.rewardGold;
  player.level = result.level;
  player.xp = result.xp;
  player.hp = resultingHp;
  player.wardRunExpiresAt = null;

  const next = nextQuestChapter(zone(w.state), chapter);
  if (next) {
    player.quest = {
      chapter: next,
      status: "available",
      progress: 0,
      target: questDefinition(zone(w.state), next)?.target ?? 0,
    };
  } else {
    player.quest.status = "completed";
  }
  w.deps.send(connectionId, {
    t: "event",
    code: "quest.fulfilled",
    params: { chapter, xp: definition.rewardXp, gold: definition.rewardGold },
    tone: "good",
  });
  player.dirty = true;
  await w.deps.savePlayer(player, connectionId);
}

/**
 * Port of `#interact` (`world.ts:3459`), the in-room parts. Portals only name catalogue zones and
 * an authored map has none (`zoneFromMapPayload` always bakes `portals: []`), so this arm is
 * currently unreachable; it stays ported verbatim (the legacy denial code, not Task 8's real
 * handoff) so a future catalogue-portal authoring path has a safe default rather than a silent
 * no-op. Authored quest bindings and `action` event triggers slot in between the resurrection and
 * the legacy quest keepers with Task 7.
 */
export async function handleInteract(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
): Promise<{ cooldownStarted: boolean }> {
  const now = w.deps.now();
  if (!canAct(player.life)) return { cooldownStarted: false };
  const portal = zone(w.state).portals.find(
    (candidate) => groundDistance(player, groundOf(candidate)) <= INTERACTION_RANGE,
  );
  if (portal) {
    // Unreachable today (see the docblock above); refusing is the safe authoritative answer for
    // whenever a catalogue portal exists to hit.
    w.deps.send(connectionId, { t: "event", code: "zone.transition_denied", tone: "bad" });
    return { cooldownStarted: false };
  }
  const merchant = merchantForRuntimeRoom();
  if (merchant && groundDistance(player, groundOf(merchant)) <= INTERACTION_RANGE) {
    w.deps.send(connectionId, { t: "merchant.open" });
    return { cooldownStarted: false };
  }
  // A corpse is just one more thing you can be standing next to. The skill bar is full and this
  // codebase resolves every action as "the nearest valid thing in range"; so does this.
  const resurrection = resurrectNearbyCorpse(w, connectionId, player, now);
  if (resurrection.handled) return { cooldownStarted: resurrection.cooldownStarted };
  const camp = nearbyAlliedPeasantCamp(w.state.peasantSupport, player, zone(w.state).terrain, now);
  if (camp) {
    w.deps.send(connectionId, {
      t: "peasant.camp_bank",
      id: camp.id,
      gold: camp.storedGold,
      opened: true,
    });
    return { cooldownStarted: false };
  }
  // Standard authored quest bindings win before the same event's advanced command program. If no
  // quest has anything relevant to show, the event program remains the full-control fallback.
  if (triggerQuestTargetNearby(w, connectionId, player)) return { cooldownStarted: false };
  const building = w.state.buildings
    .filter((candidate) => candidate.interiorMapId && !candidate.destroyed)
    .map((candidate) => ({
      building: candidate,
      distance: distanceToBuildingDoor(player, {
        x: candidate.x,
        z: candidate.z,
        assetId: candidate.standingAssetId,
        ...(candidate.orientation === undefined ? {} : { orientation: candidate.orientation }),
        ...(candidate.rotation === undefined ? {} : { rotation: candidate.rotation }),
        ...(candidate.dimensions ? { dimensions: candidate.dimensions } : {}),
      }),
    }))
    .filter((candidate) => candidate.distance <= BUILDING_DOOR_INTERACTION_RANGE)
    .sort((left, right) => left.distance - right.distance)[0]?.building;
  if (building?.interiorMapId) {
    w.deps.enterBuilding(connectionId, player, building.interiorMapId, now, building.id);
    return { cooldownStarted: false };
  }
  // Authored `action` events sit between the life-critical resurrection above and the legacy
  // quest keepers below (see `triggerActionEventNearby`).
  if (triggerActionEventNearby(w, player)) return { cooldownStarted: false };
  const chapter = player.quest.chapter ?? "three_offerings";
  player.quest.chapter = chapter;

  const site = zone(w.state).questSites.find(
    (candidate) =>
      candidate.chapter === chapter &&
      groundDistance(player, groundOf(candidate)) <= INTERACTION_RANGE,
  );
  if (site && player.quest.status === "active") {
    if (site.kind === "resource" && (w.state.siteRespawnAt.get(site.id) ?? 0) > now) {
      w.deps.send(connectionId, { t: "event", code: "interact.nothing", tone: "info" });
      return { cooldownStarted: false };
    }
    interactQuestSite(w, connectionId, player, chapter, site, now);
    return { cooldownStarted: false };
  }

  const definition = questDefinition(zone(w.state), chapter);
  if (!definition) {
    w.deps.send(connectionId, { t: "event", code: "interact.nothing", tone: "info" });
    return { cooldownStarted: false };
  }
  if (groundDistance(player, groundOf(definition.giver)) > INTERACTION_RANGE) {
    w.deps.send(connectionId, { t: "event", code: "interact.nothing", tone: "info" });
    return { cooldownStarted: false };
  }

  if (player.quest.status === "available") {
    player.quest.status = "active";
    player.quest.progress = 0;
    player.quest.target = definition.target;
    player.wardRunExpiresAt = null;
    w.deps.send(connectionId, {
      t: "event",
      code: "quest.accepted",
      params: { chapter, target: definition.target },
      tone: "good",
    });
  } else if (player.quest.status === "active") {
    w.deps.send(connectionId, {
      t: "event",
      code: "quest.progress",
      params: { chapter, progress: player.quest.progress, target: definition.target },
      tone: "info",
    });
  } else if (player.quest.status === "ready") {
    await completeQuestChapter(w, connectionId, player, chapter);
  } else {
    w.deps.send(connectionId, { t: "event", code: "quest.blessing", tone: "good" });
  }
  player.dirty = true;
  sendStateTo(w, connectionId, player);
  return { cooldownStarted: false };
}

export function handlePeasantCampGold(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  campId: string,
  operation: "deposit" | "withdraw",
  amount: number,
): void {
  const result = transferPeasantCampGold({
    runtime: w.state.peasantSupport,
    player,
    terrain: zone(w.state).terrain,
    campId,
    operation,
    amount,
    now: w.deps.now(),
  });
  if (!result.ok) {
    w.deps.send(connectionId, {
      t: "event",
      code:
        result.reason === "insufficient"
          ? "peasant.camp_gold_insufficient"
          : "peasant.camp_gold_unavailable",
      tone: "bad",
    });
    return;
  }
  sendStateTo(w, connectionId, player);
  sendCampBankToParty(w, result.camp, connectionId);
  w.deps.send(connectionId, {
    t: "event",
    code: operation === "deposit" ? "peasant.camp_gold_deposited" : "peasant.camp_gold_withdrawn",
    params: { amount },
    tone: "good",
  });
}

/** Port of `#useConsumable` (`world.ts:3930`). */
export async function handleUseConsumable(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  item: ConsumableId,
): Promise<void> {
  const now = w.deps.now();
  const counts = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
  player.inventory.consumables = counts;
  const resurrection = item === "resurrection_potion";
  if ((resurrection && player.life !== "corpse") || (!resurrection && !canAct(player.life))) {
    w.deps.send(connectionId, { t: "event", code: "item.invalid", params: { item }, tone: "info" });
    return;
  }
  if (player.consumableCooldownUntil > now) {
    w.deps.send(connectionId, {
      t: "event",
      code: "item.cooldown",
      params: { seconds: Math.ceil((player.consumableCooldownUntil - now) / 1_000) },
      tone: "info",
    });
    return;
  }
  if (counts[item] <= 0) {
    w.deps.send(connectionId, { t: "event", code: "item.invalid", params: { item }, tone: "info" });
    return;
  }

  const definition = CONSUMABLES[item];
  if (item === "health_potion") {
    const maxHp = maxHpForLevel(player.level);
    if (player.hp >= maxHp) {
      w.deps.send(connectionId, {
        t: "event",
        code: "item.invalid",
        params: { item },
        tone: "info",
      });
      return;
    }
    const remaining = await w.deps.consumePotion(player, connectionId);
    if (remaining === null) return;
    player.inventory.potions = remaining;
    counts.health_potion = remaining;
    player.hp = Math.min(maxHp, player.hp + definition.effectValue);
  } else if (item === "mana_potion") {
    if (player.resource?.kind !== "mana" || player.resource.current >= player.resource.max) {
      w.deps.send(connectionId, {
        t: "event",
        code: "item.invalid",
        params: { item },
        tone: "info",
      });
      return;
    }
    counts[item] -= 1;
    player.resource.current = Math.min(
      player.resource.max,
      player.resource.current + definition.effectValue,
    );
  } else {
    counts[item] -= 1;
    if (item === "damage_elixir") player.damageBoostUntil = now + definition.durationMs;
    if (item === "oblivion_draught") {
      player.forgottenUntil = now + definition.durationMs;
      forgetPlayer(w, player);
    }
    if (item === "invisibility_potion") {
      player.invisibleUntil = now + definition.durationMs;
      forgetPlayer(w, player);
    }
    if (item === "resurrection_potion") player.resurrectionAt = now + definition.durationMs;
  }

  player.consumableCooldownUntil = now + CONSUMABLE_COOLDOWN_MS;
  player.dirty = true;
  recordActorQuestEvent(w, player, ({ id, mapId, actor }) => ({
    id,
    mapId,
    actor,
    type: "itemUsed",
    itemId: item,
    amount: 1,
  }));
  recordActorQuestEvent(w, player, ({ id, mapId, actor }) => ({
    id,
    mapId,
    actor,
    type: "itemRemoved",
    itemId: item,
    amount: 1,
    inventoryQuantity: counts[item],
  }));
  w.deps.send(connectionId, { t: "event", code: "item.used", params: { item }, tone: "good" });
  sendStateTo(w, connectionId, player);
}

/** Port of `#buyConsumable` (`world.ts:4012`): the counter the hero was served at, or nothing. */
export function handleBuyConsumable(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  item: ConsumableId,
): void {
  // The hero's own shop anchor is already a ground position; the catalogue merchant is a pixel
  // `Vec2`. `groundOf` on the former would read its ELEVATION as a ground axis — the exact flip
  // this increment exists to make impossible — so the two are resolved separately.
  const merchant = merchantForRuntimeRoom();
  const counter: GroundVector | null = player.shopAnchor ?? (merchant ? groundOf(merchant) : null);
  if (!counter || groundDistance(player, counter) > INTERACTION_RANGE) {
    player.shopAnchor = null;
    w.deps.send(connectionId, { t: "event", code: "item.invalid", params: { item }, tone: "bad" });
    return;
  }
  const definition = CONSUMABLES[item];
  if (player.inventory[definition.currency] < definition.price) {
    w.deps.send(connectionId, {
      t: "event",
      code: "merchant.insufficient",
      params: { currency: definition.currency },
      tone: "bad",
    });
    return;
  }
  const counts = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
  player.inventory.consumables = counts;
  player.inventory[definition.currency] -= definition.price;
  counts[item] += 1;
  if (item === "health_potion") player.inventory.potions = counts.health_potion;
  player.dirty = true;
  recordActorQuestEvent(w, player, ({ id, mapId, actor }) => ({
    id,
    mapId,
    actor,
    type: "itemAcquired",
    itemId: item,
    amount: 1,
    inventoryQuantity: counts[item],
  }));
  w.deps.send(connectionId, {
    t: "event",
    code: "merchant.purchased",
    params: { item },
    tone: "good",
  });
  sendStateTo(w, connectionId, player);
}

// -------------------------------------------------------------------------------------------------
// Talents and chat
// -------------------------------------------------------------------------------------------------

/** Port of the `talent.unlock` arm of `#handleMessage` (`world.ts:1761`). */
export function handleTalentUnlock(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  nodeId: string,
): void {
  const result = unlockTalent(player.class, player.level, player.talents, nodeId);
  if (!result.ok) {
    w.deps.send(connectionId, {
      t: "event",
      code: "talent.invalid",
      params: { reason: result.reason },
      tone: "bad",
    });
    return;
  }
  player.talents = result.selected;
  if (player.guarding) {
    player.guardReduction = configuredSkill(w, player, 2).reduction ?? 0;
    player.guardActivatedAt = 0;
  }
  player.dirty = true;
  sendStateTo(w, connectionId, player);
  w.deps.send(connectionId, {
    t: "event",
    code: "talent.unlocked",
    params: { talent: nodeId },
    tone: "good",
  });
}

/** Port of the `talent.reset` arm of `#handleMessage` (`world.ts:1787`). */
export function handleTalentReset(w: WorldGlue, connectionId: string, player: PlayerRuntime): void {
  player.talents = [];
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
  removeLumenPortalsByOwner(w.state.lumenPortals, player.id);
  removeLumenTrailsByOwner(w.state.lumenTrails, player.id);
  removePolarityOrbsByOwner(w.state.polarityOrbs, player.id);
  if (player.guarding) {
    player.guardReduction = configuredSkill(w, player, 2).reduction ?? 0;
    player.guardActivatedAt = 0;
  }
  player.dirty = true;
  sendStateTo(w, connectionId, player);
  w.deps.send(connectionId, { t: "event", code: "talent.reset", tone: "good" });
}

/**
 * Port of the `chat` arm of `#handleMessage` (`world.ts:1891-1909`). A `/command` is parsed first
 * and handled by the cheat executor (gated on `deps.cheatsEnabled`); `party` fans out through the
 * coordinator (the persistent D1 party, across map rooms); anything else is local AOI chat. The
 * legacy runtime-party fallback is rollback-only and not ported.
 */
export function handleChat(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  channel: string | undefined,
  rawText: string,
): void {
  const text = rawText.trim().replaceAll(/\s+/g, " ");
  if (text.length === 0 || text.length > CHAT_MAX_LENGTH) return;
  const cheatCommand = parseCheatCommand(text);
  if (cheatCommand) {
    handleCheatCommand(w, connectionId, player, cheatCommand);
    return;
  }
  if (channel === "party") {
    if (player.identityKind === "hero" && player.partyId) {
      w.deps.broadcastToParty(player.partyId, {
        t: "chat",
        channel: "party",
        from: player.nick,
        text,
      });
    } else {
      w.deps.send(connectionId, { t: "event", code: "party.invalid", tone: "bad" });
    }
    return;
  }
  sendLocalChat(w, player, text);
}

// -------------------------------------------------------------------------------------------------
// Cheat commands
// -------------------------------------------------------------------------------------------------

/** Port of `#cheatRevive` (`world.ts:5718`). */
export function cheatRevive(w: WorldGlue, player: PlayerRuntime): void {
  player.life = "alive";
  player.resurrectionAt = 0;
  player.corpse = null;
  player.hp = maxHpForLevel(player.level);
  grantReviveGrace(w, player, w.deps.now());
  freeze(w, player);
}

/**
 * Port of `#teleportSameMap` (`world.ts:5068`): refuse an unwalkable/out-of-bounds destination
 * with a structured log while the run continues; otherwise set the authoritative position.
 *
 * This is one of the few positions the SERVER still decides. The hero's own client learns of it the
 * way everyone else does — from the next snapshot — and snaps to it, because the position it finds
 * there is one it never reported (`net.ts`, `#adoptServerPosition`).
 */
/**
 * Where an authored teleport actually lands: the target EVENT's cell when it names one and that
 * event still exists, and the authored cell otherwise.
 *
 * The fallback is not a nicety. An author who points a teleport at a door and then deletes that
 * door has left a command that cannot be honoured, and refusing the whole teleport would strand a
 * hero mid-adventure; the authored cell is the last thing the author DID say about where to go.
 * The editor is where a dangling target should be reported, before it ever ships.
 */
export function authoredTeleportTarget(
  events: readonly MapEvent[] | undefined,
  effect: { col: number; row: number; eventId?: string },
): { col: number; row: number } {
  if (effect.eventId === undefined) return { col: effect.col, row: effect.row };
  const target = events?.find((candidate) => candidate.id === effect.eventId);
  return target ? { col: target.col, row: target.row } : { col: effect.col, row: effect.row };
}

export function teleportSameMap(
  w: WorldGlue,
  player: PlayerRuntime,
  col: number,
  row: number,
  eventId: string,
): "teleported" | "first-refusal" | "repeat-refusal" {
  const terrain = zone(w.state).terrain;
  // `authoredCellCentreGround`, not `eventCellCentre`: the latter answers in the editor's PIXEL,
  // top-left-origin space, and a hero snapped there would land thousands of tiles off the grid.
  const destination = authoredCellCentreGround({ col, row }, terrain.size);
  // The grid runs `-size/2`..`+size/2`, so "in bounds" is a cell index test rather than a
  // rectangle anchored at zero — the origin moved to the middle with the units.
  const inBounds = col >= 0 && row >= 0 && col < terrain.size && row < terrain.size;
  // A teleport is not a step, so the destination's own ground is the right thing to test it
  // against: the question is whether a body could be standing there, not whether one could walk
  // there. Only the disc's relief and the props may refuse it.
  const landing = groundUnder(terrain, destination.x, destination.z, player.y);
  if (!inBounds || !canStand(terrain, destination.x, destination.z, BODY_RADIUS, landing)) {
    const first = logTeleportRefusedOnce(
      w.state,
      eventId,
      inBounds ? "unwalkable" : "out_of_bounds",
      { heroId: player.id, mapId: w.state.location?.zoneId ?? null, col, row },
    );
    return first ? "first-refusal" : "repeat-refusal";
  }
  const previousPosition = { x: player.x, y: player.y, z: player.z };
  displacePlayer(player, { x: destination.x, y: landing, z: destination.z });
  w.state.playerGrid.update(player, previousPosition);
  return "teleported";
}

/** Port of `#handleCheatCommand` (`world.ts:1912`): the executor mutates session state only;
 *  life-state transitions, terrain validation and sends stay here. Gated on `deps.cheatsEnabled`
 *  (legacy `env.CHEATS_ENABLED !== "true"` refusal). */
export function handleCheatCommand(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  command: NonNullable<ReturnType<typeof parseCheatCommand>>,
): void {
  if (!w.deps.cheatsEnabled) {
    w.deps.send(connectionId, { t: "event", code: "cheat.disabled", tone: "bad" });
    return;
  }
  const result = executeCheatCommand(player, command);
  if (result.transition === "die") {
    player.hp = 0;
    killPlayer(w, connectionId, player);
  } else if (result.transition === "ghost") {
    if (player.life === "alive") {
      player.hp = 0;
      killPlayer(w, connectionId, player);
    }
    handleRelease(w, connectionId, player);
  } else if (result.transition === "revive") {
    cheatRevive(w, player);
  }
  if (result.teleport) {
    const terrain = zone(w.state).terrain;
    const destination = authoredCellCentreGround(result.teleport, terrain.size);
    const landable =
      result.teleport.col < terrain.size &&
      result.teleport.row < terrain.size &&
      canStand(
        terrain,
        destination.x,
        destination.z,
        BODY_RADIUS,
        groundUnder(terrain, destination.x, destination.z, player.y),
      );
    if (!landable) {
      w.deps.send(connectionId, { t: "event", code: "cheat.tp_blocked", tone: "bad" });
      return;
    }
    teleportSameMap(w, player, result.teleport.col, result.teleport.row, "cheat");
  }
  if (result.stateChanged) sendStateTo(w, connectionId, player);
  w.deps.send(connectionId, { t: "event", ...result.event, x: player.x, z: player.z });
}

// -------------------------------------------------------------------------------------------------
// Authored event triggers, the budgeted drain and effect dispatch
// -------------------------------------------------------------------------------------------------

/**
 * Port of `#triggerActionEventNearby` (`world.ts:1339`): the interact-key trigger — the nearest
 * `action` event within `INTERACTION_RANGE` starts a run. Returns true when an action event was
 * FOUND (so `handleInteract` stops here even if the run was dropped by the one-run lock) — an
 * interact spent on an event is not a fall-through to the quest NPCs.
 */
export function triggerActionEventNearby(w: WorldGlue, player: PlayerRuntime): boolean {
  if (player.identityKind !== "hero") return false;
  const events = w.state.location?.definition.events ?? [];
  let best: {
    event: MapEvent;
    pageIndex: number;
    program: readonly EventCommand[];
    distance: number;
  } | null = null;
  for (const event of events) {
    const runnable = runnablePage(w.state, event, "action");
    if (runnable === null) continue;
    const distance = groundDistance(player, activeEventCentre(w.state, event));
    if (distance > INTERACTION_RANGE) continue;
    if (best === null || distance < best.distance) best = { event, ...runnable, distance };
  }
  if (best === null) return false;
  const chosen = best;
  const started = startRun(w.state.eventRuns, {
    event: chosen.event,
    pageIndex: chosen.pageIndex,
    program: chosen.program,
    heroId: player.id,
    runId: crypto.randomUUID(),
  });
  if (started) {
    const graphic = chosen.event.pages[chosen.pageIndex]?.graphicAssetId;
    const interaction =
      chosen.event.kind === "npc" ||
      chosen.event.kind === "guard" ||
      (graphic != null && editorAsset(graphic)?.domain === "character")
        ? "npcTalked"
        : "objectInteracted";
    recordActorQuestEvent(w, player, ({ id, mapId, actor }) =>
      interaction === "npcTalked"
        ? { id, mapId, actor, type: "npcTalked", targetEventId: chosen.event.id }
        : { id, mapId, actor, type: "objectInteracted", targetEventId: chosen.event.id },
    );
  }
  return true;
}

/** Resume a `say` run from the `event.advance` intent — validated hero==triggerer inside
 *  `advanceRun`; a stray intent from anyone else drops silently. */
export function handleEventAdvance(w: WorldGlue, player: PlayerRuntime, runId: string): void {
  advanceRun(w.state.eventRuns, player.id, runId);
}

/** Resume a `choices` run from the `event.choose` intent — the option is re-derived and
 *  range-checked from the live command inside `chooseRun`, never a trusted count. */
export function handleEventChoose(
  w: WorldGlue,
  player: PlayerRuntime,
  runId: string,
  index: number,
): void {
  chooseRun(w.state.eventRuns, player.id, runId, index);
}

/**
 * Port of `#closeDistantDialogues` (`world.ts:4546`): end every run parked on a dialogue whose
 * triggerer has walked beyond `DIALOGUE_CLOSE_RADIUS` of its event cell (WoW's rule: the panel
 * closes, the conversation is over). Ending the run is NOT a rollback — anything the run already
 * wrote stays written; walk-away abandons only the REMAINDER.
 */
export function closeWalkedAwayDialogues(w: WorldGlue): void {
  if (w.state.eventRuns.contexts.size === 0) return;
  const events = w.state.location?.definition.events ?? [];
  closeDistantDialogues(w.state.eventRuns, (context) => {
    const player = playerById(w.state, context.heroId);
    if (player === undefined) return true;
    const event = events.find((candidate) => candidate.id === context.eventId);
    if (event === undefined) return true;
    return groundDistance(player, activeEventCentre(w.state, event)) > DIALOGUE_CLOSE_RADIUS;
  });
}

/**
 * Port of `#flushDialogue` (`world.ts:4564`): send every buffered dialogue beat to its triggerer's
 * socket, then clear the buffer. `say`/`choices` carry authored prose — the sanctioned
 * codes-not-sentences data exception — and `closeDialogue` becomes `event.close`. A beat whose
 * triggerer has no socket (already gone) is dropped silently.
 */
export function flushDialogue(w: WorldGlue): void {
  const dialogue = w.state.eventRuns.dialogue;
  if (dialogue.length === 0) return;
  for (const buffered of dialogue) {
    const connectionId = connectionOf(w.state, buffered.heroId);
    if (connectionId === undefined) continue;
    const message = buffered.message;
    if (message.kind === "say") {
      w.deps.send(
        connectionId,
        message.name === null
          ? { t: "event.say", runId: buffered.runId, text: message.text }
          : { t: "event.say", runId: buffered.runId, text: message.text, name: message.name },
      );
    } else if (message.kind === "playSound") {
      w.deps.send(connectionId, {
        t: "event.sound",
        runId: buffered.runId,
        soundId: message.soundId,
      });
    } else if (message.kind === "offerChoices") {
      w.deps.send(connectionId, {
        t: "event.choices",
        runId: buffered.runId,
        prompt: message.prompt,
        options: [...message.options],
      });
    } else {
      w.deps.send(connectionId, { t: "event.close", runId: buffered.runId });
    }
  }
  dialogue.length = 0;
}

/**
 * The sky, the clock and the soundtrack, changed for the WHOLE room.
 *
 * Unlike every other dispatch here this one is not about the triggerer: everyone standing in the
 * rain is standing in the same rain, so the merged block is stored on the room and broadcast to
 * every authorized player. A hero who joins afterwards reads the same block off the welcome, which
 * is what keeps a late arrival from walking into a different sky than the party they joined.
 *
 * `undefined` in a field means "this command did not mention it"; `null` means "back to what the
 * map itself says". The two are deliberately different, and only this merge sees the difference.
 */
export function dispatchAmbience(
  w: WorldGlue,
  effect: Extract<DispatchEffect["effect"], { kind: "ambience" }>,
): void {
  const next: AmbienceState = {
    weather: effect.weather === undefined ? w.state.ambience.weather : effect.weather,
    dayCycle: effect.dayCycle === undefined ? w.state.ambience.dayCycle : effect.dayCycle,
    music: effect.music === undefined ? w.state.ambience.music : effect.music,
  };
  if (
    next.weather === w.state.ambience.weather &&
    next.dayCycle === w.state.ambience.dayCycle &&
    next.music === w.state.ambience.music
  ) {
    return;
  }
  w.state.ambience = next;
  for (const [connectionId, player] of w.state.players) {
    if (!player.authorized) continue;
    w.deps.send(connectionId, { t: "ambience", ...next });
  }
}

/** Port of `#dispatchGold` (`world.ts:4774`): a `changeGold` lands on the triggerer's session
 *  inventory, clamped at zero; a positive grant tells the hero with `loot.picked`. A grant landing
 *  mid-transition is refused with a deduped structured log. */
export function dispatchGold(
  w: WorldGlue,
  dispatch: DispatchEffect,
  effect: Extract<DispatchEffect["effect"], { kind: "changeGold" }>,
): void {
  const connectionId = connectionOf(w.state, dispatch.heroId);
  const player = connectionId === undefined ? undefined : w.state.players.get(connectionId);
  if (connectionId === undefined || !player?.authorized) return;
  if (player.transitioning) {
    logGoldRefusedOnce(w.state, dispatch.eventId, "transitioning", { heroId: player.id });
    return;
  }
  const before = player.inventory.gold;
  const after = Math.max(0, before + effect.amount);
  if (after === before) return;
  player.inventory.gold = after;
  player.dirty = true;
  if (effect.amount > 0) {
    w.deps.send(connectionId, {
      t: "event",
      code: "loot.picked",
      params: { amount: effect.amount, kind: "gold" },
      tone: "good",
    });
  }
  sendStateTo(w, connectionId, player);
}

/** Port of `#dispatchItems` (`world.ts:4829`): a `changeItems` lands on the triggerer's consumable
 *  bag. The runtime is the item-id authority; a full stack refuses with `item.full`; a negative
 *  change clamps at zero; every landed change syncs the `potions` mirror and the self snapshot. */
export function dispatchItems(
  w: WorldGlue,
  dispatch: DispatchEffect,
  effect: Extract<DispatchEffect["effect"], { kind: "changeItems" }>,
): void {
  const connectionId = connectionOf(w.state, dispatch.heroId);
  const player = connectionId === undefined ? undefined : w.state.players.get(connectionId);
  if (connectionId === undefined || !player?.authorized) return;
  if (player.transitioning) {
    logItemRefusedOnce(w.state, dispatch.eventId, effect.itemId, "transitioning", {
      heroId: player.id,
    });
    return;
  }
  if (!isConsumableId(effect.itemId)) {
    logItemRefusedOnce(w.state, dispatch.eventId, effect.itemId, "unknown_item", {
      heroId: player.id,
    });
    return;
  }
  const item: ConsumableId = effect.itemId;
  const counts = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
  player.inventory.consumables = counts;
  let landed = 0;
  if (effect.count > 0) {
    if (counts[item] >= CONSUMABLE_MAX_STACK) {
      w.deps.send(connectionId, { t: "event", code: "item.full", params: { item }, tone: "bad" });
      return;
    }
    const added = Math.min(effect.count, CONSUMABLE_MAX_STACK - counts[item]);
    counts[item] += added;
    landed = added;
    if (item === "health_potion") player.inventory.potions = counts.health_potion;
    player.dirty = true;
    w.deps.send(connectionId, {
      t: "event",
      code: "loot.picked",
      params: { amount: added, kind: item },
      tone: "good",
    });
  } else {
    const before = counts[item];
    const after = Math.max(0, before + effect.count);
    if (after === before) return;
    counts[item] = after;
    landed = after - before;
    if (item === "health_potion") player.inventory.potions = counts.health_potion;
    player.dirty = true;
  }
  if (landed > 0) {
    recordActorQuestEvent(w, player, ({ id, mapId, actor }) => ({
      id,
      mapId,
      actor,
      type: "itemAcquired",
      itemId: item,
      amount: landed,
      inventoryQuantity: counts[item],
    }));
  } else if (landed < 0) {
    recordActorQuestEvent(w, player, ({ id, mapId, actor }) => ({
      id,
      mapId,
      actor,
      type: "itemRemoved",
      itemId: item,
      amount: -landed,
      inventoryQuantity: counts[item],
    }));
  }
  sendStateTo(w, connectionId, player);
}

/** Port of `#dispatchTeleport` (`world.ts:4932`). Same-map is fully authoritative here; cross-map
 *  rides `deps.teleportCrossMap` (`WorldRoom.teleportCrossMap`), the same epoch-fenced handoff an
 *  authored exit uses. */
export function dispatchTeleport(
  w: WorldGlue,
  dispatch: DispatchEffect,
  effect: Extract<DispatchEffect["effect"], { kind: "teleport" }>,
  now: number,
): void {
  const connectionId = connectionOf(w.state, dispatch.heroId);
  const player = connectionId === undefined ? undefined : w.state.players.get(connectionId);
  if (connectionId === undefined || !player?.authorized || player.transitioning) return;
  if (effect.mapId === w.state.location?.zoneId) {
    // A tile-unit position IS the body's centre; the pixel `+ PLAYER_SIZE / 2` recentring is gone.
    const fromX = player.x;
    const fromZ = player.z;
    const target = authoredTeleportTarget(w.state.location?.definition.events, effect);
    const result = teleportSameMap(w, player, target.col, target.row, dispatch.eventId);
    if (result === "first-refusal") {
      w.deps.send(connectionId, { t: "event", code: "zone.transition_failed", tone: "bad" });
    } else if (result === "teleported") {
      w.deps.send(connectionId, {
        t: "event",
        code: "zone.transition",
        // The two GROUND points, departure and arrival. `EventParams` is an untyped bag of
        // numbers, so these names are the only thing saying which axis each one is — `fromY`/`toY`
        // would read as the elevation the client must not draw the flourish at.
        params: {
          teleport: 1,
          ...(effect.category === "interior" ? { interior: 1 } : {}),
          sameMap: 1,
          fromX,
          fromZ,
          toX: player.x,
          toZ: player.z,
        },
        tone: "good",
        x: fromX,
        z: fromZ,
      });
    }
    return;
  }
  w.deps.teleportCrossMap(
    connectionId,
    player,
    effect.mapId,
    effect.col,
    effect.row,
    now,
    dispatch.eventId,
    effect.category,
    effect.eventId,
  );
}

/** Port of `#dispatchOpenShop` (`world.ts:5011`): the event's cell becomes the hero's counter —
 *  `handleBuyConsumable` measures against it, so walking away ends the trade. */
export function dispatchOpenShop(w: WorldGlue, dispatch: DispatchEffect): void {
  const connectionId = connectionOf(w.state, dispatch.heroId);
  const player = connectionId === undefined ? undefined : w.state.players.get(connectionId);
  if (connectionId === undefined || !player?.authorized || player.life !== "alive") return;
  const event = (zone(w.state).events ?? []).find((candidate) => candidate.id === dispatch.eventId);
  if (!event) return;
  player.shopAnchor = activeEventCentre(w.state, event);
  w.deps.send(connectionId, { t: "merchant.open" });
}

/** Port of `#dispatchEndAdventure` (`world.ts:5023`): mark the party's save complete and broadcast
 *  victory, at most once per room lifetime (`state.adventureEndDispatched`); a failed completion
 *  frees the guard so a later trigger can retry. */
export function dispatchEndAdventure(w: WorldGlue, dispatch: DispatchEffect): void {
  if (w.state.adventureEndDispatched) return;
  const connectionId = connectionOf(w.state, dispatch.heroId);
  const player = connectionId === undefined ? undefined : w.state.players.get(connectionId);
  if (connectionId === undefined || !player?.authorized || player.identityKind !== "hero") return;
  const partyId = player.partyId;
  if (!partyId) return;
  w.state.adventureEndDispatched = true;
  w.deps.waitUntil(
    w.deps.completeAdventure(partyId).catch((error: unknown) => {
      w.state.adventureEndDispatched = false;
      console.error(
        JSON.stringify({
          event: "event_end_adventure_failed",
          partyId,
          eventId: dispatch.eventId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }),
  );
}

/** Apply one authored trap effect to its triggerer. The event program cannot select another hero. */
export function dispatchDamage(
  w: WorldGlue,
  dispatch: DispatchEffect,
  effect: Extract<DispatchEffect["effect"], { kind: "damage" }>,
  now: number,
): void {
  const connectionId = connectionOf(w.state, dispatch.heroId);
  const player = connectionId === undefined ? undefined : w.state.players.get(connectionId);
  if (connectionId === undefined || !player?.authorized || player.transitioning) return;
  damagePlayerFromEvent(w, connectionId, player, effect.amount, effect.lethal, now);
}

/** Grant one temporary locomotion modifier to the triggering hero. The authored command selects
 * neither a target nor a deadline: the room derives both and immediately republishes self state. */
export function dispatchMovementEffect(
  w: WorldGlue,
  dispatch: DispatchEffect,
  effect: Extract<DispatchEffect["effect"], { kind: "movementEffect" }>,
  now: number,
): void {
  const connectionId = connectionOf(w.state, dispatch.heroId);
  const player = connectionId === undefined ? undefined : w.state.players.get(connectionId);
  if (
    connectionId === undefined ||
    !player?.authorized ||
    player.transitioning ||
    player.life !== "alive"
  )
    return;
  player.movementEffects.set(effect.effect, {
    kind: effect.effect,
    power: effect.power,
    until: now + effect.durationMs,
  });
  consumeMovementPickup(w.state, dispatch.eventId);
  sendStateTo(w, connectionId, player);
}

/**
 * Port of `#drainEventRuns` (`world.ts:4455`): step every live run its budgeted slice, then
 * dispatch the effects that need this room's authority. State mutations are batched into ONE
 * coordinator RPC (the single writer); the drain pauses (`state.eventStateSync`) until that push
 * lands, while simulation keeps ticking — the next drain must seed its working copy from the
 * acknowledged snapshot, never a pre-batch value that would replay a non-idempotent `add`.
 *
 * Order: close any walked-away dialogue FIRST (it buffers a `closeDialogue` beat and releases the
 * lock), then drain the survivors, then flush every buffered beat — a run's `say`/`choices` and
 * its distance-close all reach the wire in the same tick they were produced.
 */
export function drainEventRuns(w: WorldGlue, now: number): void {
  closeWalkedAwayDialogues(w);
  if (w.state.eventStateSync !== null) {
    flushDialogue(w);
    return;
  }
  if (w.state.eventRuns.contexts.size > 0) {
    const { effects } = drainRuns(w.state.eventRuns, {
      state: w.state.adventureState.state,
      tick: w.state.tick,
    });
    const mutations: StateMutation[] = [];
    for (const dispatch of effects) {
      const effect = dispatch.effect;
      if (effect.kind === "mutateState") {
        mutations.push(effect.op);
      } else if (effect.kind === "teleport") {
        dispatchTeleport(w, dispatch, effect, now);
      } else if (effect.kind === "endAdventure") {
        dispatchEndAdventure(w, dispatch);
      } else if (effect.kind === "openShop") {
        dispatchOpenShop(w, dispatch);
      } else if (effect.kind === "changeGold") {
        dispatchGold(w, dispatch, effect);
      } else if (effect.kind === "changeItems") {
        dispatchItems(w, dispatch, effect);
      } else if (effect.kind === "damage") {
        dispatchDamage(w, dispatch, effect, now);
      } else if (effect.kind === "movementEffect") {
        dispatchMovementEffect(w, dispatch, effect, now);
      } else if (effect.kind === "ambience") {
        dispatchAmbience(w, effect);
      } else {
        const player = playerById(w.state, dispatch.heroId);
        if (player) {
          recordActorQuestEvent(w, player, ({ id, mapId, actor }) =>
            effect.fact.type === "areaEntered"
              ? { id, mapId, actor, type: "areaEntered", areaId: effect.fact.areaId }
              : {
                  id,
                  mapId,
                  actor,
                  type: "activityCompleted",
                  activityId: effect.fact.activityId,
                  amount: 1,
                },
          );
        }
      }
    }
    if (mutations.length > 0 && w.state.partyId !== "") {
      const sync = w.deps.applyStateChanges(mutations);
      w.state.eventStateSync = sync;
      w.deps.waitUntil(
        sync.then(
          () => {
            if (w.state.eventStateSync === sync) w.state.eventStateSync = null;
            return;
          },
          (error: unknown) => {
            if (w.state.eventStateSync === sync) {
              w.state.eventStateSync = null;
              // The run has already advanced past mutations that never became authoritative.
              // Continuing would execute its remainder against a lie, so release every lock.
              resetEventRunRuntime(w.state.eventRuns);
            }
            console.error(
              JSON.stringify({
                event: "event_state_sync_failed",
                partyId: w.state.partyId,
                roomKey: w.state.roomKey,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          },
        ),
      );
    }
  }
  flushDialogue(w);
}

// -------------------------------------------------------------------------------------------------
// Authored quest conversations (quest.open / quest.result / quest.close)
// -------------------------------------------------------------------------------------------------

/** Port of `#questDialogueEntries` (`world.ts:1050`). */
export function questDialogueEntries(
  w: WorldGlue,
  player: PlayerRuntime,
  target: QuestEventReference,
): QuestDialogueEntry[] {
  const state = w.state;
  const speakingEvent = state.location?.definition.events?.find(
    (event) => event.id === target.eventId,
  );
  const speakerName =
    speakingEvent?.name.trim() ||
    (speakingEvent ? `EV${String(speakingEvent.ordinal).padStart(3, "0")}` : "EV000");
  const definitions = questDefinitionsForPlayer(state, player);
  const index = buildQuestInteractionIndex(definitions);
  const completed = new Set([
    ...completedQuestIds(state.adventureState.state.quests),
    ...completedQuestIds(player.authoredQuestProgress),
  ]);
  const selected = new Map<
    string,
    {
      candidate: ReturnType<typeof questTargetCandidates>[number];
      state: ReturnType<typeof authoredQuestRuntimeState>;
      rank: number;
    }
  >();
  for (const candidate of questTargetCandidates(index, target)) {
    const progress = questProgressForPlayer(state, player, candidate.definition);
    const runtimeState = authoredQuestRuntimeState(candidate.definition, progress, {
      level: player.level,
      completedQuestIds: completed,
      adventureState: state.adventureState.state,
    });
    const rank =
      runtimeState === "ready" && candidate.role === "turn-in"
        ? 5
        : runtimeState === "available" &&
            candidate.role === "giver" &&
            candidate.definition.acceptance === "manual"
          ? 4
          : runtimeState === "active"
            ? 3
            : runtimeState === "completed"
              ? 2
              : runtimeState === "unavailable"
                ? 1
                : 0;
    if (rank === 0) continue;
    const current = selected.get(candidate.definition.id);
    if (!current || rank > current.rank)
      selected.set(candidate.definition.id, { candidate, state: runtimeState, rank });
  }
  return [...selected.values()]
    .sort((left, right) => right.rank - left.rank)
    .flatMap(({ candidate, state: runtimeState }) => {
      const definition = candidate.definition;
      const phase =
        runtimeState === "available"
          ? ("offer" as const)
          : runtimeState === "active" ||
              runtimeState === "ready" ||
              runtimeState === "completed" ||
              runtimeState === "unavailable"
            ? runtimeState
            : null;
      if (!phase) return [];
      const text =
        phase === "offer"
          ? definition.dialogues.offer || definition.description
          : phase === "active"
            ? definition.dialogues.reminder || definition.journalSummary || definition.description
            : phase === "ready"
              ? definition.dialogues.ready || definition.journalSummary || definition.description
              : phase === "completed"
                ? definition.dialogues.completed
                : definition.dialogues.unavailable;
      // Completed/unavailable entries are useful only when the creator authored an explicit line;
      // otherwise they would crowd a multi-quest giver with inert cards.
      if ((phase === "completed" || phase === "unavailable") && text.length === 0) return [];
      const canTurnIn = phase === "ready" && candidate.role === "turn-in";
      return [
        {
          questId: definition.id,
          speakerName,
          title: definition.title || `Quête ${definition.id}`,
          text,
          category: definition.category,
          region: definition.region,
          landmark: definition.landmark,
          giverName: definition.giverName || speakerName,
          phase,
          canAccept:
            phase === "offer" && candidate.role === "giver" && definition.acceptance === "manual",
          canTurnIn,
          rewardChoices: canTurnIn
            ? definition.rewards.choices.map((choice) => ({ id: choice.id, label: choice.label }))
            : [],
        },
      ];
    });
}

/** Port of `#triggerQuestTargetNearby` (`world.ts:1148`): open the standard quest panel for the
 *  nearest bound action event. */
export function triggerQuestTargetNearby(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
): boolean {
  if (player.identityKind !== "hero" || player.partyId === null) return false;
  const state = w.state;
  const mapId = state.location?.zoneId;
  if (!mapId) return false;
  let nearest: { event: MapEvent; pageIndex: number; distance: number } | null = null;
  for (const event of state.location?.definition.events ?? []) {
    if (!isInteractiveWorldEventKind(event.kind)) continue;
    const pageIndex = activePageIndex(event, state.adventureState.state);
    if (pageIndex === null) continue;
    const page = event.pages[pageIndex];
    if (page?.trigger !== "action") continue;
    const distance = groundDistance(player, activeEventCentre(state, event));
    if (distance > INTERACTION_RANGE) continue;
    const entries = questDialogueEntries(w, player, { mapId, eventId: event.id });
    if (entries.length === 0) continue;
    if (!nearest || distance < nearest.distance) nearest = { event, pageIndex, distance };
  }
  if (!nearest) return false;
  const found = nearest;
  const target = { mapId, eventId: found.event.id };
  const entries = questDialogueEntries(w, player, target);
  if (entries.length === 0) return false;
  const conversation: PendingQuestConversation = {
    id: crypto.randomUUID(),
    heroId: player.id,
    target,
    questIds: new Set(entries.map((entry) => entry.questId)),
    resolved: false,
  };
  state.questConversations.set(player.id, conversation);
  w.deps.send(connectionId, { t: "quest.open", conversationId: conversation.id, entries });
  const graphic = found.event.pages[found.pageIndex]?.graphicAssetId;
  const interaction =
    found.event.kind === "npc" ||
    found.event.kind === "guard" ||
    (graphic != null && editorAsset(graphic)?.domain === "character")
      ? "npcTalked"
      : "objectInteracted";
  recordActorQuestEvent(w, player, ({ id, mapId: eventMapId, actor }) =>
    interaction === "npcTalked"
      ? { id, mapId: eventMapId, actor, type: "npcTalked", targetEventId: found.event.id }
      : { id, mapId: eventMapId, actor, type: "objectInteracted", targetEventId: found.event.id },
  );
  return true;
}

/** Port of `#applyAuthoredQuestReward` (`world.ts:4608`). */
export function applyAuthoredQuestReward(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  result: Extract<QuestTurnInResult, { ok: true }>,
  customRun?: { event: MapEvent; pageIndex: number },
): void {
  const counts = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
  const beforeLevel = player.level;
  for (const item of result.consumed) {
    const itemId = item.itemId as ConsumableId;
    counts[itemId] = Math.max(0, counts[itemId] - item.quantity);
    recordActorQuestEvent(w, player, ({ id, mapId, actor }) => ({
      id,
      mapId,
      actor,
      type: "itemRemoved",
      itemId,
      amount: item.quantity,
      inventoryQuantity: counts[itemId],
    }));
  }
  for (const item of result.items) {
    const itemId = item.itemId as ConsumableId;
    counts[itemId] = Math.min(CONSUMABLE_MAX_STACK, counts[itemId] + item.quantity);
    recordActorQuestEvent(w, player, ({ id, mapId, actor }) => ({
      id,
      mapId,
      actor,
      type: "itemAcquired",
      itemId,
      amount: item.quantity,
      inventoryQuantity: counts[itemId],
    }));
  }
  player.inventory.consumables = counts;
  player.inventory.potions = counts.health_potion;
  player.inventory.gold += result.gold;
  const gained = applyExperience(player.level, player.xp, result.experience);
  player.level = gained.level;
  player.xp = gained.xp;
  player.hp = maxHpForLevel(gained.level);
  player.dirty = true;
  sendStateTo(w, connectionId, player);
  const rewardedItemCount = result.items.reduce((total, item) => total + item.quantity, 0);
  if (result.experience > 0 || result.gold > 0 || rewardedItemCount > 0) {
    w.deps.send(connectionId, {
      t: "event",
      code: "authored_quest.reward",
      params: { experience: result.experience, gold: result.gold, items: rewardedItemCount },
      tone: "good",
    });
  }
  if (player.level > beforeLevel) {
    w.deps.send(connectionId, {
      t: "event",
      code: "level_up",
      params: { level: player.level },
      tone: "good",
    });
  }
  if (result.customCommands.length > 0 && customRun) {
    startRun(w.state.eventRuns, {
      event: customRun.event,
      pageIndex: customRun.pageIndex,
      program: result.customCommands,
      heroId: player.id,
      runId: crypto.randomUUID(),
    });
  }
}

/** Port of `#claimAutomaticQuestReward` (`world.ts:4683`). */
export async function claimAutomaticQuestReward(
  w: WorldGlue,
  player: PlayerRuntime,
  questId: string,
): Promise<void> {
  const connectionId = connectionOf(w.state, player.id);
  const actor = questActor(player);
  if (connectionId === undefined || !actor || player.partyId === null) return;
  if (!(await w.deps.savePlayer(player, connectionId))) return;
  const counts = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
  const result = await w.deps.completeAuthoredQuest(
    player.partyId,
    actor,
    questId,
    null,
    undefined,
    {
      level: player.level,
      xp: player.xp,
      hp: player.hp,
      inventory: counts,
    },
  );
  if (result.ok) applyAuthoredQuestReward(w, connectionId, player, result);
}

/** The completed-quest automatic reward fan-out on `recordQuestEvent`'s result — the `.then`
 *  half of legacy `#recordQuestEvent` (`world.ts:4700-4717`). */
export function handleQuestChanges(
  w: WorldGlue,
  event: QuestBusinessEvent,
  changes: readonly AuthoredQuestChange[],
): void {
  const fallbackHeroId =
    event.type === "monsterKilled" || event.type === "bossDefeated"
      ? event.killer.heroId
      : event.actor.heroId;
  for (const change of changes) {
    if (change.status !== "completed") continue;
    const heroId = change.heroId ?? fallbackHeroId;
    const player = playerById(w.state, heroId);
    if (player) {
      w.deps.waitUntil(claimAutomaticQuestReward(w, player, change.questId));
    }
  }
}

/** Port of `#handleQuestAction` (`world.ts:1197`). */
export async function handleQuestAction(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  message: Extract<ClientMessage, { t: "quest.action" }>,
): Promise<void> {
  const state = w.state;
  const conversation = state.questConversations.get(player.id);
  if (!conversation || conversation.id !== message.conversationId) return;
  if (message.action === "close") {
    state.questConversations.delete(player.id);
    w.deps.send(connectionId, { t: "quest.close", conversationId: conversation.id });
    return;
  }
  if (conversation.resolved || !message.questId || !conversation.questIds.has(message.questId)) {
    return;
  }
  const event = state.location?.definition.events?.find(
    (candidate) => candidate.id === conversation.target.eventId,
  );
  const pageIndex = event ? activePageIndex(event, state.adventureState.state) : null;
  const page = pageIndex === null ? undefined : event?.pages[pageIndex];
  if (
    pageIndex === null ||
    !event ||
    !page ||
    page.trigger !== "action" ||
    groundDistance(player, activeEventCentre(state, event)) > DIALOGUE_CLOSE_RADIUS
  ) {
    state.questConversations.delete(player.id);
    w.deps.send(connectionId, { t: "quest.close", conversationId: conversation.id });
    return;
  }
  const definition = questDefinitionsForPlayer(state, player).find(
    (quest) => quest.id === message.questId,
  );
  const entry = questDialogueEntries(w, player, conversation.target).find(
    (candidate) => candidate.questId === message.questId,
  );
  if (!definition || !entry) return;
  if (message.action === "refuse") {
    if (!entry.canAccept) return;
    conversation.resolved = true;
    w.deps.send(connectionId, {
      t: "quest.result",
      conversationId: conversation.id,
      questId: definition.id,
      speakerName: entry.speakerName,
      title: definition.title || `Quête ${definition.id}`,
      text: definition.dialogues.refused,
      outcome: "refused",
    });
    return;
  }
  const actor = questActor(player);
  if (!actor || player.partyId === null) return;
  if (message.action === "accept") {
    if (!entry.canAccept) return;
    const inventory = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
    const result = await w.deps.acceptAuthoredQuest(
      player.partyId,
      actor,
      definition.id,
      conversation.target,
      inventory,
    );
    conversation.resolved = true;
    w.deps.send(connectionId, {
      t: "quest.result",
      conversationId: conversation.id,
      questId: definition.id,
      speakerName: entry.speakerName,
      title: definition.title || `Quête ${definition.id}`,
      text: result.ok ? definition.dialogues.accepted : "",
      outcome: result.ok ? "accepted" : "failed",
    });
    if (result.ok && result.progress.status === "completed") {
      await claimAutomaticQuestReward(w, player, definition.id);
    }
    return;
  }
  if (!entry.canTurnIn) return;
  if (!(await w.deps.savePlayer(player, connectionId))) return;
  const counts = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
  const result = await w.deps.completeAuthoredQuest(
    player.partyId,
    actor,
    definition.id,
    conversation.target,
    message.rewardChoiceId,
    { level: player.level, xp: player.xp, hp: player.hp, inventory: counts },
  );
  conversation.resolved = true;
  if (result.ok) {
    // Personal-scope completion state reaches this hero through the coordinator's own
    // personal-progress push (`installPersonalQuestProgress`), exactly like legacy.
    applyAuthoredQuestReward(w, connectionId, player, result, { event, pageIndex });
  }
  w.deps.send(connectionId, {
    t: "quest.result",
    conversationId: conversation.id,
    questId: definition.id,
    speakerName: entry.speakerName,
    title: definition.title || `Quête ${definition.id}`,
    text: result.ok ? definition.dialogues.turnIn : "",
    outcome: result.ok ? "completed" : "failed",
  });
}

/** Port of `#handleQuestAbandon` (`world.ts:1311`): journal abandonment is an intent — the
 *  coordinator rechecks ownership, state and the pinned rule. */
export async function handleQuestAbandon(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  questId: string,
): Promise<void> {
  const actor = questActor(player);
  if (!actor || player.partyId === null) return;
  const result = await w.deps.abandonAuthoredQuest(player.partyId, actor, questId);
  if (!result.ok) {
    w.deps.send(connectionId, { t: "event", code: "authored_quest.action_failed", tone: "bad" });
    return;
  }
  const conversation = w.state.questConversations.get(player.id);
  if (conversation) {
    w.state.questConversations.delete(player.id);
    w.deps.send(connectionId, { t: "quest.close", conversationId: conversation.id });
  }
  // The pushed authoritative snapshot drives the actor and every party member's journal notice.
}

// -------------------------------------------------------------------------------------------------
// Tick-order slots
// -------------------------------------------------------------------------------------------------
