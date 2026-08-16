# The spawn you can see, and the start map you can choose

Two authored facts decide where a party begins: **which map**, and **where on it**. Both already
exist. Neither is visible, one is mislabelled as a fallback, and the other is not authored at all —
it is re-derived on every join from content that was never meant to carry it.

This spec makes both explicit. It ships in two increments; the second is designed here so the
reasoning survives, but earns its own plan.

## What is actually true today

### The map spawn is the landing cell, not a fallback

`MapData.spawn` (`{col,row}`, `packages/engine/src/map-data.ts:103`) is stored as
`spawnCol`/`spawnRow` (`packages/server/src/api/entities/maps.ts:41`) and compiled into the
heightfield as exactly one entry:

```ts
// packages/engine/src/hd2d/authored-map.ts:185
spawns: [{ name: "default", x: authored.spawn.col + 0.5 - size / 2, z: authored.spawn.row + 0.5 - size / 2 }]
```

**One per map is structural**, not a rule anyone enforces: it is a single field, and the compiler
emits a single-element array from it. There is nothing to add.

That one cell is where a hero lands on this map by *every* route — adventure start
(`HeroService.startOn`, `packages/server/src/api/services/HeroService.ts:140`), exit-anchor
transition (`WorldRoom.ts:1518`), cross-map teleport (`WorldRoom.ts:1606`), admission reseat
(`WorldRoom.ts:447`), playtest (`TestSessionService.ts:95`) and the editor's own preview
(`map-preview.ts:98`). All of them go through `mapEntryPosition`
(`packages/engine/src/terrain-access.ts:531`), which takes the authored point and finds real ground
near it.

The editor calls it **"Map fallback / preview"** (`editor.tool.spawn`,
`packages/engine/src/i18n/en.ts:1158`), with a hint sending the author to Events mode for "the
global adventure start". `AdventureSettingsDialog.tsx:48` repeats the same claim in a comment. The
copy is wrong in the way that matters: this *is* the start position, and the thing it points at is
not.

### The start map is derived, not authored

`HeroService.resolveHeroStart` (`HeroService.ts:319`) runs three tiers on every hero creation and on
admission when the stored map is gone:

1. the earliest-created member map carrying a `kind: "spawn"` event — ties broken by row, then col;
2. `adventure.graph.start.mapId` — legacy compat, from the retired graph authoring;
3. the earliest-created member map.

**All three return `startOn(map)`**, whose position always comes from that map's own
`heightfield.spawns[0]`. The spawn event's own cell is never read. `HeroService.ts:130-138` states
why: a tile-editor cell cannot address a heightfield grid. So the event picks a MAP and nothing
else, while being labelled "Adventure start" (`editor.event.kind.spawn`, `en.ts:1944`) as though it
picked a point.

Nothing enforces one spawn event per adventure, or per map. Two of them is not an error; it is a
tie, resolved silently by map age.

### `maps.isFirst` is not the start map

It is tempting and it is wrong. `isFirst` (`packages/server/src/api/entities/maps.ts:65`) is
**account-scoped**, guarded by a partial unique index on `(userId) WHERE is_first = 1`, and set only
for a user's very first map ever (`MapService.ts:246`). It is never read by `resolveHeroStart`. Its
owner-fenced route `POST /api/maps/:id/first` (`MapController.ts:256`) has no caller outside tests.

Reusing it would mean an author's second adventure could not have a start map. **Do not.**

## Increment 1 — see the spawn, and mean it

Editor, renderer and the two dictionaries. No schema, no migration, no protocol, and nothing in
`packages/server`. Deployable on its own.

### The marker

`Hd2dEditorOverlay` (`packages/renderer/src/hd2d/visual-layer.ts:124`) gains:

```ts
/** The map's one hero start cell, in world coordinates. Drawn persistently, not as a selection. */
spawn?: GroundVector | null;
```

`map-editor-stage.ts`'s `setEditorOverlay` call (`:300`) fills it from `map.spawn`, using the same
`col + 0.5 - size / 2` conversion `selectionPoint` already uses (`:142`).

Drawn as a **flag pin over a tinted cell**: a billboarded flag so it reads at any zoom against any
terrain, and a tinted cell outline underneath so the exact cell is unambiguous. Deliberately not the
Warrior sprite the palette previews with — that would look like a placed element and invite clicking
and deleting it as if it were one, which the stage already refuses (`map-editor-stage.ts:835`).

**Visible in all three modes.** The spawn is a fact about the map, like the save rect, not a
Field-mode tool artefact. Hiding it in Element mode is exactly how an author drops a chest on the
spawn — which `keepsSpawnClear` (`editor-state.ts:979`) then refuses, with no visible reason why.

### Build it once, not per hover

`setEditorOverlay` runs on **every hover** — the file says so at `visual-layer.ts:321` and caches
`#gridLines` for that reason, and `c690d0c2` was spent fixing a stall of exactly this shape. The pin
geometry and material must be built once per map and repositioned, never rebuilt in
`setEditorOverlay`. A per-hover `new THREE.PlaneGeometry` here is the same bug with a new name.

### Moving it needs no new code

The chain is already whole and tested: Field palette (`TerrainPalette.tsx:232`) → `selectSpawn`
(`AdventureEditorScreen.tsx:815`) → stage click (`map-editor-stage.ts:492`) → `applyTool` case
`"spawn"` (`editor-state.ts:1346`, which refuses a covered or non-walkable cell) → `EditorMap.spawn`
→ `toSaveInput` → `spawnCol`/`spawnRow` + recompiled heightfield.

What was missing was feedback: before this increment the click changes nothing an author can see
unless the spawn happens to be the current selection. The marker is the fix; the tool is fine.

### Copy

| key | was | becomes |
| --- | --- | --- |
| `editor.tool.spawn` | Map fallback / preview | Hero start point |
| `editor.tool.spawn.hint` | "…technical fallback. Place the global adventure start in Events mode." | where a hero lands on this map, by any route |
| `editor.inspector.spawn` | Map fallback and test start | Hero start point |
| `editor.error.spawn` | The map fallback point must be… | The hero start point must be on walkable ground. |

Both dictionaries, as always. The stale comment at `AdventureSettingsDialog.tsx:48` goes with them.

### Tests

- `map-editor-stage.test.tsx`: the overlay carries `spawn` at the map's cell; it survives a mode
  switch to element and event; it follows a `applyTool` spawn move; and it is **not** rebuilt on a
  hover that did not move the spawn.
- `editor-state.test.ts` already covers the move and the clearance guards (`:822`, `:525`, `:782`).
  Nothing to add.

## Increment 2 — the start map becomes a field

Its own plan. Designed here because increment 1's copy only makes sense if this is where it lands.

### Schema and resolution

- `adventures.startMapId`, nullable text. Nullable means "derive", the same contract
  `adventureTestSessions.startMapId` already uses (`TestSessionService.ts:211`).
- `AdventureService.updateAdventure` validates it names a member map, mirroring the `graph.start`
  check it replaces (`AdventureService.ts:181`), answering the existing `map` error code.
- `resolveHeroStart` drops to two tiers: `startMapId` when it still names a member map, else the
  earliest-created member map. Tiers 1 and 2 are deleted with the things that fed them.
- Deleting the start map clears the column, mirroring `reassignFirstIfNeeded`
  (`MapService.ts:611`) rather than leaving a dangling id.

### The spawn event kind dies

- `"spawn"` leaves `EVENT_KINDS` (`packages/engine/src/map-events.ts:70`) and
  `EventPalette.FUNCTIONAL_KINDS` (`EventPalette.tsx:36`). `spawnEvents()` (`map-events.ts:361`) is
  deleted — it has no production caller.
- **A stored spawn event must not fail the parser.** Precedent is `"glace-fine"` (see
  `packages/engine/CLAUDE.md`): a removed enum value that exists in stored rows is coerced, never
  rejected, because rejecting one value rejects the whole map. `parseMapEvent` DROPS a
  `kind: "spawn"` event. It is inert at runtime, so dropping it loses nothing an author could
  observe.
- One migration writes `startMapId` from today's derivation — tier 1, then tier 2 — before the rows
  go, so Brumeval, Sombregué and La Baie des Cent Voiles start exactly where they start now.

### Authoring the choice

`MapListPanel` grows a one-at-a-time star per row, on the existing owner fence. The panel's current
test asserts the *absence* of a start affordance (`map-list-panel.test.tsx:185`, from the graph
teardown in `fb126e99`) — that assertion is inverted here deliberately, and its comment should say
so: the graph is still gone, and this is not the graph coming back.

### Carriers

`adventure-bundle.ts` (which today round-trips `graph`, `:61`), `scripts/lib/bundle-validate.ts`,
and the four `scripts/legacy/*/maps.ts` seed scripts that place spawn events.

## Out of scope

`maps.isFirst` and `POST /api/maps/:id/first` are dead in the client and mean something else. They
are confusing next to this work and should be removed or renamed one day. Not here — nothing in this
spec touches them, and mixing that removal in would put an unrelated schema change in the same
migration as the one adventures depend on.
