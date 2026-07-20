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
  applyStateMutation,
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
 *  change (the triggerer's session inventory). `wait` and the dialogue effects never appear here —
 *  `wait` is resolved into the context's `resumeAtTick` in the drain, and dialogue goes to
 *  `dialogue`. */
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
 * Start a run for a triggered event, or DROP it silently when it cannot begin. Two silent locks
 * apply, both the precedent-following kind (a refusal is never an error the player sees):
 *
 *  - Q4's one-run-per-event lock: an event already holding a live context refuses a second trigger.
 *  - The per-hero dialogue cap (T4 review, WoW's one-conversation-at-a-time): a hero already parked
 *    on a `say`/`choices` panel (`waiting-advance`/`waiting-choice`) cannot open a SECOND dialogue.
 *    The cap is scoped to dialogue-waiting contexts alone — a hero whose only live run is `running`
 *    or `waiting-timer` is mid-execution, not holding a panel, so it never blocks a new trigger.
 *
 * `World` has already resolved that the event's active page holds and carries a non-empty program,
 * and that the hero is in range/on the cell; this owns only the locks.
 */
export function startRun(runtime: EventRunRuntime, params: StartRunParams): boolean {
  if (runtime.contexts.has(params.event.id)) return false;
  for (const context of runtime.contexts.values()) {
    if (
      context.heroId === params.heroId &&
      (context.status === "waiting-advance" || context.status === "waiting-choice")
    ) {
      return false;
    }
  }
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
 *
 * ## One-room state coherence (read-after-write within a drain)
 *
 * The coordinator (`GameSession`) is the single writer and its push is only visible a tick or two
 * later, so stepping every command against the frozen `params.state` snapshot would make a run blind
 * to its OWN just-written switches/variables: `setSwitch X; if X ...` would take the wrong branch and
 * `loop { add 1; if >= 10 break }` would overshoot. We keep a LOCAL working copy, seeded from the
 * snapshot at drain start, and fold each `mutateState` effect into it with the shared pure
 * `applyStateMutation`. Every later step THIS drain — command execution and `if`/waiting-condition
 * evaluation alike — reads that copy, so a run (and other runs in THIS room this tick) sees its own
 * writes immediately. The batch still flows up to the coordinator unchanged; the copy is discarded at
 * drain end. Cross-ROOM propagation stays async by design — a room only reaches strong coherence with
 * itself, and picks up other rooms' writes on the coordinator's next push.
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
  // The drain-local working copy (see the header): steps read their own same-room writes through it.
  let workingState = params.state;

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
      const result = stepEventRun(context, workingState);
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
          // Fold a state write into the drain-local copy BEFORE the next step reads it, then hand the
          // same op up to `World` for the coordinator batch (the durable single-writer path).
          if (effect.kind === "mutateState") {
            workingState = applyStateMutation(workingState, effect.op);
          }
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

/** True for a context parked on a panel (`waiting-advance`/`waiting-choice`) — the only statuses a
 *  connected client actually has a dialogue open for, so the only ones an abort must close. */
function isDialogueParked(context: RunContext): boolean {
  return context.status === "waiting-advance" || context.status === "waiting-choice";
}

/** Abort every run a hero triggered — the life-transition queue-clear precedent, applied on the hero
 *  leaving (disconnect/transition) and on death. Their STALE buffered dialogue (a `say`/`choices`
 *  beat this same tick's drain produced but hasn't reached the wire yet) is dropped, since the run
 *  producing it no longer exists — but a run parked on a panel (`waiting-advance`/`waiting-choice`)
 *  buffers a fresh `closeDialogue` beat first, so a still-connected triggerer (death is the reachable
 *  case; a real disconnect's socket is already gone by the next flush, so the beat is silently
 *  dropped there) gets `event.close` and the panel does not go undismissable. */
export function abortRunsForHero(runtime: EventRunRuntime, heroId: string): void {
  const closes: BufferedDialogue[] = [];
  for (const [eventId, context] of [...runtime.contexts]) {
    if (context.heroId !== heroId) continue;
    if (isDialogueParked(context)) {
      closes.push({
        heroId: context.heroId,
        runId: context.runId,
        message: { kind: "closeDialogue" },
      });
    }
    runtime.contexts.delete(eventId);
  }
  const kept = runtime.dialogue.filter((buffered) => buffered.heroId !== heroId);
  runtime.dialogue.length = 0;
  runtime.dialogue.push(...kept, ...closes);
}

/** Abort the run on one event — used when a state flip changes that event's active page. Ordered
 *  BEFORE page re-evaluation in `World` so no zombie context outlives the page it was reading. A
 *  context parked on a panel (`waiting-advance`/`waiting-choice`) buffers a `closeDialogue` beat
 *  first, so the triggerer's undismissable panel actually closes instead of swallowing interact and
 *  1-4 forever. */
export function abortRunForEvent(runtime: EventRunRuntime, eventId: string): void {
  const context = runtime.contexts.get(eventId);
  if (context !== undefined && isDialogueParked(context)) {
    runtime.dialogue.push({
      heroId: context.heroId,
      runId: context.runId,
      message: { kind: "closeDialogue" },
    });
  }
  runtime.contexts.delete(eventId);
}

/**
 * The distance-close (spec Decision 4, WoW): a run PARKED on a dialogue (`waiting-advance`/
 * `waiting-choice`) whose triggerer has walked beyond `DIALOGUE_CLOSE_RADIUS` of its event ENDS — the
 * panel closes, the conversation is over. `World` owns the positions, so it supplies `isBeyond`,
 * keyed by the parked context; this function owns the bookkeeping that must never touch a socket:
 * buffer one `closeDialogue` beat for the triggerer (the flush sends `event.close`) and delete the
 * context, releasing the lock. Only PARKED-on-dialogue contexts are eligible — a running or
 * waiting-timer context is mid-execution, not waiting on a panel, so walking away does not end it.
 *
 * Ending the run is NOT a state rollback: any switch/variable/self-switch the run already wrote stays
 * written (it flowed up to the coordinator when it executed). Walk-away abandons the REMAINDER of the
 * conversation, exactly as WoW closing a quest dialog keeps whatever the click already committed.
 */
export function closeDistantDialogues(
  runtime: EventRunRuntime,
  isBeyond: (context: RunContext) => boolean,
): void {
  for (const [eventId, context] of [...runtime.contexts]) {
    if (context.status !== "waiting-advance" && context.status !== "waiting-choice") continue;
    if (!isBeyond(context)) continue;
    runtime.dialogue.push({
      heroId: context.heroId,
      runId: context.runId,
      message: { kind: "closeDialogue" },
    });
    runtime.contexts.delete(eventId);
  }
}
