import {
  advanceDamageOverTime,
  applyDamageOverTime,
  consumeDamageOverTimePower,
  type DamageOverTimeRuntime,
  damageOverTimeRemainingPower,
  removeDamageOverTimeBySource,
  removeDamageOverTimeByTarget,
} from "@lindocara/server/world/damage-over-time-system.js";
import { describe, expect, it, vi } from "vitest";

type TickResolver = Parameters<typeof advanceDamageOverTime>[2]["resolveTick"];

function poison(
  effects: DamageOverTimeRuntime[],
  now: number,
  maxStacks = 1,
): DamageOverTimeRuntime {
  return applyDamageOverTime(effects, {
    kind: "poison",
    sourceId: "rogue",
    sourceSkillId: "poisoned_shiv",
    targetKind: "monster",
    targetId: "boss",
    now,
    tickCount: 5,
    tickPower: 6,
    intervalMs: 1_000,
    maxStacks,
  });
}

function advance(
  effects: DamageOverTimeRuntime[],
  now: number,
  resolveTick: TickResolver,
  sourceIsActive = true,
  targetIsActive = true,
): void {
  advanceDamageOverTime(effects, now, {
    sourceIsActive: () => sourceIsActive,
    targetIsActive: () => targetIsActive,
    resolveTick,
  });
}

describe("server-timed damage over time", () => {
  it("resolves exactly five scheduled poison ticks without autonomous timers", () => {
    const effects: DamageOverTimeRuntime[] = [];
    const effect = poison(effects, 1_000);
    const resolveTick = vi.fn<TickResolver>();

    advance(effects, 1_999, resolveTick);
    advance(effects, 4_000, resolveTick);
    expect(resolveTick).toHaveBeenCalledTimes(3);
    expect(resolveTick.mock.calls.map((call) => call[2].dueAt)).toEqual([2_000, 3_000, 4_000]);
    expect(damageOverTimeRemainingPower(effect)).toBe(12);

    advance(effects, 6_000, resolveTick);
    expect(resolveTick).toHaveBeenCalledTimes(5);
    expect(effects).toEqual([]);
  });

  it("refreshes the ordinary poison instead of stacking its old pending ticks", () => {
    const effects: DamageOverTimeRuntime[] = [];
    const resolveTick = vi.fn<TickResolver>();
    poison(effects, 1_000);
    advance(effects, 2_000, resolveTick);

    const refreshed = poison(effects, 2_500);
    expect(refreshed.stacks).toHaveLength(1);
    expect(damageOverTimeRemainingPower(refreshed)).toBe(30);
    advance(effects, 3_499, resolveTick);
    expect(resolveTick).toHaveBeenCalledTimes(1);
    advance(effects, 3_500, resolveTick);
    expect(resolveTick).toHaveBeenCalledTimes(2);
  });

  it("keeps three stack schedules independent and deterministically refreshes the oldest", () => {
    const effects: DamageOverTimeRuntime[] = [];
    const first = poison(effects, 1_000, 3);
    poison(effects, 1_100, 3);
    poison(effects, 1_200, 3);

    poison(effects, 1_300, 3);
    expect(first.stacks).toHaveLength(3);
    expect(first.stacks.map((stack) => stack.sequence)).toEqual([3, 1, 2]);
    expect(first.stacks.map((stack) => stack.appliedAt)).toEqual([1_300, 1_100, 1_200]);
    expect(damageOverTimeRemainingPower(first)).toBe(90);
  });

  it("consumes an exact bounded share without leaving the same power on future ticks", () => {
    const effects: DamageOverTimeRuntime[] = [];
    const effect = poison(effects, 1_000);
    const resolveTick = vi.fn<TickResolver>();

    expect(
      consumeDamageOverTimePower(
        effects,
        {
          kind: "poison",
          sourceId: "rogue",
          sourceSkillId: "poisoned_shiv",
          targetKind: "monster",
          targetId: "boss",
        },
        0.6,
      ),
    ).toBe(18);
    expect(damageOverTimeRemainingPower(effect)).toBe(12);

    advance(effects, 10_000, resolveTick);
    expect(resolveTick.mock.calls.reduce((sum, call) => sum + call[2].power, 0)).toBe(12);
    expect(effects).toEqual([]);
  });

  it("drops effects when either endpoint disappears and supports explicit room cleanup", () => {
    const effects: DamageOverTimeRuntime[] = [];
    const resolveTick = vi.fn<TickResolver>();
    poison(effects, 1_000);
    advance(effects, 2_000, resolveTick, false);
    expect(resolveTick).not.toHaveBeenCalled();
    expect(effects).toEqual([]);

    poison(effects, 2_000);
    advance(effects, 3_000, resolveTick, true, false);
    expect(resolveTick).not.toHaveBeenCalled();
    expect(effects).toEqual([]);

    poison(effects, 3_000);
    removeDamageOverTimeByTarget(effects, "monster", "boss");
    expect(effects).toEqual([]);
    poison(effects, 4_000);
    removeDamageOverTimeBySource(effects, "rogue");
    expect(effects).toEqual([]);
  });
});
