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
  closeDistantDialogues,
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

describe("the per-hero dialogue cap (T4 review, one conversation at a time)", () => {
  it("refuses a second run for a hero already parked on a say, then allows it once the panel closes", () => {
    const runtime = createEventRunRuntime();
    // Hero h1 opens a say on event `a` and parks (waiting-advance).
    expect(begin(runtime, "a", [{ t: "say", text: "hi", name: null }], { heroId: "h1" })).toBe(
      true,
    );
    drainRuns(runtime, { state: EMPTY_ADVENTURE_STATE, tick: 0 });
    expect(runtime.contexts.get("a")?.status).toBe("waiting-advance");

    // MUTATION PROOF (b): remove the waiting-advance/waiting-choice scan in startRun and this second
    // dialogue starts (returns true), so `b` would live and the size assertion below reads 2.
    expect(begin(runtime, "b", [{ t: "say", text: "again", name: null }], { heroId: "h1" })).toBe(
      false,
    );
    expect(runtime.contexts.has("b")).toBe(false);

    // A DIFFERENT hero is unaffected — the cap is per-hero.
    expect(begin(runtime, "b", [{ t: "say", text: "other", name: null }], { heroId: "h2" })).toBe(
      true,
    );

    // Advancing the say to completion releases h1's panel; a new dialogue is then allowed.
    drainRuns(runtime, { state: EMPTY_ADVENTURE_STATE, tick: 1 });
    advanceRun(runtime, "h1", "run-a"); // one page say -> resumes -> done, releasing the lock
    drainRuns(runtime, { state: EMPTY_ADVENTURE_STATE, tick: 2 });
    expect(runtime.contexts.has("a")).toBe(false);
    expect(begin(runtime, "c", [{ t: "say", text: "fresh", name: null }], { heroId: "h1" })).toBe(
      true,
    );
  });

  it("does NOT cap a hero whose only live run is non-dialogue (running / waiting-timer)", () => {
    const runtime = createEventRunRuntime();
    // A spinning loop is `running`, never parked on a panel — it must not block a new trigger.
    begin(runtime, "spin", [{ t: "loop", body: [{ t: "comment", text: "x" }] }], { heroId: "h1" });
    drainRuns(runtime, { state: EMPTY_ADVENTURE_STATE, tick: 0 });
    expect(runtime.contexts.get("spin")?.status).toBe("running");
    expect(begin(runtime, "talk", [{ t: "say", text: "hi", name: null }], { heroId: "h1" })).toBe(
      true,
    );
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

describe("distance-close (spec Decision 4)", () => {
  it("ends only a dialogue-parked run when its triggerer is beyond the radius, buffering a close", () => {
    const runtime = createEventRunRuntime();
    // A parked say (waiting-advance) and a spinning loop (running) share the room.
    begin(runtime, "talk", [{ t: "say", text: "hi", name: null }], { runId: "run-talk" });
    begin(runtime, "spin", [{ t: "loop", body: [{ t: "comment", text: "x" }] }], {
      runId: "run-spin",
    });
    drainRuns(runtime, { state: EMPTY_ADVENTURE_STATE, tick: 0 });
    expect(runtime.contexts.get("talk")?.status).toBe("waiting-advance");
    expect(runtime.contexts.get("spin")?.status).toBe("running");
    // Drop the say beat the drain buffered — World flushes it to the wire every tick; here we clear
    // by hand so the assertion below sees only the close beat the distance-close appends.
    runtime.dialogue.length = 0;

    // Everyone is "beyond" — but only the dialogue-parked run may end; the running loop is untouched.
    closeDistantDialogues(runtime, () => true);
    expect(runtime.contexts.has("talk")).toBe(false);
    expect(runtime.contexts.get("spin")?.status).toBe("running");
    expect(runtime.dialogue).toEqual([
      { heroId: "hero-1", runId: "run-talk", message: { kind: "closeDialogue" } },
    ]);
  });

  it("keeps a dialogue-parked run whose triggerer is still in range", () => {
    const runtime = createEventRunRuntime();
    begin(runtime, "talk", [{ t: "say", text: "hi", name: null }], { runId: "run-talk" });
    drainRuns(runtime, { state: EMPTY_ADVENTURE_STATE, tick: 0 });
    runtime.dialogue.length = 0; // clear the say beat the drain buffered (World flushes it each tick)
    // In range: nothing closes, nothing buffered.
    closeDistantDialogues(runtime, () => false);
    expect(runtime.contexts.get("talk")?.status).toBe("waiting-advance");
    expect(runtime.dialogue).toHaveLength(0);
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
