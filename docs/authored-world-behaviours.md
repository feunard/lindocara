# Authored world behaviours

These systems are adventure-agnostic. They are evaluated from authored map events and shared party
state; clients only render the resulting state.

## Moving NPCs

A normal event whose active page uses a character graphic can use the existing `moveType` fields:

- `fixed`: remains at its authored or current state position.
- `random`: chooses deterministic, terrain-safe neighbouring steps.
- `approach`: approaches the nearest living player while inside the interaction area.
- `custom`: follows a deterministic short route around its authored position.

`moveSpeed` and `moveFreq` control cadence. The server pauses an NPC during its dialogue or event
run, owns its position, and broadcasts that position in snapshots. Changing the active page can
change the graphic, role, movement mode or presence without client-side simulation.

## Conditional encounters

Monster and guard events select their highest eligible page from party switches and variables.
The server reconciles the room roster when shared state changes:

- an event with no active page has no runtime actor;
- a newly eligible event spawns at its authored cell;
- an ineligible actor is removed;
- defeat executes only the commands on the page that was active for that actor.

This is suitable for bosses introduced by a decision, reinforcements, truce outcomes and faction
occupation. Conditions must not be emulated by hiding a still-active combat actor on the client.

## Transition categories

Every newly authored `teleport` records one of:

`geographic`, `interior`, `shortcut`, `magical`, `memory`, `puzzle`, `recovery`.

The category is descriptive metadata; destination membership, collision, save fencing and handoff
remain server-authoritative. `buildAuthoredTransitionGraph()` derives a readable cross-map graph
from the event programs and excludes same-map puzzle/recovery jumps, so conditional story gates
remain intact without polluting world topology. Legacy teleports parse as `geographic`.

## Quest presentation

Authored quests carry `category`, `region`, `landmark`, `giverName` and `knownConsequence`.
Manual quests become available when their prerequisites hold, but only an interaction with their
bound giver can accept or refuse them. The HUD tracks one main quest and at most two side quests;
the journal keeps available, active, completed, abandoned and lore entries separate.
