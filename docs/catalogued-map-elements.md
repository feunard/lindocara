# Catalogued map elements

Map scenery is persisted with Tiny Swords catalogue ids. A canonical element is:

```ts
interface MapElement {
  col: number;
  row: number;
  offsetX: 0 | 1 | 2 | 3;
  offsetY: 0 | 1 | 2 | 3;
  assetId: EditorAssetId;
}
```

`col` and `row` are the authored ground anchor; `offsetX` and `offsetY` choose one of the cell's
sixteen quarter-tile slots. `assetId` is stable across physical file moves and is the only
client-selectable art reference accepted by the map API. Source paths, animation frames, anchors,
foot offsets, suggested placement terrain, render layer, visual footprint and collision footprint
come from `src/shared/tiny-swords-catalog.ts` on both sides of the network. Suggested terrain is
advisory: every known scenery asset may be placed on grass, cliffs or water.

## Validation order

The API parses untrusted payloads into known editor asset ids, then validates the complete map in
one pass before any D1 write:

1. the id exists and is explicitly available to the editor;
2. the full visual footprint stays inside the map;
3. no second element already occupies the same cell + quarter-tile slot;
4. no footprint covers the spawn;
5. the collision bake leaves the spawn walkable;
6. the element count remains at or below 400.

Collision uses only the explicit catalogue footprint. It never derives gameplay collision from an
image's alpha bounds. Bridges may declare a walkable terrain override for their deck; all other
scenery leaves the authored terrain intact.

## Legacy maps

No D1 schema migration is needed: `map_element.kind` is already text. Rows containing `tree`,
`bush` or `stone` plus `variant` are normalized deterministically to stable catalogue ids on read.
The API also accepts that legacy JSON shape. Every subsequent successful whole-map save writes the
canonical id into `kind` with `variant = 0` inside the existing guarded D1 batch.

This lazy read/new write strategy has two safety properties: an old map remains enterable before it
is edited, and a rejected save leaves every legacy row untouched rather than partially converting a
map. Existing edge-anchored legacy props are readable even when their newly explicit visual
footprint overhangs the map; newly authored placements must satisfy the stricter full-footprint rule.

## Current limits

- Elements have one quarter-tile anchor and no rotation, tint, arbitrary scale or per-instance
  animation state.
- Visual overlap is allowed; only an identical cell + quarter-tile storage slot is refused.
- Terrain is three layered tile ids over an authored tileset, with a three-level elevation brush;
  see [`docs/superpowers/specs/2026-07-18-layered-map-model-design.md`](./superpowers/specs/2026-07-18-layered-map-model-design.md).
- Static scenery and simple authored strips are placeable. Mobile units, AI, NPCs, events,
  dialogues, quests and complex interactive animation remain browser-only catalogue families.
- The map remains a standalone object. Adventure-level map links, entry points and event graphs are
  designed in `adventure-runtime-architecture.md` but are not persisted yet.
