# Corpse runs, ghosts, and cemeteries

Death today is a 2.5 second freeze and a teleport home at full HP. It costs nothing and it
means nothing. This replaces it with the WoW model: you leave a body where you fell, you
choose between waiting for a priest and releasing your spirit, and if you release you walk
back to your own corpse as a ghost.

## The state machine

`shared/death.ts` owns it, as pure functions over a `LifeState`:

```
"alive" ──(hp hits 0)──▶ "corpse" ──(priest resurrects)──▶ "alive"
                             │
                             └──(you press R)──▶ "ghost" ──(walk onto your corpse)──▶ "alive"
```

- **alive → corpse.** Your body stays exactly where you fell. Input is inert: you are a
  spectator at your own corpse.
- **corpse → alive.** A priest revives you in place. You keep your spot and your progress.
- **corpse → ghost.** You press **R** to release. The corpse *stays where it fell*; your
  ghost appears at the nearest cemetery.
- **ghost → alive.** Your ghost walks onto your corpse and reclaims it.

There is no timer in this machine and no auto-release. A corpse waits indefinitely. The only
exits are a deliberate act by you or by a priest, and that is what gives a priest's thirty
seconds of grace any weight.

You return at **40% HP** by either route. Returning at full HP is precisely what makes the
current death free, so the corpse run has to leave a mark.

Releasing is one-way. A priest cannot resurrect a ghost — once you release, that exit is
closed. That is what makes it a choice rather than a formality.

## Entities

The **corpse** is a first-class world entity, broadcast to everyone in a `corpses[]` array
(id, nick, class, x, y). Two actors need to see it: the renderer, and a priest hunting for
someone to save.

The **ghost** is not a new entity. It is the same player row with `life: "ghost"`, so
movement, prediction, collision, and interpolation keep working untouched.

Ghost rules, all enforced server-side:

- Monsters skip any player who is not `alive` when picking a target. Without this the corpse
  run is unwinnable — you would die on the way to your own body.
- Ghosts move at **1.3×** living speed. The walk back should be brisk.
- The server drops `attack`, `skill`, `heal`, `interact`, and `use` from a ghost. Movement and
  chat only.
- Ghosts collide with terrain like the living. No new pathing.
- Ghosts are broadcast to everyone and drawn translucent.

Reclaiming is **automatic within 44px** of your corpse, not another keypress. `#collectLoot`
already establishes proximity-automatic pickup at 46px; this follows it.

## Ghost speed and the prediction invariant

`step()` already takes an optional `speed`, so this costs less than feared: the speed is
derived from `LifeState` on both sides, and `predictStep`/`reconcile` thread it through.

The load-bearing detail: **the server clears the command queue on every life transition.** It
already does so on death. A transition is a teleport, so there are no in-flight commands to
replay at the wrong speed, and the client prunes on the `ack` that comes with it.
`prediction.test.ts` gains a case asserting that replaying ghost-speed commands over a stale
position lands exactly where the server lands — the same assertion that protects living
movement.

## The priest's resurrect is the interact key

The skill bar is full, and `#interact` already dispatches to the nearest sensible thing (quest
site, then NPC). A corpse joins that dispatch.

A **priest** pressing **E** near a corpse revives its owner in place, at priest heal range, on
a 20s cooldown. No new key, no new protocol message, no targeting system — this codebase
resolves every action as "the nearest valid thing in range", and this follows it. A non-priest
pressing E on a corpse gets nothing.

## Cemeteries

Three of them, spread across the 4800×2700 map, so the run home stays in the 15–30 second
range wherever you die. `nearestCemetery(corpse)` picks your destination on release.

A cemetery is a new `LandmarkKind: "graveyard"` — a Monastery sprite for the chapel, Rock and
Stump sprites for headstones, all of which the Tiny Swords pack already gives us — plus a
spirit-anchor point where ghosts materialise.

## Persistence

`life`, `corpse_x`, and `corpse_y` go in the character row, via a migration.

This is not optional. If death lives only in memory, **logging out is a free resurrection** —
the same trap that `questRunStartedAt` currently falls into. Reconnect as a corpse and you are
still a corpse. Reconnect as a ghost and your body is still out there waiting. A row whose
`life` is `corpse`/`ghost` but whose corpse position is null is repaired to `alive` at spawn.

## Wire changes

- `PlayerSnapshot.dead: boolean` → `life: LifeState`.
- `Snapshot.corpses: CorpseSnapshot[]`.
- `WorldInfo.cemeteries: Vec2[]`.
- `ClientMessage` gains `{ t: "release" }`.
- New event codes: `death.fallen`, `death.released`, `death.reclaimed`, `death.resurrected`,
  `resurrect.nobody`, `resurrect.not_priest`. FR and EN both, as the parity test enforces.

## Tests

Driving the real Durable Object, per the house rule:

- death leaves a corpse at the death position, and the player is not alive
- a corpse cannot move, attack, or loot
- release moves the ghost to the *nearest* cemetery and leaves the corpse behind
- a ghost is neither aggroed nor damaged by monsters
- a ghost that walks onto its corpse revives at 40% HP
- a ghost cannot attack, heal, interact, or use a potion
- a priest interacting near a corpse revives its owner in place at 40% HP
- a non-priest interacting near a corpse does nothing
- a priest cannot resurrect a ghost
- `life` and the corpse position survive a reconnect

Pure, in `shared/`: the state machine's transitions, `nearestCemetery()`, and a prediction case
for ghost-speed replay.
