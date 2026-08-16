# Adventure state: switches, variables, page selection

Status: design draft, 2026-07-19, written overnight — NOT yet executed. Tranche 4 of
`docs/adventure-editor-roadmap.md`. Decisions below are proposals for morning review; the
structural one (party ownership) was already settled in the roadmap.

## Why

Tranche 3's events carry authored conditions that nothing evaluates. This tranche makes them
true: a party accumulates state (switches, variables, per-event self-switches), the server
selects each event's active page from that state, and heroes finally SEE events in the world.
Still nothing runs commands — an event with a satisfied page simply exists, visibly, at its cell.
The interpreter is tranche 5.

## Settled by the roadmap (not up for relitigation)

**State belongs to the party, not the hero.** A party is the save; four players share one set of
switches. `GameSession` (addressed by `partyId`) owns it; `World` rooms ask and are notified.
Two heroes on different maps must see the same switch flip.

## Proposed decisions (morning review)

**1. The registry.** A per-adventure registry of switches and variables — id (the 4-digit
ordinal), name, kind — authored in the editor (a small "Base de données" precursor: two lists,
add/rename; ids stable once minted). The event dialog's free-text condition ids become validated
pickers over the registry. The registry rides the adventure row (bounded JSON — 200 switches +
200 variables max), not new tables: it is small, atomic with the adventure, and t6's database
screen can normalize later if it ever needs to.

**2. Persistence of live state.** A new D1 table `party_adventure_state` (party_id pk/fk,
switches JSON, variables JSON, self_switches JSON keyed `eventId:A-D`, updated_at), written by
`GameSession` on a debounce (5s, like hero saves) and on party-empty. Fencing: `GameSession` is
already the single coordinator per party — rooms never write state directly; they send mutations
up (there are none until t5 — this tranche only READS state — so the write path is install-only:
load on first room, save on debounce/empty). The fencing question the roadmap flagged becomes
real only in t5 when commands mutate; the design leaves one writer (the coordinator) so that
question stays answered.

**3. Page selection is server-side, XP's rule.** For each event: the ACTIVE page is the
highest-position page whose conditions all hold (XP picks the last satisfied page). No page
satisfied = the event is dormant (not present). Evaluated in the room (`World`) against a
read-only state snapshot pushed by `GameSession` on join and on change; re-evaluated only on
state-change events, not per tick.

**4. Events reach the game client as appearance-only entities.** A new `WorldInfo.events` (and
delta upserts/removals) carrying id, cell, active-page graphic and options — the same
appearance-only rule as `layers` and `elements`. No collision from events in this tranche
(`Traversable` unchecked is honoured in t5 when interaction exists; until then events are
decor). The client renders them via the existing catalogue crop machinery.

**5. Editor side.** The registry editor (two dense lists in a dialog reached from the menu);
the event dialog's condition rows become registry pickers (shadcn Select over the registry,
showing `0001 · name`). The 4-digit wire shape is kept — the registry mints ids inside it.

## Order of work

1. shared: registry types + state types + page-selection rule (pure, mutation-proven).
2. D1: adventure registry column + party_adventure_state table.
3. GameSession: load/own/push state snapshots; World: evaluate pages, expose events in
   welcome/delta (protocol change + client parse).
4. Client render (appearance-only).
5. Editor: registry dialog + condition pickers.
6. Browser pass + docs.

## Non-goals

Command execution, state MUTATION paths (t5 — including self-switch writes), the full database
screen (t6), event movement (t5+), event collision/interaction (t5).
