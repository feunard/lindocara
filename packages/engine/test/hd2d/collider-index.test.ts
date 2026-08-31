import {
  colliderContainsPoint,
  colliderSurfaceHeightAt,
  createColliderIndex,
} from "@lindocara/engine/hd2d/collider-index.js";
import { describe, expect, it } from "vitest";

describe("createColliderIndex", () => {
  it("blocks a disc that overlaps a rectangle, via the closest point", () => {
    const idx = createColliderIndex();
    idx.add({ x: 0, z: 0, w: 2, h: 2 }); // from (0,0) to (2,2)
    // At the corner, the distance to the rectangle is the distance to the point (0,0).
    expect(idx.blocked(-0.2, -0.2, 0.5)).toBe(true);
    // A radius of 0.2 is no longer enough: the corner's diagonal is ~0.283.
    expect(idx.blocked(-0.2, -0.2, 0.2)).toBe(false);
  });

  it("lets a disc pass that grazes the edge without touching it", () => {
    const idx = createColliderIndex();
    idx.add({ x: 0, z: 0, w: 2, h: 2 });
    expect(idx.blocked(-0.51, 1, 0.5)).toBe(false);
    expect(idx.blocked(-0.49, 1, 0.5)).toBe(true);
  });

  it("tests a freely rotated rectangle exactly instead of blocking its empty AABB corners", () => {
    const rect = { x: -2, z: -0.5, w: 4, h: 1, rotation: Math.PI / 4, top: 1.2 };
    const idx = createColliderIndex();
    idx.add(rect);

    expect(colliderContainsPoint(rect, 1.1, 1.1)).toBe(true);
    expect(colliderContainsPoint(rect, 1.6, -1.6)).toBe(false);
    expect(idx.blocked(1.1, 1.1, 0.1, 0)).toBe(true);
    expect(idx.blocked(1.6, -1.6, 0.1, 0)).toBe(false);
    expect(colliderSurfaceHeightAt(rect, 1.1, 1.1)).toBe(1.2);
  });

  it("lets an overlapping body slide or leave, never penetrate farther", () => {
    const idx = createColliderIndex();
    idx.add({ x: 0, z: 0, w: 2, h: 2, top: 1.8 });
    expect(idx.allowsEscape(-0.2, 1, -0.2, 1.1, 0.3, 0)).toBe(true);
    expect(idx.allowsEscape(-0.2, 1, -0.25, 1, 0.3, 0)).toBe(true);
    expect(idx.allowsEscape(-0.2, 1, -0.15, 1, 0.3, 0)).toBe(false);
    expect(idx.allowsEscape(-0.2, 1, 0.05, 1, 0.3, 0)).toBe(false);
  });

  it("finds a rectangle wider than the index's cell", () => {
    // A long wall is the case the circle could not model, so it's the one no existing test
    // covers. It must be found from any point along its length.
    const idx = createColliderIndex();
    idx.add({ x: -20, z: 0, w: 40, h: 0.5 });
    expect(idx.blocked(-18, 0.2, 0.3)).toBe(true);
    expect(idx.blocked(0, 0.2, 0.3)).toBe(true);
    expect(idx.blocked(18, 0.2, 0.3)).toBe(true);
    expect(idx.blocked(0, 5, 0.3)).toBe(false);
  });

  it("blocks a strong impulse that crosses a thin wall between two frames", () => {
    const idx = createColliderIndex();
    idx.add({ x: 0, z: -1, w: 0.16, h: 2, bottom: -2.4, top: 0 });

    expect(idx.blocked(-0.7, 0, 0.3, -2.4)).toBe(false);
    expect(idx.blocked(0.7, 0, 0.3, -2.4)).toBe(false);
    expect(idx.blockedAlong(-0.7, 0, 0.7, 0, 0.3, -2.4)).toBe(true);
  });

  it("keeps movement below and above a finite wall storey-aware", () => {
    const idx = createColliderIndex();
    idx.add({ x: 0, z: -1, w: 0.16, h: 2, bottom: -2.4, top: 0 });

    expect(idx.blockedAlong(-0.7, 0, 0.7, 0, 0.3, -3.3)).toBe(false);
    expect(idx.blockedAlong(-0.7, 0, 0.7, 0, 0.3, 0)).toBe(false);
  });

  // The next three tests reprise the coverage of the old `colliders.test.ts` (circles), carried
  // over to rectangles: degrading gracefully with a large query radius is about the overlap TEST,
  // not the collider's shape, so the same cases must stay true.
  it("degrades gracefully instead of throwing when r exceeds the fast path's margin", () => {
    const idx = createColliderIndex();
    idx.add({ x: -0.5, z: -0.5, w: 1, h: 1 }); // centered at (0,0), equivalent radius 0.5
    expect(() => idx.blocked(0, 0, 2)).not.toThrow();
    expect(idx.blocked(0, 0, 2)).toBe(true);
  });

  it("always finds an overlapped rectangle with a large radius, even far from the origin cell", () => {
    const idx = createColliderIndex();
    // Rectangle centered at (6, 0): outside cell (0,0) (CELL=4), but a query disc of radius 3
    // centered at (3, 0) must still find it.
    idx.add({ x: 5.6, z: -0.4, w: 0.8, h: 0.8 });
    expect(idx.blocked(3, 0, 3)).toBe(true);
  });

  it("a large radius that truly overlaps nothing stays `false`", () => {
    const idx = createColliderIndex();
    idx.add({ x: 99.5, z: 99.5, w: 1, h: 1 }); // centered at (100, 100)
    expect(idx.blocked(0, 0, 2)).toBe(false);
  });

  it("blocks a building below its roof and releases the same footprint at roof height", () => {
    const idx = createColliderIndex();
    idx.add({ x: -1, z: -1, w: 2, h: 2, top: 0.9 });
    expect(idx.blocked(0, 0, 0.3, 0.89)).toBe(true);
    expect(idx.blocked(0, 0, 0.3, 0.9)).toBe(false);
    expect(idx.blocked(0, 0, 0.3)).toBe(true);
  });

  it("follows a gable locally instead of cutting the building with one flat plate", () => {
    const idx = createColliderIndex();
    idx.add({
      x: -1,
      z: -1,
      w: 2,
      h: 2,
      top: 2,
      surface: { shape: "gable", eave: 1, peak: 2, axis: "x" },
    });
    expect(idx.blocked(-0.9, 0, 0.05, 1.11)).toBe(false);
    expect(idx.blocked(0, 0, 0.05, 1.09)).toBe(true);
    expect(idx.blocked(0, 0, 0.05, 2)).toBe(false);
  });

  it("uses an ellipse for round architecture and reports finite jump clearance", () => {
    const idx = createColliderIndex();
    idx.add({
      x: -1,
      z: -1,
      w: 2,
      h: 2,
      top: 1.8,
      footprint: "ellipse",
      surface: { shape: "cone", eave: 0.9, peak: 1.8 },
    });
    expect(idx.blocked(0.95, 0.95, 0.05, 0)).toBe(false);
    expect(idx.heightToClear(0, 0, 0.05)).toBeCloseTo(1.8);
    expect(idx.heightToClear(4, 4, 0.05)).toBeNull();
  });
});

describe("a raised slab has an underside", () => {
  /** A deck two levels up (1.8), 0.18 thick: the shape a bridge over a gorge compiles to. */
  const deck = { x: 0, z: 0, w: 3, h: 1, top: 1.8, bottom: 1.62 } as const;

  it("lets a body walk underneath it", () => {
    const idx = createColliderIndex();
    idx.add({ ...deck });
    // Feet on the bank, head at 0.8: the whole body is below the planking.
    expect(idx.blocked(1.5, 0.5, 0.3, 0)).toBe(false);
  });

  it("still blocks a body whose head meets it", () => {
    const idx = createColliderIndex();
    idx.add({ ...deck });
    // Standing one level up: feet at 0.9, head at 1.7, which is inside [1.62, 1.8].
    expect(idx.blocked(1.5, 0.5, 0.3, 0.9)).toBe(true);
  });

  it("still lets a body stand ON it", () => {
    const idx = createColliderIndex();
    idx.add({ ...deck });
    // Feet at the deck's top: above it, so not inside it. This is the half that always worked.
    expect(idx.blocked(1.5, 0.5, 0.3, 1.8)).toBe(false);
  });

  it("keeps a column with no underside solid all the way down", () => {
    const idx = createColliderIndex();
    // No `bottom`: a wall, a tree, a building. Every collider was this before the underside existed.
    idx.add({ x: 0, z: 0, w: 3, h: 1, top: 1.8 });
    expect(idx.blocked(1.5, 0.5, 0.3, 0)).toBe(true);
  });

  it("blocks on any overlap when no height is asked about", () => {
    const idx = createColliderIndex();
    idx.add({ ...deck });
    // Two callers ask this way and mean "is anything here at all"; they must not silently gain a
    // clearance they never asked for.
    expect(idx.blocked(1.5, 0.5, 0.3)).toBe(true);
  });
});
