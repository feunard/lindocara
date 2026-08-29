import { actorUndergroundVisibilityDepth } from "@lindocara/renderer/hd2d/game-renderer.js";
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
});
