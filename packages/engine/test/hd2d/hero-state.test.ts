import { createHeroState } from "@lindocara/engine/hd2d/hero-state.js";
import { describe, expect, it } from "vitest";

describe("createHeroState", () => {
  it("starts still, on the ground, with a full breath", () => {
    const s = createHeroState(3, -4, 1.8, 12, 2.2);
    expect([s.x, s.y, s.z]).toEqual([3, 1.8, -4]);
    expect([s.vx, s.vz, s.vy]).toEqual([0, 0, 0]);
    expect(s.airborne).toBe(false);
    expect(s.swimming).toBe(false);
    expect(s.breath).toBe(12);
    // `groundY` MUST equal `y` at the start: it's `maxStep`'s reference, and leaving it at 0
    // would make the first step think it's dropping off a cliff the moment it starts at height.
    expect(s.groundY).toBe(1.8);
    // `reposHaleine` decides when the first breath puff fires: it must be initialized to the
    // passed parameter, otherwise a hero created at spawn would puff almost immediately instead
    // of waiting for the authored interval.
    expect(s.reposHaleine).toBe(2.2);
  });

  it("shares no structure between two states", () => {
    // A `createHeroState` that returned a shared frozen object would make two heroes drift apart
    // silently. Cheap to check, very expensive to discover later.
    const a = createHeroState(0, 0, 0, 10, 2.2);
    const b = createHeroState(0, 0, 0, 10, 2.2);
    a.vx = 5;
    expect(b.vx).toBe(0);
  });
});
