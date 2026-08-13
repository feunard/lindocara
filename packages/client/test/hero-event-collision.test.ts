import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import {
  withWorldEventColliders,
  zoneTerrainFromHeightfield,
} from "@lindocara/engine/terrain-access.js";
import { describe, expect, it } from "vitest";
import { createHeroController } from "@/game/hero-controller.js";

const SIZE = 12;
const FRAME = 1 / 60;

function flatTerrain() {
  const map: MapData = {
    version: 1,
    size: SIZE,
    levelHeight: 0.9,
    waterLevel: -0.05,
    levels: new Array(SIZE * SIZE).fill(0),
    materials: new Array(SIZE * SIZE).fill("herbe"),
    colliders: [],
    spawns: [{ name: "default", x: -2, z: 0 }],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

describe("live authored-event collision", () => {
  it("adds and removes a harvest footprint without resetting the hero", () => {
    const base = flatTerrain();
    const blocked = withWorldEventColliders(base, [
      { harvest: { collider: [SIZE * 32, (SIZE / 2 - 1) * 64, 64, 128] } },
    ]);
    const hero = createHeroController({
      terrain: blocked,
      spawn: { x: -2, y: 0, z: 0 },
      speed: 4,
    });
    const east = { x: 1, z: 0, jump: false };

    for (let frame = 0; frame < 120; frame += 1) hero.step(east, FRAME);
    expect(hero.state.x).toBeLessThan(0);

    hero.setTerrain(base);
    for (let frame = 0; frame < 60; frame += 1) hero.step(east, FRAME);
    expect(hero.state.x).toBeGreaterThan(0.5);
  });

  it("adds and removes the solid footprint of an authoritative Peasant camp", () => {
    const base = flatTerrain();
    const blocked = withWorldEventColliders(base, [], [{ x: 0, z: 0 }]);
    const hero = createHeroController({
      terrain: blocked,
      spawn: { x: -2, y: 0, z: 0 },
      speed: 4,
    });
    const east = { x: 1, z: 0, jump: false };

    for (let frame = 0; frame < 120; frame += 1) hero.step(east, FRAME);
    expect(hero.state.x).toBeLessThan(-0.7);

    hero.setTerrain(withWorldEventColliders(base, []));
    for (let frame = 0; frame < 60; frame += 1) hero.step(east, FRAME);
    expect(hero.state.x).toBeGreaterThan(0.5);
  });
});
