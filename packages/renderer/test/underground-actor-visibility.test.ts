import { actorUndergroundVisibilityDepth } from "@lindocara/renderer/hd2d/game-renderer.js";
import { authoredContentVisible, exactStoreyVisible } from "@lindocara/renderer/hd2d/scene.js";
import {
  groundedUndergroundVisibilityDepth,
  undergroundVisibilityTransitionAt,
} from "@lindocara/renderer/hd2d/underground-visibility.js";
import { describe, expect, it } from "vitest";

describe("underground actor visibility", () => {
  const visibilityMap = {
    version: 1 as const,
    size: 4,
    levelHeight: 0.9,
    waterLevel: -0.05,
    levels: [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    materials: Array.from({ length: 16 }, () => "herbe" as const),
    colliders: [],
    spawns: [],
    elements: [],
    events: [],
    underground: {
      levels: [
        { depth: 1, style: "cave" as const, cells: [{ col: 1, row: 1, length: 1 }] },
        { depth: 2, style: "cave" as const, cells: [{ col: 1, row: 1, length: 1 }] },
        { depth: 3, style: "cave" as const, cells: [{ col: 1, row: 1, length: 1 }] },
      ],
      stairs: [],
      shafts: [{ col: 1, row: 1, width: 1, length: 1, fromDepth: 2, depth: 3 }],
    },
  };

  it("keeps the local hero on the current storey throughout an ordinary jump", () => {
    expect(actorUndergroundVisibilityDepth(-6.1, true, false, 3)).toBe(3);
    expect(actorUndergroundVisibilityDepth(-5.7, true, false, 3)).toBe(3);
  });

  it("keeps the local hero visible while grounded and jumping on raised surface terrain", () => {
    const adjacentSurfaceHole = {
      ...visibilityMap,
      underground: {
        ...visibilityMap.underground,
        shafts: [{ col: 2, row: 1, width: 1, length: 1, fromDepth: 0, depth: 1 }],
      },
    };
    const stableDepth = groundedUndergroundVisibilityDepth(adjacentSurfaceHole, -0.5, -0.5, 0.9);

    expect(stableDepth).toBeNull();
    expect(actorUndergroundVisibilityDepth(0.9, true, false, stableDepth)).toBeNull();
    expect(actorUndergroundVisibilityDepth(1.6, true, false, stableDepth)).toBeNull();
    expect(actorUndergroundVisibilityDepth(1.1, true, false, stableDepth)).toBeNull();
  });

  it("follows real elevation while crossing a stair or shaft", () => {
    expect(actorUndergroundVisibilityDepth(-6.1, true, true, 3)).toBe(3);
    expect(actorUndergroundVisibilityDepth(-4.7, true, true, 3)).toBe(2);
    expect(actorUndergroundVisibilityDepth(-4.7, false, false, 3)).toBe(2);
  });

  it("keeps a raised surface jump beside an access entirely in the surface view", () => {
    const surfaceAccessMap = {
      ...visibilityMap,
      underground: {
        ...visibilityMap.underground,
        shafts: [{ col: 1, row: 1, width: 1, length: 1, fromDepth: 0, depth: 3 }],
      },
    };
    expect(groundedUndergroundVisibilityDepth(surfaceAccessMap, -0.5, -0.5, 0.9)).toBeNull();
    expect(
      undergroundVisibilityTransitionAt(surfaceAccessMap, -0.5, -0.5, 1.6, true, 8, null, 0.9),
    ).toBe(false);
    expect(
      undergroundVisibilityTransitionAt(surfaceAccessMap, -0.5, -0.5, 1.1, true, -4, null, 0.9),
    ).toBe(false);
    expect(
      undergroundVisibilityTransitionAt(surfaceAccessMap, -0.5, -0.5, 0.8, true, -4, null, 0.9),
    ).toBe(true);
  });

  it("does not reveal another floor while jumping above a deeper underground hole", () => {
    expect(groundedUndergroundVisibilityDepth(visibilityMap, -0.5, -0.5, -4.8)).toBe(2);
    expect(
      undergroundVisibilityTransitionAt(visibilityMap, -0.5, -0.5, -4, true, -3, 2, -4.8),
    ).toBe(false);
    expect(
      undergroundVisibilityTransitionAt(visibilityMap, -0.5, -0.5, -4.9, true, -3, 2, -4.8),
    ).toBe(true);
  });

  it("keeps world health chrome on its exact storey during multi-floor previews", () => {
    const depths = [null, 1, 2] as const;
    for (const viewed of depths) {
      for (const content of depths) {
        expect(exactStoreyVisible(content, viewed)).toBe(content === viewed);
      }
    }

    expect(
      authoredContentVisible({
        contentDepth: 2,
        viewedDepth: null,
        visibleDepths: [null, 1, 2],
        surfaceVisible: true,
        intrinsicVisible: true,
        exactStoreyOverlay: true,
      }),
    ).toBe(false);
    expect(
      authoredContentVisible({
        contentDepth: 2,
        viewedDepth: null,
        visibleDepths: [null, 1, 2],
        surfaceVisible: true,
        intrinsicVisible: true,
        exactStoreyOverlay: false,
      }),
    ).toBe(true);
    expect(
      authoredContentVisible({
        contentDepth: null,
        viewedDepth: null,
        visibleDepths: [null],
        surfaceVisible: true,
        intrinsicVisible: false,
        exactStoreyOverlay: true,
      }),
    ).toBe(false);
  });
});
