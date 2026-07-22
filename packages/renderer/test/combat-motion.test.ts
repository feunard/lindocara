import {
  lumenStepOpacity,
  mobilityRenderOffset,
  mobilityVisual,
} from "@lindocara/renderer/combat-motion.js";
import { describe, expect, it } from "vitest";

describe("combat mobility presentation", () => {
  it("gives charge, dash and blink distinct visual identities", () => {
    expect(
      new Set(["shield_bash", "dash", "blink"].map((id) => mobilityVisual(id)?.color)).size,
    ).toBe(3);
    expect(mobilityVisual("quick_shot")).toBeNull();
  });

  it("eases from the previous rendered position to authoritative truth", () => {
    expect(mobilityRenderOffset(-120, 30, 1_000, 200, 1_000)).toEqual({ x: -120, y: 30 });
    expect(mobilityRenderOffset(-120, 30, 1_000, 200, 1_100)).toEqual({ x: -30, y: 7.5 });
    expect(mobilityRenderOffset(-120, 30, 1_000, 200, 1_200)).toEqual({ x: 0, y: 0 });
  });

  it("softly disappears at Lumen impact and rematerializes through recovery", () => {
    expect(lumenStepOpacity(1_000, 1_200, undefined, 3_600, 1_000)).toBe(1);
    expect(lumenStepOpacity(1_000, 1_200, undefined, 3_600, 1_200)).toBeCloseTo(0.06);
    expect(lumenStepOpacity(1_000, 1_200, undefined, 3_600, 2_000)).toBeCloseTo(0.06);
    expect(lumenStepOpacity(1_000, 1_200, 2_000, 2_400, 2_200)).toBeCloseTo(0.53);
    expect(lumenStepOpacity(1_000, 1_200, 2_000, 2_400, 2_400)).toBe(1);
  });
});
