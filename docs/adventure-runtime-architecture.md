# Adventure runtime architecture

This document fixes the domain boundaries the current map editor must grow toward. It is an
architecture contract, not an instruction to implement the complete runtime in the catalogue and
static-scenery milestone.

## Principles

- The server remains authoritative for movement, actions, state transitions and persistence.
- An adventure definition is versioned authored content; a game session is mutable runtime state.
- A saved game references the exact adventure version it was created from.
- Stable identifiers cross persistence and network boundaries. Source paths and array indexes do
  not.
- Shared and per-player state are explicit. Events and quests never infer their scope from where a
  value happened to be stored.
- The existing `sessionEpoch` fence continues to protect character writes and inter-room handoffs.
- One live session admits at most four players. MMO population and public-world sharding are not
  product requirements.

## Adventure

An `Adventure` is the author-owned container for a complete work.

```ts
interface Adventure {
  id: string;
  authorAccountId: string;
  version: number;
  status: "draft" | "published";
  title: string;
  description: string;
  mapIds: string[];
  start: { mapId: string; entryId: string };
  settings: AdventureSettings;
  music?: AssetId;
}
```

Published versions are immutable snapshots. Editing a published adventure creates a draft for the
next version so active sessions and saves cannot silently change underneath their players.

## AdventureMap

`AdventureMap` evolves today's D1 `map`: terrain plus catalogued static elements, entry/exit points,
events, ambience and music. Elevation is deliberately reserved for a later format version.

```ts
interface AdventureMap {
  id: string;
  version: number;
  terrain: TerrainData;
  elements: MapElement[];
  entries: MapEntry[];
  exits: MapExit[];
  eventIds: string[];
  ambience?: AssetId;
  music?: AssetId;
  elevation?: FutureElevationData;
}
```

An exit names a server-owned destination map and entry. Client intent may request interaction with
an exit but never supplies the destination. Static map elements use semantic `assetId` values and
shared footprint/collision metadata. Runtime entities are separate collections rather than special
static element kinds.

## Event

An `Event` is a stable graph node with one trigger, ordered conditions and ordered actions.

- Triggers include interaction, map entry, region entry, timer and explicit event signal.
- Conditions read typed variables, inventory, quest state, party composition or prior event state.
- Actions mutate variables, show dialogue, move entities, grant rewards, start quests or signal
  another event.
- Scope is `shared` or `player`; storage and replication follow that declaration.
- Repeat policy is `repeatable`, `oncePerSession` or `oncePerPlayer`.

Every action is validated and executed server-side. The client may render an editor graph and send
authoring data, but cannot announce that a condition passed or an action completed.

## Dialogue

A `Dialogue` contains stable nodes. Each node owns localized text keys, a speaker/portrait role and
ordered choices. Choices can have conditions, variable substitutions and effects; effects are event
actions, not a second mutation language. A dialogue cursor can be shared for a party cutscene or
individual for a personal conversation.

## Quest

A `Quest` is a versioned definition with stable ordered steps. Each step declares objectives,
conditions and transitions. Completion rewards use the existing idempotent one-time claim pattern.
Quest scope is explicitly `shared` or `player`; progress records pin the quest definition version so
later author edits do not corrupt an active save.

## GameSession

A `GameSession` is the live authoritative playthrough.

```ts
interface GameSession {
  id: string;
  adventureId: string;
  adventureVersion: number;
  hostAccountId: string;
  maxPlayers: 1 | 2 | 3 | 4;
  visibility: "private" | "invite" | "friends";
  inviteCodeHash?: string;
  presentCharacterIds: string[];
  loadedMapIds: string[];
  sharedState: SessionState;
}
```

The first implementation should keep one authoritative Durable Object per session and load only the
active map(s) required by its players. Whether players may occupy different maps simultaneously is a
later policy decision; the data model must not encode "one current map forever". Join-in-progress
admission verifies the account, invite policy, four-player cap, adventure version and character
lease before exposing state.

## AdventureSave

An `AdventureSave` is a crash-safe snapshot/checkpoint of a session. It records:

- session id, adventure id and exact adventure version;
- participating accounts/characters and their persistent progression references;
- present map and position for each player;
- shared and individual typed variables;
- triggered one-shot events and repeat counters;
- shared and individual quest progress;
- persistent chest/resource state and collected rewards;
- defeated bosses and other authored durable entities;
- the server revision used for optimistic/idempotent save coordination.

Resume creates a new live lease over this state. D1 commits the durable checkpoint; Durable Object
storage may cache active state but is not the only copy. Saves use a monotone revision and idempotency
key so an interrupted write leaves either the old complete checkpoint or the new complete checkpoint,
never a mixture.

## Compatibility with today's map model

The current `map` and `map_element` tables remain useful, but a map must stop carrying implicit
adventure/session meaning. The static-element migration uses stable catalogue ids and a versioned
payload reader that accepts legacy `kind`/`variant` rows. Later Adventure tables should reference map
versions rather than mutate a map underneath a published adventure.

Compiled catalogue zones remain temporary compatibility content for Verdant Reach and integration
tests. Their authoritative movement, fencing and network behavior are reusable; their product name
and MMO capacity assumptions are not.

## Recommended implementation order

1. Catalogue and Tiny Swords UI foundation.
2. Stable catalogued static map elements and footprints.
3. Versioned Adventure container with connected maps and entry/exit definitions.
4. Typed variables plus event triggers, conditions and actions.
5. Dialogue nodes and choices over the event action language.
6. Versioned shared/individual quests.
7. One-to-four-player lobby, invite policy and join-in-progress admission.
8. Atomic AdventureSave checkpoints and resume.
9. Elevation as a new map format version.
10. Professions and the Farmer class.

Events, dialogue and the complete lobby are intentionally out of scope for the catalogue/editor
foundation. The goal now is to ensure stable assets, maps and persistence leave room for them.
