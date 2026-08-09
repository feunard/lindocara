import { describe, expect, it } from "vitest";
import { DAY_CYCLE_MS, dayCycleAt } from "../src/hd2d/day-cycle.js";

describe("24-minute day/night cycle", () => {
  it("maps one real minute to one game hour and wraps without a discontinuity", () => {
    expect(dayCycleAt(60_000).hour).toBeCloseTo(1);
    expect(dayCycleAt(DAY_CYCLE_MS + 60_000).hour).toBeCloseTo(1);
    expect(dayCycleAt(-60_000).hour).toBeCloseTo(23);
  });

  it("reaches full day at noon, full night at midnight, and smooth twilight between", () => {
    expect(dayCycleAt(12 * 60_000).nightWeight).toBe(0);
    expect(dayCycleAt(0).nightWeight).toBe(1);
    const dawn = dayCycleAt(6 * 60_000).nightWeight;
    expect(dawn).toBeGreaterThan(0);
    expect(dawn).toBeLessThan(1);
  });
});
