# Adventure state and the event interpreter

Switches, variables, page selection, and the pure clockless stepper that runs authored commands.
Party-owned state, single writer, budgeted drain.

### Adventure state: switches, variables and page selection

An event's conditions read something real. **State belongs to the party, not the hero** â€” a
party is the save, so `PartyRoom` (roomId `partyId`) is the single writer of switches,
variables and per-event self-switches; `WorldRoom`s never write it, they install a read-only
snapshot `PartyRoom` pushes over the same coordinator seam party chat and victory already cross.
Persistence is **write-through**: every accepted mutation batch is saved to the database before
the push (`AdventureStateService`), so the stored row is never behind the coordinator. The
registry â€” switch/variable ids and names, up to 200 of each â€” rides the adventure row as bounded
JSON, not a new table: it is small, atomic with the adventure, and authored entirely in the
editor's registry dialog.

**Page selection is XP's rule, not a per-tick one.** For each event, the active page is the
highest-position page whose conditions all hold; an unknown switch/variable id reads as false/0; no
page holding means the event is dormant. `WorldRoom` evaluates this against the state snapshot on
snapshot install and on hero join â€” **never per tick**; re-evaluation on state-change is the
reason the snapshot push exists at all. A room re-deriving its state (a fresh room, an evicted
isolate) pulls the current `(state, version)` from `PartyRoom` (`getAdventureState`, a reverse RPC
into the coordinator), never from the database directly: the coordinator's held version is the
ordering authority, and reading storage beside it would be a second, uncoordinated reader.

Active events reach the client as `WorldInfo.events` â€” the third member of the `elements`/`layers`
family: id, cell, the active page's appearance and options, **appearance only**. Collision still
comes exclusively from `tiles`; an event carries no collider in this tranche regardless of its
authored "traversable" flag.

**The interpreter mutates state.** `applyStateChanges` on `PartyRoom` is the real single
writer: an event run's `mutateState` effects flow UP as a coordinator RPC, are applied
serially, bump a **monotone `version`** (once per batch) shipped with every snapshot and written
through to the database before the new state is pushed to every room. `installAdventureState`
carries a **`>=` version guard** so a room that receives two pushes out of order keeps the newer
one, and it must **never throw** â€” `PartyRoom` awaits the push, so a throwing install would block
the writer. See
[`docs/archive/specs/2026-07-19-adventure-state-design.md`](./archive/specs/2026-07-19-adventure-state-design.md)
and the interpreter design below.

### The event interpreter

Authored commands are a real language now (tranche 5). `shared/event-commands.ts` is the command
model + total parser; `shared/event-interpreter.ts` is the **pure, clockless stepper**
(`stepEventRun` executes exactly ONE command and returns the new context plus data effects);
`server/world/event-run-system.ts` holds the room's live runs and the budgeted drain;
`client/ui/hud/EventDialoguePanel.tsx` is the per-player panel;
`client/ui/editor/EventCommandEditor.tsx` is the editor's command column. Five contracts bind:

- **The budget is the speed limit.** `drainRuns` executes at most `EVENT_COMMANDS_PER_TICK` (16)
  commands per tick across ALL running contexts, round-robin, then yields. An authored
  `loop { setVariable add }` with no exit consumes its slice and returns â€” the room keeps ticking,
  monsters keep moving, other heroes keep being simulated. This is the same per-tick-budget
  discipline `navigation-system.ts` applies to A*; the mutation proof (remove the cap) is a bounded
  assertion, never a hang. Never make the interpreter drain a whole program in one tick.

- **One run per event, room-local lock.** `EventRunRuntime.contexts` is keyed by `eventId`, and that
  key IS the lock (Q4): while an event holds a live context, a second trigger is dropped silently
  (never an error the player sees). A hero's disconnect, map transition or death aborts their
  contexts (the life-transition queue-clear precedent). A per-hero dialogue cap adds that a hero
  already parked on a `say`/`choices` panel cannot open a second one. Proven end-to-end: two heroes
  triggering one gold chest on the same tick yield exactly ONE grant, not two.

- **Single-writer mutations, with the drain-local working-copy read model.** Durable writes go up to
  the coordinator (above), but a run must see its OWN just-written switches immediately, or
  `setSwitch X; if X â€¦` would take the wrong branch. So the drain keeps a **local working copy**,
  seeded from the snapshot at drain start and folded forward with the shared pure `applyStateMutation`
  after each `mutateState`; every later step THIS tick (command execution and `if`/waiting-condition
  evaluation alike) reads that copy. The batch still flows up unchanged. If the command budget splits
  a run across ticks, `WorldRoom` pauses only the event drain until `PartyRoom` has applied and
  pushed that batch; simulation keeps ticking. The next drain therefore seeds from the acknowledged snapshot,
  never from a pre-batch value that would replay a non-idempotent `add`. Cross-room propagation remains
  asynchronous relative to simulation, but the source run cannot outrun its own coordinator writes.

- **Authored prose is the sanctioned codes-not-sentences exception.** `event.say`/`event.choices`
  carry the author's `text`/`name`/`prompt`/option labels as DATA across the wire (still size-capped
  and defensively parsed both directions) â€” the one exception to "server events are codes", because
  the author wrote it and no dictionary can hold it. The i18n rule keeps governing every CHROME
  string around the panel (Continue, Choose, the hotkey caption). Do not route authored prose through
  an `EventCode`, and do not smuggle a UI label into a `say`.

- **Dialogue is a per-player panel with a distance-close.** A `say`/`choices` beat is wired to the
  TRIGGERER only (`event-run-system` buffers by `heroId`); the other party members' viewports stay
  clean. Movement stays LIVE while the panel is open â€” the panel captures only its own keys (Space /
  the interact key to advance, 1-4 to choose), never WASD or the skills. Each drain tick, a run parked
  on a dialogue whose triggerer has walked beyond `DIALOGUE_CLOSE_RADIUS` (3 tiles) ENDS: the
  panel closes and the conversation is over (WoW's rule). Walk-away is not a state rollback â€” anything
  the run already wrote stays written; it abandons only the REMAINDER.

Triggers are server-detected: the interact key near an `action` event, or a movement box landing on a
`player-touch` event's cell â€” both only for `normal`-kind events with a satisfied active page. The
client only ever sends the existing interact intent and movement; no message selects a run or supplies
an outcome. Gold/items are per-hero and persisted through the same epoch-fenced hero save boundary as
the rest of the normalized inventory. See
[`docs/archive/specs/2026-07-20-interpreter-design.md`](./archive/specs/2026-07-20-interpreter-design.md).
