import { npcMovementDurationMs } from "@lindocara/engine/event-movement.js";
import { describe, expect, it } from "vitest";
import { WorldEventMotionTracker } from "../src/world-event-motion.js";

const event = {
  id: "npc-1",
  col: 2,
  row: 3,
  moveSpeed: 4,
  moveFrequency: 3,
};

describe("WorldEventMotionTracker", () => {
  it("interpolates a new authoritative target and reports its facing", () => {
    const tracker = new WorldEventMotionTracker();
    expect(tracker.sample(event, 100)).toMatchObject({ col: 2, row: 3, moving: false });

    const moved = { ...event, col: 3 };
    expect(tracker.sample(moved, 200)).toMatchObject({
      col: 2,
      row: 3,
      moving: true,
      direction: { x: 1, z: 0 },
    });
    const duration = npcMovementDurationMs(moved.moveSpeed, moved.moveFrequency);
    expect(tracker.sample(moved, 200 + duration / 2).col).toBeCloseTo(2.5);
    expect(tracker.sample(moved, 200 + duration)).toMatchObject({
      col: 3,
      row: 3,
      moving: false,
    });
  });

  it("forgets removed events instead of tweening a reused id from stale coordinates", () => {
    const tracker = new WorldEventMotionTracker();
    tracker.sample(event, 0);
    tracker.retain(new Set());
    expect(tracker.sample({ ...event, col: 8 }, 20)).toMatchObject({ col: 8, moving: false });
  });

  it("keeps the lab sheep cadence continuous between server cells", () => {
    const tracker = new WorldEventMotionTracker();
    const sheep = { ...event, id: "sheep", moveSpeed: 2, moveFrequency: 2 };
    tracker.sample(sheep, 0);
    const moved = { ...sheep, col: 3 };
    const duration = npcMovementDurationMs(2, 2);

    expect([
      tracker.sample(moved, 100).col,
      tracker.sample(moved, 100 + duration / 4).col,
      tracker.sample(moved, 100 + duration / 2).col,
      tracker.sample(moved, 100 + (duration * 3) / 4).col,
      tracker.sample(moved, 100 + duration).col,
    ]).toEqual([2, 2.25, 2.5, 2.75, 3]);
  });
});
