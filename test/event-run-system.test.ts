/**
 * The room's event-run bookkeeping (`server/world/event-run-system.ts`) exercised as the pure
 * functions it is — the lock, the budgeted round-robin drain, the wait-deadline fill, the aborts and
 * the resumes — without a Durable Object. The real-DO seam (trigger detection, effect dispatch,
 * coordinator RPC) is `test/event-run-runtime.test.ts`; this file pins the invariants the drain
 * itself owns, so a budget or lock regression fails here in milliseconds, never as a room hang.
 */
import { describe, expect, it } from "vitest";
import {
  abortRunsForHero,
  advanceRun,
  chooseRun,
  createEventRunRuntime,
  drainRuns,
  startRun,
} from "../src/server/world/event-run-system.js";
import { EMPTY_ADVENTURE_STATE } from "../src/shared/adventure-state.js";
import type { EventCommand } from "../src/shared/event-commands.js";
import { EVENT_COMMANDS_PER_TICK } from "../src/shared/event-commands.js";
import type { MapEvent } from "../src/shared/map-events.js";
import { defaultEventPage } from "../src/shared/map-events.js";

/** A one-page `normal` event carrying `program`, for the lock key. Only its id matters to the run. */
function event(id: string, program: readonly EventCommand[]): MapEvent {
  return {
    id,
    col: 0,
    row: 0,
    name: "",
    ordinal: 0,
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: [{ ...defaultEventPage(), commands: program }],
  };
}

function begin(
  runtime: ReturnType<typeof createEventRunRuntime>,
  id: string,
  program: readonly EventCommand[],
  overrides: { heroId?: string; runId?: string } = {},
): boolean {
  return startRun(runtime, {
    event: event(id, program),
    pageIndex: 0,
    program,
    heroId: overrides.heroId ?? "hero-1",
    runId: overrides.runId ?? `run-${id}`,
  });
}

describe("the one-run-per-event lock (Q4)", () => {
  it("drops a second trigger on an event that already has a live context", () => {
    const runtime = createEventRunRuntime();
    expect(begin(runtime, "ev", [{ t: "say", text: "hi", name: null }], { runId: "first" })).toBe(
      true,
    );
    // MUTATION PROOF (a): remove `contexts.has(...)` in startRun and this returns true, overwriting
    // the live run — the assertion on the surviving runId then reads "second", failing.
    expect(begin(runtime, "ev", [{ t: "say", text: "hi", name: null }], { runId: "second" })).toBe(
      false,
    );
    expect(runtime.contexts.size).toBe(1);
    expect(runtime.contexts.get("ev")?.runId).toBe("first");
  });
});

describe("the per-tick budget", () => {
  it("executes exactly the budget across a finite over-budget program", () => {
    // 30 sequential setVariable adds — more than the 16 budget. One drain does exactly 16.
    const program: EventCommand[] = Array.from({ length: 30 }, () => ({
      t: "setVariable",
      variableId: "0001",
      op: "add",
      value: 1,
    }));
    const runtime = createEventRunRuntime();
    begin(runtime, "ev", program);
    const result = drainRuns(runtime, { state: EMPTY_ADVENTURE_STATE, tick: 0 });
    // MUTATION PROOF (b): raise/remove the `used < budget` cap and all 30 run in one drain — a fast,
    // bounded assertion failure (the program is finite, so it never hangs), the load-bearing proof.
    expect(result.used).toBe(EVENT_COMMANDS_PER_TICK);
    expect(result.effects).toHaveLength(EVENT_COMMANDS_PER_TICK);
  });

  it("bounds an authored infinite loop to the budget and returns", () => {
    // A `while(true)`-equivalent. The drain MUST return (the room never hangs): exactly 16 steps,
    // the context still running for the next tick.
    const runtime = createEventRunRuntime();
    begin(runtime, "ev", [
      { t: "loop", body: [{ t: "setVariable", variableId: "0001", op: "add", value: 1 }] },
    ]);
    const result = drainRuns(runtime, { state: EMPTY_ADVENTURE_STATE, tick: 0 });
    expect(result.used).toBe(EVENT_COMMANDS_PER_TICK);
    expect(runtime.contexts.get("ev")?.status).toBe("running");
  });

  it("splits the budget round-robin across two running contexts", () => {
    const runtime = createEventRunRuntime();
    const spin: EventCommand[] = [
      { t: "loop", body: [{ t: "setVariable", variableId: "0001", op: "add", value: 1 }] },
    ];
    begin(runtime, "a", spin, { runId: "run-a" });
    begin(runtime, "b", spin, { runId: "run-b" });
    const result = drainRuns(runtime, { state: EMPTY_ADVENTURE_STATE, tick: 0 });
    expect(result.used).toBe(EVENT_COMMANDS_PER_TICK);
    // Both spin forever, so neither finishes and each got roughly half the slice.
    expect(runtime.contexts.get("a")?.status).toBe("running");
    expect(runtime.contexts.get("b")?.status).toBe("running");
  });
});

describe("wait deadlines", () => {
  it("parks a wait on tick + frames and resumes when the tick arrives", () => {
    const runtime = createEventRunRuntime();
    begin(runtime, "ev", [
      { t: "wait", frames: 20 },
      { t: "setVariable", variableId: "0001", op: "add", value: 1 },
    ]);
    // Tick 0: the wait parks the context with resumeAtTick = 0 + 20.
    drainRuns(runtime, { state: EMPTY_ADVENTURE_STATE, tick: 0 });
    expect(runtime.contexts.get("ev")?.status).toBe("waiting-timer");
    expect(runtime.contexts.get("ev")?.resumeAtTick).toBe(20);

    // Tick 5: still parked, no effect.
    const early = drainRuns(runtime, { state: EMPTY_ADVENTURE_STATE, tick: 5 });
    expect(early.effects).toHaveLength(0);
    expect(runtime.contexts.get("ev")?.status).toBe("waiting-timer");

    // Tick 20: the deadline arrives, the run resumes and executes the setVariable.
    const resumed = drainRuns(runtime, { state: EMPTY_ADVENTURE_STATE, tick: 20 });
    expect(resumed.effects).toEqual([
      {
        heroId: "hero-1",
        runId: "run-ev",
        eventId: "ev",
        effect: {
          kind: "mutateState",
          op: { type: "setVariable", variableId: "0001", op: "add", value: 1 },
        },
      },
    ]);
  });
});

describe("aborts", () => {
  it("aborts only the runs a given hero triggered", () => {
    const runtime = createEventRunRuntime();
    begin(runtime, "a", [{ t: "say", text: "a", name: null }], { heroId: "h1", runId: "run-a" });
    begin(runtime, "b", [{ t: "say", text: "b", name: null }], { heroId: "h2", runId: "run-b" });
    abortRunsForHero(runtime, "h1");
    expect([...runtime.contexts.keys()]).toEqual(["b"]);
  });
});

describe("resume — advance and choose", () => {
  it("advances a say only for the triggerer", () => {
    const runtime = createEventRunRuntime();
    begin(runtime, "ev", [{ t: "say", text: "hi", name: null }], { heroId: "h1", runId: "r" });
    drainRuns(runtime, { state: EMPTY_ADVENTURE_STATE, tick: 0 });
    expect(runtime.contexts.get("ev")?.status).toBe("waiting-advance");
    expect(advanceRun(runtime, "someone-else", "r")).toBe(false);
    expect(advanceRun(runtime, "h1", "r")).toBe(true);
    expect(runtime.contexts.get("ev")?.status).toBe("running");
  });

  it("chooses an option by re-reading the command, rejecting out-of-range and the wrong hero", () => {
    const runtime = createEventRunRuntime();
    const choices: EventCommand[] = [
      {
        t: "choices",
        prompt: "?",
        options: [
          { label: "A", body: [{ t: "setSwitch", switchId: "0001", value: true }] },
          { label: "B", body: [] },
        ],
      },
    ];
    begin(runtime, "ev", choices, { heroId: "h1", runId: "r" });
    drainRuns(runtime, { state: EMPTY_ADVENTURE_STATE, tick: 0 });
    expect(runtime.contexts.get("ev")?.status).toBe("waiting-choice");
    expect(chooseRun(runtime, "h1", "r", 2)).toBe(false); // out of range
    expect(chooseRun(runtime, "someone-else", "r", 0)).toBe(false); // wrong hero
    expect(chooseRun(runtime, "h1", "r", 0)).toBe(true);
    // Option A's body runs on the next drain, flipping 0001.
    const result = drainRuns(runtime, { state: EMPTY_ADVENTURE_STATE, tick: 1 });
    expect(result.effects.some((e) => e.effect.kind === "mutateState")).toBe(true);
  });
});
