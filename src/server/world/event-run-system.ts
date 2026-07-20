/**
 * The room's live event runs: the registry that owns which authored events are currently executing,
 * the room-local lock that keeps an event to one run at a time, and the per-tick budgeted drain that
 * advances every running context a bounded number of commands. Trigger DETECTION (an interact key
 * near an `action` event, a hero's box landing on a `player-touch` cell) and effect DISPATCH
 * (authoritative teleport, the coordinator mutation RPC) stay in `World`, which owns the positions,
 * the sockets and the coordinator seam; this system owns only the bookkeeping that must never touch
 * a socket, a clock or the coordinator.
 *
 * The interpreter (`shared/event-interpreter.ts`) is the pure stepper; this file is the caller the
 * stepper's module header names — it reads the current tick, fills a `wait`'s deadline, holds the
 * per-event contexts, and returns the effects `World` dispatches. Nothing here is a module global:
 * `World` holds one `EventRunRuntime` per room and clears it when the room empties, so two rooms
 * never share a run — the same isolation discipline `navigation-system.ts` follows for its A* state.
 *
 * ## The budget is the speed limit (spec Decision 2)
 *
 * `drainRuns` executes at most `EVENT_COMMANDS_PER_TICK` (16) commands per tick across ALL running
 * contexts, round-robin. An authored `loop { setVariable add }` consumes its slice and never hangs
 * the room: the drain always returns after `budget` steps, so the tick loop keeps running, monsters
 * keep moving and OTHER heroes keep being simulated. This is the load-bearing invariant — the tick
 * budget is sacred — and the mutation proof (remove the cap) is a fast, bounded assertion, never a
 * hang: `drainRuns` on a finite over-budget program returns exactly `budget` effects.
 */

import type { PartyAdventureState } from "../../shared/adventure-state.js";
import { EVENT_COMMANDS_PER_TICK, type EventCommand } from "../../shared/event-commands.js";
import {
  type EventEffect,
  type RunContext,
  resumeWithAdvance,
  resumeWithChoice,
  startEventRun,
  stepEventRun,
} from "../../shared/event-interpreter.js";
import type { MapEvent } from "../../shared/map-events.js";

/** A dialogue beat buffered for its triggerer. Task 4 sends these on the wire; THIS task exposes
 *  them through `World.roomDiagnostics()` so the real-DO tests can assert a conversation without the
 *  protocol existing yet. The seam is deliberate: a run's `say`/`offerChoices`/`closeDialogue`
 *  effects never enter a socket here, they only accumulate. `heroId` is the triggerer the panel
 *  belongs to (Decision 4: dialogue is a per-player panel). */
export type DialogueMessage =
  | { readonly kind: "say"; readonly text: string; readonly name: string | null }
  | { readonly kind: "offerChoices"; readonly prompt: string; readonly options: readonly string[] }
  | { readonly kind: "closeDialogue" };

export interface BufferedDialogue {
  readonly heroId: string;
  readonly runId: string;
  readonly message: DialogueMessage;
}

/** An effect the drain hands back to `World` to dispatch with its authority: a state mutation (up to
 *  the coordinator), a teleport (authoritative position set / cross-map handoff), or a gold/items
 *  change (parked for tranche-5 Task 5). `wait` and the dialogue effects never appear here — `wait`
 *  is resolved into the context's `resumeAtTick` in the drain, and dialogue goes to `dialogue`. */
export interface DispatchEffect {
  readonly heroId: string;
  readonly runId: string;
  readonly eventId: string;
  readonly effect: Extract<
    EventEffect,
    | { kind: "mutateState" }
    | { kind: "teleport" }
    | { kind: "changeGold" }
    | { kind: "changeItems" }
  >;
}

/**
 * The room's live run state. `contexts` is keyed by `eventId` — that key IS the lock (Q4): an
 * event with a live context refuses a second trigger. `dialogue` accumulates buffered beats for the
 * diagnostics/test seam described above; Task 4 will drain it onto the wire.
 */
export interface EventRunRuntime {
  readonly contexts: Map<string, RunContext>;
  readonly dialogue: BufferedDialogue[];
}

export function createEventRunRuntime(): EventRunRuntime {
  return { contexts: new Map(), dialogue: [] };
}

/** Discard every run and buffered beat — called when the room empties (the navigation-runtime reset
 *  precedent), so a re-used World never resumes a departed party's conversation. */
export function resetEventRunRuntime(runtime: EventRunRuntime): void {
  runtime.contexts.clear();
  runtime.dialogue.length = 0;
}

export interface StartRunParams {
  readonly event: MapEvent;
  readonly pageIndex: number;
  readonly program: readonly EventCommand[];
  readonly heroId: string;
  readonly runId: string;
}

/**
 * Start a run for a triggered event, or DROP it silently when the event already has a live context
 * (Q4's one-run-per-event lock). `World` has already resolved that the event's active page holds and
 * carries a non-empty program, and that the hero is in range/on the cell; this only owns the lock.
 */
export function startRun(runtime: EventRunRuntime, params: StartRunParams): boolean {
  if (runtime.contexts.has(params.event.id)) return false;
  runtime.contexts.set(
    params.event.id,
    startEventRun({
      runId: params.runId,
      eventId: params.event.id,
      pageIndex: params.pageIndex,
      heroId: params.heroId,
      program: params.program,
    }),
  );
  return true;
}

export interface DrainResult {
  readonly effects: DispatchEffect[];
  /** Commands actually executed this tick — pinned by the starvation test to `EVENT_COMMANDS_PER_TICK`. */
  readonly used: number;
}

/**
 * Advance every running context by up to `budget` commands total, round-robin, and return the
 * authority-needing effects for `World` to dispatch. Called once per tick, AFTER movement/combat so
 * the effects it produces (a teleport especially) act on final authoritative positions.
 *
 * Order within the drain:
 *  1. Wake any `waiting-timer` context whose `resumeAtTick` has arrived (a `wait` finished). The wake
 *     itself costs no budget — it is a resume, not a command.
 *  2. Round-robin: one step per running context per pass, until the budget is spent or no running
 *     context can progress. `waiting-advance`/`waiting-choice` contexts are SKIPPED — they resume
 *     only through `advanceRun`/`chooseRun` (Task 4's intents). A `wait` command parks its context in
 *     `waiting-timer`; the drain fills `resumeAtTick = tick + frames` (frames are 20Hz ticks, 1:1).
 *  3. A `done` context is deleted, releasing the lock.
 */
export function drainRuns(
  runtime: EventRunRuntime,
  params: {
    readonly state: PartyAdventureState;
    readonly tick: number;
    readonly budget?: number;
  },
): DrainResult {
  const budget = params.budget ?? EVENT_COMMANDS_PER_TICK;
  const effects: DispatchEffect[] = [];

  // (1) Timers first: a wait whose deadline has passed rejoins the running set for this same drain.
  for (const [eventId, context] of runtime.contexts) {
    if (
      context.status === "waiting-timer" &&
      context.resumeAtTick !== null &&
      params.tick >= context.resumeAtTick
    ) {
      runtime.contexts.set(eventId, { ...context, status: "running", resumeAtTick: null });
    }
  }

  // (2) Round-robin drain. Snapshot the key order each pass; deletions during the pass are fine.
  let used = 0;
  while (used < budget) {
    let progressed = false;
    for (const eventId of [...runtime.contexts.keys()]) {
      if (used >= budget) break;
      const context = runtime.contexts.get(eventId);
      if (context === undefined || context.status !== "running") continue;
      const result = stepEventRun(context, params.state);
      used += 1;
      progressed = true;
      for (const effect of result.effects) {
        if (
          effect.kind === "say" ||
          effect.kind === "offerChoices" ||
          effect.kind === "closeDialogue"
        ) {
          runtime.dialogue.push({ heroId: context.heroId, runId: context.runId, message: effect });
        } else if (effect.kind !== "wait") {
          effects.push({ heroId: context.heroId, runId: context.runId, eventId, effect });
        }
      }
      // (2) A `wait` leaves the stepper's context in `waiting-timer` with `resumeAtTick` null; the
      // caller owns the clock, so fill the deadline now. Frames are ticks at 20Hz — a 1:1 map.
      let next = result.context;
      if (next.status === "waiting-timer" && next.resumeAtTick === null) {
        const waited = result.effects.find((effect) => effect.kind === "wait");
        const frames = waited !== undefined && waited.kind === "wait" ? waited.frames : 1;
        next = { ...next, resumeAtTick: params.tick + frames };
      }
      // (3) A finished run releases its lock; anything else is held for the next pass/tick.
      if (next.status === "done") runtime.contexts.delete(eventId);
      else runtime.contexts.set(eventId, next);
    }
    if (!progressed) break;
  }

  return { effects, used };
}

/** Find a running context by its wire `runId` (dialogue intents carry `runId`, the lock is by
 *  `eventId`). Contexts are few, so a scan is cheaper than a second index. */
function findByRunId(
  runtime: EventRunRuntime,
  runId: string,
): { eventId: string; context: RunContext } | null {
  for (const [eventId, context] of runtime.contexts) {
    if (context.runId === runId) return { eventId, context };
  }
  return null;
}

/**
 * Resume a `say` page after the triggerer advances it (Task 4 wires the `event.advance` intent to
 * this). Validates the hero IS the triggerer — a stray advance from anyone else drops. Returns true
 * when the run resumed. Contexts are never serialized/rehydrated (they live only in room memory), so
 * `resumeWithAdvance` reads live state, not a stored count.
 */
export function advanceRun(runtime: EventRunRuntime, heroId: string, runId: string): boolean {
  const found = findByRunId(runtime, runId);
  if (found === null || found.context.heroId !== heroId) return false;
  const next = resumeWithAdvance(found.context);
  if (next === found.context) return false;
  runtime.contexts.set(found.eventId, next);
  return true;
}

/**
 * Resume a `choices` page with the triggerer's pick (Task 4 wires `event.choose`). Validates the
 * hero is the triggerer, then delegates to `resumeWithChoice`, which RE-DERIVES the option from the
 * `choices` command at the context's pc and range-checks the index — never trusting a stored count
 * (the TASK 3 OBLIGATION: even were a context ever rehydrated, the pending choices come from the
 * command, not a carried number). Returns true when the pick landed.
 */
export function chooseRun(
  runtime: EventRunRuntime,
  heroId: string,
  runId: string,
  index: number,
): boolean {
  const found = findByRunId(runtime, runId);
  if (found === null || found.context.heroId !== heroId) return false;
  const next = resumeWithChoice(found.context, index);
  if (next === null) return false;
  runtime.contexts.set(found.eventId, next);
  return true;
}

/** Abort every run a hero triggered — the life-transition queue-clear precedent, applied on the hero
 *  leaving (disconnect/transition) and on death. Their buffered dialogue is dropped too: there is no
 *  panel left to receive it. */
export function abortRunsForHero(runtime: EventRunRuntime, heroId: string): void {
  for (const [eventId, context] of [...runtime.contexts]) {
    if (context.heroId === heroId) runtime.contexts.delete(eventId);
  }
  const kept = runtime.dialogue.filter((buffered) => buffered.heroId !== heroId);
  runtime.dialogue.length = 0;
  runtime.dialogue.push(...kept);
}

/** Abort the run on one event — used when a state flip changes that event's active page. Ordered
 *  BEFORE page re-evaluation in `World` so no zombie context outlives the page it was reading. */
export function abortRunForEvent(runtime: EventRunRuntime, eventId: string): void {
  runtime.contexts.delete(eventId);
}
