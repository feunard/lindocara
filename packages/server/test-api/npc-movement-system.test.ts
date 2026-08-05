import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { type ZoneTerrain, zoneTerrainFromHeightfield } from "@lindocara/engine/terrain-access.js";
import { describe, expect, it } from "vitest";
import { advanceNpcEvents, reconcileNpcMovement } from "../src/world/npc-movement-system.js";
import type { ActiveWorldEvent } from "../src/world/world-runtime.js";

const SIZE = 12;

/**
 * A flat 12x12 heightfield, grid centre as origin. `patrolRadius` is tiles now — which is also
 * cells — rather than pixels divided by `TILE_SIZE` at every use.
 */
function terrainWith(raised: readonly number[] = []): ZoneTerrain {
  const levels: (number | null)[] = new Array(SIZE * SIZE).fill(0);
  for (const index of raised) levels[index] = 1;
  const map: MapData = {
    version: 1,
    size: SIZE,
    levelHeight: 0.5,
    waterLevel: -0.25,
    levels,
    materials: new Array(SIZE * SIZE).fill("herbe"),
    colliders: [],
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

const terrain = terrainWith();

/** The world point at the centre of cell `(col, row)`, in tile units. */
function atCell(col: number, row: number): { x: number; z: number } {
  return { x: col + 0.5 - SIZE / 2, z: row + 0.5 - SIZE / 2 };
}

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
          patrolRadius: 4,
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
    // Cell (col 5, row 4) is raised one level. A cliff refuses a grounded body exactly as a solid
    // tile used to: `maxStep` is 0 and an NPC does not jump.
    const blockedTerrain = terrainWith([4 * SIZE + 5]);
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

  it("follows an authored activity route and observes its waypoint pause", () => {
    const movement = reconcileNpcMovement(
      new Map(),
      [
        {
          id: "artisan",
          homeCol: 5,
          homeRow: 5,
          moveType: "custom",
          moveSpeed: 4,
          moveFreq: 4,
          through: false,
          patrolRadius: 4,
          route: [
            { offsetCol: 2, offsetRow: 0, waitMs: 1_000 },
            { offsetCol: 0, offsetRow: 0, waitMs: 0 },
          ],
        },
      ],
      0,
    );
    let events: ActiveWorldEvent[] = [event("artisan", 5, 5)];
    for (const tick of [8, 16, 24, 32, 40]) {
      events = advanceNpcEvents({
        events,
        movement,
        players: [],
        terrain,
        tick,
        pausedEventIds: new Set(),
      });
    }
    expect(events[0]).toMatchObject({ col: 7, row: 5 });

    events = advanceNpcEvents({
      events,
      movement,
      players: [],
      terrain,
      tick: 48,
      pausedEventIds: new Set(),
    });
    expect(events[0]).toMatchObject({ col: 6, row: 5 });
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
          patrolRadius: 4,
        },
      ],
      0,
    );
    const players = [{ ...atCell(6, 3), authorized: true, life: "alive" as const }];
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
          patrolRadius: 1,
        },
      ],
      0,
    );
    const players = [{ ...atCell(7, 3), authorized: true, life: "alive" as const }];
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
