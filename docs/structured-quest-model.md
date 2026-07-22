# Structured quest model

`packages/engine/src/quests.ts` is the single source of truth for authored quests. The editor,
server publication boundary and runtime must use its parser and diagnostics rather than maintaining
parallel validation rules.

## Definition schema

Quest schema version 2 models:

- personal or party scope;
- manual or automatic acceptance;
- automatic completion or an explicit turn-in;
- repeat/abandon rules and an optional recommended level;
- giver and turn-in event references;
- level, previous-quest, switch, variable and quest prerequisites;
- simultaneous or sequential objectives;
- experience, gold, item, choice, next-quest, state and advanced-command rewards;
- dialogue for unavailable, offer, accepted, refused, active, ready, turn-in and completed states.

Objectives are discriminated data, not free counters. Version 2 supports monster kills, a precise
target defeat, inventory/acquisition collection, item delivery, talk/interaction, map/area reach,
item use, registered activities and a compatibility-only manual objective. Every objective keeps a
stable four-digit id. An empty `label` means that player/editor UI generates localized wording from
the structured target; a non-empty label overrides only the presentation, never the rule.

## Compatibility conversion

No D1 schema migration is required because definitions already live in `adventure.registry` JSON and
party progress already lives in `party_adventure_state.quests` JSON. The total parsers perform an
explicit, tested conversion:

- a legacy `{ id, title, description, objectives: [{ id, label, target }] }` definition becomes a
  schema-v2, version-1 party quest with `manual` objectives;
- an old active progress row is upgraded with version/reward metadata on read;
- an old completed row is marked already rewarded, preventing newly authored rewards from being
  retroactively granted after deployment.

The next successful adventure save persists the normalized schema-v2 representation.

## Version safety

Quest versions are assigned by the server. New definitions start at 1, unchanged definitions keep
their stored version, and a material edit increments exactly once; a client-supplied counter is
ignored.

When a quest starts, its progress pins the complete accepted definition. Normalization and player
tracking use this snapshot even if the current adventure edits or deletes the quest. Consequently an
in-progress save never receives a shorter target, different reward or changed dialogue by accident.
A repeatable quest can pin the then-current definition on its next attempt.

## Validation

`validateAuthoredQuests` emits machine diagnostics with `error` or `warning` severity. It checks
broken maps, events, items, activities, switches and variables; missing acceptance/turn-in routes;
missing or cyclic prerequisite quests; invalid next-quest links; sequential stage gaps; empty or
optional-only objective sets; and manual compatibility objectives. Publication, full test mode and
the quest workspace should all render these same diagnostics with localized creator-facing text.

## Authoritative automatic progression

`packages/engine/src/quest-runtime.ts` defines the platform-free business-event language and builds
target indexes once per loaded adventure. A monster kill, item mutation, interaction or arrival
looks up only the objectives registered for that species/item/event/map/area/activity; the tick loop
never scans every quest.

`GameSession` consumes server-minted events in one serialized write queue. Party quests advance once
per event even when several members qualify. Personal quests are saved immediately in `hero_quest`
behind the hero's `session_epoch` fence, while party progress continues to use the durable
alarm-backed `party_adventure_state` save. Every progress row keeps a bounded set of business-event
ids so a retry cannot grant that fact to a second objective or sequential stage. Progress stops after the
party's authoritative `open -> completed` transition.

Combat credit deliberately reuses the existing contribution model:

- `killer` credits only the finishing hero;
- `contributors` credits heroes with meaningful combat participation inside reward range;
- `nearby-party` credits those contributors plus nearby members eligible for the existing shared XP
  rule.

World emits `monsterKilled`, `itemAcquired`, `itemRemoved`, `itemUsed`, `objectInteracted`,
`npcTalked` and `mapEntered` only after the corresponding authoritative mutation or interaction.
The engine also indexes `bossDefeated`, `areaEntered` and `activityCompleted` for domain systems that
register those facts. Legacy `advanceQuest` commands remain accepted only for explicit `manual`
objectives; they cannot double-progress a structured objective or write personal state into the
party coordinator.
