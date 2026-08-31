import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { maxHpForLevel } from "@lindocara/engine/game.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { TICK_HZ } from "@lindocara/engine/simulation.js";
import { zoneTerrainFromHeightfield } from "@lindocara/engine/terrain-access.js";
import {
  advanceLavaHazard,
  LAVA_DAMAGE_RATIO_PER_SECOND,
} from "@lindocara/server/world/lava-hazard-system.js";
import { createMonsters, newPlayer } from "@lindocara/server/world/world-runtime.js";
import { describe, expect, it } from "vitest";

function lavaMap(): MapData {
  return {
    version: 1,
    size: 3,
    levelHeight: 0.9,
    waterLevel: -0.05,
    levels: new Array(9).fill(0),
    materials: new Array(9).fill("lave"),
    colliders: [],
    spawns: [],
    elements: [],
    events: [],
  };
}

function player() {
  return newPlayer(
    {
      id: "hero-lava",
      nick: "Forge",
      x: 0,
      y: 0,
      z: 0.15,
      level: 1,
      xp: 0,
      hp: maxHpForLevel(1),
      appearance: { body: "wayfarer", primaryColor: "azure" },
      class: "warrior",
      equipment: starterEquipmentFor("warrior"),
      inventory: { potions: 0, gold: 0, crystals: 0 },
      quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
      zoneId: "caldera",
      instanceId: "main",
      sessionEpoch: 1,
      wardRunExpiresAt: null,
      life: "alive",
      corpse: null,
    },
    "connection-lava",
    "room-lava",
  );
}

describe("lava hazard", () => {
  it("applies twenty percent of maximum HP per completed second", () => {
    const target = player();
    const exposureTicks = new Map<string, number>();
    const damage: number[] = [];
    const terrain = zoneTerrainFromHeightfield(lavaMap());
    const tick = () =>
      advanceLavaHazard({
        exposureTicks,
        players: [target],
        monsters: [],
        terrain,
        damagePlayer: (_player, amount) => damage.push(amount),
        damageMonster: () => {},
      });

    for (let index = 0; index < TICK_HZ - 1; index += 1) tick();
    expect(damage).toEqual([]);
    tick();
    expect(damage).toEqual([Math.ceil(maxHpForLevel(target.level) * LAVA_DAMAGE_RATIO_PER_SECOND)]);
  });

  it("resets partial exposure outside lava and ignores bodies above its surface", () => {
    const target = player();
    const exposureTicks = new Map<string, number>();
    const damage: number[] = [];
    const terrain = zoneTerrainFromHeightfield(lavaMap());
    const tick = () =>
      advanceLavaHazard({
        exposureTicks,
        players: [target],
        monsters: [],
        terrain,
        damagePlayer: (_player, amount) => damage.push(amount),
        damageMonster: () => {},
      });

    for (let index = 0; index < TICK_HZ - 1; index += 1) tick();
    target.y = 0.9;
    tick();
    expect(exposureTicks.has(target.id)).toBe(false);
    target.y = 0;
    tick();
    expect(exposureTicks.get(target.id)).toBe(1);
    expect(damage).toEqual([]);
  });

  it("damages living monsters once per completed second without granting player credit", () => {
    const target = createMonsters([
      {
        id: "lava-minotaur",
        kind: "troll",
        species: "mire_troll",
        zone: "route",
        x: 0,
        y: 0,
        z: 0,
        patrolRadius: 2,
        maxHp: 50,
      },
    ])[0];
    if (!target) throw new Error("monster fixture missing");
    const exposureTicks = new Map<string, number>();
    const damage: number[] = [];
    const terrain = zoneTerrainFromHeightfield(lavaMap());
    const tick = () =>
      advanceLavaHazard({
        exposureTicks,
        players: [],
        monsters: [target],
        terrain,
        damagePlayer: () => {},
        damageMonster: (_monster, amount) => damage.push(amount),
      });

    for (let index = 0; index < TICK_HZ; index += 1) tick();

    expect(damage).toEqual([10]);
    expect(target.contributions.size).toBe(0);
  });

  it("keeps monsters on another storey safe from lava in the same column", () => {
    const target = createMonsters([
      {
        id: "monster-above-lava",
        kind: "troll",
        species: "mire_troll",
        zone: "route",
        x: 0,
        y: 0.9,
        z: 0,
        patrolRadius: 2,
      },
    ])[0];
    if (!target) throw new Error("monster fixture missing");
    const damage: number[] = [];
    const exposureTicks = new Map<string, number>();
    const terrain = zoneTerrainFromHeightfield(lavaMap());

    for (let index = 0; index < TICK_HZ; index += 1) {
      advanceLavaHazard({
        exposureTicks,
        players: [],
        monsters: [target],
        terrain,
        damagePlayer: () => {},
        damageMonster: (_monster, amount) => damage.push(amount),
      });
    }

    expect(damage).toEqual([]);
  });
});
