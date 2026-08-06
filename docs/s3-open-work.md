# S3 — what is still open

Written 2026-08-06, at the end of the increment that moved the world to tile units and moved hero
movement to the client. Everything below is **known, reproduced, and deliberately not fixed yet**.

The detailed record — every task, review, fix round and parked finding — is
[`.superpowers/sdd/2026-08-05-s3-tile-units-and-client-movement/progress.md`](../.superpowers/sdd/2026-08-05-s3-tile-units-and-client-movement/progress.md).
It is a controller's ledger rather than prose: dense, but it names the file, the line and the
evidence for everything here.

## 1. CRITICAL — every Sacred Passage trail frame fails to parse, in production

`packages/engine/src/protocol.ts`, the `lumen_trail` validator: `value.width >= 1` is a **pixel-era
floor** that survived the tile conversion. The emitted width is always below 1 —
`talents.ts` authors `22 / TILE_SIZE` = 0.34375, and `priest-variant-system.ts` floors it at
`1 / TILE_SIZE` = 0.015625, with a comment directly above explaining that one tile would be wrong.

Proven, not reasoned: feeding the exact frame `worldTick.ts` emits to `parseServerMessage` returns
`null`.

It is not a missing sparkle. `net.ts` treats an unparseable frame as corruption: post-welcome it
burns a `#requestResync()` (rate-limited to 1/s), and `sendPriestLumenEffectsTo` replays trails **on
admission**, so a player joining a room with a live trail takes the same path. `net.ts`'s
`onLumenTrail` handler is unreachable.

**Why CI is green:** `protocol.test.ts` still asserts on the *pixel* fixture `width: 22`, which
passes `>= 1`. The test and the runtime disagree about units.

**Fix:** `value.width > 0 && value.width <= 64`, retire the pixel fixture, and add a round-trip test
that feeds a *server-shaped* frame through the parser. This is the second instance of this defect
class on this branch (the first was `REWARD_DISTANCE = 900` compared against a tile distance, which
made every reward-eligibility gate permanently true).

## 2. IMPORTANT — the mobility grant's *spend* is pinned by nothing

The blink grant is one of only **two** decisions the spec conceded to the client, so this is the gap
that matters most. Three mutations, each leaving the whole suite green:

- `worldTick.ts` `debitHeldMobility` made a no-op — its own docblock calls it load-bearing
  ("without it the priest walks out the rest of the hold with an empty budget and no
  rematerialisation, which is not the skill");
- `hero-controller.ts` dropping `grant.remaining > 0` — the client phases past its granted distance;
- `hero-controller.ts` dropping `grant.window <= 0` — the grant never expires.

The *arming* rules are well covered (once-per-`actionId`, the `land()` resolve, the server-side
withdrawals). It is the spend that is untested, on both sides of the wire.

## 3. IMPORTANT — the corpse/handoff fence has no discriminating test

Deleting the whole guard at the top of `applyReportedMove` (`worldTick.ts`) —
`if (player.life === "corpse" || player.transitioning || player.disconnecting) return;` — leaves
**547/547 server tests green**. This is the fence the root `AGENTS.md` names explicitly ("a body that
reports itself walking is not believed") and the one stopping a mid-handoff hero from overwriting a
destination the transition already decided. The client-side `frozen` flag *is* tested; that is the
cooperative half, not the fence.

## 4. Cross-tenant map access — a design decision, not a regression

Any authenticated account can **read, rewrite, re-flag and delete another author's maps**. Executed
against a real app with a freshly registered second account:

```
LIST   /api/maps?adventure=…      -> 200  (the owner's map ids)
GET    /api/maps/:id              -> 200  (full payload)
POST   /api/maps/:id/first        -> 204  (flips the owner's front-door map)
DELETE /api/maps/:id?force=true   -> 204  (the map is gone)
```

This is the ported "collaborative editing is open" behaviour and `maps.test.ts` asserts it **on
purpose**. It is not caused by recent work. It does bound what the new heightfield fence buys: an
attacker cannot blank your terrain in place, but can delete the map holding it.

`PUT /api/maps/:id/heightfield` is the one owner-fenced route on that surface
(`MapService.saveHeightfieldForUser`, 404 to anyone else).

**Someone has to decide** whether the map surface stays collaborative, now that production maps are
worth attacking.

## 5. Smaller, recorded rather than fixed

- **`game.ts`'s monster-speed comment claims a conversion that does not exist.**
  `authored-monster-system.ts` passes `event.monsterSpeed` through raw while its neighbour
  `patrolRadius` really does convert. A stored pixel speed of 105 would spawn a monster at 105
  *tiles*/second. Inert only because a heightfield room bakes `events: []`, so no authored monster
  spawns — meaning **it fires the day that is closed**, which is the next planned work. The real fix
  belongs in `map-events.ts`, where the defaulting branch lives; a blanket `/ TILE_SIZE` at the
  consumer would divide every already-tile-scaled default by 64 again.
- **`ground-distance-units.test.ts`'s catch-all is 4× coarser than it was.** Its bound is now the
  true `MAX_HEIGHTFIELD_SIZE` (256), which is correct but means every pixel original ≤ 256 slips
  past it — including `3 * TILE_SIZE` = 192, the `DIALOGUE_CLOSE_RADIUS` bug the file was written
  about. Every *current* constant is also exactly pinned, so this only weakens the guard against a
  *future* one. A second, tighter assertion beside the true bound closes it.
- **No breath signal anywhere.** Drowning now kills, and a player's first and only warning is dying.
  Even `__lindocara.self()` has no breath field.
- **`stepHero`'s `HeroEvent[]` plays nothing** — footsteps, splashes, water entry/exit, canopy, skids
  all narrated and silent. Audio has no owner.
- **No vertical animation** — no stretch/squash (the lab drives those from `state.vy`, which never
  crosses the wire) and no canopy sprite over a glider.

## Accepted costs — do not "fix" these by accident

Both are documented in the root [`AGENTS.md`](../AGENTS.md) and are deliberate:

- an authored adventure without a heightfield renders nothing and nobody in it can move, so the five
  parked adventures are dead until regenerated;
- a heightfield room bakes `events: []`, so authored exits, teleporters, monsters and harvest nodes
  are invisible to a running room.

`PUT /api/maps/:id/heightfield` (added 2026-08-06) is the way terrain reaches a deployed instance,
whose database no local script can open. `npm run adventure:proving -- --target=… --allow-remote=true`
seeds a playable one.

## Deploying

Production is Alepha Bay, reached **over SSH**, deployed from a laptop — CI deploy on push is
disabled (`.github/workflows/deploy.yml`, `workflow_dispatch` only). Re-enabling it means rewriting
the job for an SSH key and `$BAY_HOST`; the current job still references the retired Lore route.

`../alepha/apps/bay/INSTALL.md` documents the host setup, including the three prerequisites that
silently block a first deploy.
