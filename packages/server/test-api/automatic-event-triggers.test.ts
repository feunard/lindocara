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
    consumedMovementPickupIds: new Set(),
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

  it("does not fire a surface contact event for a hero moving on the basement below", () => {
    const event = { ...authoredEvent("surface-touch", "player-touch"), col: 1 };
    const state = stateFor([event]);
    const player = state.players.get("connection-a");
    if (!player) throw new Error("hero fixture missing");
    Object.assign(player, { x: -0.5, y: -2.4, z: -1.5 });
    state.activeEvents = [
      { id: event.id, col: 1, row: 0, y: 0 },
    ] as unknown as typeof state.activeEvents;

    detectPlayerTouch(state, player, { x: -1.5, y: -2.4, z: -1.5 });
    expect(state.eventRuns.contexts.has(event.id)).toBe(false);

    player.y = 0;
    detectPlayerTouch(state, player, { x: -1.5, y: 0, z: -1.5 });
    expect(state.eventRuns.contexts.get(event.id)?.heroId).toBe("hero-a");
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

  it.each([
    { label: "basement", depth: 2, floorY: -4.8 },
    { label: "upper floor", depth: -2, floorY: 4.8 },
  ])("fires a movement pickup on its $label and never from the surface", ({ depth, floorY }) => {
    const pickup: MapEvent = {
      ...authoredEvent(`pickup-${depth}`, "player-touch"),
      col: 1,
      row: 1,
      kind: "normal",
      patrolRadius: null,
      undergroundDepth: depth,
      pages: [
        {
          ...defaultEventPage(),
          trigger: "player-touch",
          commands: [
            { t: "movementEffect", effect: "speed_boost", durationMs: 6_000, power: 1.35 },
          ],
        },
      ],
    };
    const state = stateFor([pickup]);
    const player = state.players.get("connection-a");
    if (!player) throw new Error("hero fixture missing");
    state.activeEvents = [
      {
        id: pickup.id,
        col: pickup.col,
        row: pickup.row,
        y: floorY,
        undergroundDepth: depth,
      },
    ] as unknown as typeof state.activeEvents;

    Object.assign(player, { x: -0.5, y: 0, z: -0.5 });
    detectPlayerTouch(state, player, { x: -1.5, y: 0, z: -0.5 });
    expect(state.eventRuns.contexts.has(pickup.id)).toBe(false);

    Object.assign(player, { x: -0.5, y: floorY, z: -0.5 });
    detectPlayerTouch(state, player, { x: -1.5, y: floorY, z: -0.5 });
    expect(state.eventRuns.contexts.get(pickup.id)?.heroId).toBe("hero-a");
  });

  it("does not fire a level-one trap when the hero clears its top", () => {
    const trap: MapEvent = {
      ...authoredEvent("jumpable-trap", "player-touch"),
      col: 1,
      pages: [
        {
          ...defaultEventPage(),
          trigger: "player-touch",
          commands: [{ t: "damage", amount: 25, lethal: false }],
        },
      ],
    };
    const state = stateFor([trap]);
    const player = state.players.get("connection-a");
    if (!player) throw new Error("hero fixture missing");
    if (!state.location) throw new Error("location fixture missing");
    state.location.definition.terrain = {
      size: 4,
      levelHeight: 0.9,
      waterLevel: -0.05,
      query: { heightAt: () => 0, waterLevelAt: () => -0.05 },
    } as unknown as typeof state.location.definition.terrain;
    state.activeEvents = [
      {
        id: trap.id,
        col: trap.col,
        row: trap.row,
        graphicAssetId: null,
        onTop: false,
        moveSpeed: 3,
        moveFrequency: 3,
        moveAnimation: true,
        directionFixed: false,
        collider: [68, 26, 56, 38, 1],
      },
    ];
    const previous = { x: -1.5, y: 0, z: -1.5 };
    Object.assign(player, { x: -0.5, y: 1.05, z: -1.5 });

    detectPlayerTouch(state, player, previous);
    expect(state.eventRuns.contexts.has(trap.id)).toBe(false);

    player.y = 0;
    detectPlayerTouch(state, player, previous);
    expect(state.eventRuns.contexts.get(trap.id)?.heroId).toBe("hero-a");
  });
});
