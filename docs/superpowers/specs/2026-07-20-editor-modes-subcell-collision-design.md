# Editor modes and sub-cell collision — design

Date: 2026-07-20
Status: approved, not yet implemented

## Summary

Two changes shipped as one tranche.

1. The editor's `Layer 1 / 2 / 3 / EV` control is replaced by a three-way segmented control:
   **Field / Element / Event**. This is not a rename — it is the real data model finally surfacing
   in the UI, because each mode already owns its own collection.
2. Placed elements gain a quarter-tile offset and a sub-cell AABB collider authored once per
   catalogue asset. Collision stops being grid-locked.

The two ship together because the offset is meaningless without the collider following it, and a
collider is unauthorable without the mode that owns element placement.

## Why the layer control has to go

`activeLayer` looks like it selects a paint target. It does not.

- pencil / rect / fill always write layer 0, plus automatic cliff-wall maintenance on layer 1,
  regardless of `activeLayer` (`editor-state.ts:96-99`, `:823-826`).
- the stairs stamp always writes layer 1 (`tile-brush.ts:403-423`).
- nothing writes layer 2.
- the **eraser is the only tool routed by `activeLayer`** (`editor-state.ts:930-934`), and only as
  its last fallback after event and element.

So the control's entire authored effect is "which layer the eraser clears", presented as if it were
a paint target. Meanwhile the three real authored collections — tile layers, `MapData.elements`,
`MapEvent[]` — have no selector at all; `elements` hides in a sub-section of the terrain palette and
events are smuggled in as a fourth pill that is actually a tool, not a layer.

Field / Element / Event names what is actually there.

## Section 1 — the mode model

`activeLayer: 0 | 1 | 2` is removed. `activeMode: "field" | "element" | "event"` replaces it, in
both places `activeLayer` lives today: React state in `AdventureEditorScreen.tsx:287` and the
`EditorHistory` field in `editor-state.ts:157` (kept off `EditorMap` so it survives undo/redo, same
reasoning as before). `pendingLayerRef` keeps its role for the async stage open, renamed.

| Mode | Owns | Tools | Grid |
| --- | --- | --- | --- |
| **Field** | `MapData.layers` (all three, internally) and `spawn` | pencil, rect, fill, stairs, eraser, spawn | forced, whole cell |
| **Element** | `MapData.elements` | place, select, eraser | cell + quarter-cell offset |
| **Event** | `MapEvent[]` | place, select, eraser | forced, whole cell |

### UI

- **Segmented control**, stock shadcn, three segments, replacing the `1 2 3 EV` pill group in
  `EditorToolbar.tsx:130-152`. Keyboard `1` / `2` / `3` are recycled onto the modes.
- **Menu bar**: the "Mode" menu (`EditorMenuBar.tsx:118-133`) becomes the same three items, no
  separator, no "Événements" special case.
- **Status bar** (`EditorStatusBar.tsx:50`) shows the mode instead of the layer.
- **Left sidebar** (`TerrainPalette.tsx`) generalises its existing `eventMode` boolean into three
  bodies, one per mode. The "Décor" section moves out of the Field body into the Element body.
  - *Field*: grass/water swatches, elevation 0/1/2, stairs, spawn.
  - *Element*: `CatalogueAssetPicker`, the `{n}/400` counter, the offset inspector.
  - *Event*: `EVENT_KINDS` and their per-kind fields (unchanged).

The elevation 0/1/2 selector stays where it is. It is terrain *content* written to layer 0, not a
layer target — with the layer pill gone, the visual collision between two three-digit pill groups
that made it confusing is gone too.

### Consequences

- **Layer targeting does not change at all.** Painting still writes layer 0, stairs still write
  layer 1. Only the *choice* is removed, and it only ever moved the eraser.
- **The eraser becomes mode-scoped instead of cascading.** Today it tries event → element →
  terrain. In Element mode it now erases only elements, never the terrain beneath them. More
  predictable, but it is a behaviour change. The `!isStrokeStart` guard
  (`editor-state.ts:907-911`) stays: within a mode, a drag still must not smear.
- **Layer 2 becomes unreachable.** Nothing writes it already; without the pill nothing can clear it
  either. `MAP_LAYERS` stays 3, so existing maps reload untouched and `parseMapData`'s
  `layers.length !== MAP_LAYERS` check (`map-data.ts:377`) is unaffected. The layer is dormant, not
  removed.

## Section 2 — element offsets

`TILE_SIZE` is 64 (`tilemap.ts:13`), so a quarter step is **16 px**.

```ts
export interface MapElement {
  col: number;
  row: number;
  offsetX: number; // integer 0..3, quarter-tiles
  offsetY: number; // integer 0..3, quarter-tiles
  assetId: EditorAssetId;
}
```

Offset `(0, 0)` reproduces today's placement exactly, so `parseMapElements` defaults both to 0 and
existing maps need no migration.

### Placement

**The cursor quantises to the quarter cell; the offset is implicit.** In Element mode the stage
hover snaps to 16 px instead of 64. You drop the tree where you see it and the four numbers are
derived:

```
col = floor(px / 64)        offsetX = floor((px % 64) / 16)
```

No 4×4 widget to set before clicking. The selection inspector shows the four numbers and allows
keyboard correction for precise placement.

The `0..3` range only offsets down-right from the anchor cell; an asset cannot straddle a cell
boundary centred. This is deliberate — the offset space covers exactly one cell with no overlap and
no gap between neighbours, so every sub-cell position has exactly one `(col, offset)` encoding.
With implicit placement the author never types either number, so the asymmetry is invisible.

### Rendering

`createCatalogElementView` (`catalog-element-render.ts:18-39`) is already the single contract shared
by the game renderer (`renderer.ts:1444`) and the editor stage (`map-editor-stage.ts:711`). Adding
`+ offsetX * 16` / `+ offsetY * 16` to the anchor makes both follow by construction, including the
renderer's y-sort, which sorts on that same anchor.

The editor grid gains quarter sub-divisions in Element mode only.

## Section 3 — sub-cell collision

### The collider is authored on the catalogue asset

`EditorPlacementMetadata.collisionFootprint` (a cell list) is replaced by:

```ts
collider?: Rect; // pixels, relative to the sprite's visible foot
```

The origin is where the art's visible foot lands: `footX = col * 64 + 32 + offsetX * 16`,
`footY = (row + 1) * 64 + offsetY * 16`. World AABB:
`{ x: footX + collider.x, y: footY + collider.y, width, height }`. The offset therefore carries the
collider with the sprite for free.

**Foot space, deliberately not anchor space.** `createCatalogElementView` positions the sprite
container at `(row + 1) * 64 + footOffset`, which is *not* where the art appears: `footOffset` is
`frameHeight - alphaBboxBottom`, so it cancels out and the visible foot always lands exactly on the
cell's bottom edge. The container point is `footOffset` px *below* the pixels. Authoring against it
would make every collider `footOffset`-dependent — the exact coupling this encoding exists to avoid,
and one that silently plants a tree's collider in the empty cell to its south. Foot space is
`footOffset`-independent by construction: you measure the trunk up from the ground line on the PNG,
and the same numbers work for every asset.

Cell space was rejected for the same family of reasons, plus needing an extra `+32` in every value.

This is the same indirection the tiles already use — `tile id → tileset → passable`, authored once
per tile, never per cell. Per-placement collider editing is explicitly out of scope (YAGNI); the
point of the catalogue is that it arrives correctly configured.

`terrainOverride: "walkable"` (the two wooden bridges) stays cell-based. It reclaims water cells in
the tile grid; that is a grid operation, not a collider.

The catalogue generator (`scripts/tiny-swords-catalog-lib.ts:552-558`) keeps its build-time
invariant, adapted: the `collider` must fit inside the bounding box of `visualFootprint`, build
failure otherwise.

### `TerrainGeometry` is the propagation channel

```ts
export interface TerrainGeometry extends WorldBounds {
  obstacles: readonly Rect[];
  spawnPoints: readonly Vec2[];
  safeZone: Rect | null;
  tiles: TileMap;
  colliders: ColliderIndex; // new
}
```

Every caller of `resolveTerrain` already receives the geometry — client prediction
(`prediction.ts:58`, `net.ts:136`), server movement (`movement-system.ts:84`), skills
(`skill-system.ts:65`), monsters (`monster-system.ts:273`, `:366`) and the editor preview
(`map-preview.ts:129`). Putting colliders on the geometry propagates sub-cell collision to all of
them with no rewiring. Anywhere else would require touching each site, which is how the two sources
would silently drift apart.

```ts
export interface ColliderIndex {
  cols: number;
  rows: number;
  /** `cols * rows` buckets, row-major, indexed like `TileMap.kinds`. */
  buckets: readonly (readonly Rect[])[];
}
```

`ColliderIndex` buckets the AABBs **by cell** at bake time — an AABB spanning several cells is
listed in each of them, so a bucket lookup never has to consult neighbours. `isWalkableBox` already iterates the
cells a body overlaps; the collider test consults only those buckets. Cost stays bounded by body
size, not by the 400-element cap.

### `isWalkable` is the single junction, and stays single

```
isWalkable(position, size, geometry)
  = isWalkableBox(geometry.tiles, position, size)
  && !overlapsCollider(geometry.colliders, position, size)
```

`bakeElements` (`map-data.ts:308-331`) stops writing `"forest"` for collision footprints and keeps
only the `walkable` override pass. `step()` is untouched — it never consulted collision and must
stay the lowest layer, importing neither `tilemap.ts` nor `game.ts`. `resolveTerrain` is untouched
too, since it goes through `isWalkable`.

`resolveTerrain` hardcoding `PLAYER_SIZE` (`game.ts:853-854`) is a known wart and stays as-is;
widening it to take a `size` touches six callers and is out of scope for this tranche.

### The wire

`WorldInfo` gains `colliders` **beside** `tiles`. The protocol invariant is preserved, not broken:
collision remains baked and transported as such, now in two structures instead of one.
`elements` / `layers` / `events` stay appearance-only (`protocol.ts:277-300`).

Making `WorldInfo.elements` a collision source instead would force the client to redo the bake, and
a client-side bake that disagrees with the server's is exactly the silent desync the current design
exists to prevent.

### The three direct `terrain.tiles` readers

- **A\*: free.** `createNavigationGrid` (`navigation-system.ts:94-98`) already has a second pass
  testing `isWalkable(pointForNode(grid, node), PLAYER_SIZE, terrain)`. Once `isWalkable` knows
  colliders, a node whose waypoint is eaten by a trunk drops to 0. A partially blocked cell is
  therefore **walkable if the 32×32 body fits at the waypoint, blocked otherwise** — conservative
  and consistent with the existing rule. `cellSize` stays `TILE_SIZE`; the removed per-zone
  `cellSize` is not coming back.
- **Projectiles: natural extension.** `sweptProjectileTerrainImpact`
  (`directional-combat.ts:330-366`) already does segment-vs-AABB against radius-dilated cell boxes.
  It additionally sweeps the collider buckets of the cells it traverses. `TerrainImpact.id` widens
  from `"row:col"` to an id that admits both origins; terrain still wins exact ties
  (`compareImpacts`).
- **`isPathWalkable`** (`tilemap.ts:118`, called from `monster-system.ts:214`) must learn colliders,
  or a monster walks through a trunk.
- **`hasLineOfSight` (`game.ts:783-807`) stays tile-only.** It tests centres, not bodies, and it is
  an AI heuristic, not damage truth. A thin trunk does not break line of sight. Deliberate.

### Validation

`parseMapElements` (`map-data.ts:333-356`) currently bounds-checks nothing, precisely because
elements were not collision. That is no longer true. Server and client both must now validate:
`col`/`row` inside the map, `offsetX`/`offsetY` integers in `0..3`, `assetId` known. The legacy
`{kind, variant}` migration path via `legacyElementAssetId` is preserved.

### Gameplay behaviour changes

Two, both accepted:

- **Trees shrink.** A tree blocked a full 64×64 cell; it will block its trunk (~24×20). That is the
  point of the tranche, but already-authored content becomes passable where it was not.
- **Bushes stay non-colliding.** `bushe1` has `collisionFootprint: []` today. It gets no `collider`,
  so behaviour is identical. Giving bushes a collider is a separate game-design decision.

## Documentation to update

The "one source of collision truth" invariant is stated in three places and all three become
misleading if left alone:

- `map-data.ts:276-282` (`bakeCollision`'s comment about `isWalkableBox`/`step`/`prediction.ts`
  never learning that elements exist)
- `protocol.ts:277-300` (appearance-only contract — clarify that it still holds, and why)
- `navigation-system.ts:66-76`
- `CLAUDE.md`, the "Maps and the editor" section

## Testing

- `prediction.test.ts` gains an assertion replaying commands against a sub-cell collider. This is
  where a client/server collision divergence would show up, and it is the load-bearing test.
- Pure unit tests: the collider bake, the bucketed index (including a body spanning four cells), the
  projectile sweep against a collider, `isWalkable` at collider edges.
- Editor: mode switching, mode-scoped eraser, quarter-cell quantisation round-trip
  (`px → col/offset → px`).
- Authoritative flow through the existing real Durable Object harness: a player cannot walk through
  a trunk, and can walk through the canopy cell beside it.
- Round-trip: save and reload a map with offsets, through the real D1 boundary.
