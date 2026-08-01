# Rogue and exclusive talent evolutions

This document records the shipped runtime contract for the fourth playable class and the reusable
final-evolution model. It complements
[`directional-action-combat.md`](./directional-action-combat.md): the client still sends only an
attack intent or a skill slot, while the room authority determines every target, path, position,
hit, damage roll, poison tick and cooldown change.

## Talent tree contract

The four original classes have one branch for each skill in slots 2 through 5. The Peasant's five
techniques, including its slot-1 axe action, each own a branch. All twenty-one branches have the
same seven-node topology:

1. a free tier-0 skill root;
2. two tier-1 upgrades, offensive on the left and utility or specialization on the right;
3. one tier-2 synergy unlocked by either tier-1 node;
4. two tier-3 evolutions unlocked by all three paid intermediate nodes;
5. one tier-4 ultimate unlocked after all intermediates and either tier-3 evolution.

Both tier-3 nodes share a stable `exclusiveGroup` and use `variantId` values `a` and `b`. The server
rejects an unlock when its group already has a selected member. `normalizeTalentSelection` applies
the same rule to persisted input and deterministically keeps the first compatible catalogue entry,
which preserves every former capstone identifier as variant A. Roots cost no point, each level
still grants one point, and the existing free authoritative reset clears the selection before a
different final evolution can be learned.

The final choices are:

| Class | Skill | Variant A | Variant B |
| --- | --- | --- | --- |
| Warrior | Iron Guard | Perfect Riposte | Bulwark |
| Warrior | Charge | Colossus Charge | Seismic Impact |
| Warrior | Battle Cry | King's Challenge | Rallying Cry |
| Warrior | Whirlwind | Steel Tempest | Cyclone |
| Ranger | Piercing Arrow | Ricochet | Linebreaker |
| Ranger | Volley | Arrow Deluge | Focused Volley |
| Ranger | Dash | Windstep | Retreat Shot |
| Ranger | Heartseeker | Heartstopper | Comet Arrow |
| Priest | Ranged Heal | Leaping Grace | Emergency Aid |
| Priest | Blink | Luminous Transfiguration | Sacred Passage |
| Priest | Prayer | Living Sanctuary | Absolution |
| Priest | Divine Nova | Judgment | Mercy |
| Rogue | Shadow Step | Executor | Shadow Return |
| Rogue | Vanish | Predator | Smoke Screen |
| Rogue | Poisoned Shiv | Concentrated Venom | Rupture |
| Rogue | Shadow Dance | Dark Harvest | Thousand Cuts |
| Peasant | Woodcutter's Swing | Clean Cut | Sweeping Fell |
| Peasant | Prospector's Pick | Rich Vein | Rock Fragmentation |
| Peasant | Butcher's Cut | Preservation | Field Feast |
| Peasant | Makeshift Camp | Stockade | Campfire |
| Peasant | Homemade Bomb | Shrapnel Charge | Concussion Bomb |

The talent tree presents the pair as one choice, marks A/B explicitly and disables the other node
after selection. The SkillBar resolves the exact selected node rather than a generic evolved flag,
then displays its localized name, description and A/B marker.

## Rogue authority and lifecycle

`rogue` is a normal persisted hero class, but its combat windows are deliberately room-local:
Opening, stealth, Smoke Screen protection, the Predator shiv window, Shadow Dance protection,
Shadow Return and Executor tracking are never written to the hero profile. One reset helper clears
them on death, disconnect and map transition. Room reset also drops every active damage-over-time
record.

- **Dual Slash** is the common 325 ms basic attack with one authoritative damage resolution. Its
  two-dagger animation does not create a second hit. Opening is consumed only after that resolution
  actually hits.
- **Shadow Step** selects the nearest living visible enemy on the server. It requires line of sight
  and tests behind then deterministic lateral landing candidates through the existing terrain,
  collider and entity geometry. No valid landing means a clean failure.
- **Vanish** is server state, not an alpha trick. Monsters drop the Rogue, cannot acquire it again,
  and peer interest snapshots omit it. Existing projectiles and zones remain authoritative and can
  break stealth. Its cooldown is armed only on exit.
- **Poisoned Shiv** snapshots bounded poison power into the room tick system. It uses no
  per-effect JavaScript timer. Normal reapplication replaces the schedule, Concentrated Venom
  allows at most three independently timed stacks, and Rupture removes the power it converts to
  immediate damage before resolving that damage.
- **Shadow Dance** computes the ordered target and landing sequence on the server, rejects
  wall-crossing transitions and broadcasts only validated strikes and positions. Invulnerability
  covers the short sequence only. Thousand Cuts may fill missing strikes on the primary target at
  reduced power; Dark Harvest clamps every cooldown reduction at the current server time.

Poison deaths pass through the normal player-owned damage boundary, so contribution, XP, loot and
kill effects retain the Rogue as owner. Effects disappear when their target is permanently removed
or their source leaves the room. Priest Absolution is the deliberately narrow cleanse seam and
currently removes poison only.

## Central Rogue tuning

The single balance source is `packages/engine/src/rogue.ts`; engine rules, server authority and
presentation import these values instead of copying them.

| Contract | Value |
| --- | --- |
| Attack | 22 base, +3 per level, 58 px range |
| Opening | 1,500 ms; +40% base; +75% Executor/Predator base |
| Executor | 2,000 ms kill window; 50% of remaining Shadow Step cooldown removed |
| Shadow Step | 4,500 ms cooldown; 260 px selection; 2,000 ms return window |
| Vanish | 8,000 ms maximum; 14,000 ms cooldown starting on exit |
| Predator / Smoke Screen | 2,000 ms empowered-shiv window, ×1.5 poison; 500 ms protection |
| Poisoned Shiv | 6,000 ms cooldown; 58 px; 14 direct power |
| Poison | 5 ticks, 1,000 ms apart; 6 base tick power, +1 per level |
| Concentrated Venom / Rupture | 3 stacks maximum; 60% remaining poison converted |
| Shadow Dance | 11,000 ms cooldown; 360 px; 5 × 32 power; 90 ms strike spacing |
| Dark Harvest / Thousand Cuts | −1,500 ms per kill; repeated strikes at 60% power |

Generic intermediate power talents can increase the final Opening ratio on top of its named
evolution baseline; this is intentional talent synergy, not a second Opening stack.

## Tiny Swords presentation

The character uses the hooded twin-dagger Thief already present in the generated catalogue under
`Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Thief/`:

| Sheet | Authored geometry | Ground alignment |
| --- | --- | --- |
| `Thief_Idle.png` | 6 frames at 192×192 | 60 px foot padding |
| `Thief_Run.png` | 6 frames at 192×192 | 59 px foot padding |
| `Thief_Attack.png` | 9 frames at 128×192 | 56 px foot padding |

The renderer preserves the attack strip's narrower native frames and uses the same sheets for the
creation portrait and skill icons. The vendor pack has no dedicated Shadow Step, Vanish, poison or
Shadow Dance animation, so those techniques deliberately reuse `Thief_Attack` plus existing
Tiny Swords dust, Hex Shaman projectile/impact and short explosion effects. Shadow Dance adds
ordered violet trails and impacts without a full-screen flash. No external or generated asset was
added. Rogue audio similarly reuses the bundled short melee impact because no class-specific audio
exists.

## Verification seams

Pure tests pin the twenty-one branch topologies, legacy identifiers, normalization, point limits and
all centralized Rogue and Peasant values. Real room tests cover server-only targeting, line of sight,
collision fallbacks, stealth/AI/peer visibility, incoming projectiles, poison ownership and
cleanup, all eight Rogue evolutions, Shadow Dance ordering and talent reset into the exclusive
alternative. Client and renderer tests pin the A/B disabled state, exact SkillBar evolution,
catalogued sprite geometry, class creation portrait and authoritative combat-event VFX.
