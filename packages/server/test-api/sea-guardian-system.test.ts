import { starterEquipmentFor } from "@lindocara/engine/character.js";
import type { GroundVector } from "@lindocara/engine/ground.js";
import { encodeMap, type MapData } from "@lindocara/engine/hd2d/map-data.js";
import { functionalEvent } from "@lindocara/engine/map-events.js";
import { DEFAULT_ZONE_NAVIGATION } from "@lindocara/engine/navigation.js";
import { zoneTerrainFromHeightfield } from "@lindocara/engine/terrain-access.js";
import { createWorldRoomState } from "@lindocara/server/api/realtime/worldState.js";
import {
  advanceSeaGuardian,
  createSeaGuardianRuntime,
  type SeaGuardianRuntime,
} from "@lindocara/server/world/sea-guardian-system.js";
import { newPlayer } from "@lindocara/server/world/world-runtime.js";
import { describe, expect, it, vi } from "vitest";

function mapWithWater(size: number, water: (col: number, row: number) => boolean): MapData {
  const levels: (number | null)[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) levels.push(water(col, row) ? null : 0);
  }
  return {
    version: 1,
    size,
    levelHeight: 0.9,
    waterLevel: -0.05,
    levels,
    materials: new Array(size * size).fill("herbe"),
    colliders: [],
    spawns: [],
    elements: [],
    events: [],
  };
}

function cell(size: number, col: number, row: number): GroundVector {
  return { x: col + 0.5 - size / 2, z: row + 0.5 - size / 2 };
}

function runtimeAt(map: MapData, point: GroundVector, id = "guardian-a"): SeaGuardianRuntime {
  return createSeaGuardianRuntime(map, [{ id, ...point }], 0);
}

function firstGuardian(runtime: SeaGuardianRuntime) {
  return runtime.guardians[0];
}

function swimmer(id: string, x: number, z: number) {
  const player = newPlayer(
    {
      id,
      nick: id,
      x,
      y: -0.05,
      z,
      level: 1,
      xp: 0,
      hp: 100,
      appearance: { body: "wayfarer", primaryColor: "azure" },
      class: "warrior",
      equipment: starterEquipmentFor("warrior"),
      inventory: { potions: 0, gold: 0, crystals: 0 },
      quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
      zoneId: "verdant-reach",
      instanceId: "main",
      sessionEpoch: 1,
      wardRunExpiresAt: null,
      life: "alive",
      corpse: null,
    },
    `connection-${id}`,
    "room",
  );
  player.swimming = true;
  return player;
}

describe("sea guardian", () => {
  it("is wired into a room only by an explicit authored special-monster event", () => {
    const map = mapWithWater(5, (col) => col === 2);
    const definition = (events: ReturnType<typeof functionalEvent>[]) => ({
      id: "map-a",
      nameKey: "zone.verdant_reach.name" as const,
      type: "open_world" as const,
      defaultInstanceId: "main" as const,
      maxPlayers: 4,
      terrain: zoneTerrainFromHeightfield(map),
      quests: [],
      questSites: [],
      monsters: [],
      guards: [],
      portals: [],
      navigation: DEFAULT_ZONE_NAVIGATION,
      events,
      heightfield: encodeMap(map),
    });
    const room = (events: ReturnType<typeof functionalEvent>[]) =>
      createWorldRoomState(
        "party-a:map-a",
        { partyId: "party-a", mapId: "map-a" },
        {
          zoneId: "map-a",
          instanceId: "main",
          roomKey: "party-a:map-a",
          definition: definition(events),
        },
      );

    expect(room([]).seaGuardian.guardians).toEqual([]);

    const guardianA = functionalEvent({
      id: "11111111-1111-4111-8111-111111111111",
      col: 2,
      row: 3,
      ordinal: 1,
      kind: "sea-guardian",
    });
    const guardianB = functionalEvent({
      id: "22222222-2222-4222-8222-222222222222",
      col: 2,
      row: 1,
      ordinal: 2,
      kind: "sea-guardian",
    });
    expect(room([guardianA, guardianB]).seaGuardian.guardians).toEqual([
      expect.objectContaining({
        id: `sea-guardian_${guardianA.id}`,
        ...cell(map.size, 2, 3),
      }),
      expect.objectContaining({
        id: `sea-guardian_${guardianB.id}`,
        ...cell(map.size, 2, 1),
      }),
    ]);
  });

  it("stays disabled on a water map without an authored placement", () => {
    const runtime = createSeaGuardianRuntime(
      mapWithWater(4, () => true),
      [],
      0,
    );
    advanceSeaGuardian(runtime, { now: 60_000, dt: 1, players: [], devour: vi.fn() });
    expect(runtime.topology).toBeNull();
    expect(runtime.guardians).toEqual([]);
  });

  it("refuses a defensive runtime anchor that is not water", () => {
    const map = mapWithWater(4, (col) => col === 0);
    const runtime = runtimeAt(map, cell(map.size, 2, 2));
    expect(runtime.topology).toBeNull();
    expect(runtime.guardians).toEqual([]);
  });

  it("exists immediately at its authored water anchor and patrols there permanently", () => {
    const map = mapWithWater(5, (col) => col === 2);
    const runtime = runtimeAt(map, cell(map.size, 2, 0));
    const startZ = firstGuardian(runtime)?.z;
    for (let tick = 1; tick <= 300; tick += 1) {
      advanceSeaGuardian(runtime, {
        now: tick * 500,
        dt: 0.5,
        players: [],
        devour: vi.fn(),
      });
      const guardian = firstGuardian(runtime);
      expect(guardian).toBeDefined();
      if (!guardian) continue;
      const col = Math.floor(guardian.x + map.size / 2);
      const row = Math.floor(guardian.z + map.size / 2);
      expect(map.levels[row * map.size + col]).toBeNull();
    }
    expect(firstGuardian(runtime)?.z).not.toBe(startZ);
  });

  it("loops around a continuous water rim without leaving the map", () => {
    const map = mapWithWater(7, (col, row) => col === 0 || row === 0 || col === 6 || row === 6);
    const runtime = runtimeAt(map, cell(map.size, 0, 0));
    const visited = new Set<string>();
    for (let tick = 0; tick <= 200; tick += 1) {
      advanceSeaGuardian(runtime, {
        now: tick * 50,
        dt: tick === 0 ? 0 : 0.05,
        players: [],
        devour: vi.fn(),
      });
      const guardian = firstGuardian(runtime);
      if (!guardian) continue;
      const col = Math.floor(guardian.x + map.size / 2);
      const row = Math.floor(guardian.z + map.size / 2);
      visited.add(`${col}:${row}`);
      expect(map.levels[row * map.size + col]).toBeNull();
    }
    expect(visited.size).toBeGreaterThanOrEqual(20);
  });

  it("gives colocated guardians independent patrol motion", () => {
    const map = mapWithWater(7, (col, row) => col === 0 || row === 0 || col === 6 || row === 6);
    const anchor = cell(map.size, 0, 0);
    const runtime = createSeaGuardianRuntime(
      map,
      [
        { id: "guardian-a", ...anchor },
        { id: "guardian-b", ...anchor },
      ],
      0,
    );

    for (let tick = 1; tick <= 20; tick += 1) {
      advanceSeaGuardian(runtime, {
        now: tick * 50,
        dt: 0.05,
        players: [],
        devour: vi.fn(),
      });
    }

    const [first, second] = runtime.guardians;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.patrolSpeed).not.toBe(second?.patrolSpeed);
    expect(first?.facing).not.toEqual(second?.facing);
    expect({ x: first?.x, z: first?.z }).not.toEqual({ x: second?.x, z: second?.z });
  });

  it("redirects immediately toward an in-range swimmer and devours once", () => {
    const map = mapWithWater(3, () => true);
    const anchor = cell(map.size, 1, 1);
    const runtime = runtimeAt(map, anchor);
    const hero = swimmer("hero", anchor.x, anchor.z);
    const devour = vi.fn((target) => {
      target.life = "corpse";
    });
    advanceSeaGuardian(runtime, { now: 1, dt: 0, players: [hero], devour });
    expect(devour).toHaveBeenCalledOnce();
    expect(firstGuardian(runtime)).toMatchObject({ state: "attack", targetId: hero.id });
  });

  it("advances every placed guardian independently", () => {
    const map = mapWithWater(7, () => true);
    const left = cell(map.size, 1, 3);
    const right = cell(map.size, 5, 3);
    const runtime = createSeaGuardianRuntime(
      map,
      [
        { id: "guardian-left", ...left },
        { id: "guardian-right", ...right },
      ],
      0,
    );
    const leftHero = swimmer("left-hero", left.x, left.z);
    const rightHero = swimmer("right-hero", right.x, right.z);
    const devour = vi.fn((target) => {
      target.life = "corpse";
    });

    advanceSeaGuardian(runtime, {
      now: 1,
      dt: 0,
      players: [leftHero, rightHero],
      devour,
    });

    expect(devour).toHaveBeenCalledTimes(2);
    expect(runtime.guardians).toEqual([
      expect.objectContaining({ id: "guardian-left", state: "attack", targetId: leftHero.id }),
      expect.objectContaining({ id: "guardian-right", state: "attack", targetId: rightHero.id }),
    ]);
  });

  it("never teleports between disconnected bodies of water", () => {
    const map = mapWithWater(5, (col) => col === 0 || col === 4);
    const runtime = runtimeAt(map, cell(map.size, 0, 2));
    const target = cell(map.size, 4, 2);
    const hero = swimmer("remote-swimmer", target.x, target.z);
    const devour = vi.fn();
    for (let tick = 1; tick <= 80; tick += 1) {
      advanceSeaGuardian(runtime, {
        now: tick * 50,
        dt: 0.05,
        players: [hero],
        devour,
      });
      const guardian = firstGuardian(runtime);
      expect(guardian).toBeDefined();
      if (guardian) expect(Math.floor(guardian.x + map.size / 2)).toBe(0);
    }
    expect(devour).not.toHaveBeenCalled();
  });

  it("repaths through a right-angle channel when the swimmer turns the corner", () => {
    const map = mapWithWater(7, (col, row) => (row === 1 && col <= 5) || (col === 5 && row >= 1));
    const start = cell(map.size, 0, 1);
    const runtime = runtimeAt(map, start);
    const firstTarget = cell(map.size, 5, 1);
    const hero = swimmer("corner-runner", firstTarget.x, firstTarget.z);
    const devour = vi.fn((target) => {
      target.life = "corpse";
    });
    let turnedSouth = false;
    for (let tick = 0; tick < 80 && devour.mock.calls.length === 0; tick += 1) {
      if (tick === 5) {
        const finalTarget = cell(map.size, 5, 6);
        hero.x = finalTarget.x;
        hero.z = finalTarget.z;
      }
      advanceSeaGuardian(runtime, {
        now: tick * 50,
        dt: tick === 0 ? 0 : 0.05,
        players: [hero],
        devour,
      });
      const guardian = firstGuardian(runtime);
      if (!guardian) continue;
      const col = Math.floor(guardian.x + map.size / 2);
      const row = Math.floor(guardian.z + map.size / 2);
      expect(map.levels[row * map.size + col]).toBeNull();
      if (guardian.facing.z > 0.5) turnedSouth = true;
    }
    expect(turnedSouth).toBe(true);
    expect(devour).toHaveBeenCalledOnce();
  });
});
