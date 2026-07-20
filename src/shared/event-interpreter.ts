/**
 * The pure stepper: how an event's authored program (`event-commands.ts`) runs, one command at a
 * time, as data-in/data-out with no clock, no randomness and no I/O. Everything later in tranche 5
 * — the room's per-tick drain, the dialogue protocol, effect dispatch — leans on this file being
 * exactly right and replayable, so it lives in `shared/` and is tested without a Durable Object,
 * the same argument `simulation.ts` makes for `step()`: the one authority, exercised in isolation.
 *
 * ## A frame STACK, not pc-splicing
 *
 * A running program has structure — an `if` branch, a `loop` body, a picked `choices` option each
 * open a nested block. The naive model splices the taken branch's commands into a flat instruction
 * list and tracks one program counter; that mutates the program as it runs, loses the boundary
 * between "I am inside this loop" and "I returned from it", and makes `breakLoop` a search for a
 * matching end-marker. Instead a `RunContext` carries a stack of `Frame`s. The ROOT frame holds the
 * page's program (there is no separate `program` parameter to drift from what the frames say);
 * entering an `if`/`choices`-option/`loop` PUSHES a frame; running off the end of a frame POPS it
 * (a `loop` frame RESETS its pc to 0 instead of popping — that IS the loop); `breakLoop` pops
 * through to and including the nearest `loop` frame. The program is never rewritten, and "where am
 * I" is just the stack. This is the settled design (spec Decision 2 offered the choice; this is it).
 *
 * ## Clockless, and who owns `resumeAtTick`
 *
 * The stepper never reads a clock — determinism is the whole point (replay in `prediction`-style
 * tests, and a room that re-derives the same run every time). `wait` therefore does NOT compute a
 * deadline. It emits a `{ kind: "wait", frames }` effect and parks the context in `waiting-timer`
 * with `resumeAtTick` left `null`; the CALLER (the room drain, task 3) reads the current tick, adds
 * `frames`, writes `resumeAtTick`, and flips the context back to `running` when the tick arrives.
 * Keeping the clock entirely on the caller's side is what lets this module stay pure.
 *
 * ## `breakLoop` with no enclosing loop
 *
 * Pre-decided and documented: it acts as `exitRun` — the run ends. An author who breaks with no loop
 * around them means "stop", and there is no honest alternative (there is no outer loop to break, and
 * silently continuing would hide the authoring mistake). See `stepBreakLoop`.
 *
 * ## `closeDialogue` on `done`
 *
 * Reaching `done` (via `exitRun`, running off the root frame, or a loopless `breakLoop`) emits a
 * `closeDialogue` effect so the client's dialogue panel closes at the natural end of a conversation
 * — WoW closes the panel when the event finishes. A run that opened no panel still emits it; the
 * client treats closing an absent panel as a no-op. Task 3's distance-close constructs the same
 * effect when the triggerer walks away, which is why it is part of this module's effect union.
 */
import {
  type PartyAdventureState,
  selfSwitchIsOn,
  selfSwitchKey,
  switchIsOn,
  variableAtLeast,
} from "./adventure-state.js";
import type { ChoiceOption, EventCommand, EventCondition } from "./event-commands.js";

/**
 * One block of the running program. `commands` is the block's ordered command list (the root
 * frame's is the whole page program); `pc` is the next command to execute within it. `kind`
 * distinguishes a plain `body` block (an `if` branch or a `choices` option) from a `loop` body:
 * running off the end of a `body` pops it, running off the end of a `loop` resets its pc to 0.
 */
export interface Frame {
  readonly commands: readonly EventCommand[];
  readonly pc: number;
  readonly kind: "body" | "loop";
}

/**
 * `waiting-advance` parks on a `say` until the player advances; `waiting-choice` parks on a
 * `choices` until the player picks; `waiting-timer` parks on a `wait` until the caller's tick
 * deadline; `done` is terminal. Only a `running` context is steppable — `stepEventRun` returns a
 * parked/done context unchanged so the caller can hold it until the external event resumes it.
 */
export type RunStatus = "running" | "waiting-advance" | "waiting-choice" | "waiting-timer" | "done";

/**
 * A single run of a single event's program. Immutable: `stepEventRun` and the resume helpers return
 * a NEW context rather than mutating, so a caller may keep the prior one (replay, diffing) freely.
 *
 * - `runId` identifies this run on the wire (dialogue messages carry it); `eventId` keys the run's
 *   self-switches (`setSelfSwitch` mutates `${eventId}:${letter}`); `pageIndex`/`heroId` record
 *   which page triggered and for whom.
 * - `frames` is the stack described in the module header; the root frame holds the page program.
 * - `pendingChoices` is the offered option COUNT while `waiting-choice` (the sole gate
 *   `resumeWithChoice` validates against), `null` otherwise.
 * - `resumeAtTick` is the wait deadline while `waiting-timer`; the stepper always leaves it `null`
 *   (see the module header — the caller owns it), `null` otherwise.
 */
export interface RunContext {
  readonly runId: string;
  readonly eventId: string;
  readonly pageIndex: number;
  readonly heroId: string;
  readonly frames: readonly Frame[];
  readonly status: RunStatus;
  readonly pendingChoices: number | null;
  readonly resumeAtTick: number | null;
}

/** A switch/variable/self-switch write the run wants applied. The interpreter emits it as pure
 *  data; the coordinator (the single writer) applies it. `setSelfSwitch` carries the already-keyed
 *  `${eventId}:${letter}` so the applier needs no knowledge of which event ran. */
export type StateMutation =
  | { readonly type: "setSwitch"; readonly switchId: string; readonly value: boolean }
  | {
      readonly type: "setVariable";
      readonly variableId: string;
      readonly op: "set" | "add";
      readonly value: number;
    }
  | { readonly type: "setSelfSwitch"; readonly key: string; readonly value: boolean };

/**
 * Apply one mutation to a party's adventure state, returning a NEW state (the interpreter never
 * mutates; the coordinator, the single writer, is the sole caller). Pure and total: `add` reads the
 * current value as `0` when the variable is untouched — the exact unknown-id default page selection
 * uses (`adventure-state.ts`), so a run adding to a never-set variable and a page reading it agree.
 * A `set` overwrites; a `setSwitch`/`setSelfSwitch` records the boolean under its key. Lives here,
 * beside `StateMutation`, so the shape and the applier cannot drift.
 */
export function applyStateMutation(
  state: PartyAdventureState,
  mutation: StateMutation,
): PartyAdventureState {
  switch (mutation.type) {
    case "setSwitch":
      return { ...state, switches: { ...state.switches, [mutation.switchId]: mutation.value } };
    case "setVariable": {
      const current = state.variables[mutation.variableId] ?? 0;
      const next = mutation.op === "add" ? current + mutation.value : mutation.value;
      return { ...state, variables: { ...state.variables, [mutation.variableId]: next } };
    }
    case "setSelfSwitch":
      return {
        ...state,
        selfSwitches: { ...state.selfSwitches, [mutation.key]: mutation.value },
      };
  }
}

/**
 * What a step asks the outside world to do, as data. The stepper resolves none of these — it does
 * not touch a socket, the coordinator, or a hero's inventory; task 3 dispatches each. `wait` carries
 * the authored frame count (NOT a deadline; see the module header). `closeDialogue` fires on `done`.
 */
export type EventEffect =
  | { readonly kind: "say"; readonly text: string; readonly name: string | null }
  | { readonly kind: "offerChoices"; readonly prompt: string; readonly options: readonly string[] }
  | { readonly kind: "mutateState"; readonly op: StateMutation }
  | {
      readonly kind: "teleport";
      readonly mapId: string;
      readonly col: number;
      readonly row: number;
    }
  | { readonly kind: "changeGold"; readonly amount: number }
  | { readonly kind: "changeItems"; readonly itemId: string; readonly count: number }
  | { readonly kind: "closeDialogue" }
  | { readonly kind: "wait"; readonly frames: number };

export interface StepResult {
  readonly context: RunContext;
  readonly effects: readonly EventEffect[];
}

/** Build the initial context for a page's program: the root `body` frame at pc 0, `running`, no
 *  pending choice, no timer. Task 3 and the tests start a run through here rather than hand-rolling
 *  the frame stack, keeping "the root frame holds the program" in one place. */
export function startEventRun(params: {
  readonly runId: string;
  readonly eventId: string;
  readonly pageIndex: number;
  readonly heroId: string;
  readonly program: readonly EventCommand[];
}): RunContext {
  return {
    runId: params.runId,
    eventId: params.eventId,
    pageIndex: params.pageIndex,
    heroId: params.heroId,
    frames: [{ commands: params.program, pc: 0, kind: "body" }],
    status: "running",
    pendingChoices: null,
    resumeAtTick: null,
  };
}

/** The frames with the top frame's pc advanced by one. A missing top (only if the stack is empty,
 *  which `stepEventRun` handles before calling this) leaves the frames untouched. */
function advanceTop(frames: readonly Frame[]): readonly Frame[] {
  const top = frames[frames.length - 1];
  if (top === undefined) return frames;
  return [...frames.slice(0, -1), { commands: top.commands, pc: top.pc + 1, kind: top.kind }];
}

function pushFrame(frames: readonly Frame[], frame: Frame): readonly Frame[] {
  return [...frames, frame];
}

/** A `running` context with new frames and no pending-choice/timer state. */
function running(context: RunContext, frames: readonly Frame[]): RunContext {
  return { ...context, frames, status: "running", pendingChoices: null, resumeAtTick: null };
}

/** The terminal context: no frames left to run, `done`, nothing pending. */
function finish(context: RunContext): RunContext {
  return { ...context, frames: [], status: "done", pendingChoices: null, resumeAtTick: null };
}

const CLOSE_DIALOGUE: StepResult["effects"] = [{ kind: "closeDialogue" }];

/** Evaluate an authored condition against the party snapshot, reusing the SAME primitives page
 *  selection uses (`adventure-state.ts`) so the two can never disagree on what a switch/variable/
 *  self-switch reads — including the unknown-id defaults (unknown switch false, unknown variable 0). */
function evaluateCondition(
  cond: EventCondition,
  eventId: string,
  state: PartyAdventureState,
): boolean {
  switch (cond.type) {
    case "switch":
      return switchIsOn(state, cond.switchId);
    case "variable":
      return variableAtLeast(state, cond.variableId, cond.min);
    case "selfSwitch":
      return selfSwitchIsOn(state, eventId, cond.selfSwitch);
  }
}

/** `breakLoop`: the frames with everything from the top down through (and including) the nearest
 *  `loop` frame removed. Returns `null` when there is no enclosing loop — the caller turns that into
 *  the run ending (documented `exitRun` behaviour). The frame BELOW the loop already has its pc past
 *  the `loop` command (advanced when the loop was entered), so execution correctly resumes after it. */
function popThroughLoop(frames: readonly Frame[]): readonly Frame[] | null {
  for (let index = frames.length - 1; index >= 0; index--) {
    const frame = frames[index];
    if (frame !== undefined && frame.kind === "loop") return frames.slice(0, index);
  }
  return null;
}

function stepBreakLoop(context: RunContext): StepResult {
  const popped = popThroughLoop(context.frames);
  // No enclosing loop → break behaves as exitRun. Pre-decided; see the module header.
  if (popped === null) return { context: finish(context), effects: CLOSE_DIALOGUE };
  return { context: running(context, popped), effects: [] };
}

/**
 * Execute exactly the one command at `top.pc`. A control command (`if`/`loop`) first CONSUMES itself
 * in the current frame (pc + 1) and then pushes the child frame, so when the child later pops,
 * execution resumes AFTER the control command — the one place the "advance then push" order matters.
 * `choices` is the exception: it does NOT advance, leaving pc on the command so `resumeWithChoice`
 * can re-read the option bodies once the player picks (its parent pc advances only then).
 */
function executeCommand(
  context: RunContext,
  command: EventCommand,
  state: PartyAdventureState,
): StepResult {
  const frames = context.frames;
  switch (command.t) {
    case "say":
      return {
        context: {
          ...context,
          frames: advanceTop(frames),
          status: "waiting-advance",
          pendingChoices: null,
          resumeAtTick: null,
        },
        effects: [{ kind: "say", text: command.text, name: command.name }],
      };
    case "choices":
      return {
        // pc stays on the `choices` command; `resumeWithChoice` consumes it once a valid pick lands.
        context: {
          ...context,
          status: "waiting-choice",
          pendingChoices: command.options.length,
          resumeAtTick: null,
        },
        effects: [
          {
            kind: "offerChoices",
            prompt: command.prompt,
            options: command.options.map((option) => option.label),
          },
        ],
      };
    case "setSwitch":
      return {
        context: running(context, advanceTop(frames)),
        effects: [
          {
            kind: "mutateState",
            op: { type: "setSwitch", switchId: command.switchId, value: command.value },
          },
        ],
      };
    case "setVariable":
      return {
        context: running(context, advanceTop(frames)),
        effects: [
          {
            kind: "mutateState",
            op: {
              type: "setVariable",
              variableId: command.variableId,
              op: command.op,
              value: command.value,
            },
          },
        ],
      };
    case "setSelfSwitch":
      return {
        context: running(context, advanceTop(frames)),
        effects: [
          {
            kind: "mutateState",
            op: {
              type: "setSelfSwitch",
              key: selfSwitchKey(context.eventId, command.selfSwitch),
              value: command.value,
            },
          },
        ],
      };
    case "if": {
      const branch = evaluateCondition(command.cond, context.eventId, state)
        ? command.then
        : command.else;
      const frames2 = pushFrame(advanceTop(frames), { commands: branch, pc: 0, kind: "body" });
      return { context: running(context, frames2), effects: [] };
    }
    case "loop": {
      const frames2 = pushFrame(advanceTop(frames), {
        commands: command.body,
        pc: 0,
        kind: "loop",
      });
      return { context: running(context, frames2), effects: [] };
    }
    case "breakLoop":
      return stepBreakLoop(context);
    case "exitRun":
      return { context: finish(context), effects: CLOSE_DIALOGUE };
    case "wait":
      // Clockless: emit the frame count and park; the caller computes and writes `resumeAtTick`.
      return {
        context: {
          ...context,
          frames: advanceTop(frames),
          status: "waiting-timer",
          pendingChoices: null,
          resumeAtTick: null,
        },
        effects: [{ kind: "wait", frames: command.frames }],
      };
    case "teleport":
      return {
        context: running(context, advanceTop(frames)),
        effects: [{ kind: "teleport", mapId: command.mapId, col: command.col, row: command.row }],
      };
    case "changeGold":
      return {
        context: running(context, advanceTop(frames)),
        effects: [{ kind: "changeGold", amount: command.amount }],
      };
    case "changeItems":
      return {
        context: running(context, advanceTop(frames)),
        effects: [{ kind: "changeItems", itemId: command.itemId, count: command.count }],
      };
    case "comment":
      // A no-op beat: consume it and carry on with no effect.
      return { context: running(context, advanceTop(frames)), effects: [] };
  }
}

/**
 * Advance a run by exactly one step and return the new context plus any effects it produced.
 *
 * A step does ONE of two things and always returns bounded work (never loops internally — an empty
 * `loop {}` must not hang a step):
 *  - if the top frame is exhausted (`pc` past its end), resolve the boundary: a `loop` frame RESETS
 *    to pc 0, a `body` frame POPS, and an exhausted ROOT frame ends the run (`done` + closeDialogue);
 *  - otherwise execute the single command at the top frame's pc (see `executeCommand`).
 *
 * A non-`running` context is returned untouched — the caller holds a parked/done run until the
 * external event (advance, choice, timer) resumes it. Pure: same context + state ⇒ same result.
 */
export function stepEventRun(context: RunContext, state: PartyAdventureState): StepResult {
  if (context.status !== "running") return { context, effects: [] };
  const frames = context.frames;
  const top = frames[frames.length - 1];
  if (top === undefined) return { context: finish(context), effects: CLOSE_DIALOGUE };

  if (top.pc >= top.commands.length) {
    if (top.kind === "loop") {
      // Run off the end of a loop body → back to the top of the body. This (not popping) IS the
      // loop; an authored infinite loop resets here forever, one bounded step at a time.
      const reset = [
        ...frames.slice(0, -1),
        { commands: top.commands, pc: 0, kind: "loop" as const },
      ];
      return { context: running(context, reset), effects: [] };
    }
    if (frames.length === 1) {
      // The root program is exhausted: the run is over.
      return { context: finish(context), effects: CLOSE_DIALOGUE };
    }
    // An `if` branch or `choices` option finished: pop back to its parent, resuming after it.
    return { context: running(context, frames.slice(0, -1)), effects: [] };
  }

  const command = top.commands[top.pc];
  if (command === undefined) return { context: finish(context), effects: CLOSE_DIALOGUE };
  return executeCommand(context, command, state);
}

/** Resume a `waiting-advance` run after the player advances a `say` page: flip it back to `running`
 *  so the next `stepEventRun` executes the following command. A context in any other status is
 *  returned unchanged (a stray advance is a no-op, not a crash). */
export function resumeWithAdvance(context: RunContext): RunContext {
  if (context.status !== "waiting-advance") return context;
  return { ...context, status: "running" };
}

/**
 * Resume a `waiting-choice` run with the player's pick, pushing that option's body as a new frame.
 * Returns `null` — so the caller DROPS the intent — when the run is not waiting on a choice or the
 * index is out of range. The range check against the stored `pendingChoices` count is the SOLE
 * validation gate: on a valid index the option is always present, so the `?? []` fallback below is a
 * type-level formality, never taken. That is deliberate — it makes removing the range check
 * observable (a dropped-index test would then get a running context instead of `null`), which is the
 * mutation proof the plan asks for.
 */
export function resumeWithChoice(context: RunContext, index: number): RunContext | null {
  if (context.status !== "waiting-choice") return null;
  const count = context.pendingChoices;
  if (count === null || !Number.isInteger(index) || index < 0 || index >= count) return null;
  const frames = context.frames;
  const top = frames[frames.length - 1];
  if (top === undefined) return null;
  const command = top.commands[top.pc];
  if (command === undefined || command.t !== "choices") return null;
  const option: ChoiceOption | undefined = command.options[index];
  const body = option?.body ?? [];
  const frames2 = pushFrame(advanceTop(frames), { commands: body, pc: 0, kind: "body" });
  return {
    ...context,
    frames: frames2,
    status: "running",
    pendingChoices: null,
    resumeAtTick: null,
  };
}
