import {
  advanceProjectile,
  circleIntersectsArc,
  circleIntersectsCapsule,
  circleIntersectsCone,
  directionalCone,
  facingFromInput,
  firstSegmentImpact,
  frontalArc,
  normalizeDirection,
  orientationFromMovement,
  segmentIntersectsRect,
  strikeCapsule,
  sweptProjectileEntityImpact,
  sweptProjectileTerrainImpact,
} from "@lindocara/engine/directional-combat.js";
import { NO_INPUT } from "@lindocara/engine/simulation.js";
import type { TileKind, TileMap } from "@lindocara/engine/tilemap.js";
import { describe, expect, it } from "vitest";

function tiles(rows: readonly (readonly TileKind[])[]): TileMap {
  return {
    cols: rows[0]?.length ?? 0,
    rows: rows.length,
    kinds: rows.flat(),
  };
}

describe("directional combat geometry", () => {
  // `normalizeDirection` is still the one `Vec2` door — pure angle arithmetic that means the same
  // thing in either unit system. A facing, by contrast, has never had an elevation, so
  // `orientationFromMovement` answers on the GROUND PLANE (`x`/`z`); the numbers are identical
  // because only the second axis's NAME moved.
  it("normalises directions and preserves facing for zero movement", () => {
    expect(normalizeDirection({ x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
    expect(orientationFromMovement({ x: 0, z: 0 }, { x: 0, z: -2 })).toEqual({ x: 0, z: -1 });
    expect(normalizeDirection({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 1, y: 0 });
  });

  // This is the exact conversion `movement-system.ts` applies to a dequeued command every tick,
  // and the map-preview sandbox now applies to its locally-polled input every tick. Regressing
  // either caller back to a hardcoded facing (the map-preview bug this pins) leaves this failing.
  // `up`/`down` are SCREEN axes and name the ground axis `z`, so a negative `z` is northward.
  it("turns a movement input into facing, and preserves facing at rest", () => {
    expect(facingFromInput({ ...NO_INPUT, left: true }, { x: 1, z: 0 })).toEqual({ x: -1, z: 0 });
    expect(facingFromInput({ ...NO_INPUT, right: true }, { x: -1, z: 0 })).toEqual({ x: 1, z: 0 });
    expect(facingFromInput({ ...NO_INPUT, up: true }, { x: 1, z: 0 })).toEqual({ x: 0, z: -1 });
    expect(facingFromInput({ ...NO_INPUT, down: true }, { x: 1, z: 0 })).toEqual({ x: 0, z: 1 });
    // Standing still (or a diagonal that cancels out) preserves whatever facing was already held.
    expect(facingFromInput(NO_INPUT, { x: -1, z: 0 })).toEqual({ x: -1, z: 0 });
    expect(facingFromInput({ ...NO_INPUT, left: true, right: true }, { x: 0, z: -1 })).toEqual({
      x: 0,
      z: -1,
    });
  });

  // Every shape below is on the GROUND PLANE (`x`/`z`); the numbers are unchanged because the
  // geometry is unit-free — what moved is which second axis these functions read. A `{x, y}`
  // literal here would now be a type error, which is the whole point of the conversion.
  it("hits entities in a frontal arc but not behind or outside its radius", () => {
    const arc = frontalArc({ x: 100, z: 100 }, { x: 1, z: 0 }, 60, Math.PI / 3);
    expect(circleIntersectsArc({ center: { x: 145, z: 105 }, radius: 8 }, arc)).toBe(true);
    expect(circleIntersectsArc({ center: { x: 55, z: 100 }, radius: 8 }, arc)).toBe(false);
    expect(circleIntersectsArc({ center: { x: 180, z: 100 }, radius: 8 }, arc)).toBe(false);
  });

  it("builds a directional cone and capsule", () => {
    const cone = directionalCone({ x: 0, z: 0 }, { x: 1, z: 0 }, 100, Math.PI / 6);
    expect(circleIntersectsCone({ center: { x: 75, z: 20 }, radius: 5 }, cone)).toBe(true);
    expect(circleIntersectsCone({ center: { x: 75, z: 70 }, radius: 5 }, cone)).toBe(false);

    const capsule = strikeCapsule({ x: 0, z: 0 }, { x: 1, z: 0 }, 100, 10);
    expect(circleIntersectsCapsule({ center: { x: 65, z: 14 }, radius: 5 }, capsule)).toBe(true);
    expect(circleIntersectsCapsule({ center: { x: 65, z: 17 }, radius: 5 }, capsule)).toBe(false);
  });

  it("advances a projectile along a normalised direction", () => {
    expect(advanceProjectile({ x: 10, z: 20 }, { x: 3, z: 4 }, 100, 0.5)).toEqual({
      from: { x: 10, z: 20 },
      to: { x: 40, z: 60 },
      distance: 50,
    });
  });

  it("sweeps fast projectiles through entities instead of checking only the endpoint", () => {
    const impact = sweptProjectileEntityImpact(
      { x: 0, z: 20 },
      { x: 200, z: 20 },
      3,
      { center: { x: 100, z: 20 }, radius: 12 },
      "monster-a",
    );
    expect(impact).not.toBeNull();
    expect(impact?.fraction).toBeCloseTo(0.425);
    expect(impact?.point.x).toBeCloseTo(85);
  });

  it("finds terrain crossed between projectile endpoints", () => {
    const map = tiles([
      ["grass", "water", "grass"],
      ["grass", "water", "grass"],
    ]);
    const impact = sweptProjectileTerrainImpact({ x: 20, y: 32 }, { x: 170, y: 32 }, 2, map);
    expect(impact).toMatchObject({ kind: "terrain", col: 1, row: 0 });
    expect(impact?.point.x).toBeCloseTo(62);
  });

  it("tests a swept segment against one explicit rectangle without an index", () => {
    const rect = { x: 40, z: 20, w: 12, h: 16 };
    expect(segmentIntersectsRect({ x: 0, z: 28 }, { x: 80, z: 28 }, rect)).toBe(true);
    expect(segmentIntersectsRect({ x: 0, z: 4 }, { x: 80, z: 4 }, rect)).toBe(false);
    expect(segmentIntersectsRect({ x: 0, z: 14 }, { x: 80, z: 14 }, rect, 6)).toBe(true);
    expect(segmentIntersectsRect({ x: Number.NaN, z: 0 }, { x: 80, z: 0 }, rect)).toBe(false);
  });

  it("sweeps projectiles against a rotated collider in its local space", () => {
    const rect = { x: -2, z: -0.5, w: 4, h: 1, rotation: Math.PI / 4 };
    expect(segmentIntersectsRect({ x: 0.8, z: 1.1 }, { x: 1.4, z: 1.1 }, rect)).toBe(true);
    expect(segmentIntersectsRect({ x: 1.4, z: -1.6 }, { x: 1.8, z: -1.6 }, rect)).toBe(false);
  });

  it("chooses the first impact deterministically and lets terrain win exact ties", () => {
    const result = firstSegmentImpact([
      { fraction: 0.4, point: { x: 40, z: 0 }, kind: "entity", id: "z" },
      { fraction: 0.2, point: { x: 20, z: 0 }, kind: "entity", id: "b" },
      { fraction: 0.2, point: { x: 20, z: 0 }, kind: "entity", id: "a" },
    ]);
    expect(result?.id).toBe("a");

    expect(
      firstSegmentImpact([
        { fraction: 0.2, point: { x: 20, z: 0 }, kind: "entity", id: "a" },
        { fraction: 0.2, point: { x: 20, z: 0 }, kind: "terrain", id: "0:1" },
      ])?.kind,
    ).toBe("terrain");
  });
});
