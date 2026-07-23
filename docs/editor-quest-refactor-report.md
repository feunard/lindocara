# Editor and structured quest refactor report

This report records the final state of the editor/quest audit completed in July 2026. It complements
the implementation tests and `structured-quest-model.md`; it is not a replacement for the shared
engine rules.

## Audit findings and corrections

### Authoring and persistence

- A double save could pass through the React render gap and submit the same map revision twice. A
  synchronous save lock now closes that window.
- Edits made while a save was in flight could be marked clean, and stale async map loads could
  replace a newer selection. Saves now acknowledge the captured snapshot only, while generation
  guards reject out-of-order loads.
- A map-list refresh could roll adventure metadata or the registry back to an older response. The
  refresh now merges only map membership/name/revision data into the latest editor session.
- First save used separate name/content operations and could leave a partial result. Name, content,
  elements and events now share one map transaction.
- Two writers could both pass the revision preflight before destructive child-row rewrites. The map
  row now carries a write token asserted inside the D1 batch, so only one revision owner can mutate
  children.
- Map creation, rename, deletion and navigation remained actionable during a save. These actions are
  locked until the authoritative revision returns, with loading, empty and error states preserved.

### Runtime parity and creator clarity

- Event triggers left over from older editor models were selectable even though the runtime did not
  execute them. Legacy values remain readable for migration, but saving is blocked until the creator
  converts them to Action or Player touch.
- Two controls called "Spawn" represented different concepts. They are now "Map fallback / preview"
  and the global "Adventure start", with visible explanations.
- Controls that could not act on the current mode/empty target are disabled instead of remaining
  visually active. Keyboard shortcuts are still gated by focus, dialogs and stage readiness.
- Returning from a game session targeted removed `party`/`characters` screens and produced a blank
  client. Both return paths now lead to the resumable-save screen and clear the active party.
- Area and activity objectives were authorable but had no server fact source. Typed event commands,
  guided bindings, semantic validation and real runtime dispatch now make both paths executable.
- Kill objectives could appear valid with no matching monster on their permitted maps, while a
  precise target could silently become a normal event. Shared validation now checks the authored
  monster catalogue per map and blocks full test when either target is impossible.
- Authored parties inherited the compiled demo quest in their HUD. The legacy tracker is now shown
  only for rollback catalogue sessions; created adventures display only their own journal/tracking.

### Quests

- The former registry editor exposed essentially free-form labels and manual counters behind an
  obscure event flow. It was replaced by a first-class searchable quest workspace.
- Quest definitions now include stable ids, authoring versions, scope, lifecycle policy,
  prerequisites, structured objectives, state-specific dialogue and typed rewards. Legacy JSON is
  converted explicitly and active attempts pin their accepted definition.
- Automatic progress is server authoritative and indexed by species, precise target, item, event,
  map, area and activity. No quest scan runs in the world tick.
- Givers, turn-in targets and interaction objectives use named event pickers and guided "Make
  interactive" actions. The server derives per-player quest markers.
- Turn-in, delivery consumption, completion and rewards are protected by a unique claim and one D1
  batch. Automatic completion uses the same claim path.
- The client now has state-aware quest dialogue, a journal, tracked-objective HUD, abandonment and
  immediate progress/reward notices.
- "Test" now creates an isolated, resettable, expiring save on the real adventure runtime. It can
  start at the adventure beginning or a selected map without touching the creator's real saves.

## Data changes and compatibility

- `0028_legal_the_call.sql` adds the map write token used by concurrent revision fencing.
- `0029_milky_skin.sql` adds the unique authored-quest reward claim and recipient index.
- `0030_bizarre_spencer_smythe.sql` adds hidden, expiring adventure test sessions.
- Quest schema v2 remains inside bounded adventure/state JSON. Total parsers convert legacy
  definitions and progress; completed legacy rows are marked rewarded to prevent retroactive grants.
- Existing event commands remain readable. `advanceQuest` is intentionally restricted to migrated
  manual objectives, so old content keeps working without bypassing structured rules.

## Verification coverage

The automated suite covers parsing and migration, semantic validation, quest indexes, sequential
objectives, group credit, duplicate event ids, inactive/completed quests, map restrictions,
inventory counting, reconnect persistence, stale session fences, multiple matching objectives,
missing monster targets, atomic delivery/reward claims, bound dialogue, markers, journal
presentation, editor bindings and disposable test-session ownership/cleanup.

The real Durable Object harness additionally covers the complete authored flow: accept at a bound
giver, kill ten spear goblins over two maps with a real handoff, observe automatic progress, turn in
at the bound target, receive XP/gold exactly once, reconnect and restore the completed state. A
two-player case verifies shared credit and idempotency. Area contact and activity completion also run
through authored events and the real coordinator.

Final acceptance was run against the finished tree:

- `npm run check`: catalogue and generated maps unchanged, lint/typecheck green, 165 test files and
  1,645 tests passed;
- `npm run build`: deployable Worker and production client bundles built successfully;
- `npm run db:migrate`: local D1 reported every committed migration already applied;
- production-browser walkthrough: main quest navigation, structured kill editor, impossible-monster
  diagnostic, clarified spawn copy, isolated full test launch/reset/return and the authored-party HUD
  were exercised with no browser console errors. The temporary adventure and test save were deleted.

## Deliberate non-blocking boundaries

- A named area is currently an authored player-touch event anchor, not a polygon drawing tool.
- Activity completion is a typed, server-emitted event fact; specialised arena/defence subsystems can
  emit the same fact later without changing quest data.
- Escort, timed survival, branching and multi-stage failure authoring are extension points rather
  than shipped objective editors. Optional, hidden and sequential objectives are already represented.
- The isolated editor test party is single-player. Multiplayer authority is exercised by the real
  Durable Object integration harness and normal party runtime, keeping disposable creator tests
  deterministic.
- The production build still reports its pre-existing large main-chunk/dynamic-import optimisation
  warnings. They do not affect loading or runtime behaviour; further route-level code splitting is a
  performance follow-up, not an editor or quest correctness blocker.
