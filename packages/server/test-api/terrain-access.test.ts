/**
 * `canStand` — the server's single walkability question, and the mirror of `canEnter`
 * (`packages/engine/src/hd2d/hero-step.ts`). Two of its clauses are the ones a naive port drops,
 * and each has a test here that fails without it:
 *
 * - the DISC test (`maxHeightAround` over the body's radius, never `heightAt` at the centre point),
 *   without which a body sinks half of itself into a cliff before anything stops it;
 * - water counting as a SURFACE at `waterLevel` rather than as a wall, without which nobody can
 *   stand on a shore — every cell of open water inside the disc would read as an obstacle.
 *
 * Water under the CENTRE is still refused, and that is not a contradiction of the second point: no
 * server entity swims in this increment, so a foot may not land in the sea. `canEnter` allows it
 * because the hero it serves flips to swimming on the next line; nothing here does.
 */

import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { describe, expect, it } from "vitest";
import {
  canStand,
  type ZoneTerrain,
  zoneTerrainFromHeightfield,
} from "../src/world/terrain-access.js";

const LEVEL_HEIGHT = 0.5;
const WATER_LEVEL = -0.25;

/**
 * A 4x4 grid — the smallest one carrying every case that matters. Rows run north to south, and a
 * cell (i, j) covers `x ∈ [i - 2, i - 1)`, `z ∈ [j - 2, j - 1)` (grid centre as origin, so
 * `toCell = floor(w + size / 2)`):
 *
 * ```
 *        x: -2   -1    0    1
 *  z: -2      0    0    0    0     flat strip, level 0
 *  z: -1    sea    0    0    0     one cell of open water, the rest still level 0
 *  z:  0      1    1    1    1     plateau, level 1 — one whole level above the strip
 *  z:  1      1    1    1    1
 * ```
 *
 * The plateau's south face therefore runs along `z = 0`, with walkable level-0 ground immediately
 * north of it — which is what makes the disc test below a real test rather than a restatement of
 * the centre test. The single sea cell sits beside level-0 ground for the same reason: a shore.
 *
 * The lone collider is a half-tile rectangle in the middle of the flat strip, so the third clause
 * (props, `ColliderIndex.blocked`) has something to refuse that terrain height alone would allow.
 */
function terrain(): ZoneTerrain {
  const levels: (number | null)[] = [
    ...[0, 0, 0, 0],
    ...[null, 0, 0, 0],
    ...[1, 1, 1, 1],
    ...[1, 1, 1, 1],
  ];
  const map: MapData = {
    version: 1,
    size: 4,
    levelHeight: LEVEL_HEIGHT,
    waterLevel: WATER_LEVEL,
    levels,
    materials: new Array(16).fill("herbe"),
    colliders: [{ x: 0.25, z: -1.75, w: 0.5, h: 0.5 }],
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

describe("canStand", () => {
  it("allows flat ground at the hero's own level", () => {
    expect(canStand(terrain(), -1.5, -1.5, 0.3, 0)).toBe(true);
  });

  it("refuses water", () => {
    expect(canStand(terrain(), -1.5, -0.5, 0.3, 0)).toBe(false);
  });

  it("refuses a step up onto the plateau, because maxStep is 0", () => {
    expect(canStand(terrain(), -1.5, 0.5, 0.3, 0)).toBe(false);
  });

  it("allows standing on the plateau once already at its height", () => {
    expect(canStand(terrain(), -1.5, 0.5, 0.3, LEVEL_HEIGHT)).toBe(true);
  });

  it("tests the disc, not the centre — a body cannot half-enter a cliff", () => {
    // (-0.5, -0.2) is level-0 ground: its own cell is (1, 1), 0.2 short of the plateau's face at
    // `z = 0`. A body of radius 0.3 standing there overlaps the cliff, so it must be refused —
    // while the same point tested as a bare point (radius 0) is perfectly good ground. An
    // implementation that asks `heightAt` at the centre answers `true` to both and fails here.
    expect(canStand(terrain(), -0.5, -0.2, 0.3, 0)).toBe(false);
    expect(canStand(terrain(), -0.5, -0.2, 0, 0)).toBe(true);
  });

  it("stands on a shore — water inside the disc is a surface, not a wall", () => {
    // (-0.9, -0.9) is level-0 ground 0.1 from the sea cell at (0, 1), so the disc of radius 0.3
    // covers open water. Water contributes `waterLevel` (below the hero's own ground) rather than
    // an obstacle, so the shore is walkable. Treat water as a wall in `maxHeightAround` and this
    // reads as a cliff — the whole coastline becomes a fence one body-radius deep.
    expect(canStand(terrain(), -0.9, -0.9, 0.3, 0)).toBe(true);
  });

  it("refuses ground a prop stands on", () => {
    // Level-0 ground, level with the hero, whose only objection is the authored collider.
    expect(canStand(terrain(), 0.5, -1.5, 0.3, 0)).toBe(false);
    // A step away from it, the same ground is free again.
    expect(canStand(terrain(), 1.5, -1.5, 0.3, 0)).toBe(true);
  });

  it("refuses everything off the grid, where there is no ground at all", () => {
    expect(canStand(terrain(), -9, -9, 0.3, 0)).toBe(false);
  });
});
