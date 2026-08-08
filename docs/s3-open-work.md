# S3 — follow-up ledger

Written 2026-08-06, at the end of the increment that moved the world to tile units and moved hero
movement to the client. Updated after the first follow-up wave: sections 1–3, the tighter
ground-distance guard and the breath signal are now closed; the remaining entries are still open.

The detailed record — every task, review, fix round and parked finding — is
[`.superpowers/sdd/2026-08-05-s3-tile-units-and-client-movement/progress.md`](../.superpowers/sdd/2026-08-05-s3-tile-units-and-client-movement/progress.md).
It is a controller's ledger rather than prose: dense, but it names the file, the line and the
evidence for everything here.

## 1. CLOSED — Sacred Passage trail frames parse in tile units

Closed 2026-08-06: the validator now accepts every finite positive width through 64, and the
protocol test round-trips the exact `22 / TILE_SIZE` server-shaped frame instead of a pixel fixture.

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

## 2. CLOSED — the mobility grant's spend is pinned on both sides

Closed 2026-08-06: client tests discriminate distance exhaustion and window expiry, including
rematerialisation from inside a collider; the real room harness proves each accepted move segment
debits the server's held mobility budget.

The blink grant is one of only **two** decisions the spec conceded to the client, so this is the gap
that matters most. Three mutations, each leaving the whole suite green:

- `worldTick.ts` `debitHeldMobility` made a no-op — its own docblock calls it load-bearing
  ("without it the priest walks out the rest of the hold with an empty budget and no
  rematerialisation, which is not the skill");
- `hero-controller.ts` dropping `grant.remaining > 0` — the client phases past its granted distance;
- `hero-controller.ts` dropping `grant.window <= 0` — the grant never expires.

The *arming* rules are well covered (once-per-`actionId`, the `land()` resolve, the server-side
withdrawals). It is the spend that is untested, on both sides of the wire.

## 3. CLOSED — the corpse/handoff fence has discriminating tests

Closed 2026-08-06: real room tests send current, in-bounds move frames while the hero is a corpse,
transitioning or disconnecting and prove that none can overwrite the room-owned position.

Deleting the whole guard at the top of `applyReportedMove` (`worldTick.ts`) —
`if (player.life === "corpse" || player.transitioning || player.disconnecting) return;` — leaves
**547/547 server tests green**. This is the fence the root `AGENTS.md` names explicitly ("a body that
reports itself walking is not believed") and the one stopping a mid-handoff hero from overwriting a
destination the transition already decided. The client-side `frozen` flag *is* tested; that is the
cooperative half, not the fence.

## 4. CLOSED — map access is owner-fenced

Closed 2026-08-09: the product decision is private authoring. Every HTTP map route now scopes the
row or adventure to the authenticated author. Foreign lists are empty; foreign reads, writes,
front-door changes, forced deletes and creates under another adventure all answer the same 404.

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

`PUT /api/maps/:id/heightfield` was the first owner-fenced route on that surface; every map route
now applies the same author boundary.

**Decision recorded 2026-08-09:** the map surface is private to its author. The reproduction above
is retained as the evidence for the fence, not as current behavior.

## 5. Smaller, recorded rather than fixed

- **CLOSED: legacy authored monster speeds are normalized at parse time.**
  `authored-monster-system.ts` passes `event.monsterSpeed` through raw while its neighbour
  `patrolRadius` really does convert. A stored pixel speed of 105 would spawn a monster at 105
  *tiles*/second. Inert only because a heightfield room bakes `events: []`, so no authored monster
  spawns — meaning **it would have fired the day that cost is closed**. The fix now lives in
  `map-events.ts`: absent/defaulted and plausible tile values pass unchanged, while explicit
  values in the legacy pixel-only band are divided once. The consumer remains a pass-through.
- **CLOSED: `ground-distance-units.test.ts`'s catch-all was 4× coarser than it was.** Its bound is now the
  true `MAX_HEIGHTFIELD_SIZE` (256), which is correct but means every pixel original ≤ 256 slips
  past it — including `3 * TILE_SIZE` = 192, the `DIALOGUE_CLOSE_RADIUS` bug the file was written
  about. Every *current* constant is also exactly pinned, so this only weakens the guard against a
  *future* one. A second, tighter assertion beside the true bound now closes it.
- **CLOSED: no breath signal anywhere.** The local movement controller now feeds a rounded countdown
  to the HUD while swimming, and `__lindocara.self()` exposes raw `breath`, `maxBreath` and `vy`.
- **CLOSED: `stepHero`'s audible `HeroEvent[]` is owned by `GameSound`.** Footsteps, swimming,
  water transitions, jumps, landings, thin ice, canopy opening and held skids are synthesized from
  the event stream; visual-only trace/breath events remain deliberately silent.
- **CLOSED: vertical animation and canopy.** `vy` is bounded on the move wire, relayed for remote
  players, and drives the lab's stretch/squash curve. A gliding actor carries the generated canopy
  as a second billboard, lazily created and hidden again on close.

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

Production is Alepha Bay, reached **over SSH**. `.github/workflows/deploy.yml` supports both pushes
to `main` and manual dispatch, uses the Bay SSH host/key, and deploys the game plus the static lab.
The retired Lore route is no longer referenced.

`../alepha/apps/bay/INSTALL.md` documents the host setup, including the three prerequisites that
silently block a first deploy.
