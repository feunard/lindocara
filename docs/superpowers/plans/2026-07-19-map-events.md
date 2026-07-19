# Map Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authored map events — placement, the page-based event dialog, D1 persistence — with zero runtime effect on the game.

**Architecture:** `shared/map-events.ts` owns types and defensive parsing; two D1 tables ride the map save transaction; the editor gets an EV overlay, an event tool, and the wireframe's dialog in stock shadcn. Spec: `docs/superpowers/specs/2026-07-19-map-events-design.md` (Decisions bind).

## Global Constraints

Same as the editor-shell plan, all still in force: `.js` imports; Biome semicolons; no `!`; `noUncheckedIndexedAccess`; `noUnusedParameters`; `src/shared/` platform-free; wire parsing returns null, never throws; two-tree rule (editor = stock shadcn); i18n keys both languages; `src/client/game/` no React; `#stage` untouched by React; every test mutation-proven in the implementer's report; D1 writes chunked under 100 bound parameters; D1 tests truncate in `afterEach` children-before-parents; `npm run typecheck` green before every commit, full `npm run check` green at the end of every task (this plan has no red-window: each task is additive).

Limits (shared constants, single source in `map-events.ts`): `MAX_EVENTS_PER_MAP = 64`, `MAX_PAGES_PER_EVENT = 8`, `EVENT_NAME_MAX = 32`.

---

### Task 1: `shared/map-events.ts` — types, limits, parsing

`EventTrigger = "action" | "player-touch" | "event-touch" | "auto" | "parallel"`; `MoveType = "fixed" | "random" | "approach" | "custom"`; `SelfSwitch = "A" | "B" | "C" | "D"`. `MapEventPage` (all condition fields nullable; graphic nullable `EditorAssetId`; move speed 0-5, freq 0-4; five boolean options; trigger). `MapEvent { id, col, row, name, ordinal, pages: readonly MapEventPage[] }` — pages non-empty, ≤ MAX. `parseMapEvents(value, cols, rows): MapEvent[] | null` — total, bounds-checked, id shape checked (uuid), duplicate-cell rejected, unknown `graphic_asset_id` rejected via `isEditorAssetId`. `validateEventName` trims and bounds. Tests: totality table (each malformed field → null), bounds, duplicate cell, page count, mutation proofs on the duplicate-cell and bounds branches. Follow the shape and idioms of `parseMapMarkers` in `shared/map-data.ts`.

### Task 2: D1 schema + migration

The spec's two tables in `src/server/db/schema.ts` (drizzle), `npm run db:generate`, apply locally. Unique index `(map_id, col, row)` on `map_event`; FK cascades map→event→page; `position` unique per event. POC: no data preservation concerns. Test in `test/db.test.ts` style: insert/cascade/unique-violation.

### Task 3: server save/load joined to the map save

`src/server/maps.ts`: `MapInput` gains `events?: readonly MapEvent[]`; `validateMapInput` validates them (limits, cells inside the map, standing on any terrain — events float above collision by design; spawn-cell overlap is allowed, they are different planes). Save path: delete-and-reinsert events+pages inside the same `db.batch` as elements, chunked ≤ 100 params per statement (derive chunk size from params-per-row; the tranche-1 bug class). Load: `StoredMap` gains `events`. HTTP: `parseMapBody` accepts the events field via `parseMapEvents`; `mapResponseBody` returns it; **re-derive `MAX_MAP_JSON_BYTES`'s worst case** to include 64 events × 8 pages and update the derivation comment (do the arithmetic in the comment). Tests: round-trip incl. page order; chunked insert at the full 64×8 worst case with a mutation proof restoring an unchunked insert (must fail with `too many SQL variables`); body-cap accept test extended to include the event worst case.

### Task 4: editor-state — the event tool and draft

`EditorMap.events`; `EditorTool` gains `{ kind: "event" }`; placement on empty cell (mints a client-side temporary id — the SERVER mints final uuids on save; the temp-id→uuid swap happens on save response; test that references survive the swap... actually simpler and better: mint the uuid CLIENT-side with `crypto.randomUUID()` and the server accepts client uuids for NEW events on a map it owns — decide by reading how elements/markers do idempotency today and match the existing pattern; state the choice in the report), move by drag with the select tool, delete via eraser topmost-first (events are topmost above elements/markers), each one history entry; `ordinal` assigned per map monotonically. The dialog edits a DRAFT: open→copy, save→one history entry, cancel→discard. Serialization includes events (dirty tracking). Tests: each operation one undo entry; draft atomicity (edit two fields, cancel, nothing changed); eraser precedence event>element>marker; mutation proofs.

### Task 5: stage EV overlay

`map-editor-stage.ts`: an events overlay container (sprite from the catalogue crop, or the wireframe's dashed placeholder box when no graphic; `EV{ordinal}` chip) shown while the event tool or EV layer is active, hidden otherwise; hit-testing for select/double-click through the existing pointer path; selection outline. Rendering only — no game renderer changes. Tests at the `paintLandCell`-style extracted-function level (the file's established pattern for jsdom-testable stage logic) + mutation proofs (chip shows wrong ordinal; overlay visible when EV inactive).

### Task 6: the EV layer button + palette

Un-disable the `EV` slot in the toolbar layer group (it becomes the event-tool toggle, wireframe Mode menu item too); palette gains an Événements section only while EV is active (the wireframe's unit choices = catalogue filter over the unit domain). i18n keys both languages. Tests: EV toggle activates the event tool + overlay flag on the handle; mutation proof.

### Task 7: EventDialog.tsx

The wireframe dialog in stock shadcn: header (name input, `EV{ordinal}` + cell), page tabs (add/delete, ≤ 8, delete disabled at 1), conditions block (three optional rows: switch id text-input enabled by checkbox; variable id + ≥ threshold; self-switch select A-D), appearance (graphic picker = filtered catalogue grid + none), movement (three selects), options (five checkboxes), trigger (five options), footer (delete event danger btn / cancel / save). Command column: disabled pane with a `t()` placeholder naming tranche 5. Opens on double-click from the stage (thread through the handle callback) and Enter on selection. All strings i18n both languages. Tests: full field round-trip through the draft; page add/delete bounds; open-from-stage wiring; mutation proofs (save writes to the wrong page; delete-page removes the wrong index).

### Task 8: browser pass + docs

Playwright (harness in the scratchpad; dev server pattern established): place two events, open dialog, fill every block across two pages, save, reload, reopen — everything survives; EV overlay toggles; console clean. Screenshots. Update CLAUDE.md (events exist, editor-only, ids are uuids, nothing executes) and the roadmap (tranche 3 state + discoveries). Full `npm run check`.

---

**Final:** whole-branch review (opus) with the ledger, fix wave if needed, merge to main after reconciling origin, push, ledger closed.
