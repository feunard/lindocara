import { actorUndergroundVisibilityDepth } from "@lindocara/renderer/hd2d/game-renderer.js";
import { authoredContentVisible, exactStoreyVisible } from "@lindocara/renderer/hd2d/scene.js";
import { describe, expect, it } from "vitest";

describe("underground actor visibility", () => {
  it("keeps the local hero on the current storey throughout an ordinary jump", () => {
    expect(actorUndergroundVisibilityDepth(-6.1, true, false, 3)).toBe(3);
    expect(actorUndergroundVisibilityDepth(-5.7, true, false, 3)).toBe(3);
  });

  it("follows real elevation while crossing a stair or shaft", () => {
    expect(actorUndergroundVisibilityDepth(-6.1, true, true, 3)).toBe(3);
    expect(actorUndergroundVisibilityDepth(-4.7, true, true, 3)).toBe(2);
    expect(actorUndergroundVisibilityDepth(-4.7, false, false, 3)).toBe(2);
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
