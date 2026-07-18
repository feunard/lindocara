import { describe, expect, it } from "vitest";
import {
  advanceProjectile,
  circleIntersectsArc,
  circleIntersectsCapsule,
  circleIntersectsCone,
  directionalCone,
  firstSegmentImpact,
  frontalArc,
  normalizeDirection,
  orientationFromMovement,
  strikeCapsule,
  sweptProjectileEntityImpact,
  sweptProjectileTerrainImpact,
} from "../src/shared/directional-combat.js";
import type { TileKind, TileMap } from "../src/shared/tilemap.js";

function tiles(rows: readonly (readonly TileKind[])[]): TileMap {
  return {
    cols: rows[0]?.length ?? 0,
    rows: rows.length,
    kinds: rows.flat(),
  };
}

describe("directional combat geometry", () => {
  it("normalises directions and preserves facing for zero movement", () => {
    expect(normalizeDirection({ x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
    expect(orientationFromMovement({ x: 0, y: 0 }, { x: 0, y: -2 })).toEqual({ x: 0, y: -1 });
    expect(normalizeDirection({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 1, y: 0 });
  });

  it("hits entities in a frontal arc but not behind or outside its radius", () => {
    const arc = frontalArc({ x: 100, y: 100 }, { x: 1, y: 0 }, 60, Math.PI / 3);
    expect(circleIntersectsArc({ center: { x: 145, y: 105 }, radius: 8 }, arc)).toBe(true);
    expect(circleIntersectsArc({ center: { x: 55, y: 100 }, radius: 8 }, arc)).toBe(false);
    expect(circleIntersectsArc({ center: { x: 180, y: 100 }, radius: 8 }, arc)).toBe(false);
  });

  it("builds a directional cone and capsule", () => {
    const cone = directionalCone({ x: 0, y: 0 }, { x: 1, y: 0 }, 100, Math.PI / 6);
    expect(circleIntersectsCone({ center: { x: 75, y: 20 }, radius: 5 }, cone)).toBe(true);
    expect(circleIntersectsCone({ center: { x: 75, y: 70 }, radius: 5 }, cone)).toBe(false);

    const capsule = strikeCapsule({ x: 0, y: 0 }, { x: 1, y: 0 }, 100, 10);
    expect(circleIntersectsCapsule({ center: { x: 65, y: 14 }, radius: 5 }, capsule)).toBe(true);
    expect(circleIntersectsCapsule({ center: { x: 65, y: 17 }, radius: 5 }, capsule)).toBe(false);
  });

  it("advances a projectile along a normalised direction", () => {
    expect(advanceProjectile({ x: 10, y: 20 }, { x: 3, y: 4 }, 100, 0.5)).toEqual({
      from: { x: 10, y: 20 },
      to: { x: 40, y: 60 },
      distance: 50,
    });
  });

  it("sweeps fast projectiles through entities instead of checking only the endpoint", () => {
    const impact = sweptProjectileEntityImpact(
      { x: 0, y: 20 },
      { x: 200, y: 20 },
      3,
      { center: { x: 100, y: 20 }, radius: 12 },
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

  it("chooses the first impact deterministically and lets terrain win exact ties", () => {
    const result = firstSegmentImpact([
      { fraction: 0.4, point: { x: 40, y: 0 }, kind: "entity", id: "z" },
      { fraction: 0.2, point: { x: 20, y: 0 }, kind: "entity", id: "b" },
      { fraction: 0.2, point: { x: 20, y: 0 }, kind: "entity", id: "a" },
    ]);
    expect(result?.id).toBe("a");

    expect(
      firstSegmentImpact([
        { fraction: 0.2, point: { x: 20, y: 0 }, kind: "entity", id: "a" },
        { fraction: 0.2, point: { x: 20, y: 0 }, kind: "terrain", id: "0:1" },
      ])?.kind,
    ).toBe("terrain");
  });
});
