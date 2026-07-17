# LindoCara adventure creator direction

## Product vision

LindoCara is a modern creator for cooperative 2D RPG adventures. It takes the approachable map-led
authoring spirit of RPG Maker and makes cooperative play, authoritative simulation and resumable
sessions native concerns rather than add-ons. A creator should eventually be able to assemble a
complete adventure from connected maps, scenery, events, dialogue, quests, conditions and
cinematics, then launch it alone or with as many as three other players.

The former MMO direction is retired as a product goal. Existing server-authoritative movement,
prediction, combat, Durable Objects, D1 persistence, characters, presence leases and message
validation remain valuable implementation foundations. They must evolve deliberately rather than
being deleted because the product vocabulary changed.

## Tiny Swords is the visual source of truth

The three Tiny Swords packs under `assets/` define the visual language of the whole product:
terrain, buildings, units, enemies, resources, effects, cursors, controls, windows, HUD, inventory
and editor. Before drawing a substitute in CSS, generating an image or retaining art from another
source, contributors must check the semantic Tiny Swords catalogue. Assets keep their native frame
size, pixel rendering and authored anchor; layout adapts around them rather than distorting them.

`assets/index.json` is a technical inventory of source files. The semantic catalogue layered above
it assigns stable product identifiers, roles and placement metadata. Saved data uses those stable
identifiers, never physical paths.

No remote art is loaded at runtime and this direction does not authorize redistribution of the
source packs. `assets/LICENSE.md` records the licence verification still required from a human.

## Domain vocabulary

- An **Adventure** is the authored, versioned work: its metadata, ordered collection of maps,
  starting point, settings and later event/dialogue/quest graphs.
- An **AdventureMap** is one spatial scene inside an adventure: terrain, static scenery, entrances,
  exits, atmosphere and later events. A D1 map today is the foundation of this object, not an
  adventure by itself.
- A **GameSession** is one live playthrough of a pinned adventure version, with one host and at most
  four present players. Players may join it after it starts.
- An **AdventureSave** is the durable checkpoint of a session: players, positions, shared and
  individual variables, triggered events, quest state and persistent world changes. Loading a save
  recreates a session against the adventure version it references.

Keeping these nouns separate prevents map CRUD, publication state and live party state from being
collapsed into one table or one Durable Object attachment.

## Delivery progression

1. Establish the semantic asset catalogue and Tiny Swords UI foundation.
2. Expand maps from terrain plus three props into stable catalogued scenery with shared placement
   and collision rules.
3. Add a versioned multi-map Adventure container with explicit entry and exit points.
4. Add events, conditions, actions and shared/individual variables.
5. Add branching dialogue.
6. Add reusable quest definitions and objectives.
7. Add lobbies and join-in-progress GameSessions for one to four players.
8. Add AdventureSave creation and resume.
9. Add elevation after map/event compatibility is stable.
10. Add professions and the Farmer class on top of resources, variables and persistence.

## What already exists

- authoritative movement, combat and action validation;
- client prediction, reconciliation and interpolated remote players;
- authenticated accounts, up to three persistent characters and fenced saves;
- room-local Durable Object simulation and presence leases;
- D1-backed atomic map CRUD with a protected first map and built-in fallback;
- WYSIWYG PixiJS map painting, camera movement, zoom and continuous paint;
- shared terrain, placement and collision rules used by editor, preview and server;
- unsaved client preview using the real movement simulation;
- localized React UI and an existing Tiny Swords world-art integration.

## Scope of the catalogue/editor foundation

This foundation catalogues all source art, migrates active UI chrome to Tiny Swords, exposes a
progressively loaded asset browser, makes the editor palette catalogue-driven and persists stable
asset identifiers while reading legacy tree/bush/stone maps. It also records the future runtime
boundaries.

It does **not** implement the complete event engine, dialogue editor, quest editor, cinematics,
publication workflow, lobby, invite system, join-in-progress orchestration, session save/resume,
elevation or professions. Static assets may be discoverable in the browser before their gameplay
runtime exists; mobile units, enemies and complex interactive animations are not placeable map
elements in this phase.
