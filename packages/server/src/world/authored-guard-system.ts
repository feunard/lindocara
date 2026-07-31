/**
 * Projection of authored `guard` events into the existing authoritative guard simulation.
 *
 * Party state remains owned by GameSession and event page selection remains the engine's pure XP
 * rule. This module only derives definitions and reconciles them with the room-owned runtimes; it
 * owns no clock, socket, storage or mutable module state.
 */
import { activePageIndex, type PartyAdventureState } from "@lindocara/engine/adventure-state.js";
import type { GuardDefinition } from "@lindocara/engine/game.js";
import { eventCellCentre, guardEvents, type MapEvent } from "@lindocara/engine/map-events.js";
import { createGuards, type GuardRuntime } from "./world-runtime.js";

const AUTHORED_GUARD_PREFIX = "guard-";

/** Stable runtime id binding an authored guard event to its moving combat entity. */
export function authoredGuardRuntimeId(eventId: string): string {
  return `${AUTHORED_GUARD_PREFIX}${eventId}`;
}

export function activeAuthoredGuardDefinitions(
  events: readonly MapEvent[],
  state: PartyAdventureState,
): GuardDefinition[] {
  return guardEvents(events).flatMap((event) => {
    const pageIndex = activePageIndex(event, state);
    if (pageIndex === null || event.patrolRadius === null) return [];
    const page = event.pages[pageIndex];
    if (!page) return [];
    return [
      {
        id: authoredGuardRuntimeId(event.id),
        ...eventCellCentre(event),
        patrolRadius: event.patrolRadius,
        graphicTint: page.graphicTint ?? 0xffffff,
      },
    ];
  });
}

/**
 * Keep combat state for reinforcements that remain active, create newly earned ones at full health,
 * and drop those whose page no longer holds. Static catalogue guards share the same reconciliation
 * path, so authored state changes cannot accidentally erase them.
 */
export function reconcileActiveGuards(
  current: readonly GuardRuntime[],
  definitions: readonly GuardDefinition[],
): GuardRuntime[] {
  const currentById = new Map(current.map((guard) => [guard.id, guard]));
  return definitions.map((definition) => {
    const existing = currentById.get(definition.id);
    if (!existing) return createGuards([definition])[0] as GuardRuntime;
    return {
      ...existing,
      homeX: definition.x,
      homeY: definition.y,
      patrolRadius: definition.patrolRadius,
      graphicTint: definition.graphicTint ?? 0xffffff,
    };
  });
}
