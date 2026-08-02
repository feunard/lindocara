# Peasant runtime and authoring contract

The Peasant is LindoCara's fifth playable class. It is intentionally weak in direct combat and
creates value through server-authoritative harvesting and party support. This document records the
storage and gameplay decisions that must remain stable across maps, reconnects, and editor changes.

## Economy and ownership

- Wood, stone, iron, and meat are a shared party stock in `PartyAdventureState`. A harvested unit
  benefits every party member and follows the adventure save across maps.
- Gold is not a party material. Gold harvests credit the existing per-hero gold economy through its
  epoch-fenced, idempotent ledger; there is no parallel currency counter.
- Support costs are resolved from typed skill/talent data and spent only by the party coordinator.
  A durable support-spend journal makes debit, compensation, and acknowledgement replay
  idempotent; the browser never submits a cost or quantity.
- Wood, stone, and meat fund the makeshift camp and its rations. Iron and stone fund the homemade
  bomb. Materials therefore have gameplay uses in the first implementation rather than serving as
  decorative counters.

Shared stock was chosen because the class is a cooperative economic role and party adventure state
already provides the correct cross-map ownership boundary. Personal materials would duplicate that
storage and make one Peasant's contribution unavailable to teammates.

Harvest progression remains personal: the Peasant who authoritatively exhausts a node earns a
resource-specific share of the XP required for their current level (wood 3%, stone 4%, meat 5%,
iron 6%, gold 8%). Intermediate hits, cancelled channels, stale generations, and losing a concurrent
reservation grant no XP. This percentage-based curve keeps gathering useful at later levels without
letting the support class level faster than specialized combat heroes.

## Explicit harvest profiles

An authored harvestable event stores a validated `HarvestProfile`; gameplay is never inferred from
an asset id, filename, or directory. The profile names the resource, required tool, reward or gold
value, hit count, range, channel duration, exhaustion behavior, optional exhausted appearance,
fade duration, and permanent or timed respawn policy. Presets provide editable defaults only. Each
placed instance persists its detached overrides.

The initial semantic presets are four tree sizes, stone outcrop, iron outcrop, small gold, large
gold, meat cache, sheep, and happy sheep. Both sheep appearances are explicitly mapped to meat profiles. Dead
monster harvesting is also explicit: only species in the typed animal allowlist create carcass
nodes; the current monster roster contributes `war_pig`. Ordinary monsters never become meat just
because their art looks animal-like.

The server validates class, selected skill/tool, range, facing area, line of sight, node generation,
depletion state, and the current hero lease after every coordinator await. One-hit reservations and
durable generations serialize competing Peasants and prevent double reward. Permanent depletion and
timed respawn live in party state, so disconnects and map transitions do not reset a node.

Harvest collision is explicit gameplay data stored beside the profile, in event-foot coordinates;
it is never reconstructed from an asset id or path. The server sends the current rectangle to the
client: intact nodes block movement, fade/hide exhaustion removes the rectangle, replacement stumps
use their smaller authored rectangle, and timed respawn restores it. If admission or respawn finds
an actor inside a newly active footprint, that collider stays explicitly pending until the actor
has fully left; it then activates and prevents re-entry without teleporting or trapping anyone.
This occupancy check includes saved heroes, guards, ordinary NPCs and a monster's actual respawn
destination. A replacement collider must stay contained inside the already-solid intact footprint,
so depletion cannot create new solid ground around the harvesting actor.

Profiles saved before collision existed receive a resource-kind compatibility default on read and
persist the normalized form the next time their map is saved. Historical built-in profiles also
migrate their inherited post-animation duration to the active frame, even when an author overrode
quantity or hit count; a genuinely custom duration is preserved. The exact legacy small/large gold
asset pair is corrected while reading old gold presets. These compatibility reads are deliberately
limited to the old schema and known semantic profile family; runtime gameplay never inspects an
asset name or path.

Default tool swings register their harvest hit on the authoritative active frame. Trees and deposits
still require several distinct swings, but there is no hidden post-animation channel that movement
can silently cancel. Custom maps may author a non-zero channel duration explicitly.

Animal carcass generations use the monster's absolute `deadUntil` deadline. The party coordinator
preserves that deadline across reservation latency and rejects an already-expired carcass, so a
late knife hit cannot leave the next death stuck behind a delayed harvest generation.

## Skill kit

| Slot | Skill | Tool/presentation | Authoritative role |
| --- | --- | --- | --- |
| 1 | Woodcutter's Swing | Axe | Weak arc attack; harvests wood. |
| 2 | Prospector's Pick | Pickaxe | Weak arc attack; harvests stone, iron, and gold. |
| 3 | Butcher's Cut | Knife | Very weak arc attack; harvests explicit meat sources and animal carcasses. |
| 4 | Makeshift Camp | Hammer | Spends shared stock to heal/protect allies, serve finite rations, and optionally slow enemies. |
| 5 | Homemade Bomb | Bomb | Spends iron/stone; server launches and resolves a modest delayed area explosion. |

The editor exposes four semantic tree presets without coupling their rules to artwork: very tall
(Tree 2/Stump 2), large legacy `tree` (Tree 1/Stump 1), medium (Tree 3/Stump 3), and small
(Tree 4/Stump 4). Their yields, required hits, collision boxes, and replacement stumps are explicit.
Changing only the selected appearance changes none of those rules. Decorative catalogue trees and
rocks remain scenery; the editor points authors to **Events → Harvestable resource** for gameplay.

Tiny Swords has no Pawn shovel interaction strip. Construction deliberately uses
`Pawn_Interact Hammer.png`; this is an explicit skill-to-art mapping, not a name-based fallback.
The other strips are `Pawn_Interact Axe.png`, `Pawn_Interact Pickaxe.png`, and
`Pawn_Interact Knife.png`; the bomb uses the existing Enemy Pack bomb art. Carry presentation uses
a deterministic priority (gold, meat, then wood) and does not invent stone or iron sprites.

No new binary or external asset was added for the Peasant. The project uses the existing local Tiny
Swords packs. Their provenance is recorded in `packages/catalog/assets/README.md`; that file also
records the pre-existing requirement to verify the original pack terms before redistribution.

## Talent branches

The Peasant uses the same tier, exclusivity, unlock, persistence, and UI rules as every other class.
Its five data-driven branches are:

- Axe: Wood Bounty / readiness / reach, then Clean Cut or Sweeping Fell, with **Great Felling** as
  the ultimate.
- Pickaxe: Ore Share / readiness / force, then Rich Vein or Rock Fragmentation, with
  **Mother Lode** as the ultimate.
- Knife: Meat Share / readiness / force, then Preservation or Field Feast, with **Grand Feast** as
  the ultimate.
- Camp: reach / readiness / Reinforcement, then Stockade or Campfire, with
  **Complete Encampment** as the ultimate.
- Bomb: force / reach / readiness, then Shrapnel or Concussion, with **Powder Keg** as the ultimate.

Talent effects resolve into immutable harvest, ration, construction, and bomb plans before an
authoritative reservation starts. Runtime systems consume those plans; they do not scatter talent
id conditionals through combat or persistence code.

## Compatibility boundary

Old maps have no harvestable events and continue to load unchanged. Old party saves have no
materials, node state, or support journal and normalize each to an empty value. New persisted fields
are added by explicit SQLite/D1 migrations before the code that reads them is deployed.
