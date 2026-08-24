/**
 * Authored-event page evaluation and trigger detection for the Alepha world room (Task 7) — the
 * state-level half of the legacy `World`'s event machinery. Everything here reads and mutates
 * `WorldRoomState` alone: page selection against the party's adventure-state snapshot, authored
 * monster/guard reconciliation, run-lock trigger starts and the contact-trigger geometry. Nothing
 * in this module touches a socket, a clock, a database or the coordinator — the dispatch half
 * (effects, dialogue, quest conversations) lives in `worldTick.ts`, which owns the `WorldGlue`.
 *
 * Each function is a port of the matching `world.ts` private method (cited on each), re-hosted on
 * the room-state container instead of Durable Object fields.
 */

import { activePageIndex } from "@lindocara/engine/adventure-state.js";
import type { EventCommand } from "@lindocara/engine/event-commands.js";
import type { Rect } from "@lindocara/engine/game.js";
import type { GroundVector, WorldPosition } from "@lindocara/engine/ground.js";
import {
  animalCarcassHarvestProfile,
  type HarvestProfile,
  harvestActorBehavior,
  harvestColliderAt,
  harvestGroundColliderAt,
} from "@lindocara/engine/harvest.js";
import { type ColliderRect, createColliderIndex } from "@lindocara/engine/hd2d/collider-index.js";
import {
  authoredCellCentreGround,
  authoredPatrolRadius,
  type EventTrigger,
  hostileOnPage,
  isActiveWorldEventKind,
  isInteractiveWorldEventKind,
  type MapEvent,
} from "@lindocara/engine/map-events.js";
import { maxMapHeroMovementSpeed } from "@lindocara/engine/map-hero-settings.js";
import { refreshHarvestNode } from "@lindocara/engine/party-harvest-state.js";
import type { WorldEventCollider } from "@lindocara/engine/protocol.js";
import { TICK_MS } from "@lindocara/engine/simulation.js";
import {
  BODY_RADIUS,
  canStand,
  groundUnder,
  worldEventColliderRect,
} from "@lindocara/engine/terrain-access.js";
import {
  type CollisionElevation,
  editorAssetCollisionElevation,
  LINDOCARA_PICKUP_ASSET_IDS,
} from "@lindocara/engine/tiny-swords-catalog.js";
import type { ZoneTerrain } from "@lindocara/engine/zones.js";

import {
  activeAuthoredGuardDefinitions,
  authoredGuardRuntimeId,
  reconcileActiveGuards,
} from "../../world/authored-guard-system.js";
import {
  activeAuthoredMonsterDefinitions,
  reconcileActiveMonsters,
} from "../../world/authored-monster-system.js";
import { abortRunForEvent, startRun } from "../../world/event-run-system.js";
import { resetMonsterNavigation } from "../../world/monster-system.js";
import { createNavigationRuntime } from "../../world/navigation-system.js";
import { reconcileNpcMovement } from "../../world/npc-movement-system.js";
import type { ActiveWorldEvent, MonsterRuntime, PlayerRuntime } from "../../world/world-runtime.js";
import type { WorldRoomState } from "./worldState.ts";

/** The map's grid side, which is what turns a top-left cell index into a grid-centred coordinate. */
function gridSize(state: WorldRoomState): number {
  return state.location?.definition.terrain.size ?? 0;
}

function programGrantsMovementEffect(commands: readonly EventCommand[]): boolean {
  return commands.some((command) => {
    if (command.t === "movementEffect") return true;
    if (command.t === "if") {
      return programGrantsMovementEffect(command.then) || programGrantsMovementEffect(command.else);
    }
    if (command.t === "loop") return programGrantsMovementEffect(command.body);
    if (command.t === "choices") {
      return command.options.some((option) => programGrantsMovementEffect(option.body));
    }
    return false;
  });
}

const MOVEMENT_PICKUP_ASSET_IDS: ReadonlySet<string> = new Set(
  Object.values(LINDOCARA_PICKUP_ASSET_IDS),
);

function isMovementPickupPage(event: MapEvent, pageIndex: number): boolean {
  const page = event.pages[pageIndex];
  return Boolean(
    page &&
    page.graphicAssetId &&
    MOVEMENT_PICKUP_ASSET_IDS.has(page.graphicAssetId) &&
    programGrantsMovementEffect(page.commands),
  );
}

/** Consume a dedicated movement pickup for the room's current attempt. The effect remains scoped
 * to its triggering hero, while the collectible itself is shared world state and disappears for
 * everyone. Scripted movement effects using another appearance remain repeatable. */
export function consumeMovementPickup(state: WorldRoomState, eventId: string): boolean {
  const event = state.location?.definition.events?.find((candidate) => candidate.id === eventId);
  if (!event) return false;
  const pageIndex = activePageIndex(event, state.adventureState.state);
  if (pageIndex === null || !isMovementPickupPage(event, pageIndex)) return false;
  state.consumedMovementPickupIds.add(eventId);
  state.activeEvents = state.activeEvents.filter((active) => active.id !== eventId);
  state.npcMovement.delete(eventId);
  state.eventTouchActorPositions.delete(eventId);
  for (const contact of state.eventTouchContacts) {
    if (contact.startsWith(`${eventId}:`)) state.eventTouchContacts.delete(contact);
  }
  return true;
}

function colliderTuple(
  rect: Rect | null,
  elevation: CollisionElevation,
): WorldEventCollider | null {
  return rect ? [rect.x, rect.y, rect.width, rect.height, elevation] : null;
}

function sameCollider(a: ColliderRect | undefined, b: ColliderRect | undefined): boolean {
  return (
    a !== undefined &&
    b !== undefined &&
    a.x === b.x &&
    a.z === b.z &&
    a.w === b.w &&
    a.h === b.h &&
    a.top === b.top
  );
}

export function harvestCollisionElevation(
  profile: HarvestProfile,
  graphicAssetId: string | null,
  harvestState: "intact" | "depleted",
): CollisionElevation {
  const assetElevation = graphicAssetId ? editorAssetCollisionElevation(graphicAssetId) : null;
  if (assetElevation !== null) return assetElevation;
  // Compatibility for authored profiles whose appearance was removed or is no longer catalogued:
  // replacement-style wood nodes are trees, while caches, rocks, ore and every other small node
  // retain the stump's one-level top. The harvest profile itself is untouched.
  return profile.resource === "wood" &&
    profile.exhaustionBehavior === "replace" &&
    harvestState === "intact"
    ? 3
    : 1;
}

/**
 * An actor's occupancy box on the ground plane. A tile-unit position is the body's CENTRE, so the
 * box is anchored half a body back on each ground axis — the pixel version anchored at the position
 * itself because a pixel position was already a 32 px box's top-left corner.
 */
function actorBody(x: number, z: number): ColliderRect {
  return { x: x - BODY_RADIUS, z: z - BODY_RADIUS, w: BODY_RADIUS * 2, h: BODY_RADIUS * 2 };
}

/** Axis-aligned overlap on the ground plane — `rectsOverlap`'s `{x, z, w, h}` counterpart. */
function groundRectsOverlap(a: ColliderRect, b: ColliderRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.z < b.z + b.h && a.z + a.h > b.z;
}

/**
 * A collider must never materialize around a body that was allowed to enter while the node was
 * depleted. The intact visual may return immediately, but its collision and harvest eligibility
 * stay pending until every authoritative combat actor has cleared the footprint.
 */
function harvestColliderOccupied(
  state: WorldRoomState,
  collider: ColliderRect,
  now: number,
): boolean {
  for (const player of state.players.values()) {
    if (groundRectsOverlap(collider, actorBody(player.x, player.z))) return true;
  }
  for (const monster of state.monsters) {
    // A living monster occupies its current body. A corpse due this tick will first teleport to
    // its authored spawn, so guard that destination rather than the unrelated corpse position.
    const position =
      monster.hp > 0
        ? { x: monster.x, z: monster.z }
        : monster.deadUntil <= now
          ? { x: monster.spawnX, z: monster.spawnZ }
          : null;
    if (position && groundRectsOverlap(collider, actorBody(position.x, position.z))) {
      return true;
    }
  }
  for (const guard of state.guards) {
    if (guard.hp > 0 && groundRectsOverlap(collider, actorBody(guard.x, guard.z))) return true;
  }
  const size = gridSize(state);
  for (const event of state.activeEvents) {
    const movement = state.npcMovement.get(event.id);
    if (!movement || movement.through) continue;
    // An NPC stands at its cell's CENTRE. The pixel version inset its top-left box by half the
    // difference between a tile and a body to say the same thing.
    const centre = authoredCellCentreGround(event, size);
    if (groundRectsOverlap(collider, actorBody(centre.x, centre.z))) return true;
  }
  return false;
}

function projectHarvestCollider(
  state: WorldRoomState,
  profile: HarvestProfile,
  col: number,
  row: number,
  harvestState: "intact" | "depleted",
  graphicAssetId: string | null,
  now: number,
): {
  collider: WorldEventCollider | null;
  collisionPending?: true;
} {
  // The wire tuple stays the authored PIXEL rectangle; the occupancy test is the room's own
  // collision and is therefore asked on the ground plane.
  const collider = harvestColliderAt(profile, col, row, harvestState);
  const elevation = harvestCollisionElevation(profile, graphicAssetId, harvestState);
  // Wandering harvest actors still advertise their moving body for directional tool selection,
  // but `syncHarvestColliders` keeps that body out of terrain so it cannot block its own next cell.
  if (harvestActorBehavior(profile) === "wander") {
    return { collider: colliderTuple(collider, elevation) };
  }
  const ground = harvestGroundColliderAt(profile, col, row, harvestState, gridSize(state));
  if (harvestState === "intact" && ground && harvestColliderOccupied(state, ground, now)) {
    return { collider: null, collisionPending: true };
  }
  return { collider: colliderTuple(collider, elevation) };
}

/**
 * Rebuild the room's one collision truth only when a node changes between intact/depleted states.
 * Static map colliders stay separate for the wire; clients merge these explicit event tuples in
 * exactly the same way and never inspect asset ids.
 */
function syncHarvestColliders(state: WorldRoomState): void {
  const definition = state.location?.definition;
  if (!definition) return;
  const eventById = new Map(
    (state.location?.definition.events ?? []).map((event) => [event.id, event]),
  );
  // The tuple remains in authored pixels on the wire; the shared crossing adds both its centred
  // tile footprint and its finite top to the room collision index.
  const next = state.activeEvents.flatMap((event): ColliderRect[] => {
    const authored = eventById.get(event.id);
    const profile = authored?.kind === "harvestable" ? authored.harvestProfile : undefined;
    if (!profile || harvestActorBehavior(profile) === "wander") return [];
    // A null tuple means the footprint is deliberately absent (depleted, or collision pending).
    if (!event.harvest || event.harvest.collider === null) return [];
    return [worldEventColliderRect(definition.terrain, event.harvest.collider)];
  });
  if (
    next.length === state.harvestColliders.length &&
    next.every((collider, index) => sameCollider(collider, state.harvestColliders[index]))
  ) {
    return;
  }
  state.harvestColliders = next;
  const colliders = createColliderIndex();
  for (const rect of state.staticColliders) colliders.add(rect);
  for (const rect of next) colliders.add(rect);
  const terrain: ZoneTerrain = { ...definition.terrain, colliders };
  definition.terrain = terrain;
  state.navigation = createNavigationRuntime(terrain, definition.navigation);
  // Replacing the runtime abandons its queue and active search. Reset every actor that could
  // still point at either of them, as well as completed paths baked against the previous grid.
  // Threat remains intact, so the next monster tick immediately selects and replans its target.
  for (const monster of state.monsters) resetMonsterNavigation(monster);
}

/**
 * Port of `#evaluateActiveEvents` (`world.ts:1493`): select each authored event's active page
 * against the current adventure-state snapshot and project the holders down to their appearance,
 * reconciling authored monsters/guards/NPC movement along the way. Called on state install, state
 * creation and hero join — NEVER from the tick loop — so an event carries zero per-tick cost.
 */
export function evaluateActiveEvents(state: WorldRoomState, now = Date.now()): void {
  const definition = state.location?.definition;
  if (!definition) return;
  const events = definition.events ?? [];
  const adventureState = state.adventureState.state;

  const monsterDefinitions = [
    ...definition.monsters,
    ...activeAuthoredMonsterDefinitions(events, adventureState, definition.terrain.size),
  ];
  state.monsters = reconcileActiveMonsters(state.monsters, monsterDefinitions);
  // A permanent authored animal remains as a corpse until its explicit carcass node is depleted.
  // Reconnecting reconstructs that corpse from party state instead of silently reviving it.
  for (const monster of state.monsters) {
    if (!monster.id.startsWith("mon-")) continue;
    const eventId = monster.id.slice(4);
    if (adventureState.defeatedMonsters?.[eventId] !== true) continue;
    if (!animalCarcassHarvestProfile(monster.species, "never", 0)) continue;
    monster.hp = 0;
    monster.deadUntil = Number.POSITIVE_INFINITY;
    monster.action = null;
    monster.vx = 0;
    monster.vz = 0;
  }
  state.monsterGrid.clear();
  for (const monster of state.monsters) state.monsterGrid.insert(monster);

  const guardDefinitions = [
    ...definition.guards,
    ...activeAuthoredGuardDefinitions(events, adventureState, definition.terrain.size),
  ];
  state.guards = reconcileActiveGuards(state.guards, guardDefinitions);

  const currentEvents = new Map(state.activeEvents.map((event) => [event.id, event]));
  const active: ActiveWorldEvent[] = [];
  const movement = [];
  for (const event of events) {
    // Scripted events, free NPCs and harvestable resources have an appearance. Anchors and monster
    // spawns are consumed elsewhere; guards are projected above into the authoritative collection.
    if (!isActiveWorldEventKind(event.kind)) continue;
    const index = activePageIndex(event, adventureState);
    if (index === null) continue;
    if (state.consumedMovementPickupIds.has(event.id) && isMovementPickupPage(event, index))
      continue;
    // A character the active page turned hostile has a body already: the monster projected above.
    // Drawing its peaceful sprite here too would leave the villager standing inside the thing that
    // is attacking, and would keep its dialogue interactable mid-fight.
    if (hostileOnPage(event, index)) continue;
    const page = event.pages[index];
    if (page === undefined) continue;
    const current = currentEvents.get(event.id);
    const harvestNode =
      event.kind === "harvestable"
        ? refreshHarvestNode(adventureState.harvestNodes ?? {}, event.id, now)?.node
        : undefined;
    const depleted = harvestNode?.depleted === true;
    const profile = event.kind === "harvestable" ? event.harvestProfile : undefined;
    const graphicAssetId =
      depleted && profile
        ? profile.exhaustionBehavior === "replace"
          ? profile.exhaustedAssetId
          : null
        : page.graphicAssetId;
    const eventCol = current?.col ?? event.col;
    const eventRow = current?.row ?? event.row;
    const harvestState = depleted ? ("depleted" as const) : ("intact" as const);
    const projectedHits = depleted
      ? profile?.hitsRequired
      : Math.min(harvestNode?.hits ?? 0, Math.max(0, (profile?.hitsRequired ?? 1) - 1));
    const wanderingHarvest = profile && harvestActorBehavior(profile) === "wander";
    active.push({
      id: event.id,
      col: eventCol,
      row: eventRow,
      graphicAssetId,
      graphicTint: page.graphicTint ?? 0xffffff,
      onTop: page.optOnTop,
      moveSpeed: wanderingHarvest ? 2 : page.moveSpeed,
      moveFrequency: wanderingHarvest ? 2 : page.moveFreq,
      moveAnimation: page.optMoveAnim,
      directionFixed: page.optDirFix,
      ...(page.trigger === "action" ? { interactive: true as const } : {}),
      presentation: event.kind === "harvestable" ? "native" : "marker",
      showMarker: event.showMarker !== false,
      ...(page.graphicElevation === undefined ? {} : { elevationOffset: page.graphicElevation }),
      ...(page.optFloat === true ? { floating: true as const } : {}),
      ...(profile && harvestNode
        ? {
            harvest: {
              state: harvestState,
              generation: harvestNode.generation,
              hits: projectedHits ?? 0,
              hitsRequired: profile.hitsRequired,
              lastHitAt: harvestNode.lastHitAt,
              depletedAt: harvestNode.depletedAt,
              respawnAt: harvestNode.respawnAt,
              exhaustionBehavior: profile.exhaustionBehavior,
              exhaustedAssetId: profile.exhaustedAssetId,
              fadeDurationMs: profile.fadeDurationMs,
              ...projectHarvestCollider(
                state,
                profile,
                eventCol,
                eventRow,
                harvestState,
                graphicAssetId,
                now,
              ),
            },
          }
        : {}),
    });
    // Static resources remain scenery. Explicit wandering resources join the same harmless,
    // deterministic NPC motion model as authored characters.
    if (event.kind !== "harvestable" || wanderingHarvest) {
      movement.push({
        id: event.id,
        homeCol: event.col,
        homeRow: event.row,
        moveType: wanderingHarvest ? "random" : page.moveType,
        moveSpeed: wanderingHarvest ? 2 : page.moveSpeed,
        moveFreq: wanderingHarvest ? 2 : page.moveFreq,
        through: page.optThrough,
        // Authored leashes are stored in pixels; `authoredPatrolRadius` is the one place they
        // cross into tile units. The default is two cells, which is two TILES here, not 128 px.
        patrolRadius: event.patrolRadius === null ? 2 : authoredPatrolRadius(event.patrolRadius),
        route: page.moveRoute ?? [],
        ...(wanderingHarvest ? { movementStyle: "sheep" as const } : {}),
      });
    }
  }
  state.activeEvents = active;
  state.npcMovement = reconcileNpcMovement(state.npcMovement, movement, state.tick);
  // Re-project once movement identities and the new event positions are installed, so a resource
  // cannot materialize under a non-through NPC that occupied its depleted footprint.
  refreshHarvestEventVisuals(state, now);
}

/** Tick-cheap visual refresh for timed harvest respawns; no monster/NPC reconciliation. */
export function refreshHarvestEventVisuals(state: WorldRoomState, now: number): void {
  const events = state.location?.definition.events ?? [];
  const adventureState = state.adventureState.state;
  const eventById = new Map(events.map((event) => [event.id, event]));
  state.activeEvents = state.activeEvents.map((active) => {
    const event = eventById.get(active.id);
    if (event?.kind !== "harvestable") return active;
    const profile = event.harvestProfile;
    if (!profile) return active;
    const node = refreshHarvestNode(adventureState.harvestNodes ?? {}, event.id, now)?.node;
    if (!node) return active;
    const depleted = node.depleted;
    const pageIndex = activePageIndex(event, adventureState);
    const page = pageIndex === null ? undefined : event.pages[pageIndex];
    if (!page) return active;
    const graphicAssetId = depleted
      ? profile.exhaustionBehavior === "replace"
        ? profile.exhaustedAssetId
        : null
      : page.graphicAssetId;
    const harvest = {
      state: depleted ? ("depleted" as const) : ("intact" as const),
      generation: node.generation,
      hits: depleted
        ? profile.hitsRequired
        : Math.min(node.hits, Math.max(0, profile.hitsRequired - 1)),
      hitsRequired: profile.hitsRequired,
      lastHitAt: node.lastHitAt,
      depletedAt: node.depletedAt,
      respawnAt: node.respawnAt,
      exhaustionBehavior: profile.exhaustionBehavior,
      exhaustedAssetId: profile.exhaustedAssetId,
      fadeDurationMs: profile.fadeDurationMs,
      ...projectHarvestCollider(
        state,
        profile,
        active.col,
        active.row,
        depleted ? "depleted" : "intact",
        graphicAssetId,
        now,
      ),
    };
    if (
      active.graphicAssetId === graphicAssetId &&
      active.harvest?.state === harvest.state &&
      active.harvest.generation === harvest.generation &&
      active.harvest.hits === harvest.hits &&
      active.harvest.hitsRequired === harvest.hitsRequired &&
      active.harvest.lastHitAt === harvest.lastHitAt &&
      active.harvest.depletedAt === harvest.depletedAt &&
      active.harvest.respawnAt === harvest.respawnAt &&
      active.harvest.exhaustionBehavior === harvest.exhaustionBehavior &&
      active.harvest.exhaustedAssetId === harvest.exhaustedAssetId &&
      active.harvest.fadeDurationMs === harvest.fadeDurationMs &&
      active.harvest.collisionPending === harvest.collisionPending &&
      active.harvest.collider?.[0] === harvest.collider?.[0] &&
      active.harvest.collider?.[1] === harvest.collider?.[1] &&
      active.harvest.collider?.[2] === harvest.collider?.[2] &&
      active.harvest.collider?.[3] === harvest.collider?.[3] &&
      active.harvest.collider?.[4] === harvest.collider?.[4]
    ) {
      return active;
    }
    return {
      ...active,
      graphicAssetId,
      harvest,
    };
  });
  syncHarvestColliders(state);
}

/** Port of `#abortRunsForStalePages` (`world.ts:1024`): kill any run whose event's active page no
 *  longer matches the page the run started on. Ordered BEFORE re-evaluation on a state install so
 *  no zombie context keeps executing the page it was reading. */
export function abortRunsForStalePages(state: WorldRoomState): void {
  const events = state.location?.definition.events ?? [];
  for (const [eventId, context] of [...state.eventRuns.contexts]) {
    const event = events.find((candidate) => candidate.id === eventId);
    const active = event ? activePageIndex(event, state.adventureState.state) : null;
    if (active !== context.pageIndex) abortRunForEvent(state.eventRuns, eventId);
  }
}

/** Port of `#activeEventCell`: an NPC may have wandered off its authored cell. */
export function activeEventCell(
  state: WorldRoomState,
  event: Pick<MapEvent, "id" | "col" | "row">,
): { col: number; row: number } {
  return state.activeEvents.find((candidate) => candidate.id === event.id) ?? event;
}

/**
 * Port of `#activeEventCentre`, on the GROUND PLANE.
 *
 * `eventCellCentre` answers in the editor's pixel, top-left-origin space; measuring one of those
 * against a tile-unit hero gives hundreds against a range of a few tiles, so every proximity clause
 * reading it would have silently stopped rejecting anything.
 */
export function activeEventCentre(
  state: WorldRoomState,
  event: Pick<MapEvent, "id" | "col" | "row" | "kind">,
): WorldPosition {
  if (event.kind === "guard") {
    const guard = state.guards.find(
      (candidate) => candidate.id === authoredGuardRuntimeId(event.id),
    );
    if (guard) return { x: guard.x, y: guard.y, z: guard.z };
  }
  return authoredCellCentreGround(activeEventCell(state, event), gridSize(state));
}

/** Port of `#touchesEventCell` (`world.ts:1562`): whether an actor-sized authoritative body
 *  overlaps an event cell. Heroes and monsters share this exact geometry.
 *
 *  One cell is ONE unit wide now, and the grid is centred, so the cell's bounds are its indices
 *  shifted by half the grid rather than multiplied by `TILE_SIZE`. The body is centred on its
 *  position instead of anchored at its top-left corner. */
export function touchesEventCell(
  state: WorldRoomState,
  position: GroundVector,
  event: Pick<MapEvent, "id" | "col" | "row">,
  tolerance: number,
): boolean {
  const cell = activeEventCell(state, event);
  const half = gridSize(state) / 2;
  const left = cell.col - half - tolerance;
  const top = cell.row - half - tolerance;
  const right = cell.col + 1 - half + tolerance;
  const bottom = cell.row + 1 - half + tolerance;
  return (
    position.x - BODY_RADIUS < right &&
    position.x + BODY_RADIUS > left &&
    position.z - BODY_RADIUS < bottom &&
    position.z + BODY_RADIUS > top
  );
}

/** Port of `#runnablePage` (`world.ts:1038`): the active page of a scripted event carrying a
 *  runnable program under `trigger`, or null. Only a satisfied active page with a non-empty
 *  program can fire — a blank appearance-only event is not a script. */
export function runnablePage(
  state: WorldRoomState,
  event: MapEvent,
  trigger: EventTrigger,
): { pageIndex: number; program: readonly EventCommand[] } | null {
  if (!isInteractiveWorldEventKind(event.kind)) return null;
  if (state.consumedMovementPickupIds.has(event.id)) return null;
  const pageIndex = activePageIndex(event, state.adventureState.state);
  if (pageIndex === null) return null;
  const page = event.pages[pageIndex];
  if (page === undefined || page.trigger !== trigger || page.commands.length === 0) return null;
  return { pageIndex, program: page.commands };
}

function automaticTriggerer(state: WorldRoomState): PlayerRuntime | null {
  for (const player of state.players.values()) {
    if (
      player.identityKind === "hero" &&
      player.authorized &&
      player.life === "alive" &&
      !player.transitioning &&
      !player.disconnecting
    ) {
      return player;
    }
  }
  return null;
}

/**
 * Starts every active Autorun/Parallel page against one deterministic live hero.
 *
 * The event-id lock in `startRun` limits each page to one context, while `drainRuns` still shares
 * the room-wide command budget. A completed page may restart on the next tick, matching RPG event
 * semantics; authors stop repetition with a page condition or self-switch. State-sync pauses also
 * pause new starts so a run is never selected against the pre-mutation page snapshot.
 */
export function startAutomaticEventRuns(state: WorldRoomState): number {
  if (state.eventStateSync !== null) return 0;
  const hero = automaticTriggerer(state);
  const events = state.location?.definition.events;
  if (!hero || !events) return 0;
  let started = 0;
  for (const event of events) {
    const auto = runnablePage(state, event, "auto");
    const parallel = auto === null ? runnablePage(state, event, "parallel") : null;
    const runnable = auto ?? parallel;
    if (!runnable) continue;
    if (
      startRun(state.eventRuns, {
        event,
        pageIndex: runnable.pageIndex,
        program: runnable.program,
        heroId: hero.id,
        runId: crypto.randomUUID(),
      })
    ) {
      started += 1;
    }
  }
  return started;
}

function eventActorPosition(state: WorldRoomState, event: MapEvent): GroundVector | null {
  if (event.kind === "guard") {
    const guard = state.guards.find(
      (candidate) => candidate.id === authoredGuardRuntimeId(event.id),
    );
    return guard ? { x: guard.x, z: guard.z } : null;
  }
  const active = state.activeEvents.find((candidate) => candidate.id === event.id);
  return active ? authoredCellCentreGround(active, gridSize(state)) : null;
}

function actorTouchesHero(actor: GroundVector, hero: GroundVector): boolean {
  const reach = 0.5 + BODY_RADIUS;
  return Math.abs(actor.x - hero.x) < reach && Math.abs(actor.z - hero.z) < reach;
}

/**
 * Detects the event-owned half of contact triggering.
 *
 * A persistent contact set distinguishes a NEW edge, and the actor-position map distinguishes who
 * created it: a hero walking into an idle event belongs to `player-touch`; `event-touch` starts only
 * after the NPC/guard moved. This scan runs after NPCs and guards have advanced for the tick.
 */
export function detectEventTouch(state: WorldRoomState): number {
  const events = state.location?.definition.events;
  if (!events) return 0;
  const currentContacts = new Set<string>();
  const currentActorIds = new Set<string>();
  let started = 0;
  for (const event of events) {
    const runnable = runnablePage(state, event, "event-touch");
    if (!runnable) continue;
    const actor = eventActorPosition(state, event);
    if (!actor) continue;
    currentActorIds.add(event.id);
    const previous = state.eventTouchActorPositions.get(event.id);
    const actorMoved =
      previous !== undefined &&
      (Math.abs(previous.x - actor.x) > 0.000_1 || Math.abs(previous.z - actor.z) > 0.000_1);
    state.eventTouchActorPositions.set(event.id, actor);
    for (const player of state.players.values()) {
      if (
        player.identityKind !== "hero" ||
        !player.authorized ||
        player.life !== "alive" ||
        player.transitioning ||
        player.disconnecting ||
        !actorTouchesHero(actor, player)
      ) {
        continue;
      }
      const contactKey = `${event.id}:${player.id}`;
      currentContacts.add(contactKey);
      if (!actorMoved || state.eventTouchContacts.has(contactKey)) continue;
      if (
        startRun(state.eventRuns, {
          event,
          pageIndex: runnable.pageIndex,
          program: runnable.program,
          heroId: player.id,
          runId: crypto.randomUUID(),
        })
      ) {
        started += 1;
      }
    }
  }
  for (const eventId of state.eventTouchActorPositions.keys()) {
    if (!currentActorIds.has(eventId)) state.eventTouchActorPositions.delete(eventId);
  }
  state.eventTouchContacts.clear();
  for (const contact of currentContacts) state.eventTouchContacts.add(contact);
  return started;
}

/**
 * Port of `#detectPlayerTouch` (`world.ts:1386`): the contact-with-hero trigger, evaluated on the
 * movement edge (from `movement-system`'s `onPlayerMoved`), not a per-tick scan. Uses the body's
 * own half-tile footprint (`BODY_RADIUS` either side of its centre) plus the maximum living-player
 * step as tolerance — a door/shore teleporter commonly sits on
 * solid terrain the body can touch but never occupy. Standing in contact does not re-fire; the
 * one-run lock covers a re-entry while the run lives.
 */
export function detectPlayerTouch(
  state: WorldRoomState,
  player: PlayerRuntime,
  previous: WorldPosition,
): void {
  if (player.identityKind !== "hero" || player.life !== "alive" || !player.authorized) return;
  const events = state.location?.definition.events;
  if (!events || events.length === 0) return;
  const movementTolerance =
    (maxMapHeroMovementSpeed(state.location?.definition.heroSettings) * TICK_MS) / 1_000;
  for (const event of events) {
    if (!isActiveWorldEventKind(event.kind)) continue;
    const runnable = runnablePage(state, event, "player-touch");
    if (runnable !== null) {
      const page = event.pages[runnable.pageIndex];
      if (!page) continue;
      const movementPickup = programGrantsMovementEffect(runnable.program);
      const verticalContact = (position: WorldPosition): boolean => {
        if (!movementPickup) return true;
        const terrain = state.location?.definition.terrain;
        if (!terrain) return false;
        const centre = activeEventCentre(state, event);
        const surface = terrain.query.heightAt(centre.x, centre.z) ?? terrain.waterLevel;
        const targetY = surface + (page.graphicElevation ?? 0);
        return Math.abs(position.y - targetY) <= 0.85;
      };
      if (
        (touchesEventCell(state, previous, event, 0) && verticalContact(previous)) ||
        !touchesEventCell(state, player, event, movementTolerance) ||
        !verticalContact(player)
      )
        continue;
      startRun(state.eventRuns, {
        event,
        pageIndex: runnable.pageIndex,
        program: runnable.program,
        heroId: player.id,
        runId: crypto.randomUUID(),
      });
      return;
    }
  }
}

/** Warn about a refused authored teleport at most ONCE per (event, reason) per room lifetime —
 *  port of `#logTeleportRefusedOnce` (`world.ts:4749`). Returns whether this was the first. */
export function logTeleportRefusedOnce(
  state: WorldRoomState,
  eventId: string,
  reason: string,
  extra: Record<string, unknown>,
): boolean {
  const key = `${eventId}:${reason}`;
  if (state.teleportRefusalsLogged.has(key)) return false;
  state.teleportRefusalsLogged.add(key);
  console.warn(JSON.stringify({ event: "event_teleport_refused", reason, eventId, ...extra }));
  return true;
}

/** Port of `#logItemRefusedOnce` (`world.ts:4912`): once per (event, itemId, reason). */
export function logItemRefusedOnce(
  state: WorldRoomState,
  eventId: string,
  itemId: string,
  reason: string,
  extra: Record<string, unknown>,
): void {
  const key = `${eventId}:${itemId}:${reason}`;
  if (state.itemRefusalsLogged.has(key)) return;
  state.itemRefusalsLogged.add(key);
  console.warn(JSON.stringify({ event: "event_item_refused", reason, eventId, itemId, ...extra }));
}

/** Port of `#logGoldRefusedOnce` (`world.ts:4805`): once per (event, reason). */
export function logGoldRefusedOnce(
  state: WorldRoomState,
  eventId: string,
  reason: string,
  extra: Record<string, unknown>,
): void {
  const key = `${eventId}:${reason}`;
  if (state.goldRefusalsLogged.has(key)) return;
  state.goldRefusalsLogged.add(key);
  console.warn(JSON.stringify({ event: "event_gold_refused", reason, eventId, ...extra }));
}

/**
 * Port of `#detectMonsterTouch` (`world.ts:1429`): contact teleporters affect live monsters on the
 * same authoritative movement edge as heroes. Only a single direct same-map teleport command is
 * eligible — a monster must never impersonate a hero to run dialogue, inventory, quest or
 * party-state commands. Both contact spellings (`player-touch`/`event-touch`) are accepted.
 */
export function detectMonsterTouch(
  state: WorldRoomState,
  monster: MonsterRuntime,
  previous: GroundVector,
): void {
  const events = state.location?.definition.events;
  const mapId = state.location?.zoneId;
  if (!events || events.length === 0 || !mapId) return;
  const movementTolerance = (monster.speed * TICK_MS) / 1_000;
  for (const event of events) {
    if (!isActiveWorldEventKind(event.kind)) continue;
    const pageIndex = activePageIndex(event, state.adventureState.state);
    if (pageIndex === null) continue;
    const page = event.pages[pageIndex];
    if (
      !page ||
      (page.trigger !== "player-touch" && page.trigger !== "event-touch") ||
      page.commands.length !== 1
    ) {
      continue;
    }
    const command = page.commands[0];
    if (
      command?.t !== "teleport" ||
      touchesEventCell(state, previous, event, 0) ||
      !touchesEventCell(state, monster, event, movementTolerance)
    ) {
      continue;
    }
    if (command.mapId !== mapId) {
      logTeleportRefusedOnce(state, event.id, "monster_cross_map_unsupported", {
        monsterId: monster.id,
        sourceMapId: mapId,
        destinationMapId: command.mapId,
      });
      return;
    }
    const terrain = state.location?.definition.terrain;
    if (!terrain) return;
    const destination = authoredCellCentreGround(command, terrain.size);
    // The grid runs `-size/2`..`+size/2`, so bounds are a cell-index test, not a rectangle
    // anchored at zero: the origin moved to the middle along with the units.
    const inBounds =
      command.col >= 0 &&
      command.row >= 0 &&
      command.col < terrain.size &&
      command.row < terrain.size;
    const landing = groundUnder(terrain, destination.x, destination.z, monster.y);
    if (!inBounds || !canStand(terrain, destination.x, destination.z, BODY_RADIUS, landing)) {
      logTeleportRefusedOnce(state, event.id, inBounds ? "unwalkable" : "out_of_bounds", {
        monsterId: monster.id,
        mapId,
        col: command.col,
        row: command.row,
      });
      return;
    }
    const beforeTeleport = { x: monster.x, y: monster.y, z: monster.z };
    monster.x = destination.x;
    monster.z = destination.z;
    monster.y = landing;
    state.monsterGrid.update(monster, beforeTeleport);
    resetMonsterNavigation(monster);
    return;
  }
}
