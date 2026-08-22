/**
 * Everything the room SENDS: per-player state, spatial and room events, local chat, peasant and
 * priest views, the quest trackers a client renders, and the resync path. No rule decides anything
 * here — these functions serialize decisions already made.
 *
 * Extracted from `worldTick.ts`, which had grown to 7100 lines and 136 declarations while its own
 * docblock still called it "the tick order". Same functions, same explicit-dependency shape; only
 * the file boundary is new.
 */

import {
  type AuthoredQuestMarker,
  type AuthoredQuestProgress,
  type AuthoredQuestTracker,
  authoredQuestTrackers,
  EMPTY_ADVENTURE_STATE,
} from "@lindocara/engine/adventure-state.js";
import type { GroundVector } from "@lindocara/engine/ground.js";
import { LOCAL_CHAT_RADIUS, SPATIAL_EVENT_RADIUS } from "@lindocara/engine/interest.js";
import { EMPTY_PARTY_MATERIALS } from "@lindocara/engine/party-harvest-state.js";
import type { ServerMessage } from "@lindocara/engine/protocol.js";
import {
  authoredQuestRuntimeState,
  buildQuestInteractionIndex,
  completedQuestIds,
  questMarkerForTarget,
  questMarkerPriority,
  questTargetCandidates,
} from "@lindocara/engine/quest-runtime.js";
import type { AuthoredQuestDefinition } from "@lindocara/engine/quests.js";

import { type InterestSystemContext, worldView } from "../../world/interest-system.js";
import type {
  PeasantCampRuntime,
  PeasantRationRuntime,
} from "../../world/peasant-support-system.js";
import { questDefinition } from "../../world/quest-system.js";
import { selfState, sendState, sendWorldResync } from "../../world/snapshot-system.js";
import { type PlayerRuntime, RESYNC_COOLDOWN_MS } from "../../world/world-runtime.js";
import type { WorldGlue } from "./world-glue.ts";
import { connectionOf, recordActorQuestEvent, zone } from "./world-glue.ts";
import type { WorldRoomState } from "./worldState.ts";

/** Port of `#selfState` (`world.ts:5820`): the welcome's self snapshot, trackers and markers
 *  included. */
export function selfStateFor(w: WorldGlue, player: PlayerRuntime): ReturnType<typeof selfState> {
  const chapter = player.quest.chapter ?? "three_offerings";
  return selfState(
    player,
    questDefinition(zone(w.state), chapter)?.target,
    playerQuestTrackers(w.state, player),
    playerQuestMarkers(w.state, player),
    w.state.adventureState.state.materials ?? EMPTY_PARTY_MATERIALS,
  );
}

/** Port of the join-time `mapEntered` gameplay fact (`world.ts:852`): arrival is a server-minted
 *  fact, not a client claim; reconnects are harmless (reach objectives clamp at one). */
export function recordMapEntered(w: WorldGlue, player: PlayerRuntime): void {
  recordActorQuestEvent(w, player, ({ id, mapId, actor }) => ({
    id,
    mapId,
    actor,
    type: "mapEntered",
  }));
}

/** Port of `#sendState` (`world.ts:5830`), authored-quest trackers and markers included. */
export function sendStateTo(w: WorldGlue, connectionId: string, player: PlayerRuntime): void {
  const chapter = player.quest.chapter ?? "three_offerings";
  sendState(
    connectionId,
    player,
    questDefinition(zone(w.state), chapter)?.target,
    (recipient, message) => w.deps.send(recipient, message),
    playerQuestTrackers(w.state, player),
    playerQuestMarkers(w.state, player),
    w.state.adventureState.state.materials ?? EMPTY_PARTY_MATERIALS,
  );
}

/**
 * Tells every hero the room has moved that the room moved it — an obligation, not an optimisation.
 *
 * `SelfState.displacement` is the only carrier of a server-authored displacement, and until it
 * arrives the client's every `move` frame is dropped (`knowsCurrentDisplacement`). A displacement
 * nobody announced therefore does not merely go unnoticed: it locks its hero out of the position
 * stream for as long as the silence lasts. Most sites already send a state frame of their own and
 * `selfState` marks the stamp as it builds one, so this normally sends nothing at all — it exists so
 * that a site which does not, and the fifteenth site added tomorrow, cannot cost a hero its
 * movement.
 *
 * Run immediately before the snapshot flush, and THAT ORDER IS THE CONTRACT: both frames leave on
 * one ordered socket, so the stamp is always in the client's hands before the `world.delta` carrying
 * the displaced position — and a client can never adopt the position of a displacement it has not
 * been told about.
 */
export function announceDisplacements(w: WorldGlue): void {
  for (const [connectionId, player] of w.state.players) {
    if (!player.authorized || player.displacement === player.displacementAnnounced) continue;
    sendStateTo(w, connectionId, player);
  }
}

/** Idempotent camp replay for admission and the slow AOI catch-up heartbeat. */
export function sendPeasantCampsTo(w: WorldGlue, connectionId: string, now: number): void {
  for (const camp of w.state.peasantSupport.camps) {
    if (camp.expiresAt <= now) continue;
    w.deps.send(connectionId, {
      t: "peasant.camp",
      id: camp.id,
      actorId: camp.ownerId,
      x: camp.x,
      z: camp.z,
      radius: camp.radius,
      startedAt: camp.startedAt,
      expiresAt: camp.expiresAt,
    });
  }
}

export function peasantRationMessage(ration: PeasantRationRuntime): ServerMessage {
  return {
    t: "peasant.ration",
    id: ration.id,
    actorId: ration.ownerId,
    originX: ration.originX,
    originY: ration.originY,
    originZ: ration.originZ,
    x: ration.x,
    y: ration.y,
    z: ration.z,
    launchedAt: ration.launchedAt,
    landsAt: ration.landsAt,
    fadeAt: ration.fadeAt,
    expiresAt: ration.expiresAt,
  };
}

export function sendPeasantRationEvent(w: WorldGlue, message: ServerMessage): void {
  for (const [connectionId, player] of w.state.players) {
    if (player.authorized) w.deps.send(connectionId, message);
  }
}

/** Idempotent ration replay for admission and the slow AOI catch-up heartbeat. */
export function sendPeasantRationsTo(w: WorldGlue, connectionId: string, now: number): void {
  for (const ration of w.state.peasantSupport.rations) {
    if (ration.expiresAt <= now) continue;
    w.deps.send(connectionId, peasantRationMessage(ration));
  }
}

/** Admission replay for the two persistent Pas de Lumen visuals. */
export function sendPriestLumenEffectsTo(w: WorldGlue, connectionId: string, now: number): void {
  for (const trail of w.state.lumenTrails) {
    if (trail.expiresAt <= now || trail.points.length < 2) continue;
    w.deps.send(connectionId, {
      t: "priest.lumen_trail",
      id: trail.id,
      actorId: trail.ownerId,
      points: trail.points.map((point) => ({ x: point.x, z: point.z })),
      width: trail.width,
      startedAt: trail.startedAt,
      endsAt: trail.expiresAt,
    });
  }
  for (const portal of w.state.lumenPortals) {
    if (portal.expiresAt <= now) continue;
    w.deps.send(connectionId, {
      t: "priest.lumen_portal",
      id: portal.id,
      actorId: portal.ownerId,
      from: portal.from,
      to: portal.to,
      startedAt: portal.startedAt,
      endsAt: portal.expiresAt,
    });
  }
}

export function sendCampBankToParty(
  w: WorldGlue,
  camp: PeasantCampRuntime,
  openedConnectionId?: string,
): void {
  for (const [connectionId, candidate] of w.state.players) {
    if (!candidate.authorized || candidate.partyId !== camp.ownerPartyId) continue;
    w.deps.send(connectionId, {
      t: "peasant.camp_bank",
      id: camp.id,
      gold: camp.storedGold,
      opened: connectionId === openedConnectionId,
    });
  }
}

/** Port of `#authoredQuestTrackers` (`world.ts:5842`). */
export function playerQuestTrackers(
  state: WorldRoomState,
  player: PlayerRuntime,
): readonly AuthoredQuestTracker[] {
  const registry = state.adventureRegistry;
  const adventureState = state.adventureState.state;
  const definitions = registry.quests ?? [];
  const scopeById = new Map(definitions.map((quest) => [quest.id, quest.scope]));
  const scopedProgress = (
    progress: Readonly<Record<string, AuthoredQuestProgress>> | undefined,
    scope: "party" | "personal",
  ): Record<string, AuthoredQuestProgress> =>
    Object.fromEntries(
      Object.entries(progress ?? {}).filter(([, value]) => {
        const resolvedScope = value.definitionSnapshot?.scope;
        return resolvedScope === undefined || resolvedScope === scope;
      }),
    );
  const partyRegistry = {
    ...registry,
    quests: definitions.filter((quest) => quest.scope === "party"),
  };
  const personalRegistry = {
    ...registry,
    quests: definitions.filter((quest) => quest.scope === "personal"),
  };
  const partyProgress = Object.fromEntries(
    Object.entries(scopedProgress(adventureState.quests, "party")).filter(
      ([questId, value]) =>
        value.definitionSnapshot !== null || scopeById.get(questId) !== "personal",
    ),
  );
  const personalProgress = Object.fromEntries(
    Object.entries(scopedProgress(player.authoredQuestProgress, "personal")).filter(
      ([questId, value]) => value.definitionSnapshot !== null || scopeById.get(questId) !== "party",
    ),
  );
  const completed = new Set([
    ...completedQuestIds(adventureState.quests),
    ...completedQuestIds(player.authoredQuestProgress),
  ]);
  const availableQuestIds = (scope: "party" | "personal"): Set<string> =>
    new Set(
      definitions.flatMap((definition) => {
        if (definition.scope !== scope || definition.acceptance !== "manual") return [];
        const progress =
          scope === "party" ? partyProgress[definition.id] : personalProgress[definition.id];
        return authoredQuestRuntimeState(definition, progress, {
          level: player.level,
          completedQuestIds: completed,
          adventureState,
        }) === "available"
          ? [definition.id]
          : [];
      }),
    );
  return [
    ...authoredQuestTrackers(
      partyRegistry,
      { ...adventureState, quests: partyProgress },
      { availableQuestIds: availableQuestIds("party") },
    ),
    ...authoredQuestTrackers(
      personalRegistry,
      { ...EMPTY_ADVENTURE_STATE, quests: personalProgress },
      { availableQuestIds: availableQuestIds("personal") },
    ),
  ];
}

/** Port of `#questDefinitionsForPlayer` (`world.ts:5911`). */
export function questDefinitionsForPlayer(
  state: WorldRoomState,
  player: PlayerRuntime,
): AuthoredQuestDefinition[] {
  const definitions = new Map(
    (state.adventureRegistry.quests ?? []).map((definition) => [definition.id, definition]),
  );
  for (const progress of Object.values(state.adventureState.state.quests ?? {})) {
    if (
      progress.definitionSnapshot?.scope === "party" &&
      (progress.status !== "completed" || !progress.definitionSnapshot.repeatable)
    ) {
      definitions.set(progress.definitionSnapshot.id, progress.definitionSnapshot);
    }
  }
  for (const progress of Object.values(player.authoredQuestProgress ?? {})) {
    if (
      progress.definitionSnapshot?.scope === "personal" &&
      (progress.status !== "completed" || !progress.definitionSnapshot.repeatable)
    ) {
      definitions.set(progress.definitionSnapshot.id, progress.definitionSnapshot);
    }
  }
  return [...definitions.values()];
}

/** Port of `#questProgressForPlayer` (`world.ts:5934`). */
export function questProgressForPlayer(
  state: WorldRoomState,
  player: PlayerRuntime,
  definition: AuthoredQuestDefinition,
): AuthoredQuestProgress | undefined {
  return definition.scope === "party"
    ? state.adventureState.state.quests?.[definition.id]
    : player.authoredQuestProgress?.[definition.id];
}

/** Port of `#authoredQuestMarkers` (`world.ts:5943`). */
export function playerQuestMarkers(
  state: WorldRoomState,
  player: PlayerRuntime,
): AuthoredQuestMarker[] {
  const mapId = state.location?.zoneId;
  if (!mapId) return [];
  const index = buildQuestInteractionIndex(questDefinitionsForPlayer(state, player));
  const completed = new Set([
    ...completedQuestIds(state.adventureState.state.quests),
    ...completedQuestIds(player.authoredQuestProgress),
  ]);
  const markers = new Map<string, AuthoredQuestMarker["kind"]>();
  for (const event of state.activeEvents) {
    for (const candidate of questTargetCandidates(index, { mapId, eventId: event.id })) {
      const progress = questProgressForPlayer(state, player, candidate.definition);
      const runtimeState = authoredQuestRuntimeState(candidate.definition, progress, {
        level: player.level,
        completedQuestIds: completed,
        adventureState: state.adventureState.state,
      });
      const marker = questMarkerForTarget(candidate, runtimeState);
      if (!marker) continue;
      const current = markers.get(event.id);
      if (!current || questMarkerPriority(marker) > questMarkerPriority(current)) {
        markers.set(event.id, marker);
      }
    }
  }
  return [...markers].map(([eventId, kind]) => ({ eventId, kind }));
}

/** Port of `#sendSpatialEvent` (`world.ts:6093`). */
export function sendSpatialEvent(
  w: WorldGlue,
  message: ServerMessage,
  position: GroundVector,
): void {
  for (const recipient of w.state.playerGrid.queryRadius(position, SPATIAL_EVENT_RADIUS)) {
    if (!recipient.authorized) continue;
    const connectionId = connectionOf(w.state, recipient.id);
    if (connectionId !== undefined) w.deps.send(connectionId, message);
  }
}

/** Broadcast an event to every authorized hero currently present in this room. */
export function sendRoomEvent(w: WorldGlue, message: ServerMessage): void {
  for (const [connectionId, player] of w.state.players) {
    if (player.authorized) w.deps.send(connectionId, message);
  }
}

/** Port of `#sendSpatialEventAcross` (`world.ts:6101`). */
export function sendSpatialEventAcross(
  w: WorldGlue,
  message: ServerMessage,
  positions: readonly GroundVector[],
): void {
  const sent = new Set<string>();
  for (const position of positions) {
    for (const recipient of w.state.playerGrid.queryRadius(position, SPATIAL_EVENT_RADIUS)) {
      if (!recipient.authorized) continue;
      const connectionId = connectionOf(w.state, recipient.id);
      if (connectionId === undefined || sent.has(connectionId)) continue;
      sent.add(connectionId);
      w.deps.send(connectionId, message);
    }
  }
}

/** Port of `#sendLocalChat` (`world.ts:6079`). */
export function sendLocalChat(w: WorldGlue, sender: PlayerRuntime, text: string): void {
  const message: ServerMessage = { t: "chat", channel: "local", from: sender.nick, text };
  for (const recipient of w.state.playerGrid.queryRadius(sender, LOCAL_CHAT_RADIUS)) {
    if (!recipient.authorized) continue;
    const connectionId = connectionOf(w.state, recipient.id);
    if (connectionId !== undefined) w.deps.send(connectionId, message);
  }
}

export function interestContext(w: WorldGlue): InterestSystemContext<string> {
  return {
    players: w.state.players,
    monsters: w.state.monsters,
    guards: w.state.guards,
    loot: w.state.loot,
    projectiles: w.state.projectiles,
    seaGuardian: w.state.seaGuardian,
    playerGrid: w.state.playerGrid,
    monsterGrid: w.state.monsterGrid,
    lootGrid: w.state.lootGrid,
    navigationDebugAvailable: w.deps.navigationDebugAvailable,
    now: w.deps.now,
  };
}

/** Port of `#sendWorldResync`'s room half — the message dispatch and the tick's queued-resync
 *  payback both route through this. */
export function sendResyncTo(w: WorldGlue, connectionId: string, player: PlayerRuntime): void {
  sendWorldResync(
    connectionId,
    player,
    w.state.tick,
    (recipient) => worldView(interestContext(w), recipient),
    (recipientId, message) => w.deps.send(recipientId, message),
    w.state.activeEvents,
  );
}

/** Port of `#flushQueuedResyncs` (`world.ts:5274`). */
export function flushQueuedResyncs(w: WorldGlue, now: number): void {
  for (const [connectionId, player] of w.state.players) {
    if (!player.resyncQueued || !player.authorized) continue;
    if (now - player.lastResyncAt < RESYNC_COOLDOWN_MS) continue;
    player.resyncQueued = false;
    player.lastResyncAt = now;
    sendResyncTo(w, connectionId, player);
  }
}
