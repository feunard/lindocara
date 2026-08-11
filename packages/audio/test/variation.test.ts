import {
  GAIN_JITTER,
  jitterGain,
  jitterRate,
  pickVariant,
  RATE_JITTER,
} from "@lindocara/audio/variation.js";
import { describe, expect, it } from "vitest";

import { sequence } from "./fake-context.js";

describe("pickVariant", () => {
  it("spreads evenly over the takes a key holds", () => {
    const seen = new Set<number>();
    for (const value of [0, 0.24, 0.25, 0.49, 0.5, 0.74, 0.75, 0.99]) {
      seen.add(pickVariant(4, () => value));
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("never indexes past the last take, whatever the generator returns", () => {
    for (const value of [1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const index = pickVariant(3, () => value);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(3);
    }
  });

  it("returns the only take there is when a key holds one", () => {
    expect(pickVariant(1, () => 0.9)).toBe(0);
    expect(pickVariant(0, () => 0.9)).toBe(0);
  });
});

describe("jitter", () => {
  it("spans exactly the tuned band, centred on the value asked for", () => {
    expect(jitterRate(1, () => 0)).toBeCloseTo(1 - RATE_JITTER, 8);
    expect(jitterRate(1, () => 0.5)).toBeCloseTo(1, 8);
    expect(jitterRate(1, () => 1)).toBeCloseTo(1 + RATE_JITTER, 8);
    expect(jitterGain(1, () => 0)).toBeCloseTo(1 - GAIN_JITTER, 8);
    expect(jitterGain(1, () => 1)).toBeCloseTo(1 + GAIN_JITTER, 8);
  });

  it("multiplies an authored transposition rather than replacing it", () => {
    // A sheep bleating three semitones up must still be three semitones up after the jitter.
    const authored = 2 ** (3 / 12);
    expect(jitterRate(authored, () => 0.5)).toBeCloseTo(authored, 8);
    expect(jitterRate(authored, () => 1)).toBeCloseTo(authored * (1 + RATE_JITTER), 8);
  });

  it("stays positive and finite for a nonsense input", () => {
    const random = sequence([0.5]);
    expect(jitterRate(0, random)).toBeCloseTo(1, 8);
    expect(jitterRate(Number.NaN, random)).toBeCloseTo(1, 8);
    expect(jitterGain(Number.NaN, random)).toBe(0);
  });
});
