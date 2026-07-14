import { describe, expect, it } from "vitest";
import { healthBarsEnabled, shouldShowHealthBar } from "../../src/client/game/display-settings.js";

describe("world health bar preferences", () => {
  it.each([
    ["both", true, true],
    ["allies", true, false],
    ["enemies", false, true],
    ["none", false, false],
  ] as const)("maps %s without conflating allies and enemies", (mode, ally, enemy) => {
    expect(healthBarsEnabled(mode, "ally")).toBe(ally);
    expect(healthBarsEnabled(mode, "enemy")).toBe(enemy);
  });

  it("only reveals enabled bars inside the proximity radius", () => {
    expect(shouldShowHealthBar("both", "ally", 280)).toBe(true);
    expect(shouldShowHealthBar("both", "enemy", 280.01)).toBe(false);
    expect(shouldShowHealthBar("allies", "enemy", 20)).toBe(false);
  });
});
