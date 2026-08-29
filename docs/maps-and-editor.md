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

The gameplay camera policy is adventure metadata too. New and legacy adventures default to the
HD-2D side view (`cameraMode: "hd2d"`), which keeps pitch fixed but lets players move laterally
through a 90-degree arc around the authored heading. Authors may opt an adventure into `"orbit"`,
which enables movement-following unrestricted horizontal orbit plus the existing bounded pitch
control. Player settings persist independent 25–200% multipliers for automatic follow, horizontal
orientation and vertical tilt, and apply them live. The room copies
that policy into every welcome frame; clients treat an absent field as `"hd2d"` for compatibility
and reset yaw/pitch to the authored baseline before applying that limited arc. The editor's own
authoring camera remains freely orbitable independently of this player-facing setting.

Teleporter authoring is a two-click atomic gesture: the first click records the entrance and the
second creates both ordinary events with reciprocal `linkedEventId` values and reciprocal same-map
teleport commands. No half-link reaches history or persistence. Deleting either endpoint removes
both; authors open an endpoint only after placement to customize its command program. Every event
also carries an optional `showMarker` preference (legacy omission means visible) for the generated
ground locator ring. Native building geometry participates in editor ray picking, so a click on a
wall resolves inward to its footprint and a click on a roof keeps the visible roof coordinate;
teleport and building-door destinations can therefore intentionally land on walkable roofs.

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
four independent edge handles. Dragging one end or side holds its opposite edge fixed, previews the
snapped bridge immediately and commits the gesture as one undoable edit. The bridge's exact rotated,
quarter-cell-shifted deck plus a small halo is selectable, rather than only its historical anchor.
The renderer regenerates planks, rails and supports from those dimensions; the heightfield compiler
bakes the identical footprint, deck and side rails, so visual geometry and movement collision cannot
drift apart. Dimensions reuse the element row's existing transform integer, keeping old 3x1 bridges
valid and requiring no schema migration.
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
This building contract is also the definition of done for every new placeable 3D family. A model
must support movement, enlargement, shrinking and multiple orientations, and its content definition
must explicitly choose whether it is destructible. Indestructible is a valid authored choice;
destructible content must provide the required visual states. The editor preview, undo/redo,
serialization, renderer, map compiler and authoritative collision must all consume the same saved
transform and state. Adding a special-case 3D model with fewer controls, or a visual transform that
collision does not reproduce, is not allowed.
Native 3D scenery (all current and future native buildings, bridges, traps and barricades) also supports an
absolute 0..359-degree rotation. The inspector exposes the exact degree value, while selection on
the map draws a purple rotation arm that can be dragged continuously; either interaction commits as
one undoable edit. Rendering, doors, resize handles, bridge decks/rails and the authoritative
heightfield all consume the same angle. Collision uses oriented rectangles rather than the larger
axis-aligned bounds used only for editor coverage checks, so diagonal structures do not create
invisible blocked corners. Existing quarter-turn buildings and vertical/horizontal bridges retain
their old direction. Free angles are version-packed into the existing transform integer alongside
building or bridge dimensions, requiring neither a database migration nor a new dependency.
The Buildings palette exposes the seven human archetypes plus four complete faction packs:
goblins, orcs/trolls, beastfolk and wild tribes. Each non-human pack contains two distinct native
models for housing, command, training, community life and daily life (40 models total). These are
forty dedicated compositions rather than variants of a shared hall: each has a unique normalized
silhouette and a functional landmark matching its role (forge, granary, training pit, healer's herb
racks and so on). Their nearest-filtered materials are sampled from faction-appropriate 2D art
already shipped in the Tiny Swords catalogue, preserving the pixel texture language on lit,
volumetric geometry instead of producing smooth clay surfaces. Cards are
grouped by faction, ordered by purpose and badged with their purpose and A/B variant. Selecting the
Buildings category reveals the whole organized set instead of paginating through unrelated
factions. Human families retain their five shipped roof recolours; faction buildings own their
materials and silhouettes and therefore have no synthetic recolour.

Future 3D packs follow the same acceptance loop. Finish one faction before propagating the method:
define a construction language from its source art, give every building a structurally plausible
and role-specific composition, and place the entire pack side by side in the editor at the gameplay
camera. Repeated dominant roofs, interchangeable massing, flat decoration and unfinished surfaces
are revised at that stage. Only a visually accepted faction becomes the reference for the next one;
the human buildings and a generic shared hall are not starting meshes. Automated renderer tests
keep each finished faction building above the current detail floor of 55 meshes, 45 genuinely
volumetric parts, 7 materials and 4 geometry families, while the browser comparison remains a
required complementary check. The handoff records the screenshot used for that comparison.

Traps and defenses have their own palette category, split into General, Goblin and Orc/Troll
groups. Alongside the spike trap and human barricade it contains a damage-free backward repulsor, a
damage-free vertical launcher, a low goblin scrap barricade at collision elevation 1 and a massive
orc barricade at elevation 3. The two movement traps are ordinary authored event presets: the room
resolves the push against the shared heightfield, while a stamped server grant arms the client's
vertical physics without granting the client any outcome authority.
Flat crenellated roofs compile their visible edges as separate finite collision volumes. Barracks
receive four perimeter parapets; castles combine those central parapets with the same twelve
battlement positions around each of their four corner towers as the rendered model. Standalone
round towers use that twelve-piece ring too. The open deck remains walkable, while a hero at deck
height cannot cross the raised edge. This is keyed by the shared `crenellated` roof archetype, so a
future native building using that roof contract receives logical edge collision automatically.
Resizing also preserves art density: timber facade bays, shingles, masonry and planks repeat across
the final world-space faces (including internally scaled round/fortified models) instead of
magnifying one low-resolution texture over the whole footprint.
Irregular architecture also compiles as the solid pieces that are actually rendered instead of one
bounding slab: mills use their round cap, fortified halls use their narrower central body, and
castles add four independent round tower roofs. Enlarging those buildings therefore leaves their
intentional margins and the passages between castle towers free of invisible collision.

Interior maps may additionally author an `interiorShell`. Its style is one of timber, castle,
cave, mountain, volcano, ice or snow; each resolves to surfaces already shipped by the game, while
sand, water and grass are deliberately unavailable as wall materials. Each style names one
structural-floor brush: cave/mountain/volcano/ice/snow use their matching terrain, while timber and
castle reuse Sand as a neutral authored marker rendered as boards or stone paving. Only that floor
grows the envelope. Applying the first coating converts every existing solid floor to that
structural material without changing its elevation or water; changing coating later converts only
the previous structural floor, preserving decorative terrain painted since. Any other terrain or
liquid may be painted inside; a flood fill keeps enclosed
patches in the room without creating walls around them, while outside-connected cells do not extend
the architecture. Repainting the selected structural floor over cells already using it writes a
sparse architectural mask independent of the visible terrain, allowing nested rooms and partitions
inside an already enclosed map. Repainting those cells with another terrain removes that inner
architecture. The mask follows canvas padding/cropping and round-trips with the map. Contiguous
exposed edges become one boundary run for collision and GPU instances for rendering. The coating
dialog controls camera-facing cutaways independently for perimeter walls and author-painted inner
walls: either group can remain full height or lower to a sill over the black void as camera yaw
changes. These visual openings never weaken collision; the merged full boundary still compiles into
finite heightfield colliders, keeping the visible enclosure and both movement authorities on one
geometry source. Missing cutaway flags preserve the historical open-both behaviour, and omitting
`interiorShell` preserves older open interiors.

Physical passages are separate authored `interiorShell.openings`. In Field mode, **Create passage**
records two unit wall edges on the same straight perimeter or inner wall; every edge between the two
clicks is removed, so authors choose any width in one-cell increments. **Close passage** uses the same
two-click gesture and restores only that span, including a sub-span of a wider opening. The first
click is transient and the completed passage is one undo step. Openings follow padding/cropping and
round-trip through both stored map formats. Unlike camera cutaways, they filter the shared boundary
runs before rendering and collider compilation, so the visible gap is genuinely traversable for
both movement authorities.

True underground space is authored separately from the surface heightfield. A map may contain
sixteen storeys (`-1` through `-16`), each 2.4 world units below the previous one. Excavated cells
are stored as compact row runs with one of the existing interior styles; sand, water and grass are
not underground coatings. The Field palette can excavate a rectangular room/block or long narrow
tunnel, cut a true vertical shaft from the surface through every storey down to its selected bottom,
refill a volume, and place a multi-cell stair flight between the selected storey and the one above.
These operations are single undo entries. The depth selector also selects the storey rendered by the
editor, with the surface retained as a translucent alignment reference instead of leaving the author
to work over an empty background.

The compact Surface/`-N` bar is the editing context for every normal palette mode, not a separate
underground editor. At a selected storey, the pencil, rectangle and flood-fill tools paint any
terrain material or water and excavate new cells as they grow; the cave Fill operation remains the
explicit way to close rock again. Scenery, buildings, native resources and every event kind use the
same placement, selection, resize, rotation, eraser and event-dialog workflows as the surface.
Quest bindings continue to point at stable event UUIDs, so a giver, objective or turn-in below the
map needs no special quest model. Content is filtered to the selected storey in the stage and event
list, while the quest workspace may still inspect the whole map. Refilling rock removes content
inside the closed volume instead of leaving invisible actors or colliders behind.

Excavation participates in the saved content bounds independently of painted surface tiles. A
storey, tunnel, stair or shaft may therefore extend beyond the land footprint above it (up to the
same 256×256 authoring canvas), and the saved map grows to retain that volume plus its ocean margin.
Surface height, liquids and relief are ignored by movement at an underground support elevation;
only colliders whose vertical span intersects the body may block that storey.

Element and event identities include the storey, so authors may stack content at the same logical
cell on several floors. Their legacy database tables still have two-dimensional unique keys; the
map service encodes the depth outside the legal editor-column range only while writing those rows
and restores the authored column at its boundary. Depth metadata itself remains in the validated
heightfield document. The editor and runtime therefore never see synthetic coordinates, and no
schema migration is required for existing maps.

Compilation turns each run into finite floor and ceiling slabs plus merged perimeter-wall segments.
The original level-zero terrain remains above ordinary excavated volumes and is still a walkable
surface. A surface stair or shaft is different: its footprint cuts the terrain top visibly, while a
shaft also removes surface support without being misread as water. Floor and ceiling spans open
under connecting stairs and through every intermediate shaft storey, retaining only the shaft's
bottom floor. Stair endpoints span the full 2.4-unit storey rather than one 0.9-unit terrain tier.
Shared terrain queries filter the surface terrain by the moving body's vertical ceiling before
considering underground platforms, so a hero below the map cannot be snapped back onto the ground
above. Saved hero positions use the same body-bounded lookup on restore. Renderer and collision both
consume the compiled underground document; visual walls use the same stair-mouth rule as collision,
and surface scenery/actors from another storey are culled during descent. Gameplay selects the
visible storey from the local hero's reported `y` while the body occupies a stair or shaft, so the
camera follows the sampled elevation continuously instead of teleporting between views. Elsewhere,
an airborne body retains its last grounded storey: an ordinary jump inside a basement cannot reveal
the ceiling above or put its billboard into an in-between visibility state. The editor can address a
storey directly without altering gameplay state. Canvas padding/cropping shifts underground runs,
stairs and shafts with every other authored cell.

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
null and the stage flashes its refusal hint rather than repainting the same slot. The range runs
from `MIN_TERRAIN_LEVEL` (-3) through `MAX_TERRAIN_LEVEL` (10): three excavated tiers and ten
plateaus around level zero. Those limits are the tile encoding rather than a preference. A cell's level IS its
index into `TERRAIN_MATERIAL_SLOTS`, whose entries are slots in the tileset's `autotiles` array, and
the id space reserves 64 of those: eleven levels across four materials plus the cliff walls and the
retired thin-ice band comes to 52, and the twelve remaining slots hold the four materials at depths
1 through 3. Another level in either direction would not fit; raising the reservation moves
`FIXED_BASE`, which renumbers every stored fixed tile in every saved map.

What a taller range does not cost is art. `terrainAtlasKey` clamps to its four palettes and
`wantedCliffDirection` clamps its faces at level 2, so everything above three repeats the level-3
look with a darker tint, and `raisedTint` derives that tint rather than naming one per level.

Levels 0 to 3 keep the exact slots every saved map already holds. Restoring that correspondence was
its own fix: retiring the thin-ice material (`af434a16`) removed it from the generator, which
shortened every generated block and slid the level-3 band from 19..23 down to 16..19 while the
tables, and every stored map, went on naming the old slots. Sand, snow and ice at level 3 referenced
undeclared slots from then until the band was restored; nothing failed loudly because the terrain is
a mesh built from the heightfield rather than from tile art.

The stairs tool authors one-cell ramp geometry in all four directions and may widen a compatible
flight to three cells. From a raised ledge it builds down to level zero; from level zero or an
existing pit ledge it excavates a flight down to `MIN_TERRAIN_LEVEL`. Negative ramp ids live in a
new fixed band appended after all historical terrain and water ids, so existing maps keep their
meaning. Camera yaw breaks genuine direction ties. Each rendered flight samples the material of
the high bank it attaches to, including the selected interior structural coating, rather than using
a hard-coded grass atlas. Later terrain edits that invalidate a ramp remove it and restore normal
cliff upkeep. Baked ramp cells reduce hero movement to 86%; the renderer adds a smooth 7px hero
lift and raises the camera target, blending through the stair and reversing on descent. The elevation offset is applied after ordinary
map-bound camera clamping, otherwise a stair near the north edge silently loses the whole effect.
Client movement, server validation and local preview all read the same
baked `ramp` kind. In an adventure using the 360-degree camera, horizontal follow eases behind the
hero's actual multidirectional travel after a short manual-control grace period. Climbing or
descending adds a small temporary pitch offset, then returns to the player's manually selected
inclination on any flat landing, including raised floors. Horizontal and vertical orbit gestures
lock independently so an intentional manual look remains available without diagonal axis drift.
Painted water keeps its explicit liquid tier and renders inside an interior at every elevation.
Level zero uses the previously reserved fixed-water slot, so it is distinguishable from a historical
empty cell. For older interiors, a level-less cell enclosed by structural floor is recovered as a
level-zero pool; only edge-connected implicit water becomes the black architectural void.
Swimming billboards read the queried liquid surface at their own cell rather than the map-wide sea
level, so excavated water and lava at negative tiers also hold the hero visibly inside that liquid.
Fill has no fill-to-empty primitive; the UI disables it rather than let it
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
