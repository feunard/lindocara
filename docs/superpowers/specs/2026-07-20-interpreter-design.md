# The command interpreter

Status: design, 2026-07-20. Tranche 5 of `docs/adventure-editor-roadmap.md`. Built on the settled
multiplayer answers (`2026-07-19-interpreter-questions.md`, WoW compass) and tranche 4's recorded
obligations. This is the largest tranche; it ships in six tasks, each independently green.

## What ships, and what deliberately does not

**The tranche-5 vocabulary** (the wireframe's catalogue filtered by the settled answers):
show text · show choices · set switch · set variable (set/add) · set self-switch · conditional
(switch / variable ≥ / self-switch, with else) · loop · break loop · exit event processing ·
wait (N frames at 20Hz) · teleport the hero (the TRIGGERER, same-map or cross-map via the
existing handoff) · change gold (± on the triggerer) · change items (± on the triggerer) ·
comment (no-op).

**Deferred, recorded:** audio/screen commands and move routes (t6); « Appeler un événement
commun » (needs a common-event registry — t6); « Saisir un nombre » (minor dialogue primitive —
t6); Automatique/Processus parallèle triggers (Q6); event-touch trigger (inert while events
cannot move — player-touch covers the static case); event movement itself.

**Triggers live:** Touche action (the interact key near an `action` event) and Contact avec le
héros (walking onto the event's cell). Both server-detected; the client only ever sends the
existing interact intent and movement.

## The decisions that shape the runtime

**1. Execution is room-local; state writes go up.** An event lives on exactly one map, so its
run executes in that map's `World` room. Commands that mutate switches/variables/self-switches
emit mutations UP to `GameSession` (the single writer, per tranche 4), which applies them and
pushes the new snapshot to all rooms. The tranche-4 seam (`#applyStateChange`, commented as
"t5's entry point") becomes real. The tranche-4 obligations bind here: a **monotone snapshot
version with a `>=` guard** in `installAdventureState` (rooms may receive pushes out of order);
the **never-throw guarantee** on the install path (it gates admission); **`ctx.storage.setAlarm`**
replaces the `setTimeout` debounce so a coordinator eviction cannot lose a flip.

**2. The interpreter is a pure stepper in `shared/`, budgeted in the tick.** A running context is
`{ eventId, pageIndex, heroId, pc, loopStack, status }` where status is `running | waiting-choice
| waiting-timer | done`. `stepEventRun(context, program, state, services)` executes ONE command
and returns the new context plus zero or more effects (say-text, offer-choices, mutate-state,
teleport, give-gold, give-items). `World` drains at most `EVENT_COMMANDS_PER_TICK = 16` commands
per tick across all running contexts (the `navigation-system` budget discipline); `wait` parks a
context on a tick deadline; an authored infinite loop consumes its budget slice and never hangs
the room. Pure stepper = replayable in tests without a DO.

**3. One run per event, ignored re-triggers (Q4).** The lock is room-local (`Map<eventId,
RunContext>`): while an event has a live context, further triggers are dropped silently. A
hero's disconnect or map transition aborts their contexts (the command queue clear on life
transitions is the precedent).

**4. Dialogue is a per-player UI panel (Q1/Q2, WoW).** New protocol messages, all size-capped
and defensively parsed: server→client `event.say { runId, text, name? }` and `event.choices
{ runId, prompt, options[] }`; client→server `event.advance { runId }` and `event.choose
{ runId, index }` (validated against the pending offer; anything else drops). **Authored prose
crosses the wire as data** — the one sanctioned exception to codes-not-sentences, because the
author wrote it and no dictionary can hold it; the i18n rule keeps governing all CHROME around
the panel. Movement stays free; the server closes the run's dialogue when the triggerer moves
beyond `DIALOGUE_CLOSE_RADIUS = 3 * TILE_SIZE` of the event (and the client mirrors the close).
No queue freeze — nothing to un-freeze (Q2-A).

**5. Gold and items are per-hero and session-only (Q5).** `gold` joins the hero's session
runtime (born 0, HUD-displayed, never yet persisted — exactly like inventory; the durable-hero
migration remains future work, recorded). Item changes route through the existing per-hero
inventory.

**6. Commands persist as a bounded JSON column on the page.** `map_event_page.commands` TEXT —
an ordered array, `MAX_COMMANDS_PER_PAGE = 200`, text fields ≤ 200 chars, choices ≤ 4 options.
Total parser (`parseEventCommands`) on every boundary; the map body cap gets its worst case
re-derived AGAIN (the tranche-1/3 discipline — show the arithmetic). Only `normal` events carry
commands; the parser rejects commands on entry/exit/monster kinds.

**7. The editor's command column comes alive.** The wireframe's right pane in EventDialog:
the command list (monospace lines, selectable), the Insérer palette (categories from the
wireframe, minus the deferred), per-command param editors (text area for say, options editor
for choices, registry pickers for switch/variable, cell picker for teleport reusing the map
panel's affordances, number inputs with the blur-normalize precedent), reorder, delete.
Conditionals and loops indent their bodies the way the wireframe shows.

## Structure

```
src/shared/event-commands.ts     command model, limits, total parser
src/shared/event-interpreter.ts  the pure stepper + effects
src/server/world/event-run-system.ts  contexts, budget, trigger detection, effect dispatch
src/server/game-session.ts       real #applyStateChange: version, alarm, guard
src/shared/protocol.ts           event.say/choices/advance/choose + caps
src/client/ui/hud/EventDialoguePanel.tsx  the per-player panel (Tiny tree — game UI)
src/client/ui/editor/EventCommandEditor.tsx  the dialog's command column (shadcn tree)
```

## Testing

The stepper: a command-table test per opcode plus program-level tests (loop with break; nested
conditional; budget starvation — an infinite loop yields exactly budget commands per tick and
the room ticks on), all mutation-proven. The lock: double-trigger same tick → one run. State
mutations: flip in room A visible in room B through the coordinator (extends the t4 runtime
suite); version guard drops an out-of-order install. Dialogue: full protocol round-trip against
the real DO (say → advance → choices → choose → effects); distance-close. Teleport cross-map
rides the existing handoff tests' patterns. Editor: author → save → reload → identical program;
the insert palette only offers the t5 vocabulary. End: a campaign scene — a door NPC whose
choice flips switch 0001, observed by the second hero on another map.

## Non-goals

Everything in the deferred list; event pathfinding/movement; persistence of gold/inventory;
common events; any change to combat, collision or the one-command-per-tick movement contract.
