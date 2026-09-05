# Docs index

`AGENTS.md` at the repo root holds the rules. These hold the reasoning behind them — read one when
the task is in its subject, not before.

## Read before touching that subject

| Doc | Read it when |
| --- | --- |
| [hd2d-rendering.md](./hd2d-rendering.md) | anything in the render path — what makes the HD-2D style, and what the deleted PixiJS renderer knew that nothing else records |
| [Priest animation pipeline](../studio/pixel-art/priest-prototype/README.md) | regenerating the Priest raster clips, distance clock, weapon sockets, preview and validation |
| [adventure-runtime-architecture.md](./adventure-runtime-architecture.md) | world routing, room ownership, hero location persistence |
| [directional-action-combat.md](./directional-action-combat.md) | skill geometry, timings, limits, Tiny Swords mappings |
| [cooperative-combat.md](./cooperative-combat.md) | threat, contribution eligibility, XP split, resource costs |
| [monster-navigation.md](./monster-navigation.md) | A* generation, budgets, debug mode, known limits |
| [persistence-model.md](./persistence-model.md) | the normalized hero child tables and their epoch fence |
| [structured-quest-model.md](./structured-quest-model.md) | quest definitions, progression rows, rewards |
| [peasant-runtime.md](./peasant-runtime.md) | harvest jobs, camps, rations, support requests |
| [rogue-and-talent-variants.md](./rogue-and-talent-variants.md) | class variants and the talent tables |
| [authored-world-behaviours.md](./authored-world-behaviours.md) / [authored-npc-movement.md](./authored-npc-movement.md) | authored monsters, guards, NPC movement |
| [catalogued-map-elements.md](./catalogued-map-elements.md) | placing catalogue art, sub-cell colliders |
| [music-system.md](./music-system.md) | the music catalogue, its generation and its checks |
| [testing-cheats.md](./testing-cheats.md) | driving a running game as an agent (`/tp` and friends) |
| [adventure-creator-direction.md](./adventure-creator-direction.md) / [adventure-editor-roadmap.md](./adventure-editor-roadmap.md) | where the creator tools are going |
| [mmo-architecture.md](./mmo-architecture.md) | the security/limits review of the whole runtime |

## Historical — do not search here

`docs/archive/` is 81 specs and plans for work already shipped, kept because several are cited by
name as the design record. They describe the repo as it was on the date in their filename, so a
grep hit there is usually a wrong answer with a confident tone. Read one only when a doc or
`AGENTS.md` links it deliberately.

The same applies to the dated audits and reports beside this file
([directional-action-combat-audit.md](./directional-action-combat-audit.md),
[editor-quest-refactor-report.md](./editor-quest-refactor-report.md),
[hd2d-transition-audit-2026-08-09.md](./hd2d-transition-audit-2026-08-09.md),
[mmo-migration-plan.md](./mmo-migration-plan.md),
[playable-adventure-vertical-slice-audit.md](./playable-adventure-vertical-slice-audit.md),
[s3-open-work.md](./s3-open-work.md),
[tiny-swords-ui-migration.md](./tiny-swords-ui-migration.md)): snapshots of a moment, not statements
about today.

[generated/tiny-swords-catalog-coverage.md](./generated/tiny-swords-catalog-coverage.md) is written
by `yarn catalog:build`. Never edit it by hand.
