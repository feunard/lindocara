import { emptyColliderIndex } from "@lindocara/engine/collider.js";
import type { TerrainGeometry } from "@lindocara/engine/game.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { describe, expect, it } from "vitest";
import { advanceNpcEvents, reconcileNpcMovement } from "../src/world/npc-movement-system.js";
import type { ActiveWorldEvent } from "../src/world/world-runtime.js";

const terrain: TerrainGeometry = {
  width: 12 * TILE_SIZE,
  height: 10 * TILE_SIZE,
  obstacles: [],
  spawnPoints: [],
  safeZone: null,
  tiles: {
    cols: 12,
    rows: 10,
    kinds: Array.from({ length: 120 }, () => "grass"),
  },
  colliders: emptyColliderIndex(12, 10),
};

function event(id: string, col: number, row: number): ActiveWorldEvent {
  return {
    id,
    col,
    row,
    graphicAssetId: null,
    onTop: false,
    moveSpeed: 4,
    moveFrequency: 4,
    moveAnimation: true,
    directionFixed: false,
  };
}

describe("authoritative NPC movement", () => {
  it("follows a deterministic custom circuit and respects baked collision", () => {
    let movement = reconcileNpcMovement(
      new Map(),
      [
        {
          id: "worker",
          homeCol: 5,
          homeRow: 5,
          moveType: "custom",
          moveSpeed: 4,
          moveFreq: 4,
          through: false,
          patrolRadius: 4 * TILE_SIZE,
        },
      ],
      0,
    );
    let events: ActiveWorldEvent[] = [event("worker", 5, 5)];
    for (const tick of [8, 16]) {
      events = advanceNpcEvents({
        events,
        movement,
        players: [],
        terrain,
        tick,
        pausedEventIds: new Set(),
      });
    }
    expect(events[0]).toMatchObject({ col: 5, row: 3 });

    movement = reconcileNpcMovement(new Map(), [...movement.values()], 16);
    const blockedTerrain: TerrainGeometry = {
      ...terrain,
      tiles: {
        ...terrain.tiles,
        kinds: terrain.tiles.kinds.map((kind, index) => (index === 53 ? "forest" : kind)),
      },
    };
    const blocked = advanceNpcEvents({
      events: [event("worker", 5, 5)],
      movement,
      players: [],
      terrain: blockedTerrain,
      tick: 24,
      pausedEventIds: new Set(),
    });
    expect(blocked[0]).toMatchObject({ col: 5, row: 5 });
  });

  it("approaches a nearby hero but pauses while the NPC owns a conversation", () => {
    const movement = reconcileNpcMovement(
      new Map(),
      [
        {
          id: "guard",
          homeCol: 3,
          homeRow: 3,
          moveType: "approach",
          moveSpeed: 4,
          moveFreq: 4,
          through: false,
          patrolRadius: 4 * TILE_SIZE,
        },
      ],
      0,
    );
    const players = [
      { x: 6 * TILE_SIZE, y: 3 * TILE_SIZE, authorized: true, life: "alive" as const },
    ];
    const moved = advanceNpcEvents({
      events: [event("guard", 3, 3)],
      movement,
      players,
      terrain,
      tick: 8,
      pausedEventIds: new Set(),
    });
    expect(moved[0]).toMatchObject({ col: 4, row: 3 });

    const paused = advanceNpcEvents({
      events: moved,
      movement,
      players,
      terrain,
      tick: 16,
      pausedEventIds: new Set(["guard"]),
    });
    expect(paused).toEqual(moved);
  });

  it("keeps an approaching NPC inside its authored patrol radius", () => {
    const movement = reconcileNpcMovement(
      new Map(),
      [
        {
          id: "villager",
          homeCol: 3,
          homeRow: 3,
          moveType: "approach",
          moveSpeed: 4,
          moveFreq: 4,
          through: false,
          patrolRadius: TILE_SIZE,
        },
      ],
      0,
    );
    const players = [
      { x: 7 * TILE_SIZE, y: 3 * TILE_SIZE, authorized: true, life: "alive" as const },
    ];
    let events: ActiveWorldEvent[] = [event("villager", 3, 3)];
    for (const tick of [8, 16, 24, 32]) {
      events = advanceNpcEvents({
        events,
        movement,
        players,
        terrain,
        tick,
        pausedEventIds: new Set(),
      });
      expect(Math.hypot((events[0]?.col ?? 0) - 3, (events[0]?.row ?? 0) - 3)).toBeLessThanOrEqual(
        1,
      );
    }
  });
});
