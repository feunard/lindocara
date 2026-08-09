import { staticAnimationFrame } from "@lindocara/renderer/hd2d/static-content.js";
import { describe, expect, it } from "vitest";

describe("HD-2D authored scenery animation", () => {
  it("loops every frame over the catalogue duration", () => {
    expect(staticAnimationFrame(0, 800, 4)).toBe(0);
    expect(staticAnimationFrame(199, 800, 4)).toBe(0);
    expect(staticAnimationFrame(200, 800, 4)).toBe(1);
    expect(staticAnimationFrame(799, 800, 4)).toBe(3);
    expect(staticAnimationFrame(800, 800, 4)).toBe(0);
  });

  it("uses stable placement phases without changing the loop cadence", () => {
    expect(staticAnimationFrame(0, 800, 4, 200)).toBe(1);
    expect(staticAnimationFrame(600, 800, 4, 200)).toBe(0);
    expect(staticAnimationFrame(-200, 800, 4, 200)).toBe(0);
  });

  it("pins static and technical sheets when no animation duration is declared", () => {
    expect(staticAnimationFrame(4_000, 0, 12, 300)).toBe(0);
    expect(staticAnimationFrame(4_000, 800, 1, 300)).toBe(0);
  });
});
