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
import {
  canStand,
  sweptGroundTerrainImpact,
  type ZoneTerrain,
  zoneTerrainFromHeightfield,
} from "@lindocara/engine/terrain-access.js";
import { describe, expect, it } from "vitest";

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
  const levels: (number | null)[] = [0, 0, 0, 0, null, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1];
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

/**
 * A 16x16 flat plain at level 0 carrying two thin obstacles on the shooting line at `z = 0`:
 *
 * - a ONE-CELL block of level-1 ground at cell (8, 8) — world `x ∈ [0, 1)`, `z ∈ [0, 1)` — and
 * - a very narrow authored collider (0.05 wide — a fence post, 3 px in the old money) at world
 *   `x ∈ [4.07, 4.12)`, `z ∈ [0.4, 0.6)`. Its width and its offset are both deliberate: it is
 *   thinner than any sampling stride a plausible walk-the-segment implementation would choose, and
 *   it sits on no round fraction of any test's path, so no sample lands on it by luck.
 *
 * Every shot below runs along `z = 0.5`, straight through both.
 *
 * Both are deliberately narrower than one tick of projectile travel. `MAX_PROJECTILE_RANGE` is
 * 8.4 tiles and a Heartseeker covers 0.55 tiles per tick, but a talented or authored projectile is
 * bounded only by that range — so a segment several tiles long is a real case, and it is exactly
 * the case an endpoint test or a sampled walk gets wrong.
 */
function shootingRange(): ZoneTerrain {
  const size = 16;
  const levels: (number | null)[] = [];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) levels.push(i === 8 && j === 8 ? 1 : 0);
  }
  const map: MapData = {
    version: 1,
    size,
    levelHeight: LEVEL_HEIGHT,
    waterLevel: WATER_LEVEL,
    levels,
    materials: new Array(size * size).fill("herbe"),
    colliders: [{ x: 4.07, z: 0.4, w: 0.05, h: 0.2 }],
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

describe("sweptGroundTerrainImpact", () => {
  it("cannot be tunnelled through by a single tick longer than the obstacle", () => {
    // One segment, -7 -> -0.5 on `z = -0.05`: it starts and ends on flat level-0 ground and is
    // 6.5 tiles long. Nothing about its ENDPOINTS says "blocked"; only the sweep does. The raised
    // cell it must find spans `x ∈ [0, 1)`, so the shot stops at `x = 0` — which is BEYOND the
    // segment... no: the segment ends at -0.5, short of the cell, so this first pair proves the
    // premise (a shot that stops short of the wall is not blocked) before the tunnelling case.
    expect(
      sweptGroundTerrainImpact(shootingRange(), { x: -7, z: 0.5 }, { x: -0.5, z: 0.5 }, 0, 0),
    ).toBeNull();

    // The same shot continued past the wall in ONE step. A projectile advanced 9 tiles in a tick
    // and tested only at its destination reads "clear": both -7 and 2 are level-0 ground and the
    // wall is a single cell in between.
    const impact = sweptGroundTerrainImpact(
      shootingRange(),
      { x: -7, z: 0.5 },
      { x: 2, z: 0.5 },
      0,
      0,
    );
    expect(impact).not.toBeNull();
    expect(impact?.kind).toBe("terrain");
    // Stopped AT the wall's near face, not at the far end of the tick.
    expect(impact?.point.x).toBeCloseTo(0, 5);
  });

  it("cannot be tunnelled through by a collider narrower than one tick of travel", () => {
    const impact = sweptGroundTerrainImpact(
      shootingRange(),
      { x: 2, z: 0.5 },
      { x: 7, z: 0.5 },
      0,
      0,
    );
    expect(impact?.point.x).toBeCloseTo(4.07, 5);
  });

  it("reports the FIRST obstacle along the path, not any obstacle", () => {
    // Fired from the west, the raised cell at x = 0 comes before the fence post at x = 4.07.
    const impact = sweptGroundTerrainImpact(
      shootingRange(),
      { x: -7, z: 0.5 },
      { x: 7, z: 0.5 },
      0,
      0,
    );
    expect(impact?.point.x).toBeCloseTo(0, 5);
    // Fired from the east, the collider comes first.
    const reverse = sweptGroundTerrainImpact(
      shootingRange(),
      { x: 7, z: 0.5 },
      { x: -7, z: 0.5 },
      0,
      0,
    );
    expect(reverse?.point.x).toBeCloseTo(4.12, 5);
  });

  it("dilates the obstacle by the projectile's radius, so a fat shot clips what a thin one misses", () => {
    const thin = sweptGroundTerrainImpact(
      shootingRange(),
      { x: -7, z: 1.2 },
      { x: 7, z: 1.2 },
      0,
      0,
    );
    expect(thin).toBeNull();
    const fat = sweptGroundTerrainImpact(
      shootingRange(),
      { x: -7, z: 1.2 },
      { x: 7, z: 1.2 },
      0.3,
      0,
    );
    expect(fat).not.toBeNull();
  });

  it("is not stopped by ground at or below the flight height", () => {
    // Fired FROM the raised cell's own level, the wall is no longer above the shot.
    expect(
      sweptGroundTerrainImpact(
        shootingRange(),
        { x: -7, z: 0.5 },
        { x: 2, z: 0.5 },
        0,
        LEVEL_HEIGHT,
      ),
    ).toBeNull();
  });

  it("is stopped by neither water nor the edge of the grid", () => {
    // The 4x4 fixture's sea cell sits at (0, 1); a shot straight across it is not blocked, and one
    // that leaves the map entirely is not blocked either — both die of range, not of a wall.
    expect(
      sweptGroundTerrainImpact(terrain(), { x: -1.5, z: -1.5 }, { x: -1.5, z: -0.2 }, 0, 0),
    ).toBeNull();
    expect(
      sweptGroundTerrainImpact(terrain(), { x: -1.5, z: -1.5 }, { x: -40, z: -1.5 }, 0, 0),
    ).toBeNull();
  });

  it("refuses a non-finite segment rather than reporting a contact at NaN", () => {
    expect(
      sweptGroundTerrainImpact(shootingRange(), { x: Number.NaN, z: 0.5 }, { x: 7, z: 0.5 }, 0, 0),
    ).toBeNull();
  });
});
