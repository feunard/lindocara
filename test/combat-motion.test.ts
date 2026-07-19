import { describe, expect, it } from "vitest";
import { mobilityRenderOffset, mobilityVisual } from "../src/client/game/combat-motion.js";

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
});
