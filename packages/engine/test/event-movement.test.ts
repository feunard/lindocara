import {
  npcMovementDurationMs,
  npcMovementIntervalTicks,
  sampleNpcMovementTween,
} from "@lindocara/engine/event-movement.js";
import { TICK_DT } from "@lindocara/engine/simulation.js";
import { describe, expect, it } from "vitest";

describe("authored NPC movement presentation", () => {
  it("uses the same speed and frequency cadence as the authoritative server", () => {
    expect(npcMovementIntervalTicks(3, 4)).toBe(10);
    expect(npcMovementIntervalTicks(4, 4)).toBe(8);
    expect(npcMovementDurationMs(3, 4)).toBe((10 - 1) * TICK_DT * 1_000);
  });

  it("samples a continuous cell tween without overshooting the authoritative target", () => {
    const from = { col: 2, row: 3 };
    const to = { col: 3, row: 3 };
    expect(sampleNpcMovementTween(from, to, 1_000, 400, 1_000)).toMatchObject({
      col: 2,
      row: 3,
      moving: true,
      progress: 0,
    });
    expect(sampleNpcMovementTween(from, to, 1_000, 400, 1_200)).toMatchObject({
      col: 2.5,
      row: 3,
      moving: true,
      progress: 0.5,
    });
    expect(sampleNpcMovementTween(from, to, 1_000, 400, 1_800)).toMatchObject({
      col: 3,
      row: 3,
      moving: false,
      progress: 1,
    });
  });
});
