import { clientCooldownDeadlines } from "@lindocara/client/game/cooldown-sync.js";
import { ServerClock, serverTimestampToLocal } from "@lindocara/renderer/server-clock.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const timeline = { startedAt: 100_000, impactAt: 100_280, recoveryEndsAt: 100_650 };

describe("shared browser server clock", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["aligned", 100_000],
    ["browser wall clock 30 seconds ahead", 130_000],
    ["browser wall clock 30 seconds behind", 70_000],
  ])("preserves relative action timing with %s", (_label, localWallClock) => {
    vi.spyOn(Date, "now").mockReturnValue(localWallClock);
    const clock = new ServerClock();
    clock.sample(100_000, 500);
    expect(clock.combatTimeline(timeline, 999_999)).toEqual({
      startedAt: 500,
      impactAt: 780,
      recoveryEndsAt: 1_150,
    });
  });

  it("updates the sample and uses the same projection for cooldowns and animations", () => {
    const clock = new ServerClock();
    clock.sample(100_000, 500);
    clock.sample(101_000, 800);
    const sample = clock.currentSample();
    if (!sample) throw new Error("expected a server clock sample");
    expect(serverTimestampToLocal(101_325, sample)).toBe(1_125);
    expect(
      clock.combatTimeline(
        { ...timeline, startedAt: 101_000, impactAt: 101_130, recoveryEndsAt: 101_325 },
        0,
      ),
    ).toEqual({
      startedAt: 800,
      impactAt: 930,
      recoveryEndsAt: 1_125,
    });
    expect(
      clientCooldownDeadlines(
        {
          attackUntil: 101_325,
          healUntil: 0,
          skillCooldowns: [101_325, 0, 0, 0, 0],
          guardUntil: 0,
          resurrectUntil: 0,
        },
        clock,
      ),
    ).toMatchObject({ attackUntil: 1_125, skills: { 1: 1_125 } });
  });

  it("falls back to relative action durations and no speculative cooldown before a sample", () => {
    const clock = new ServerClock();
    expect(clock.combatTimeline(timeline, 250)).toEqual({
      startedAt: 250,
      impactAt: 530,
      recoveryEndsAt: 900,
    });
    expect(clientCooldownDeadlines(undefined, clock).attackUntil).toBe(0);
  });
});
