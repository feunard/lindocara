# Maps, terrain and the adventure editor

The layered map model, what is appearance and what is collision, and the editor that authors it.
The single rule to carry away: collision comes from the heightfield and from nothing else.

### Maps and the editor

Maps live in the database (`MapService`) and are private to their author account. Every successful
content/name update increments a monotone `revision`; failed updates do not. Adventures may only
reference their author's maps, their full graph is revalidated before a referenced map mutation,
and delete/edit operations cannot silently invalidate a saved adventure. Legacy ownerless rows are
quarantined unless the migration can identify exactly one author.

Terrain is three layers of frozen tile ids (`MapData.layers`, RPG Maker XP-shaped) over an authored
`tilesetId`, not one `TileKind` character per cell. A tile's id is decided once, at paint time â€” the
editor computes the autotile edge variant when you paint and freezes the result, which is what lets
an author override a single tile by hand afterwards. What an id *means* â€” walkable or not, drawn
behind or in front of characters â€” is a tileset property authored once per tile, never a per-cell
one, so collision stays derivable from appearance through one indirection: `tile id â†’ tileset â†’
passable`. The pixel `TerrainGeometry` still carries two baked collision sources â€” `tiles` (the
grid, whole cells) and `colliders` (a `ColliderIndex` of sub-cell rectangles, one per colliding
element), joined by `isWalkable` so a tree blocks its trunk rather than its whole cell â€” **but no
running room reads them any more.** That model belongs to the tile editor and the catalogue zones
now; it feeds no live party and dies with them. **On the wire, `WorldInfo.heightfield` is the ONLY
terrain, and
`WorldInfo.layers`/`WorldInfo.elements`/`WorldInfo.events` are appearance only** â€” never derive
collision from any of the latter three. `WorldInfo.tiles` and `WorldInfo.colliders` are gone: S3's
tile-units increment made the stored heightfield the single geometry, baked into a `ZoneTerrain` by
`zoneTerrainFromHeightfield` (`packages/engine/src/terrain-access.ts`) on the server AND, from the
same string with the same function, on the client â€” which runs the movement rule itself and needs
the very geometry the server will validate it against. An agent that reads
`layers` to decide walkability reintroduces exactly the silent desync this design exists to prevent,
and reading `elements` for a collider is the same mistake with a second bake: collision only ever
comes from the heightfield, via `canStand`/`resolveGroundMovement`. Elevation needs no engine change â€” a cliff face
is its own cell, impassable, one layer above the ground. The brush maintains that face on the lower
cell of every north/east/south/west boundary, so a plateau is a real barrier on all four sides.
Directional stair gateways are the only authored crossing: the editor chooses a side
(right/left) and the transition (0â†”1 or 1â†”2). They use Pixel Frog's two native side ramps; there are
no top/bottom variants. The brush clears both joined cliff faces and the path is bidirectional.
Every blocking cliff face draws its oriented rock cell; no side may remain collision-only because
that creates an apparently empty but inaccessible strip around raised ground. See
[`docs/archive/specs/2026-07-18-layered-map-model-design.md`](./archive/specs/2026-07-18-layered-map-model-design.md)
for the full model.

The welcome message includes `mapId + revision`, the `heightfield` (the only geometry there is),
appearance layers, `tilesetId` and authored elements, so the client's movement rule, the renderer
and the mini-map share the same cache identity. The baked collision tiles and sub-cell colliders it
used to carry are gone with `WorldInfo.tiles`/`WorldInfo.colliders`.

The `adventures` and `map-editor` screens are gone: one `adventure-editor` screen
(`src/client/ui/editor/`) now owns both, as menu bar / toolbar / three resizable panes (shadcn
`TerrainPalette` left, the WYSIWYG HD-2D stage centre (rebuilt on the shared renderer;
rebuild), `MapListPanel` right) / status bar.

Entering the editor opens an **unsaved local sandbox** rather than a picker, and WRITES NOTHING:
`AdventureEditorScreen`'s no-session branch calls `createSandboxSession()`, which is pure and
synchronous — a map minted from the engine's own `defaultMapInput` template, a draft that tracks it,
and `adventureId: null`. The stage compiles that map's terrain itself (`compileAuthoredMap`), so a
sandbox paints, previews and plays exactly like a stored map. The author's **first save creates
both**: `POST /api/adventures` carrying the map (`AdventureController.createAdventure`'s optional
`map` body) makes the adventure and its one map in a single transaction — a create-then-PUT pair
could persist a named adventure and then fail the map. `File → Open` reaches an existing adventure
and `File → New adventure` starts another sandbox; both are dirty-guarded.

`adventureId === null` is the flag every server-backed surface reads. Test routes through the
first-save popup and continues into the launch (with the just-created id passed explicitly — the
handler's own `adventureId` is still the render's `null`); the settings dialog saves through the same
create seam and hides Delete; New map stays disabled; the status bar reads "Not saved yet" instead of
a green tick, because "no unsaved edits" is vacuously true for a map that was never written at all.
This reversed the old rule that abandoned scratches are never cleaned up: a sandbox is memory-only,
so closing the tab loses it. `AdventureEditorInner` is keyed by `draftId`, NOT `adventureId` — the
first save gives the session an id, and remounting there would throw the stage away mid-save.

Adventure metadata lives in `AdventureSettingsDialog`, off the canvas. All chrome is stock shadcn â€”
the old floating asset palette was the last Tiny import inside a creator surface, and it died with
the pre-merge screens, so the two-tree rule now has zero exceptions in the editor. The stage keeps
sharing placement/collision/catalog rendering rules with the runtime through `shared/map-data.ts`
and `client/game/catalog-element-render.ts`, with explicit loading/empty/error state, grouped
history, dirty navigation guards, selection/inspectors, stable marker ids with optional labels and
complete marker preview.

`shared/tile-brush.ts` grew a rectangle (`paintRectAutotile`/`eraseRect`), a flood fill
(`floodFill`) and a stairs stamp (`paintStairs`) â€” each re-resolves neighbours the same way the
pencil always did, and `resolveWholeLayer` is still the oracle they're tested against. The old
`Layer 1/2/3/EV` pill only ever routed the eraser â€” painting always wrote layer 0 (plus automatic
cliff-wall upkeep on layer 1) and stairs always wrote layer 1 â€” so it is now a Field/Element/Event
segmented control (`activeMode`, threaded from toolbar/menu bar down to the stage handle) that
actually names which of the three authored collections the editor is working in: Field owns the
tile layers, Element owns `MapData.elements`, Event owns `MapEvent[]`. The sidebar is three
mode-scoped palettes (`TerrainPalette`/`ElementPalette`/`EventPalette`) and the eraser is
mode-scoped too. Element mode places at quarter-cell positions: an element carries `offsetX`/
`offsetY` (0..3, quarter tiles = 16px) on top of its `col`/`row`, so a terrain cell is a 4x4 sub-grid
of decoration slots â€” up to 16 stacked decorations per cell â€” with an offset inspector, and each
catalogue asset authors its own sub-cell collider (`elementWorldCollider`), no longer a whole-cell
footprint. Scenery placement is terrain-independent: every known catalogue asset may be placed on
grass, cliffs or water; `allowedTerrain` remains catalogue guidance, not a save-time restriction.
Once either wooden bridge is placed, its selection inspector can resize its crossing length and
deck width in whole cells (1..32). Selecting it on the map also draws its exact deck footprint plus
one length and one width handle; dragging either previews the snapped bridge immediately and commits
the gesture as one undoable edit. The renderer regenerates planks, rails and supports from those
dimensions; the heightfield compiler bakes the identical footprint, deck and side rails, so visual
geometry and movement collision cannot drift apart. Dimensions reuse the element row's existing
transform integer, keeping old 3x1 bridges valid and requiring no schema migration.
Bridge elevation is resolved from both the end-cap cells and terrain immediately beyond the two
crossing ends, including for freely rotated bridges. Side terrain below a cliff no longer outvotes
the actual support: the highest elevation touched by either end anchors the whole deck, even when
level 0 occurs at both ends. The placement ghost uses this same compiled elevation, so its preview
does not drop to level 0 while one end still rests on raised terrain.
Every supported native 3D building uses the same generic contract: its inspector and map handles
resize the whole archetype while preserving its native width/depth ratio. Width, depth and vertical
architecture grow together, so a larger house, tower or mill reads as a larger model rather than a
facade stretched along one axis. Values still snap to eighth-cell footprints; model modules, roof,
solid footprint and doorway consume the same result. Selecting one on the map draws its footprint
plus two side handles and one rear handle; dragging any of them previews the linked size immediately
and commits the whole gesture as one undoable edit. Newly registered native building archetypes
inherit the controls automatically. Legacy buildings retain their stored footprint, and explicit
dimensions share the existing transform integer, so no schema migration is required.
Native 3D scenery (all current and future native buildings plus both bridges) also supports an
absolute 0..359-degree rotation. The inspector exposes the exact degree value, while selection on
the map draws a purple rotation arm that can be dragged continuously; either interaction commits as
one undoable edit. Rendering, doors, resize handles, bridge decks/rails and the authoritative
heightfield all consume the same angle. Collision uses oriented rectangles rather than the larger
axis-aligned bounds used only for editor coverage checks, so diagonal structures do not create
invisible blocked corners. Existing quarter-turn buildings and vertical/horizontal bridges retain
their old direction. Free angles are version-packed into the existing transform integer alongside
building or bridge dimensions, requiring neither a database migration nor a new dependency.
The Buildings palette exposes one card for each native 3D archetype (house, tower, archery guild,
barracks, monastery, castle and windmill), rather than hiding supported models or repeating dozens
of recoloured cards. After placement, the inspector offers the five shipped roof colours for each
family that owns them; changing colour preserves the element identity, footprint, rotation,
durability and interior. The windmill has no synthetic colour choice because the source catalogue
does not ship one.
Flat crenellated roofs compile their visible edges as separate finite collision volumes. Barracks
and castles receive four perimeter parapets; round towers receive the same twelve battlement
positions as their rendered model. The open deck remains walkable, while a hero at deck height
cannot cross the raised edge. This is keyed by the shared `crenellated` roof archetype, so a future
native building using that roof contract receives logical edge collision automatically.
Resizing also preserves art density: timber facade bays, shingles, masonry and planks repeat across
the final world-space faces (including internally scaled round/fortified models) instead of
magnifying one low-resolution texture over the whole footprint.
Content edits deliberately do not rebuild terrain. Moving/resizing a building or bridge and
adding/removing scenery recompiles only authored content plus its colliders, then diffs the changed
static visuals in place; event edits reuse the same path while their preview remains dynamic. The
65,536 terrain cells of the 256x256 working canvas, the ground/water meshes, actors and post-effects
remain alive. Field brushes are the only edits that remesh terrain, and rapid terrain strokes keep
their existing throttle plus release flush.
Every tool has a keyboard shortcut, gated off while a dialog is open or the stage isn't ready.

The elevation brushes are RELATIVE: ground, +1 and -1, resolved against whatever level the painted
cell already stands at (`elevationStepTarget`, `tile-brush.ts`). Picking a material alone carries
`keep`, so choosing ice does not flatten the plateau it lands on. A step with nowhere to go returns
null and the stage flashes its refusal hint rather than repainting the same slot: there is nothing
below the ground, and `MAX_TERRAIN_LEVEL` is the top. That ceiling is the tile encoding, not a
preference - a cell's level IS its index into `TERRAIN_MATERIAL_SLOTS`, and the raised tints, the
cliff faces and the ramp art are all per-level in the same way, so a taller range costs four sets of
new art before the number can move.

The stairs tool stamps a two-tile Tiny Swords ramp on layer 1. Atlas column 0 climbs right and
column 3 climbs left; those are the only supported orientations, so a bank whose high side is north
or south has no ramp at all. The author no longer declares which: `inferStairsPlacement` tries all
six candidates (two directions, three transitions) at the hovered cell and takes the one that fits,
with the camera's yaw breaking a genuine tie toward whichever direction currently reads as the
screen's right. The ghost still draws where nothing fits, marked invalid so it paints red. Both
halves run beside one 0â†”1, 1â†”2 or 2â†”3 boundary; the clicked cell is the low half and the preview
shows both occupied cells. It never paints elevation itself: the author paints both levels first,
and flat or mismatched ground is refused. Other adjacent elevation faces do not invalidate two matching endpoints. Painting water
over either stair tile, or any later terrain edit that invalidates either endpoint, removes the whole
pair and restores normal cliff upkeep. Baked ramp cells reduce hero movement to 86%; the renderer
adds a smooth 7px hero lift and raises the camera target by 24px on level 1 and 56px on level 2,
blending through the stair and reversing on descent. The elevation offset is applied after ordinary
map-bound camera clamping, otherwise a stair near the north edge silently loses the whole effect.
Client movement, server validation and local preview all read the same
baked `ramp` kind. Fill has no fill-to-empty primitive; the UI disables it rather than let it
silently no-op.

The pointer-events contract is load-bearing and easy to get backwards. `#stage` stays a `position:
fixed`, full-viewport sibling of `#root` (see the canvas gotcha below), so by default it paints and
hit-tests *above* any normal-flow chrome. `.editor-root` inverts that: a `pointer-events: none`
stacking context over the canvas, with each chrome island â€” menu bar, toolbar, the two side panels,
status bar â€” opting back in via `.editor-chrome`/`.editor-root > *`. The centre body row
(`.editor-body`) stays pointer-transparent so painting strokes reach the canvas; anything clickable
floating over that centre, like the selection inspector, must re-enable pointer events on itself.
Get this backwards and either every chrome click is eaten by the canvas, or every stroke is blocked
by the chrome.

Maps now carry authored **events** â€” their own `mapEvents`/`mapEventPages` tables, saved inside
the same map-save write path as elements and layers, chunked under D1's ~100-bound-parameter cap
the same way the element writes are. An event is a client-minted uuid (stable so tranche 5's
commands can reference it) plus a per-map creation-order ordinal (the `EV001` chip â€” display only,
never identity) and 1â€“8 ordered pages, each carrying conditions, appearance, autonomous-movement
settings, options and a trigger. **Nothing executes**: the game runtime is untouched, and an
authored event is invisible to a running party until the next tranche evaluates page conditions
server-side. The wire parser rejects a payload with an absent condition field â€” a client must emit
an explicit `null`, never omit the key, so "no condition" stays distinguishable from "malformed."
The EV tool, the stage overlay (sprite + `EV{ordinal}` chip, or the placeholder box with no
graphic) and the event dialog live entirely in the editor, in stock shadcn. Because Radix portals
`DialogContent` to `document.body`, outside `.editor-root`, the `legacy.css` shadcn fence now also
exempts `[data-slot] *`, not just `[data-slot]` itself â€” a bare `<button>`/`<input>` nested inside a
data-slot container had no `data-slot` of its own and was repainting as a green Tiny Swords pill.
See
[`docs/archive/specs/2026-07-19-map-events-design.md`](./archive/specs/2026-07-19-map-events-design.md)
for the full model.

See
[`docs/archive/specs/2026-07-18-editor-shell-design.md`](./archive/specs/2026-07-18-editor-shell-design.md)
and [`docs/archive/plans/2026-07-18-editor-shell.md`](./archive/plans/2026-07-18-editor-shell.md)
for the shell's spec and plan, and
[`docs/adventure-editor-roadmap.md`](./adventure-editor-roadmap.md) for what comes next. The
pre-merge two-screen spec/plan
([`docs/archive/specs/2026-07-16-map-editor-design.md`](./archive/specs/2026-07-16-map-editor-design.md),
[`docs/archive/plans/2026-07-16-map-editor.md`](./archive/plans/2026-07-16-map-editor.md))
is superseded.
