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
| 3 | Events: data and placement | **Done** (branch `feature/map-events`) |
| 4 | Switches, variables, adventure state | **Done** (branch `feature/adventure-state`) |
| 4.5 | UX feedback wave | **Done — exit gate cleared** (`feature/ux-wave`, Task 6) |
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

**What shipped.** `shared/map-events.ts` (types, limits, a total defensive parser) plus
`map_event`/`map_event_page`, their own tables rather than a JSON blob on the map row, because a
page count is unbounded and would have fought the body cap tranche 1 already had to re-derive once.
Events ride the same `db.batch` as the map save, chunked under D1's 100-bound-parameter cap — the
tranche-1 bug class, this time caught by a test before it shipped. An event is a client-minted uuid
(stable so tranche 5's commands can reference it, unlike a marker's server-minted slug) plus a
per-map creation-order ordinal (`EV001`, display only, never identity) and 1–8 pages of
conditions/appearance/movement/options/trigger. The EV tool, the stage overlay and `EventDialog.tsx`
(stock shadcn, the command-list pane disabled with a tranche-5 placeholder) are editor-only —
nothing executes; the game runtime is untouched. Browser-verified: place two events, fill every
block across two pages, save, reload, reopen — everything survives, zero console errors. One real
bug found and fixed on that pass, not by any test: Radix portals `DialogContent` to `document.body`,
outside `.editor-root`, so bare `<button>`/`<input>` nested inside a `[data-slot]` container had no
`data-slot` of its own and was repainting as a green Tiny Swords pill; the `legacy.css` fence now
also exempts `[data-slot] *` (`f7ddc63`).

**Discoveries the next tranches inherit:**

- **The catalogue has no unit/character domain.** The wireframe picks an event's appearance from
  warrior/archer-style unit sprites; the repo's Tiny Swords catalogue has no such category, so the
  graphic picker offers the full catalogue instead (scenery, props, everything) rather than a
  filtered unit set. Adding real units is an art task — extending the generated catalogue — not an
  editor task; nothing here blocks it, but nothing here does it either.
- **Switch/variable ids are authored, not registered, yet.** A page's condition ids are free 4-digit
  strings, validated in shape only (`/^\d{4}$/`). Tranche 4's registry is what closes the loop —
  until then an author can type an id nothing reads.
- **Page identity is `(event_id, position)`.** The D1 row also has its own server-minted primary
  key, unused as identity today. Affirmed forward-compatible: giving a page a durable id later is a
  column addition, not an identity migration.
- **The eraser is now strict one-plane-per-stroke**: event beats element beats marker beats terrain,
  first match wins, never multiple planes in one stroke. A disclosed UX change from the prior
  eraser, worth a human nod rather than a silent behavior shift.
- **Tranche 4's obligations, recorded in the ledger** (`.superpowers/sdd/progress.md`): client
  event serialization must emit explicit `null` condition fields, never omit the key — the wire
  parser rejects an absent field on purpose, so "no condition" and "malformed" stay distinguishable.
  And the map's next-event-ordinal is display-only: deleting the highest-ordinal event and adding a
  new one reuses that ordinal, which is fine for a chip but would be wrong as an identity.

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

**What shipped.** `GameSession` is the single writer of party-owned switches, variables and
per-event self-switches; `World` rooms hold a read-only snapshot pushed over the same coordinator
seam party chat and victory already cross, and never write it themselves. Persistence is a debounced
5s save (matching the hero-profile cadence) plus an immediate party-empty flush that prunes orphaned
self-switches against D1's live event ids. `World` evaluates `activePageIndex` — XP's rule, highest-
position page whose conditions all hold, unknown ids reading false/0 — on snapshot install and on
hero join, **never per tick**; active events reach the client as `WorldInfo.events`, appearance-only,
the third member of the `elements`/`layers` family, with collision staying exclusively in `tiles`.
The registry (switch/variable ids and names, up to 200 of each) rides the adventure row as bounded
JSON and is authored through the editor's registry dialog, whose condition pickers replaced tranche
3's free-text ids. **Nothing mutates state yet** — the coordinator's own state changes only through a
single, deliberately commented test-only seam, left as tranche 5's entry point. Browser-verified by
the controller: the registry dialog opens by mouse, the empty state is calm, zero console errors;
the runtime path itself is covered by tests against the real Durable Object rather than a browser
pass. See
[`docs/superpowers/specs/2026-07-19-adventure-state-design.md`](./docs/superpowers/specs/2026-07-19-adventure-state-design.md)
for the full design.

**Obligations recorded for tranche 5:**

- **A monotone snapshot version, with a `>=` guard in `installAdventureState`**, must exist before
  concurrent mutations do. Nothing enforces ordering across two state pushes today because nothing
  yet produces two in a row from different sources; the interpreter will.
- **The install path's never-throw guarantee must survive.** `GameSession` awaits the state install
  ahead of room admission, so a snapshot install that starts throwing would block every join into the
  party, not just the mutation that triggered it.

## Tranche 4.5 — the UX feedback wave

A user feedback wave arrived mid-tranche-4 and is sequenced between 4 and 5 rather than folded into
either: `docs/superpowers/specs/2026-07-19-ux-feedback-wave.md` records the thirteen items verbatim,
translated into requirements — no dark mode, the editor opening on an adventure picker rather than a
blank canvas, adventures owning their maps 1-n instead of an n-n membership model, a new adventure
auto-creating its first map (5x5 earth, spawn centre, water border), the start map moving into the
map panel, grid-on-by-default, hover preview with an opaque red illegal-placement background,
exclusive tool selection, a Test-map performance fix, a minimal/trusted catalogue, and the largest
piece — markers becoming typed events (spawn/entry/exit/monster-spawn) instead of a parallel system,
which needs its own mini-spec before it starts. Its exit gate is not a checklist, it is **hours of
real Playwright testing**: authoring adventures online, multi-map, multi-player, from zero, without a
snag. Tranche 5 does not start until that gate is cleared.

**Exit gate cleared (Task 6, `feature/ux-wave`).** A scripted Playwright campaign drove the real app
end to end and passed with zero console errors in every context: register → creator → instant
"Nouvelle aventure" (5×5 land in a 20×15 canvas, born with an entry + exit event) → name-at-first-save
popup → build map 1 (pencil/rect/fill terrain, elevation + stairs, curated tree/bush — the palette
offers *only* the four curated assets and the one curated species — red illegal-placement feedback on
water, a switch `0001` in the Database, a monster event, a normal event with a graphic and a switch
condition) → add map 2 → wire map 1's exit → map 2's entry and map 2's exit → end → PLAYABLE badge →
create a party → hero → play (terrain collision, the monster attacks, the normal event visible, take
the exit and arrive on map 2 → Victory). Two-account multiplayer was verified in a second browser
context: B joined A's party, both heroes saw each other and each other's movement on the same map,
local chat worked both directions, both fought the goblin, and B took the exit to map 2 while A
remained on map 1 — both kept functioning. Persistence held: A left and re-entered with map **and**
exact position restored (a dead hero even restored its corpse state), and the adventure reopened in
the editor intact after a full reload. The core author→build→wire→play loop was rerun 3× on fresh
accounts with no flakes. Two minor UX observations, non-blocking (see the Task 6 report): the
Database dialog's "Retour" unloads the whole editor session (Escape/× is the safe dismiss), and
adding a map via the panel leaves that map's exit unbound so the adventure reads Draft until it is
wired. Tranche 5 may proceed.

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
- `docs/superpowers/specs/2026-07-19-map-events-design.md` — tranche 3's design.
- `docs/adventure-runtime-architecture.md` — room ownership, routing, presence fencing.
- `docs/superpowers/specs/2026-07-16-map-editor-design.md` — the current editor's spec, which
  tranche 2 supersedes but should not contradict without saying so.
- `.superpowers/sdd/progress.md` — every finding from tranche 1, with commit shas.
