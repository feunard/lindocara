import type { ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { type ZoneTerrain, zoneTerrainFromHeightfield } from "@lindocara/engine/terrain-access.js";
import { undergroundColliders, undergroundFloorHeight } from "@lindocara/engine/underground.js";
import {
  hasRogueLineOfSight,
  isShadowStepLandingValid,
  isShadowStepPathClear,
  planShadowReturn,
  planShadowStep,
  type ShadowStepCandidate,
  shadowStepDestination,
} from "@lindocara/server/world/rogue-skill-system.js";
import { describe, expect, it } from "vitest";

/**
 * Everything here is TILE UNITS on a grid centred at the origin, and every position is a body
 * CENTRE — the two conversions that matter for this suite. The pixel version added `PLAYER_SIZE/2`
 * to both ends of every sight line because a position was a top-left corner; that offset is gone,
 * so a collider aimed at a sight line must now straddle the line itself.
 */
const SIZE = 16;
const LEVEL_HEIGHT = 0.5;

function heightfield(options: {
  colliders?: readonly ColliderRect[];
  raisedColumn?: number;
}): ZoneTerrain {
  const levels: (number | null)[] = [];
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) levels.push(i === options.raisedColumn ? 1 : 0);
  }
  const map: MapData = {
    version: 1,
    size: SIZE,
    levelHeight: LEVEL_HEIGHT,
    waterLevel: -0.25,
    levels,
    materials: new Array(SIZE * SIZE).fill("herbe"),
    colliders: [...(options.colliders ?? [])],
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

function terrain(colliders: readonly ColliderRect[] = []): ZoneTerrain {
  return heightfield({ colliders });
}

/**
 * A wall of level-1 ground filling the cells `x ∈ [2, 3)`, standing between the rogue in the west
 * and anything east of it. Relief, not water: water is a surface BELOW a sight line rather than a
 * wall, so it stops nothing — a cliff does.
 */
function walledTerrain(): ZoneTerrain {
  return heightfield({ raisedColumn: 10 });
}

function basementTerrain(): ZoneTerrain {
  const underground = {
    levels: [
      {
        depth: 2,
        style: "cave" as const,
        cells: Array.from({ length: SIZE }, (_, row) => ({ col: 0, row, length: SIZE })),
      },
    ],
    stairs: [],
  };
  return zoneTerrainFromHeightfield({
    version: 1,
    size: SIZE,
    levelHeight: LEVEL_HEIGHT,
    waterLevel: -0.25,
    levels: Array.from({ length: SIZE * SIZE }, () => 0),
    materials: Array.from({ length: SIZE * SIZE }, () => "herbe" as const),
    colliders: undergroundColliders(underground, SIZE, LEVEL_HEIGHT),
    spawns: [],
    elements: [],
    events: [],
    underground,
  });
}

/** The target's own combat body — a fifth of a tile, the tile-unit twin of the old 14 px. */
const TARGET_BODY_RADIUS = 14 / 64;
const bodyRadius = () => TARGET_BODY_RADIUS;

/** The rogue, standing on level-0 ground. */
const origin = { x: 1, y: 0, z: 2 };

describe("authoritative Shadow Step planning", () => {
  it("selects the nearest living visible enemy with an id-stable tie break", () => {
    const candidates: ShadowStepCandidate[] = [
      { id: "dead", x: 1.1, z: 2, deadUntil: 2_000 },
      { id: "far", x: 4.1, z: 2, deadUntil: 0 },
      { id: "z-tie", x: 2, z: 1.5, deadUntil: 0 },
      { id: "a-tie", x: 2, z: 2.5, deadUntil: 0 },
    ];
    const result = planShadowStep(origin, candidates, 4.0625, 1_000, terrain(), bodyRadius);
    expect(result).toMatchObject({ ok: true, plan: { targetId: "a-tie" } });
  });

  it("treats a sub-cell collider as opaque during target selection", () => {
    const blocked = { id: "blocked", x: 1.5, z: 2, deadUntil: 0 };
    const visible = { id: "visible", x: 1, z: 3.75, deadUntil: 0 };
    // An eighth-of-a-tile post straddling the sight line at z = 2. It sits far enough east that
    // the rogue's own swept body does not already overlap it — otherwise every plan would be
    // "blocked" and the test would prove nothing about sight.
    const geometry = terrain([{ x: 1.32, z: 1.94, w: 0.125, h: 0.125 }]);

    expect(hasRogueLineOfSight(origin, blocked, geometry, 0)).toBe(false);
    expect(
      planShadowStep(origin, [blocked, visible], 4.0625, 1_000, geometry, bodyRadius),
    ).toMatchObject({ ok: true, plan: { targetId: "visible" } });
  });

  it("lands behind the target, then uses deterministic lateral fallback", () => {
    const target = { x: 2.5, z: 2 };
    // 0.25 (the rogue's body) + 0.21875 (the target's) + 0.0625 (clearance) = 0.53125 behind.
    expect(shadowStepDestination(origin, target, TARGET_BODY_RADIUS, terrain(), 0)).toEqual({
      x: 3.03125,
      y: 0,
      z: 2,
    });

    const behindBlocked = terrain([{ x: 2.98, z: 1.94, w: 0.125, h: 0.125 }]);
    expect(shadowStepDestination(origin, target, TARGET_BODY_RADIUS, behindBlocked, 0)).toEqual({
      x: 2.5,
      y: 0,
      z: 2.53125,
    });
  });

  it("keeps Shadow Step and Shadow Return on their underground storey", () => {
    const geometry = basementTerrain();
    const floor = undergroundFloorHeight(2);
    const basementOrigin = { x: 1, y: floor, z: 2 };

    expect(
      shadowStepDestination(basementOrigin, { x: 2.5, z: 2 }, TARGET_BODY_RADIUS, geometry, floor),
    ).toEqual({ x: 3.03125, y: floor, z: 2 });
    expect(planShadowReturn({ ...basementOrigin, expiresAt: 2_000 }, 1_999, geometry)).toEqual({
      ok: true,
      destination: basementOrigin,
    });
  });

  it("fails cleanly when behind and both lateral positions are occupied", () => {
    const target = { id: "sealed", x: 2.5, z: 2, deadUntil: 0 };
    const geometry = terrain([
      { x: 2.98, z: 1.94, w: 0.125, h: 0.125 },
      { x: 2.44, z: 2.48, w: 0.125, h: 0.125 },
      { x: 2.44, z: 1.4, w: 0.125, h: 0.125 },
    ]);
    expect(planShadowStep(origin, [target], 4.0625, 1_000, geometry, bodyRadius)).toEqual({
      ok: false,
      reason: "blocked",
    });
    expect(
      planShadowStep(origin, [target], 4.0625, 1_000, geometry, bodyRadius, {
        phaseThroughObstacles: true,
      }),
    ).toEqual({ ok: false, reason: "blocked" });
  });

  it("sweeps the whole Rogue body and never teleports through an obstacle", () => {
    const geometry = terrain([{ x: 2.26, z: 1, w: 0.1875, h: 3 }]);
    expect(isShadowStepPathClear(origin, { x: 3.4375, z: 2 }, geometry, 0)).toBe(false);
  });

  it("phases through relief that blocks sight, but never onto a landing it could not stand on", () => {
    const target = { id: "hidden", x: 4, z: 2, deadUntil: 0 };
    const geometry = walledTerrain();

    expect(planShadowStep(origin, [target], 4.0625, 1_000, geometry, bodyRadius)).toEqual({
      ok: false,
      reason: "no_target",
    });
    expect(
      planShadowStep(origin, [target], 4.0625, 1_000, geometry, bodyRadius, {
        phaseThroughObstacles: true,
      }),
    ).toMatchObject({
      ok: true,
      plan: {
        targetId: "hidden",
        destination: { x: 4.53125, y: 0, z: 2 },
      },
    });
    // On top of the wall is not a landing: `MAX_STEP` is 0, so a rogue standing at level 0 may no
    // more shadow-step up a cliff than walk up it.
    expect(isShadowStepLandingValid({ x: 2.5, z: 2 }, geometry, 0)).toBe(false);
    // ...and from up there it would be, which is what makes the line above a statement about the
    // rogue's own level rather than about the cell.
    expect(isShadowStepLandingValid({ x: 2.5, z: 2 }, geometry, LEVEL_HEIGHT)).toBe(true);
  });

  it("validates Shadow Return against expiry and its landing while crossing intervening obstacles", () => {
    const point = { x: 1, y: 0, z: 2, expiresAt: 2_000 };
    expect(planShadowReturn(point, 1_999, terrain())).toEqual({
      ok: true,
      destination: { x: 1, y: 0, z: 2 },
    });
    expect(planShadowReturn(point, 2_000, terrain())).toEqual({
      ok: false,
      reason: "expired",
    });
    // A wall between the rogue and the remembered point does not invalidate the return: only the
    // landing itself is re-validated.
    expect(planShadowReturn(point, 1_999, terrain([{ x: 2.26, z: 1, w: 0.1875, h: 3 }]))).toEqual({
      ok: true,
      destination: { x: 1, y: 0, z: 2 },
    });
    // A remembered point now standing inside a prop is refused.
    expect(
      planShadowReturn(
        { x: 2.3, y: 0, z: 2, expiresAt: 2_000 },
        1_999,
        terrain([{ x: 2.26, z: 1, w: 0.1875, h: 3 }]),
      ),
    ).toEqual({ ok: false, reason: "blocked" });
  });

  it("reports no target when every living enemy is out of range or out of sight", () => {
    const geometry = terrain([{ x: 1.2, z: 1.7, w: 0.125, h: 0.75 }]);
    expect(
      planShadowStep(
        origin,
        [
          { id: "hidden", x: 1.5, z: 2, deadUntil: 0 },
          { id: "distant", x: 6.25, z: 2, deadUntil: 0 },
        ],
        4.0625,
        1_000,
        geometry,
        bodyRadius,
      ),
    ).toEqual({ ok: false, reason: "no_target" });
  });
});
