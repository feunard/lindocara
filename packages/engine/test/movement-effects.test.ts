import { describe, expect, it } from "vitest";

import {
  combinedMovementEffectModifiers,
  type ActiveMovementEffect,
} from "../src/movement-effects.js";

const active = (kind: ActiveMovementEffect["kind"], power: number): ActiveMovementEffect => ({
  kind,
  power,
  until: 2_000,
});

describe("combinedMovementEffectModifiers", () => {
  it("stacks distinct bonus and malus effects", () => {
    expect(
      combinedMovementEffectModifiers(
        [
          active("speed_boost", 1.35),
          active("speed_slow", 0.65),
          active("light_gravity", 0.55),
          active("heavy_gravity", 1.65),
          active("double_jump", 1),
          active("inverted_controls", 1),
        ],
        1_000,
      ),
    ).toEqual({
      speedMultiplier: 1.35 * 0.65,
      gravityMultiplier: 0.55 * 1.65,
      extraAirJumps: 1,
      controlMultiplier: -1,
    });
  });

  it("does not stack two effects of the same kind", () => {
    expect(
      combinedMovementEffectModifiers(
        [active("speed_boost", 1.35), active("speed_boost", 1.5)],
        1_000,
      ).speedMultiplier,
    ).toBe(1.5);
  });

  it("ignores expired effects", () => {
    expect(
      combinedMovementEffectModifiers([{ kind: "speed_slow", power: 0.65, until: 1_000 }], 1_000)
        .speedMultiplier,
    ).toBe(1);
  });
});
