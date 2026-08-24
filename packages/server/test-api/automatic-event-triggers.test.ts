import { EMPTY_ADVENTURE_STATE } from "@lindocara/engine/adventure-state.js";
import type { EventCommand } from "@lindocara/engine/event-commands.js";
import {
  defaultEventPage,
  type EventTrigger,
  type MapEvent,
} from "@lindocara/engine/map-events.js";
import {
  detectEventTouch,
  detectPlayerTouch,
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

  it("fires an elevated pickup when the hero crosses its stable capture height", () => {
    const pickup: MapEvent = {
      ...authoredEvent("pickup", "player-touch"),
      col: 1,
      row: 1,
      kind: "normal",
      patrolRadius: null,
      pages: [
        {
          ...defaultEventPage(),
          trigger: "player-touch",
          graphicElevation: 1.8,
          optFloat: true,
          commands: [{ t: "movementEffect", effect: "double_jump", durationMs: 9_000, power: 1 }],
        },
      ],
    };
    const state = stateFor([pickup]);
    const player = state.players.get("connection-a");
    if (!player) throw new Error("hero fixture missing");
    Object.assign(player, { x: -0.5, y: 1.8, z: -0.5 });
    state.activeEvents = [
      {
        id: pickup.id,
        col: 1,
        row: 1,
        graphicAssetId: null,
        onTop: false,
        moveSpeed: 3,
        moveFrequency: 3,
        moveAnimation: true,
        directionFixed: false,
      },
    ];
    if (!state.location) throw new Error("location fixture missing");
    state.location.definition.terrain = {
      size: 4,
      waterLevel: -0.05,
      query: { heightAt: () => 0 },
    } as unknown as typeof state.location.definition.terrain;

    detectPlayerTouch(state, player, { x: -0.5, y: 0, z: -0.5 });

    expect(state.eventRuns.contexts.get(pickup.id)?.heroId).toBe("hero-a");
  });
});
