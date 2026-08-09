import { EMPTY_ADVENTURE_STATE } from "@lindocara/engine/adventure-state.js";
import type { EventCommand } from "@lindocara/engine/event-commands.js";
import {
  defaultEventPage,
  type EventTrigger,
  type MapEvent,
} from "@lindocara/engine/map-events.js";
import {
  detectEventTouch,
  startAutomaticEventRuns,
} from "@lindocara/server/api/realtime/worldEvents.ts";
import type { WorldRoomState } from "@lindocara/server/api/realtime/worldState.ts";
import { createEventRunRuntime } from "@lindocara/server/world/event-run-system.js";
import { describe, expect, it } from "vitest";

const PROGRAM: readonly EventCommand[] = [{ t: "say", text: "runtime", name: null }];

function authoredEvent(id: string, trigger: EventTrigger): MapEvent {
  return {
    id,
    col: 0,
    row: 0,
    name: id,
    ordinal: 1,
    kind: "npc",
    species: null,
    patrolRadius: 64,
    pages: [{ ...defaultEventPage(), trigger, commands: PROGRAM }],
  };
}

function stateFor(events: readonly MapEvent[]): WorldRoomState {
  const hero = {
    id: "hero-a",
    x: -0.5,
    z: -1.5,
    identityKind: "hero",
    authorized: true,
    life: "alive",
    transitioning: false,
    disconnecting: false,
  };
  return {
    players: new Map([["connection-a", hero]]),
    location: { definition: { events, terrain: { size: 4 } } },
    activeEvents: events.map((event) => ({ id: event.id, col: event.col, row: event.row })),
    guards: [],
    adventureState: { state: EMPTY_ADVENTURE_STATE, version: 0 },
    eventRuns: createEventRunRuntime(),
    eventStateSync: null,
    eventTouchActorPositions: new Map(),
    eventTouchContacts: new Set(),
  } as unknown as WorldRoomState;
}

describe("authoritative automatic authored-event triggers", () => {
  it("starts autorun and parallel pages once under the existing event lock", () => {
    const state = stateFor([
      authoredEvent("auto-event", "auto"),
      authoredEvent("parallel-event", "parallel"),
      authoredEvent("action-event", "action"),
    ]);

    expect(startAutomaticEventRuns(state)).toBe(2);
    expect([...state.eventRuns.contexts.keys()]).toEqual(["auto-event", "parallel-event"]);
    expect(startAutomaticEventRuns(state)).toBe(0);
  });

  it("pauses new automatic runs while a state mutation is awaiting coordinator acknowledgement", () => {
    const state = stateFor([authoredEvent("auto-event", "auto")]);
    state.eventStateSync = Promise.resolve();

    expect(startAutomaticEventRuns(state)).toBe(0);
    expect(state.eventRuns.contexts.size).toBe(0);
  });

  it("fires event-touch only when the event actor creates a fresh contact edge", () => {
    const event = authoredEvent("walker", "event-touch");
    const state = stateFor([event]);

    expect(detectEventTouch(state)).toBe(0);
    state.activeEvents = [{ id: event.id, col: 1, row: 0 }] as unknown as typeof state.activeEvents;
    expect(detectEventTouch(state)).toBe(1);
    expect(state.eventRuns.contexts.get(event.id)?.heroId).toBe("hero-a");
    expect(detectEventTouch(state)).toBe(0);
  });
});
