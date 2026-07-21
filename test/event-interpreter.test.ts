/**
 * The pure stepper (`event-interpreter.ts`): a per-opcode table (one command in, the expected
 * effect and status out), the control-flow programs the plan names — nested `if` inside a `loop`
 * with `breakLoop`, `choices` resume, a loopless `breakLoop`, an infinite loop that never grows the
 * frame stack, deep nesting to the model's depth cap — plus determinism and the four mutation
 * proofs (both runs each) the plan asks for. No Durable Object: the stepper is data-in/data-out, so
 * these are replay tests exactly like `prediction.test.ts`.
 *
 * MUTATION PROOFS (asserted below, each with the real code passing and the mutation failing):
 *  (a) else-branch taken when the condition HOLDS → the opcode/sequence table fails
 *      ("if takes the then-branch when the condition holds").
 *  (b) a loop frame pops instead of resetting → the 200-step no-growth test fails
 *      ("an infinite loop yields a step every call and never grows the frame stack").
 *  (c) breakLoop pops only one frame instead of through the loop → the nested-break sequence fails
 *      ("nested if inside a loop with breakLoop runs the exact effect sequence").
 *  (d) resumeWithChoice skips the index range check → the out-of-range drop test fails
 *      ("resumeWithChoice drops an out-of-range index").
 */
import { describe, expect, it } from "vitest";
import { EMPTY_ADVENTURE_STATE, type PartyAdventureState } from "../src/shared/adventure-state.js";
import type { EventCommand } from "../src/shared/event-commands.js";
import {
  applyStateMutation,
  type EventEffect,
  type RunContext,
  resumeWithAdvance,
  resumeWithChoice,
  startEventRun,
  stepEventRun,
} from "../src/shared/event-interpreter.js";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const MAP_ID = "22222222-2222-4222-8222-222222222222";

function run(program: readonly EventCommand[]): RunContext {
  return startEventRun({
    runId: "run-1",
    eventId: EVENT_ID,
    pageIndex: 0,
    heroId: "hero-1",
    program,
  });
}

function state(overrides: Partial<PartyAdventureState> = {}): PartyAdventureState {
  return { ...EMPTY_ADVENTURE_STATE, ...overrides };
}

/** Step until the run leaves `running` (parks or finishes), collecting the effect of every step.
 *  A hard cap guards the test itself against a genuine non-termination bug. */
function drain(
  context: RunContext,
  snapshot: PartyAdventureState,
  cap = 1000,
): { context: RunContext; effects: EventEffect[] } {
  let current = context;
  const effects: EventEffect[] = [];
  for (let i = 0; i < cap && current.status === "running"; i++) {
    const result = stepEventRun(current, snapshot);
    effects.push(...result.effects);
    current = result.context;
  }
  return { context: current, effects };
}

describe("stepEventRun — the per-opcode table", () => {
  it("say emits its text and speaker and parks on waiting-advance", () => {
    const result = stepEventRun(run([{ t: "say", text: "Bonjour", name: "Mira" }]), state());
    expect(result.effects).toEqual([{ kind: "say", text: "Bonjour", name: "Mira" }]);
    expect(result.context.status).toBe("waiting-advance");
  });

  it("choices offers the labels, stores the count and parks without advancing pc", () => {
    const result = stepEventRun(
      run([
        {
          t: "choices",
          prompt: "Ouvrir ?",
          options: [
            { label: "Oui", body: [] },
            { label: "Non", body: [] },
          ],
        },
      ]),
      state(),
    );
    expect(result.effects).toEqual([
      { kind: "offerChoices", prompt: "Ouvrir ?", options: ["Oui", "Non"] },
    ]);
    expect(result.context.status).toBe("waiting-choice");
    expect(result.context.pendingChoices).toBe(2);
    expect(result.context.frames[0]?.pc).toBe(0);
  });

  it("setSwitch emits a setSwitch mutation and keeps running", () => {
    const result = stepEventRun(run([{ t: "setSwitch", switchId: "0001", value: true }]), state());
    expect(result.effects).toEqual([
      { kind: "mutateState", op: { type: "setSwitch", switchId: "0001", value: true } },
    ]);
    expect(result.context.status).toBe("running");
  });

  it("setVariable carries the set/add op", () => {
    const result = stepEventRun(
      run([{ t: "setVariable", variableId: "0002", op: "add", value: 3 }]),
      state(),
    );
    expect(result.effects).toEqual([
      { kind: "mutateState", op: { type: "setVariable", variableId: "0002", op: "add", value: 3 } },
    ]);
  });

  it("setSelfSwitch keys the mutation by the event id", () => {
    const result = stepEventRun(
      run([{ t: "setSelfSwitch", selfSwitch: "A", value: true }]),
      state(),
    );
    expect(result.effects).toEqual([
      { kind: "mutateState", op: { type: "setSelfSwitch", key: `${EVENT_ID}:A`, value: true } },
    ]);
  });

  it("wait emits the frame count and parks on waiting-timer with a null deadline (clockless)", () => {
    const result = stepEventRun(run([{ t: "wait", frames: 20 }]), state());
    expect(result.effects).toEqual([{ kind: "wait", frames: 20 }]);
    expect(result.context.status).toBe("waiting-timer");
    expect(result.context.resumeAtTick).toBeNull();
  });

  it("teleport, changeGold and changeItems each emit their effect and keep running", () => {
    const program: EventCommand[] = [
      { t: "teleport", mapId: MAP_ID, col: 4, row: 5 },
      { t: "changeGold", amount: -10 },
      { t: "changeItems", itemId: "health_potion", count: 2 },
    ];
    const drained = drain(run(program), state());
    expect(drained.effects.filter((e) => e.kind !== "closeDialogue")).toEqual([
      { kind: "teleport", mapId: MAP_ID, col: 4, row: 5 },
      { kind: "changeGold", amount: -10 },
      { kind: "changeItems", itemId: "health_potion", count: 2 },
    ]);
    expect(drained.context.status).toBe("done");
  });

  it("starts, advances and completes a party-owned authored quest", () => {
    let snapshot = state();
    snapshot = applyStateMutation(snapshot, { type: "startQuest", questId: "0001" });
    snapshot = applyStateMutation(snapshot, {
      type: "advanceQuest",
      questId: "0001",
      objectiveId: "0001",
      amount: 2,
    });
    snapshot = applyStateMutation(snapshot, { type: "completeQuest", questId: "0001" });
    expect(snapshot.quests).toEqual({
      "0001": { status: "completed", objectives: { "0001": 2 } },
    });

    const result = stepEventRun(run([{ t: "startQuest", questId: "0002" }]), snapshot);
    expect(result.effects).toEqual([
      { kind: "mutateState", op: { type: "startQuest", questId: "0002" } },
    ]);
  });

  it("comment produces no effect and advances", () => {
    const result = stepEventRun(run([{ t: "comment", text: "note" }, { t: "exitRun" }]), state());
    expect(result.effects).toEqual([]);
    expect(result.context.frames[0]?.pc).toBe(1);
  });

  it("exitRun finishes the run and closes the dialogue", () => {
    const result = stepEventRun(run([{ t: "exitRun" }]), state());
    expect(result.context.status).toBe("done");
    expect(result.effects).toEqual([{ kind: "closeDialogue" }]);
  });

  it("running off the end of the program finishes with a closeDialogue", () => {
    const result = stepEventRun(run([]), state());
    expect(result.context.status).toBe("done");
    expect(result.effects).toEqual([{ kind: "closeDialogue" }]);
  });

  // MUTATION PROOF (a): the condition drives which branch runs. Inverting it (else on hold) breaks
  // both this and the nested-break sequence below.
  it("if takes the then-branch when the condition holds", () => {
    const program: EventCommand[] = [
      {
        t: "if",
        cond: { type: "switch", switchId: "0001" },
        then: [{ t: "setSwitch", switchId: "0002", value: true }],
        else: [{ t: "setSwitch", switchId: "0003", value: true }],
      },
    ];
    const drained = drain(run(program), state({ switches: { "0001": true } }));
    const mutations = drained.effects.filter((e) => e.kind === "mutateState");
    expect(mutations).toEqual([
      { kind: "mutateState", op: { type: "setSwitch", switchId: "0002", value: true } },
    ]);
  });

  it("if takes the else-branch when the condition fails", () => {
    const program: EventCommand[] = [
      {
        t: "if",
        cond: { type: "switch", switchId: "0001" },
        then: [{ t: "setSwitch", switchId: "0002", value: true }],
        else: [{ t: "setSwitch", switchId: "0003", value: true }],
      },
    ];
    const drained = drain(run(program), state());
    const mutations = drained.effects.filter((e) => e.kind === "mutateState");
    expect(mutations).toEqual([
      { kind: "mutateState", op: { type: "setSwitch", switchId: "0003", value: true } },
    ]);
  });

  it("a variable condition holds at exactly the threshold and against an untouched (0) variable", () => {
    const program: EventCommand[] = [
      {
        t: "if",
        cond: { type: "variable", variableId: "0005", min: 0 },
        then: [{ t: "comment", text: "held" }],
        else: [{ t: "setSwitch", switchId: "0009", value: true }],
      },
    ];
    // min 0 against an unknown variable HOLDS (0 >= 0) — the shared unknown-id default.
    const drained = drain(run(program), state());
    expect(drained.effects.filter((e) => e.kind === "mutateState")).toEqual([]);
  });
});

describe("stepEventRun — control-flow programs", () => {
  // MUTATION PROOF (c): asserts the EXACT effect sequence. With breakLoop popping only one frame the
  // loop re-enters instead of exiting, so setSwitch 0004 / closeDialogue never arrive and this fails.
  it("nested if inside a loop with breakLoop runs the exact effect sequence", () => {
    const program: EventCommand[] = [
      {
        t: "loop",
        body: [
          {
            t: "if",
            cond: { type: "switch", switchId: "0001" },
            then: [{ t: "setSwitch", switchId: "0002", value: true }, { t: "breakLoop" }],
            else: [{ t: "setSwitch", switchId: "0003", value: true }],
          },
        ],
      },
      { t: "setSwitch", switchId: "0004", value: true },
    ];
    const drained = drain(run(program), state({ switches: { "0001": true } }));
    expect(drained.effects).toEqual([
      { kind: "mutateState", op: { type: "setSwitch", switchId: "0002", value: true } },
      { kind: "mutateState", op: { type: "setSwitch", switchId: "0004", value: true } },
      { kind: "closeDialogue" },
    ]);
    expect(drained.context.status).toBe("done");
  });

  it("breakLoop with no enclosing loop ends the run", () => {
    const drained = drain(
      run([{ t: "breakLoop" }, { t: "setSwitch", switchId: "0009", value: true }]),
      state(),
    );
    // The trailing setSwitch never runs — break with no loop is exitRun.
    expect(drained.effects).toEqual([{ kind: "closeDialogue" }]);
    expect(drained.context.status).toBe("done");
  });

  // MUTATION PROOF (b): a loop frame must RESET, not pop. Popping ends the run after a few steps, so
  // the status would flip off "running" and the frame stack would shrink — both asserted here.
  it("an infinite loop yields a step every call and never grows the frame stack", () => {
    let context = run([{ t: "loop", body: [{ t: "comment", text: "spin" }] }]);
    let maxDepth = context.frames.length;
    for (let i = 0; i < 200; i++) {
      const result = stepEventRun(context, state());
      expect(result.context.status).toBe("running");
      context = result.context;
      maxDepth = Math.max(maxDepth, context.frames.length);
    }
    // root + loop, forever — the loop reset never pushes and never pops past the loop frame.
    expect(context.frames.length).toBe(2);
    expect(maxDepth).toBe(2);
  });

  // Task-2 carry: a bare `loop {}` (empty body) is a fixpoint, not growth. Stepping it twice must
  // land on the IDENTICAL context — an exhausted empty loop body resets pc to 0 and never pushes,
  // so the second step is byte-for-byte the first. A pop-instead-of-reset bug would end the run.
  it("an empty loop steps to an identical context twice running", () => {
    const once = stepEventRun(run([{ t: "loop", body: [] }]), state());
    const twice = stepEventRun(once.context, state());
    expect(once.context.status).toBe("running");
    expect(twice.context).toEqual(once.context);
    expect(twice.effects).toEqual([]);
  });

  it("walks nested ifs down to the model's depth cap and executes the innermost command", () => {
    // Eight nested holding ifs (the depth cap is 8), each satisfied, reaching a marker at the bottom.
    let inner: EventCommand[] = [{ t: "setSwitch", switchId: "0099", value: true }];
    for (let depth = 0; depth < 7; depth++) {
      inner = [{ t: "if", cond: { type: "switch", switchId: "0001" }, then: inner, else: [] }];
    }
    const drained = drain(run(inner), state({ switches: { "0001": true } }));
    expect(drained.effects.filter((e) => e.kind === "mutateState")).toEqual([
      { kind: "mutateState", op: { type: "setSwitch", switchId: "0099", value: true } },
    ]);
    expect(drained.context.status).toBe("done");
  });
});

describe("resume — advance and choice", () => {
  it("resumeWithAdvance continues a say run to the next command", () => {
    const program: EventCommand[] = [
      { t: "say", text: "Un", name: null },
      { t: "setSwitch", switchId: "0001", value: true },
    ];
    const parked = stepEventRun(run(program), state());
    expect(parked.context.status).toBe("waiting-advance");
    const resumed = resumeWithAdvance(parked.context);
    const drained = drain(resumed, state());
    expect(drained.effects.filter((e) => e.kind === "mutateState")).toEqual([
      { kind: "mutateState", op: { type: "setSwitch", switchId: "0001", value: true } },
    ]);
  });

  it("resumeWithChoice runs the chosen option's body then resumes after the choices command", () => {
    const program: EventCommand[] = [
      {
        t: "choices",
        prompt: "Pick",
        options: [
          { label: "A", body: [{ t: "setSwitch", switchId: "0001", value: true }] },
          { label: "B", body: [{ t: "setSwitch", switchId: "0002", value: true }] },
        ],
      },
      { t: "setSwitch", switchId: "0003", value: true },
    ];
    const parked = stepEventRun(run(program), state());
    const resumed = resumeWithChoice(parked.context, 1);
    expect(resumed).not.toBeNull();
    if (resumed === null) return;
    const drained = drain(resumed, state());
    // Option B's body, then the command after the choices — option A's switch never runs.
    expect(drained.effects.filter((e) => e.kind === "mutateState")).toEqual([
      { kind: "mutateState", op: { type: "setSwitch", switchId: "0002", value: true } },
      { kind: "mutateState", op: { type: "setSwitch", switchId: "0003", value: true } },
    ]);
  });

  // MUTATION PROOF (d): the range check against pendingChoices is the sole gate. Remove it and an
  // out-of-range index resolves to an empty body (a running context) instead of the null drop.
  it("resumeWithChoice drops an out-of-range index", () => {
    const program: EventCommand[] = [
      {
        t: "choices",
        prompt: "Pick",
        options: [
          { label: "A", body: [] },
          { label: "B", body: [] },
        ],
      },
    ];
    const parked = stepEventRun(run(program), state());
    expect(resumeWithChoice(parked.context, 3)).toBeNull();
    expect(resumeWithChoice(parked.context, -1)).toBeNull();
  });

  it("resumeWithChoice drops a pick when the run is not waiting on a choice", () => {
    const parked = stepEventRun(run([{ t: "say", text: "hi", name: null }]), state());
    expect(resumeWithChoice(parked.context, 0)).toBeNull();
  });

  it("resumeWithAdvance is a no-op on a run that is not waiting to advance", () => {
    const context = run([{ t: "setSwitch", switchId: "0001", value: true }]);
    expect(resumeWithAdvance(context)).toBe(context);
  });
});

describe("determinism", () => {
  it("stepping the same context and state twice yields deep-equal results", () => {
    const program: EventCommand[] = [
      {
        t: "if",
        cond: { type: "variable", variableId: "0001", min: 5 },
        then: [{ t: "setSwitch", switchId: "0002", value: true }],
        else: [{ t: "changeGold", amount: 7 }],
      },
      { t: "wait", frames: 10 },
    ];
    const context = run(program);
    const snapshot = state({ variables: { "0001": 9 } });
    const first = drain(context, snapshot);
    const second = drain(context, snapshot);
    expect(second.effects).toEqual(first.effects);
    expect(second.context).toEqual(first.context);
  });
});
