# The Adventure Editor: where we are and where this goes

A handoff document. Tranche 1 is merged; tranches 2 through 6 are ahead. This is not an
implementation plan — each tranche still earns its own spec and plan. It is the map: what is
already decided and must not be relitigated, what is genuinely open, and where the hard parts are.

The visual target is `wireframes/RPG Editor.dc.html`. Open it. It is the whole editor in one
screen, and it answers more layout questions than any prose here can.

## The shape of the thing

The goal is an RPG Maker XP-class adventure editor living inside the game. **Everything about an
adventure is authored there.** The game itself becomes a runtime: it loads an adventure out of D1
and plays it. Nothing about a specific adventure should end up compiled into the client or the
server.

Six tranches, each ending in something playable:

| | Tranche | State |
| --- | --- | --- |
| 1 | Layered map model + tilesets | **Merged** (`9fdc9b9`) |
| 2 | The editor shell — the wireframe's chrome | **Done** (branch `feature/editor-shell`) |
| 3 | Events: data and placement | |
| 4 | Switches, variables, adventure state | |
| 5 | The command interpreter | The big one |
| 6 | Test button, tileset database, the rest | |

The ordering is not arbitrary. An event must exist before it can have state, and have state before
code can read that state. Tranche 5 is larger than 2, 3 and 4 combined and will likely need its own
sub-decomposition.

## What tranche 1 established, and what now binds you

Terrain was one character per cell over six `TileKind` values, with the sprite derived from
neighbours at draw time. It is now three layers of frozen tile ids over an authored tileset, in the
RPG Maker XP model. `docs/superpowers/specs/2026-07-18-layered-map-model-design.md` has the full
design; `CLAUDE.md`'s "Maps and the editor" section has the short version.

Three rules came out of it that later tranches must not break:

**A tile id's meaning lives in the tileset, not the cell.** Walkable-or-not and drawn-behind-or-in-
front are authored once per tile. That indirection is what keeps collision derivable from
appearance: `tile id → tileset → passable`.

**`WorldInfo.tiles` is collision truth; `WorldInfo.layers` is appearance only.** Same rule
`elements` already followed. An agent that reads `layers` to decide walkability reintroduces exactly
the silent desync the design exists to prevent — nothing in the protocol would complain, the client
would simply draw its own square somewhere the server does not have it.

**Autotiling is a paint-time brush, not a storage format.** The editor freezes the resolved variant,
which is what lets an author override a single tile by hand. The stored variant *is* the neighbour
mask; turning a mask into an atlas cell belongs to the renderer's half of the world.

## Tranche 2 — The editor shell

The wireframe's chrome, on the model tranche 1 built. No new runtime behaviour.

**What shipped.** The `adventures` and `map-editor` screens merged into one `adventure-editor`
screen: menu bar / toolbar / three resizable panes (shadcn `TerrainPalette` left, the painting stage
centre, `MapListPanel` right) / status bar. Adventure metadata moved into
`AdventureSettingsDialog`. Toolbar: new/save/delete, select/pencil/rect/fill/eraser, a layer
selector, grid and dim toggles, zoom, the Test button — plus a stairs stamp, picked from the palette
rather than the toolbar. `activeLayer` now threads from the chrome down to the stage, every tool has
a keyboard shortcut, and the whole shell is stock shadcn: `EditorAssetPalette`, the last Tiny import
inside a creator surface, was deleted along with the pre-merge screens, so the two-tree rule now has
zero exceptions here. The nine missing shadcn components (dialog, select, tabs, checkbox, tooltip,
dropdown-menu, menubar, resizable, scroll-area) are generated; the feared `ui/Tabs.tsx` /
`ui/components/tabs.tsx` name collision turned out not to be one — different directories, one
consumer (`AuthScreen`) of the old one, nothing to decide.

**Discoveries the next tranches inherit:**

- **Locale switching is unavailable inside the editor.** The floating EN/FR toggle and status pill
  are Tiny Swords game chrome anchored bottom-right, and they collided with the editor's own
  bottom-right "Adventure settings" button. `App.tsx` now hides both for the `adventure-editor`
  screen rather than fight the collision. The editor needs its own locale control — a menu-bar item
  is the obvious home — before this is a real gap and not just an omission.
- **Wall upkeep never overwrites a fixed tile.** `syncWall` (`shared/tile-brush.ts`) refuses to
  paint or erase a cliff wall on a cell that already holds a fixed tile (a ramp): an author who wants
  the wall back has to erase the ramp first. This is the same "explicit authoring intent beats
  ambient upkeep" rule the rect and fill tools apply, just in the other direction — see the next
  point.
- **Rect and fill diverge on fixed tiles, deliberately.** A rectangle stroke is explicit authoring
  intent, so it overwrites any fixed tile inside its region exactly like an autotile cell. Flood fill
  is the opposite: an unclicked fixed tile is a barrier the region never crosses — clicking a fixed
  tile itself fills a region of exactly that one cell. Don't unify these; they're solving different
  problems (a stamped rectangle vs. a region that must not leak past a hand-placed tile).
- **Two things were dropped, not deferred.** `makeFirst` (the map panel's "set as first map" action,
  `flagFirstMapApi`) has no UI anywhere in the new shell — the API endpoint is now dead code. The old
  palette's "recent assets" section is also gone; the terrain palette has no equivalent. Neither is
  scheduled to come back; note it here rather than let it surface as a silent regression later.

Ramps are paintable now — the stairs tool stamps the tileset's four ramp fixed tiles onto layer 1,
so tranche 1's "declared but unpaintable" caveat is dead. Fill still has no fill-to-empty primitive;
the palette disables it while water is the active content instead of shipping a dead brush.

## Tranche 3 — Events: data and placement

The event layer. Placing, moving and deleting an event on the map, with its appearance. The event
dialog — pages, spawn conditions, appearance, autonomous movement, options, trigger — but **not**
the command list. Nothing executes yet.

**The data model is the whole task.** An event is not a map element: elements are catalogue assets
with footprints and collision, events are addressable things with pages and state. They want their
own tables — `map_event` for identity and position, `map_event_page` for the pages — because a page
count is unbounded and a JSON blob on the map row would fight the 200 KiB body cap that tranche 1
already had to re-derive once.

**Open decisions worth settling deliberately:**

- **Event id stability.** Markers use server-minted ids matching `/^[a-z0-9][a-z0-9-]{0,31}$/`, and
  the adventure graph binds to them. Events will be referenced by commands in tranche 5, so their
  ids must survive edits the same way. Decide this now, not in tranche 5.
- **What an event looks like.** The wireframe picks from unit sprites. The repo has a full Tiny
  Swords catalogue with stable asset ids and footprints. Reuse it rather than inventing a second
  art-reference scheme.
- **Which page is active is a runtime question**, not an authoring one. Tranche 3 authors the
  conditions; tranche 4 makes the server evaluate them. Resist making the editor decide.

## Tranche 4 — Switches, variables, adventure state

The state an event's conditions read. Global switches and variables per adventure, plus per-event
local switches (XP's A/B/C/D).

**The load-bearing call: this state belongs to the party, not the hero.** A party is the save.
Four players sharing an adventure share one set of switches — that is what makes cooperative
progression coherent, and it is why `GameSession` (addressed by `partyId`) is the natural owner
rather than `World` (addressed by `partyId:mapId`). Two heroes on different maps must see the same
switch.

**Read the fencing model before you design persistence.** `docs/adventure-runtime-architecture.md`
and the hero presence section of `CLAUDE.md` describe how hero saves are fenced by a monotone
`session_epoch` against a SQLite-backed Durable Object lease. Adventure state has the same hazard —
two rooms writing the same switch — and deserves a deliberate answer rather than an accidental one.
"The coordinator owns it and rooms ask" is probably right; prove it rather than assume it.

**The server arbitrates page selection.** A client never says which page of an event is active. That
is the same rule as everywhere else in this codebase: the server decides outcomes.

## Tranche 5 — The command interpreter

The largest tranche by a wide margin. Authored commands become a language, and something runs it
inside a Durable Object.

The wireframe's catalogue is the target vocabulary: show text, show choices, prompt for a number;
set switches and variables; conditions, loops, break, call common event, exit; teleport the hero,
move route, wait; change gold and items; play BGM/SE, fade; comment and script.

**Four things make this hard, and none of them are the parser.**

**1. It runs inside a 20 Hz tick loop.** An authored `while` loop with no exit must not hang a room
— and a room hanging means every player in it disconnects. The interpreter has to be *step-wise*:
it advances a bounded number of commands per tick and yields, keeping its position in a resumable
structure. This is the same discipline `navigation-system.ts` already applies to A* with its
per-tick node budget. Read it; the shape transfers.

**2. Multiplayer is not a detail here, it is the design.** RPG Maker is single-player. This is not.
When one of four players talks to an NPC: does the dialogue appear for everyone, or only them? Can
the other three walk away mid-conversation? If a command teleports "the hero", which hero? If two
players trigger the same event on the same tick, does it run twice?

There are defensible answers to all of these and they are not obvious. **Settle them with the human
before writing a line of interpreter code** — retrofitting a multiplayer answer onto a single-player
interpreter is how this tranche fails.

**3. Blocking is a protocol problem.** A message box that pauses the game means the server must
know a player is waiting, and must not let their movement commands accumulate into a sprint when
the box closes. `World` already clears the command queue on every life transition for exactly this
reason (see the death state machine in `CLAUDE.md`) — the same argument applies.

**4. Every player-facing string must be authored data, not code.** Server events are codes, not
sentences: `{ t: "event", code, params }`, with the client owning all wording via `shared/i18n/`.
But an authored dialogue line *is* prose, written by the adventure's author, and it cannot live in a
dictionary. That is a genuine new case and the i18n boundary needs an explicit answer for it.

**Expect to sub-decompose.** A reasonable split: the command data model and its editor UI; the
interpreter core with only set-switch and conditional; the message/choice protocol and client UI;
then the rest of the vocabulary. Each of those is a tranche-sized piece.

## Tranche 6 — The rest

The Test button (launch the adventure from the editor — `map-preview.ts` already sandboxes a
playable preview, start there). The "Base de données…" screen, which is the tileset editor tranche 1
deliberately shipped as a data file instead. Audio and screen commands. Custom move routes.

Also the deferred tile behaviours: terrain tag, bush, counter. Terrain tag is cheap — one field on a
tileset entry, no map migration — and gains a consumer the moment the interpreter can ask "what is
the hero standing on". Counter needs redesigning for continuous movement rather than transposing
from XP's grid.

## How to work

Tranche 1 was executed with `superpowers:subagent-driven-development`: a fresh subagent per task, a
two-verdict review after each, and a whole-branch review at the end. Keep that. It is why the branch
merged with `simulation.ts`, `prediction.ts` and `tilemap.ts` showing zero diff.

**One practice mattered more than all the others: demand a mutation proof for every test.** Break
the thing the test guards, watch it fail, restore it, watch it pass. Report both runs.

Tranche 1's plan shipped **six tests that passed against broken code**. A property test whose PRNG
overflowed `MAX_SAFE_INTEGER` on its second multiply, degenerating 399 of 400 steps — it passed with
the function under test disabled. A body-cap test that would have passed at any cap above a value it
never reached. A bounds assertion vacuous on a 1×1 fixture. None were caught by the suite going
green. All were caught by mutation.

That rate came from plausible-looking test code written and never executed. Assume the same of any
plan you are handed, including this document's descendants.

Three real bugs also surfaced, two of them pre-existing and invisible for months:

- D1 caps a query at 100 bound parameters; the element insert bound 5 per row in one statement, so
  saving a map failed past ~20 decorations while the declared cap said 400. No test had ever created
  a decorated map.
- `autotileOffset` throws on an out-of-range mask, and nothing bounded a `run4` autotile's variant.
  Ids that passed every validation layer killed the render loop on the first repaint that scrolled
  them into view.
- The save path flattened layers back to the old format, which would have silently eaten every cliff
  wall the moment the editor could write one.

None of these were found by reading. They were found by someone being asked to prove a claim.

**Verify in a browser.** The UI suite runs with `css: false` and mocks the Pixi stage; no test in
this repo can catch a visual regression. Tranche 1's browser pass is what confirmed the sheet swap
landed and the elevation brush actually draws a cliff.

## Known debt, inherited

Tranche 1 merged with these open. None block tranche 2. Judge each when it becomes relevant — the
full record with commit shas is in `.superpowers/sdd/progress.md`.

**Elevation only casts a wall on the south face.** A plateau horizontally adjacent to lower ground
has no cliff and is walkable. Appearance and collision agree, so nothing is broken — but plateaus
are not gameplay barriers in three directions of four. Cheaper to fix while few authored maps exist.

**Two rendering paths.** Compiled catalogue zones (`shared/zones/*`) ship empty layers and keep the
old derived autotile pass; `#updateTerrain` branches on whether an appearance argument was supplied.
Honest debt that dies with the catalogue zones.

**`#tilesAbove` is wired but unexercised.** Every current tileset entry is `priority: "below"`, so
the head-under-treetop effect cannot be demonstrated until a tileset declares an `above` tile.

**Migration `0018` left pre-existing maps unenterable**, not merely blank: all-empty layers bake to
all-water, which is solid, so a hero arrives on a solid spawn. Accepted — POC, no production data.

**Schema and migration disagree on `layers`' column default** (`notNull()` with no default in
`schema.ts`, `DEFAULT ''` in the migration). The next `db:generate` will emit a spurious diff, which
in SQLite means a table recreate nobody asked for. Cheap to reconcile.

**The read path does not validate tile ids against the tileset**, unlike the write path, which does
so twice. A bad row opens the editor blank with no message. Safe but mute.

**`MAX_CELLS` in `tile-layer-codec.ts` duplicates the map size cap** because `shared/` cannot import
`server/`. Fail-closed, but it is one of the "same rule in two places" seams worth closing by moving
the cap into `shared/`.

**Two test gaps worth closing early:** `test/map-layers.test.ts` claims to check "any layer" but only
exercises layer 1 — layer 2 is never tested for collision. And the renderer's tile-priority routing
has no test, while the editor's does, which is backwards: the editor's exists because that exact bug
shipped once already.

## Where to read next

- `CLAUDE.md` — the agent contract. Read it fully before touching anything.
- `wireframes/RPG Editor.dc.html` — the visual target.
- `docs/superpowers/specs/2026-07-18-layered-map-model-design.md` — tranche 1's design.
- `docs/adventure-runtime-architecture.md` — room ownership, routing, presence fencing.
- `docs/superpowers/specs/2026-07-16-map-editor-design.md` — the current editor's spec, which
  tranche 2 supersedes but should not contradict without saying so.
- `.superpowers/sdd/progress.md` — every finding from tranche 1, with commit shas.
