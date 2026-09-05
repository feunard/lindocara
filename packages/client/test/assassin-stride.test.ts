import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { zoneTerrainFromHeightfield } from "@lindocara/engine/terrain-access.js";
import { ASSASSIN_V2_MANIFEST as manifest } from "@lindocara/renderer/assassin-v2-art.js";
import { describe, expect, it } from "vitest";

import { createHeroController, HERO_PHYSICS } from "../src/game/hero-controller.js";

describe("Assassin contact cadence in the real movement controller", () => {
  it("keeps audio/footprints on stride contacts over sustained diagonal movement at different refresh rates", () => {
    expect(manifest.strideDistance).toBe(HERO_PHYSICS.pasTousLes * 2);
    const size = 100;
    const map: MapData = {
      version: 1,
      size,
      levelHeight: 0.9,
      waterLevel: -0.05,
      levels: Array(size * size).fill(0),
      materials: Array(size * size).fill("herbe"),
      colliders: [],
      spawns: [],
      elements: [],
      events: [],
    };
    const terrain = zoneTerrainFromHeightfield(map);
    for (const hz of [30, 60, 144]) {
      const hero = createHeroController({
        terrain,
        spawn: { x: 0, y: 0, z: 0 },
        speed: manifest.referenceSpeed,
      });
      let travelled = 0,
        contacts = 0;
      for (let frame = 0; frame < hz * 5; frame++) {
        const before = { x: hero.state.x, z: hero.state.z };
        const events = hero.step({ x: 1, z: 1, jump: false }, 1 / hz);
        travelled += Math.hypot(hero.state.x - before.x, hero.state.z - before.z);
        for (const event of events)
          if (event.t === "pas") {
            contacts++;
            const overshoot = travelled - contacts * HERO_PHYSICS.pasTousLes;
            expect(overshoot).toBeGreaterThanOrEqual(-1e-8);
            expect(overshoot).toBeLessThan(manifest.referenceSpeed / hz + 1e-8);
          }
      }
      expect(contacts).toBeGreaterThan(15);
      expect(Math.hypot(hero.state.x, hero.state.z)).toBeCloseTo(travelled, 8);
    }
  });
});
