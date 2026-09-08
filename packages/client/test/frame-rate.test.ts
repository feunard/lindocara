import { createFrameRateMeter } from "@lindocara/client/game/frame-rate.js";
import { describe, expect, it } from "vitest";

describe("render frame rate", () => {
  it.each([30, 60, 144])("measures a %i Hz render loop independently of simulation time", (hz) => {
    const meter = createFrameRateMeter();
    expect(meter.sample(1000)).toBeUndefined();
    for (let frame = 1; frame < hz / 2; frame++) {
      expect(meter.sample(1000 + (frame * 1000) / hz)).toBeUndefined();
    }
    expect(meter.sample(1500)).toBe(hz);
  });

  it("includes a real long frame instead of reporting the capped simulation delta", () => {
    const meter = createFrameRateMeter();
    meter.sample(0);
    for (let frame = 1; frame < 15; frame++) meter.sample((frame * 1000) / 60);
    expect(meter.sample(1000)).toBe(15);
  });

  it("starts a fresh measurement after returning from a hidden tab", () => {
    const meter = createFrameRateMeter();
    meter.sample(0);
    meter.sample(100);
    meter.reset();
    expect(meter.sample(60_000)).toBeUndefined();
    for (let frame = 1; frame < 30; frame++) meter.sample(60_000 + (frame * 1000) / 60);
    expect(meter.sample(60_500)).toBe(60);
  });
});
