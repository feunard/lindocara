import { starterEquipmentFor } from "@lindocara/engine/character.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import {
  SEA_GUARDIAN_PATROL_DURATION_MS,
  SEA_GUARDIAN_PATROL_FIRST_DELAY_MS,
  SEA_GUARDIAN_PATROL_INTERVAL_MS,
  SEA_GUARDIAN_SWIMMER_SPAWN_DELAY_MS,
} from "@lindocara/engine/sea-guardian.js";
import {
  advanceSeaGuardian,
  createSeaGuardianRuntime,
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
  it("stays disabled on a map with no authored water", () => {
    const runtime = createSeaGuardianRuntime(
      mapWithWater(4, () => false),
      0,
    );
    advanceSeaGuardian(runtime, { now: 60_000, dt: 1, players: [], devour: vi.fn() });
    expect(runtime.topology).toBeNull();
    expect(runtime.guardian).toBeNull();
  });

  it("periodically patrols only through a connected edge-to-edge water channel", () => {
    const map = mapWithWater(5, (col) => col === 2);
    const runtime = createSeaGuardianRuntime(map, 0);
    const devour = vi.fn();
    advanceSeaGuardian(runtime, {
      now: SEA_GUARDIAN_PATROL_FIRST_DELAY_MS,
      dt: 0,
      players: [],
      devour,
    });
    expect(runtime.guardian?.state).toBe("patrol");
    const startZ = runtime.guardian?.z;
    for (let tick = 1; tick <= 20; tick += 1) {
      advanceSeaGuardian(runtime, {
        now: SEA_GUARDIAN_PATROL_FIRST_DELAY_MS + tick * 50,
        dt: 0.05,
        players: [],
        devour,
      });
      const guardian = runtime.guardian;
      expect(guardian).not.toBeNull();
      if (!guardian) continue;
      const col = Math.floor(guardian.x + map.size / 2);
      const row = Math.floor(guardian.z + map.size / 2);
      expect(map.levels[row * map.size + col]).toBeNull();
    }
    expect(runtime.guardian?.z).not.toBe(startZ);
    expect(devour).not.toHaveBeenCalled();
  });

  it("loops clockwise around a continuous water rim", () => {
    const map = mapWithWater(7, (col, row) => col === 0 || row === 0 || col === 6 || row === 6);
    const runtime = createSeaGuardianRuntime(map, 0);
    const visited = new Set<string>();
    for (let tick = 0; tick <= 200; tick += 1) {
      advanceSeaGuardian(runtime, {
        now: SEA_GUARDIAN_PATROL_FIRST_DELAY_MS + tick * 50,
        dt: tick === 0 ? 0 : 0.05,
        players: [],
        devour: vi.fn(),
      });
      const guardian = runtime.guardian;
      if (!guardian) continue;
      const col = Math.floor(guardian.x + map.size / 2);
      const row = Math.floor(guardian.z + map.size / 2);
      visited.add(`${col}:${row}`);
      expect(map.levels[row * map.size + col]).toBeNull();
    }
    expect(visited.size).toBeGreaterThanOrEqual(20);
  });

  it("waits for more than three continuous seconds in water before a forced appearance", () => {
    const runtime = createSeaGuardianRuntime(
      mapWithWater(7, () => true),
      0,
    );
    const hero = swimmer("hero", 0, 0);
    const devour = vi.fn();
    advanceSeaGuardian(runtime, { now: 0, dt: 0, players: [hero], devour });
    advanceSeaGuardian(runtime, {
      now: SEA_GUARDIAN_SWIMMER_SPAWN_DELAY_MS,
      dt: 0,
      players: [hero],
      devour,
    });
    expect(runtime.guardian).toBeNull();
    advanceSeaGuardian(runtime, {
      now: SEA_GUARDIAN_SWIMMER_SPAWN_DELAY_MS + 50,
      dt: 0,
      players: [hero],
      devour,
    });
    expect(runtime.guardian).toMatchObject({ state: "chase", targetId: hero.id });
  });

  it("restarts the forced-appearance timer when the hero leaves the water", () => {
    const runtime = createSeaGuardianRuntime(
      mapWithWater(7, () => true),
      0,
    );
    const hero = swimmer("hesitant-hero", 0, 0);
    const devour = vi.fn();
    advanceSeaGuardian(runtime, { now: 0, dt: 0, players: [hero], devour });
    hero.swimming = false;
    advanceSeaGuardian(runtime, { now: 2_000, dt: 0, players: [hero], devour });
    hero.swimming = true;
    advanceSeaGuardian(runtime, { now: 2_050, dt: 0, players: [hero], devour });
    advanceSeaGuardian(runtime, {
      now: 2_050 + SEA_GUARDIAN_SWIMMER_SPAWN_DELAY_MS,
      dt: 0,
      players: [hero],
      devour,
    });
    expect(runtime.guardian).toBeNull();
    advanceSeaGuardian(runtime, {
      now: 2_050 + SEA_GUARDIAN_SWIMMER_SPAWN_DELAY_MS + 50,
      dt: 0,
      players: [hero],
      devour,
    });
    expect(runtime.guardian).toMatchObject({ state: "chase", targetId: hero.id });
  });

  it("leaves the map between autonomous patrols instead of remaining permanently", () => {
    const runtime = createSeaGuardianRuntime(
      mapWithWater(5, () => true),
      0,
    );
    const devour = vi.fn();
    advanceSeaGuardian(runtime, {
      now: SEA_GUARDIAN_PATROL_FIRST_DELAY_MS,
      dt: 0,
      players: [],
      devour,
    });
    expect(runtime.guardian).not.toBeNull();
    advanceSeaGuardian(runtime, {
      now: SEA_GUARDIAN_PATROL_FIRST_DELAY_MS + SEA_GUARDIAN_PATROL_DURATION_MS + 1,
      dt: 0,
      players: [],
      devour,
    });
    expect(runtime.guardian).toBeNull();
    advanceSeaGuardian(runtime, {
      now:
        SEA_GUARDIAN_PATROL_FIRST_DELAY_MS +
        SEA_GUARDIAN_PATROL_DURATION_MS +
        SEA_GUARDIAN_PATROL_INTERVAL_MS,
      dt: 0,
      players: [],
      devour,
    });
    expect(runtime.guardian).toBeNull();
    advanceSeaGuardian(runtime, {
      now:
        SEA_GUARDIAN_PATROL_FIRST_DELAY_MS +
        SEA_GUARDIAN_PATROL_DURATION_MS +
        SEA_GUARDIAN_PATROL_INTERVAL_MS +
        1,
      dt: 0,
      players: [],
      devour,
    });
    expect(runtime.guardian).not.toBeNull();
  });

  it("redirects an existing patrol immediately and devours an in-range swimmer once", () => {
    const runtime = createSeaGuardianRuntime(
      mapWithWater(3, () => true),
      0,
    );
    const devour = vi.fn((hero) => {
      hero.life = "corpse";
    });
    advanceSeaGuardian(runtime, {
      now: SEA_GUARDIAN_PATROL_FIRST_DELAY_MS,
      dt: 0,
      players: [],
      devour,
    });
    const hero = swimmer("hero", 0, 0);
    advanceSeaGuardian(runtime, {
      now: SEA_GUARDIAN_PATROL_FIRST_DELAY_MS + 1,
      dt: 1,
      players: [hero],
      devour,
    });
    expect(devour).toHaveBeenCalledOnce();
    expect(runtime.guardian).toMatchObject({ state: "attack", targetId: hero.id });
  });

  it("repaths through a right-angle channel when the swimmer turns the corner", () => {
    const map = mapWithWater(7, (col, row) => (row === 1 && col <= 5) || (col === 5 && row >= 1));
    const runtime = createSeaGuardianRuntime(map, 0);
    const hero = swimmer("corner-runner", 2, -2);
    const devour = vi.fn((target) => {
      target.life = "corpse";
    });
    let turnedSouth = false;
    for (let tick = 0; tick < 80 && devour.mock.calls.length === 0; tick += 1) {
      if (tick === 5) hero.z = 3;
      advanceSeaGuardian(runtime, {
        now: SEA_GUARDIAN_PATROL_FIRST_DELAY_MS + tick * 50,
        dt: tick === 0 ? 0 : 0.05,
        players: [hero],
        devour,
      });
      const guardian = runtime.guardian;
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
