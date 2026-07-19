# Map events: data and placement

Status: design, 2026-07-19. Tranche 3 of `docs/adventure-editor-roadmap.md`. Written overnight
under standing autonomy; every decision below is reversible and flagged for morning review.

## Why

The wireframe's event dialog is the heart of the RPG Maker model: an event is a thing on the map
with pages, conditions, an appearance, movement, and — later — commands. Tranches 4 and 5 give
events state and behaviour; this tranche gives them existence. Placing, editing and persisting
events, entirely in the editor. **Nothing executes: the game runtime is untouched by this
tranche.** An authored event is invisible to a running party until tranche 4 starts evaluating
page conditions server-side.

## Decisions (each reversible, with the reasoning that picked it)

**1. An event is not a map element.** Elements are catalogue scenery with footprints baked into
collision. Events are addressable, stateful, one-cell entities. They live in their own tables and
their own editor layer (the wireframe's EV button, disabled since tranche 2). Collision: an event
never contributes to `bakeCollision` in this tranche — walkability-by-event-options ("Traversable")
is runtime semantics that belongs to tranche 4+, and baking it now would create collision that
nothing can yet honour.

**2. Event ids are server-minted UUIDs, stable across edits.** Same policy as maps and adventures,
not the author-chosen slug policy markers use. Reasoning: tranche 5's commands will reference
events; a rename must never break a reference, and UUIDs remove the uniqueness burden from the
author. The editor displays the wireframe's friendly `EV001` ordinal, derived from creation order
per map — display only, never identity.

**3. Appearance reuses the Tiny Swords catalogue.** An event page's graphic is an optional
`EditorAssetId` from the existing catalogue (plus "no graphic", the wireframe's blank tile).
No second art-reference scheme. The unit sprites the wireframe shows (warrior, archer…) are already
catalogued; the picker is the palette's existing asset grid, filtered.

**4. Pages are ordered, page 1 mandatory.** A `map_event` owns N `map_event_page` rows ordered by
`position`. Conditions, appearance, movement, options and trigger are PER PAGE (XP semantics).
Page selection at runtime (highest-numbered page whose conditions hold — XP's rule) is tranche 4's
job; this tranche only authors the data.

**5. Conditions are authored as data with no evaluator.** A page's conditions: switch (id),
variable (id, ≥ threshold), self-switch (A-D). Switch/variable IDS are free 4-digit ordinals in
this tranche (the wireframe's `0001`), because the switch/variable REGISTRY is tranche 4's
deliverable. The editor does not validate them against anything yet — recorded as an accepted gap,
closed in tranche 4 when the registry exists.

**6. The wire shape is defensive like everything else.** `parseMapEvents` returns null on
malformed payloads. Events ride the map save (same `/api/maps/:id` PUT) but in their own tables —
the map body cap was re-derived in tranche 1 for layers; events add a bounded payload
(MAX_EVENTS_PER_MAP = 64, MAX_PAGES_PER_EVENT = 8, name ≤ 32 chars, matching the wireframe's
scale) whose worst case must be added to the cap derivation comment.

**7. Editor surface.** The EV layer button becomes real: selecting it shows events as the
wireframe does (sprite + `EV001` chip) on a dedicated stage overlay, and clicks place/select
events. Double-click (or Enter on selection) opens the event dialog. The dialog is the wireframe's,
in stock shadcn: header (name, id/position), page tabs (+ add/delete page), conditions block,
appearance block (graphic picker), autonomous movement block (type/speed/frequency selects —
authored data, no mover exists yet), options block (checkboxes; stored, not yet honoured), trigger
select (the wireframe's five), footer (delete event / cancel / save). The command-list column is
NOT built — its pane shows the tranche-5 placeholder text, disabled.

**8. Persistence model.**

```
map_event       id (uuid pk), map_id (fk cascade), col, row, name, ordinal (int, per-map creation
                order), created_at
map_event_page  id (uuid pk), event_id (fk cascade), position (int),
                cond_switch_id (text null), cond_variable_id (text null),
                cond_variable_min (int null), cond_self_switch (text null, 'A'-'D'),
                graphic_asset_id (text null), move_type (text), move_speed (int),
                move_freq (int), opt_move_anim / opt_stop_anim / opt_dir_fix / opt_through /
                opt_on_top (int 0/1), trigger (text)
```

One event per cell (enforced by unique index on `(map_id, col, row)` — the wireframe replaces on
overlap; the editor moves instead, which is less destructive). Events are saved with the map save
in one batch (chunked per the D1 100-bound-parameter rule tranche 1 hit), fenced by the same map
revision bump.

**9. Editor-state model.** `EditorMap` gains `events: readonly EditorEvent[]`; undo/redo covers
event placement/move/delete; the event DIALOG edits a draft committed as one history entry on
save. The `event` tool joins `EditorTool`. Serialization joins `serializedMap` so dirty tracking
sees events.

## Structure

```
src/shared/map-events.ts        types, limits, parse/validate (both sides)
src/server/db/schema.ts         the two tables
src/server/maps.ts              event load/save joined to the map save transaction
src/client/game/editor-state.ts EditorEvent, the event tool, draft/commit
src/client/game/map-editor-stage.ts EV overlay rendering + hit-testing
src/client/ui/editor/EventDialog.tsx the wireframe dialog, stock shadcn
src/client/ui/editor/...        EV layer button un-disabled, palette section
```

## Testing

Shared: parse/validate totality (null on malformed, bounds, page limits) with mutation proofs.
Server: round-trip through D1 including page order, the unique-cell constraint, cascade delete,
the chunked insert at MAX_EVENTS_PER_MAP (the tranche-1 D1 bug class). Editor-state: placement/
move/delete/undo as single history entries; draft commit atomicity. UI: dialog round-trip of every
field; page add/delete; EV layer toggle. Browser pass: place → edit → save → reload → survive.

## Non-goals

Runtime anything: no page evaluation, no rendering in the game client, no movement, no triggers
firing, no commands. No switch/variable registry (t4). No event copy/paste (later). The
wireframe's "Interrupteur local = ON" runtime meaning (t4).
