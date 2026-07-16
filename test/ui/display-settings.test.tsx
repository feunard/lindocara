import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDisplaySettings,
  healthBarsEnabled,
  setDisplaySettings,
  shouldShowHealthBar,
  subscribeDisplaySettings,
} from "../../src/client/game/display-settings.js";

afterEach(() => vi.unstubAllGlobals());

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

  it("keeps the in-memory setting and notifies listeners when storage rejects a write", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    });
    const listener = vi.fn();
    const unsubscribe = subscribeDisplaySettings(listener);
    expect(() => setDisplaySettings({ healthBars: "none" })).not.toThrow();
    expect(getDisplaySettings().healthBars).toBe("none");
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("does not swallow errors thrown by a subscriber", () => {
    const failure = new Error("listener failed");
    const unsubscribe = subscribeDisplaySettings(() => {
      throw failure;
    });
    expect(() => setDisplaySettings({ healthBars: "both" })).toThrow(failure);
    unsubscribe();
  });
});
