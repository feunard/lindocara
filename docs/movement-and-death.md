# Movement, the move report, and death

The two decisions that moved to the client, the fences that kept them honest, and the state
machine that death is. Read this before changing anything about where a hero is.

### Two players, two rules

- **You** are drawn in the present, because you ARE the present. Your client runs the movement
  rule (`stepHero`) every animation frame and draws the result immediately. There is nothing to
  reconcile and nothing to smear: the position on your screen is not a guess at the server's
  answer, it is the answer, and the server's copy is the one that trails.
- **Everyone else** is drawn `INTERPOLATION_DELAY_MS` (150ms) in the past, interpolated
  between the two snapshots bracketing that instant. You cannot know where a remote player is
  *now*, and guessing looks worse than being slightly late.

Do not "fix" the interpolation delay by removing it. It is what buys smooth remote motion out
of a 10Hz delta stream, and it does not apply to your own hero â€” it never did, and moving movement
to the client changed nothing about that half.

**A remote hero is drawn in its reported STATE, not just at its reported point.** `PlayerSnapshot`
carries `airborne`, `swimming`, `gliding` and vertical velocity beside the position, and the
renderer reads them
(`packages/renderer/src/hd2d/billboards.ts`): a swimmer is drawn at the water line, an airborne or
gliding hero at its own reported elevation, and only a walking one is stood on the terrain under it.
The position stream cannot tell those three apart, so a renderer that ground-snapped everyone would
make every other player's jump invisible and never fail a test.

### The move report

The client owns its hero's position and REPORTS it â€” `{t:"move"}`, carrying all three axes,
vertical velocity, the unit facing vector and the three locomotion flags. There is no command queue, no sequence number
and no `ack`; `{t:"input"}`, `MAX_STARVED_TICKS` and the starve branch are deleted.

- **20 reports a second, deliberately** (`MOVE_REPORT_MS = TICK_MS`, `packages/client/src/game/net.ts`)
  â€” the exact rate the retired one-command-per-tick stream ran at, so it is already proven to sit
  inside `RATE_MAX_MESSAGES` (35/s) with chat, actions and resyncs beside it. Do not lift it.
- **An identical frame is not sent.** An idle hero reports nothing: the last frame the server has is
  still true. The hero still STEPS every animation frame; only the report is throttled, and remote
  clients fill the gaps with the interpolation above.
- **The server validates, it does not step.** `applyReportedMove` (`world-move-life.ts`) bounds the
  reported position against the real map (`withinRoomBounds`), the parser caps every coordinate at
  `MOVE_COORDINATE_LIMIT`, and a corpse's or a mid-handoff hero's frames are dropped outright.
  Authority over movement was conceded; validity was not.

### Why `stepHero()` lives in `engine/`

The client runs it to move, and it is the only copy â€” so the terms have changed but the reason has
not. What both sides still share is the TERRAIN: `zoneTerrainFromHeightfield` bakes a `ZoneTerrain`
out of the stored heightfield string, and `canStand`/`resolveGroundMovement` answer every "can a
body be here" question. The server bakes it to validate; the client bakes it to move. **Same
string, same function, one answer** â€” fork that and a hero walks through a wall on one side of the
wire and into it on the other, with nothing failing anywhere.

Two client-owned decisions and their fences:

- **Mobility (blink).** The server GRANTS it: `SelfState.mobility` carries a distance and a deadline
  derived from the live held action, so the grant's ABSENCE is its withdrawal â€” there is no revoke
  message. The client spends it once per action id and lands on a standable cell. Cost, cooldown,
  resource, invulnerability and every effect stayed server-side, and `ClientMessage` gained nothing
  that mentions mobility, so a client cannot fabricate a grant.
- **Drowning.** A server-decided death in place. The client reports a bare `{t:"drowned"}` â€” no
  position, no damage â€” and the room refuses it unless that client's own position stream has the
  hero alive and swimming. Then `killPlayer` leaves the body where it went under. The current
  release policy resurrects it at the map entry like any other death.

`apps/lab` remains the witness that exercises `stepHero` outside the game, not a second copy of it.

### Classes

`CLASS_STATS` in `shared/game.ts` and `CLASS_SKILLS` in `shared/skills.ts` are the balance tables for
damage scaling and skill values. `PLAYER_ACTIONS` in `shared/combat-actions.ts` supplies the active
frame, recovery and projectile geometry. The server validates class, unlock level, resource cost,
cooldown, direction, collision and every resulting damage or heal.

### Directional action combat

Player combat has no target selection. The only offensive intents are `{ t: "attack" }` and
`{ t: "skill", slot }`; neither may carry an entity id, hit position, damage, heal or impact.
The last non-zero movement accepted by the server becomes the player's facing and remains stable
while idle. Starting an action freezes that direction, spends its cooldown/resource immediately,
and broadcasts only visual timing. Missing is valid and still consumes the cooldown.

Actions have anticipation, one active frame and recovery. Melee origin follows the actor until the
active frame; projectile origin is frozen when the projectile spawns. Projectiles use swept terrain
and entity collision, so a fast projectile cannot tunnel between ticks. Monster threat may choose
whom the AI pursues, but a monster freezes its strike direction at wind-up and damages only actors
still inside its capsule at the active frame. See
[`docs/directional-action-combat.md`](./directional-action-combat.md) for skill geometry,
timings, limits and Tiny Swords mappings.

### Death is a state machine, not a timer

`shared/death.ts` owns it. Dying does not move you â€” it leaves your body where you fell:

```
"alive" â”€â”€(hp 0)â”€â”€â–¶ "corpse" â”€â”€(a priest interacts)â”€â”€â–¶ "alive"
                        â”‚
                        â””â”€â”€(you press R)â”€â”€â–¶ "ghost" â”€â”€(walk onto your body)â”€â”€â–¶ "alive"
```

The current release policy bypasses the ghost branch: pressing R resurrects immediately at the
current map's authored entry (or its nearest standable fallback). The ghost route shown above is
retained only for historical persisted-state compatibility.

Hardcore runner release is deliberately heavier. It resets the party-owned attempt and performs an
epoch-fenced map handoff even when the adventure start is the map already on screen. The controlled
disconnect drains and destroys the old world room; reconnecting recreates monsters, loot,
projectiles, event runs, pickups and every other map-local runtime from authored data. Never replace
this with a same-map resurrection or a list of fields to clear: both preserve stale state and make
respawns depend on remembering every future runtime collection.

There is no timer in it and no auto-release. A corpse waits indefinitely, which is the only
reason a priest's grace period means anything. Priest revival and direct release both return at
`RESURRECT_HP_RATIO` of max HP.

Three consequences, each easy to break:

- **Monsters skip any player who is not `alive`.** A corpse waiting for release or a priest must not
  keep taking damage, and a historical ghost remains protected while compatibility state resolves.
- **A body is broadcast for as long as its owner has one** â€” while they lie over it *and* while
  a historical ghost still refers to it. Ordinary release clears it immediately.
- **`life` and the corpse position are persisted** (`hero.life`, `corpse_x`, `corpse_y`,
  `corpse_z` â€” three axes, `x`/`z` ground and `y` elevation, like every other position).
  Death that lives only in memory turns logging out into a free resurrection.

A compatibility ghost moves at `GHOST_SPEED` and a corpse at zero, so the client folds its life state into the
one speed the rule reads (`speedForLife`, `engine/death.ts`) before every `stepHero` â€” it does not
branch on life twice, and a corpse is fed a zeroed input rather than skipped, so gravity and the
water keep running underneath it. The server's half of the fence is `applyReportedMove`,
which refuses a corpse's frames outright: a body that reports itself walking is not believed.

The priest's resurrect is the interact key, not a sixth skill slot: `#interact` already dispatches
to the nearest sensible thing, and a corpse is one more thing you can be standing next to.

`CEMETERIES` and `nearestCemetery()` remain part of the legacy pixel catalogue, but the current
heightfield release path does not use them: `mapEntryPosition()` resolves the authored map entry.
