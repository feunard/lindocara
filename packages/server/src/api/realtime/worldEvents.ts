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
import { isWalkable } from "@lindocara/engine/game.js";
import {
  type EventTrigger,
  eventCellCentre,
  isActiveWorldEventKind,
  type MapEvent,
} from "@lindocara/engine/map-events.js";
import { PLAYER_SIZE, PLAYER_SPEED, TICK_MS, type Vec2 } from "@lindocara/engine/simulation.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import {
  activeAuthoredGuardDefinitions,
  reconcileActiveGuards,
} from "../../world/authored-guard-system.js";
import {
  activeAuthoredMonsterDefinitions,
  reconcileActiveMonsters,
} from "../../world/authored-monster-system.js";
import { abortRunForEvent, startRun } from "../../world/event-run-system.js";
import { resetMonsterNavigation } from "../../world/monster-system.js";
import { reconcileNpcMovement } from "../../world/npc-movement-system.js";
import type { ActiveWorldEvent, MonsterRuntime, PlayerRuntime } from "../../world/world-runtime.js";
import type { WorldRoomState } from "./worldState.ts";

/**
 * Port of `#evaluateActiveEvents` (`world.ts:1493`): select each authored event's active page
 * against the current adventure-state snapshot and project the holders down to their appearance,
 * reconciling authored monsters/guards/NPC movement along the way. Called on state install, state
 * creation and hero join — NEVER from the tick loop — so an event carries zero per-tick cost.
 */
export function evaluateActiveEvents(state: WorldRoomState): void {
  const definition = state.location?.definition;
  if (!definition) return;
  const events = definition.events ?? [];
  const adventureState = state.adventureState.state;

  const monsterDefinitions = [
    ...definition.monsters,
    ...activeAuthoredMonsterDefinitions(events, adventureState),
  ];
  state.monsters = reconcileActiveMonsters(state.monsters, monsterDefinitions);
  state.monsterGrid.clear();
  for (const monster of state.monsters) state.monsterGrid.insert(monster);

  const guardDefinitions = [
    ...definition.guards,
    ...activeAuthoredGuardDefinitions(events, adventureState),
  ];
  state.guards = reconcileActiveGuards(state.guards, guardDefinitions);

  const currentEvents = new Map(state.activeEvents.map((event) => [event.id, event]));
  const active: ActiveWorldEvent[] = [];
  const movement = [];
  for (const event of events) {
    // Scripted events and free NPCs have an appearance. Anchors and monster spawns are consumed
    // elsewhere; guards are projected above into the authoritative guard collection.
    if (!isActiveWorldEventKind(event.kind)) continue;
    const index = activePageIndex(event, adventureState);
    if (index === null) continue;
    const page = event.pages[index];
    if (page === undefined) continue;
    const current = currentEvents.get(event.id);
    active.push({
      id: event.id,
      col: current?.col ?? event.col,
      row: current?.row ?? event.row,
      graphicAssetId: page.graphicAssetId,
      onTop: page.optOnTop,
      moveSpeed: page.moveSpeed,
      moveFrequency: page.moveFreq,
      moveAnimation: page.optMoveAnim,
      directionFixed: page.optDirFix,
    });
    movement.push({
      id: event.id,
      homeCol: event.col,
      homeRow: event.row,
      moveType: page.moveType,
      moveSpeed: page.moveSpeed,
      moveFreq: page.moveFreq,
      through: page.optThrough,
      patrolRadius: event.patrolRadius ?? TILE_SIZE * 2,
    });
  }
  state.activeEvents = active;
  state.npcMovement = reconcileNpcMovement(state.npcMovement, movement, state.tick);
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

/** Port of `#activeEventCentre`. */
export function activeEventCentre(
  state: WorldRoomState,
  event: Pick<MapEvent, "id" | "col" | "row">,
): { x: number; y: number } {
  return eventCellCentre(activeEventCell(state, event));
}

/** Port of `#touchesEventCell` (`world.ts:1562`): whether an actor-sized authoritative body
 *  overlaps an event cell. Heroes and monsters share this exact geometry. */
export function touchesEventCell(
  state: WorldRoomState,
  position: Vec2,
  event: Pick<MapEvent, "id" | "col" | "row">,
  tolerance: number,
): boolean {
  const cell = activeEventCell(state, event);
  const left = cell.col * TILE_SIZE - tolerance;
  const top = cell.row * TILE_SIZE - tolerance;
  const right = (cell.col + 1) * TILE_SIZE + tolerance;
  const bottom = (cell.row + 1) * TILE_SIZE + tolerance;
  return (
    position.x < right &&
    position.x + PLAYER_SIZE > left &&
    position.y < bottom &&
    position.y + PLAYER_SIZE > top
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
  if (!isActiveWorldEventKind(event.kind)) return null;
  const pageIndex = activePageIndex(event, state.adventureState.state);
  if (pageIndex === null) return null;
  const page = event.pages[pageIndex];
  if (page === undefined || page.trigger !== trigger || page.commands.length === 0) return null;
  return { pageIndex, program: page.commands };
}

/**
 * Port of `#detectPlayerTouch` (`world.ts:1386`): the contact-with-hero trigger, evaluated on the
 * movement edge (from `movement-system`'s `onPlayerMoved`), not a per-tick scan. Uses the 32px
 * body plus the maximum living-player step as tolerance — a door/shore teleporter commonly sits on
 * solid terrain the body can touch but never occupy. Standing in contact does not re-fire; the
 * one-run lock covers a re-entry while the run lives.
 */
export function detectPlayerTouch(
  state: WorldRoomState,
  player: PlayerRuntime,
  previous: { x: number; y: number },
): void {
  if (player.identityKind !== "hero" || player.life !== "alive" || !player.authorized) return;
  const events = state.location?.definition.events;
  if (!events || events.length === 0) return;
  const movementTolerance = (PLAYER_SPEED * TICK_MS) / 1_000;
  for (const event of events) {
    if (!isActiveWorldEventKind(event.kind)) continue;
    const runnable = runnablePage(state, event, "player-touch");
    if (
      runnable !== null &&
      !touchesEventCell(state, previous, event, 0) &&
      touchesEventCell(state, player, event, movementTolerance)
    ) {
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
  previous: Vec2,
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
    const destination = eventCellCentre(command);
    const inBounds =
      destination.x >= 0 &&
      destination.y >= 0 &&
      destination.x < terrain.width &&
      destination.y < terrain.height;
    if (!inBounds || !isWalkable(destination, PLAYER_SIZE, terrain)) {
      logTeleportRefusedOnce(state, event.id, inBounds ? "unwalkable" : "out_of_bounds", {
        monsterId: monster.id,
        mapId,
        col: command.col,
        row: command.row,
      });
      return;
    }
    const beforeTeleport = { x: monster.x, y: monster.y };
    monster.x = destination.x;
    monster.y = destination.y;
    state.monsterGrid.update(monster, beforeTeleport);
    resetMonsterNavigation(monster);
    return;
  }
}
