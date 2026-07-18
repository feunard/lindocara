import { describe, expect, it } from "vitest";
import { HEALTH_BAR_PROXIMITY, shouldShowHealthBar } from "../src/client/game/display-settings.js";

describe("world health bar visibility", () => {
  it("respects proximity and ally/enemy preferences for ordinary units", () => {
    expect(shouldShowHealthBar("allies", "ally", HEALTH_BAR_PROXIMITY)).toBe(true);
    expect(shouldShowHealthBar("allies", "enemy", 1)).toBe(false);
    expect(shouldShowHealthBar("both", "enemy", HEALTH_BAR_PROXIMITY + 1)).toBe(false);
  });
});
