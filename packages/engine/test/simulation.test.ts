import {
  type Input,
  NETWORK_SNAPSHOT_HZ,
  NETWORK_TICKS_PER_SNAPSHOT,
  NO_INPUT,
  TICK_DT,
  TICK_HZ,
} from "@lindocara/engine/simulation.js";
import { describe, expect, it } from "vitest";

// `step()` and `PLAYER_SPEED` retired with client-side prediction: the hero's movement rule is
// `stepHero` (`hd2d/hero-step.ts`), it runs on the client, and its tests live beside it
// (`packages/engine/test/hd2d/`) and in `packages/client/test/hero-controller.test.ts`. What is
// still worth pinning here is the clock every server system derives its budgets from, and the fact
// that `Input` is an intent shape with no sequence and no wire role left.

describe("the simulation clock", () => {
  it("simulates twice as often as it emits network world state", () => {
    expect(TICK_HZ).toBe(20);
    expect(NETWORK_SNAPSHOT_HZ).toBe(10);
    expect(NETWORK_SNAPSHOT_HZ).toBeLessThan(TICK_HZ);
    expect(NETWORK_TICKS_PER_SNAPSHOT).toBe(2);
    expect(Number.isInteger(NETWORK_TICKS_PER_SNAPSHOT)).toBe(true);
  });

  it("derives its fixed timestep from the tick rate rather than restating it", () => {
    expect(TICK_DT).toBeCloseTo(1 / TICK_HZ, 12);
  });
});

describe("the movement intent", () => {
  it("carries direction only — no sequence, nothing to acknowledge", () => {
    const keys: (keyof Input)[] = ["up", "down", "left", "right", "jump", "axisX", "axisY"];
    expect(Object.keys(NO_INPUT).sort()).toEqual([...keys].sort());
  });

  it("is frozen, so a shared no-input cannot be mutated by one reader for all of them", () => {
    expect(Object.isFrozen(NO_INPUT)).toBe(true);
  });
});
