# @lindocara/audio

The **shared sample bank**: the recorded sounds the game and the lab both play, and the small
WebAudio primitives that play them. Extracted from `apps/lab/src/core/audio.ts`, which is where
every sample here was chosen, encoded and levelled.

## The boundary

This package knows nothing about lindocara. It has **no dependency at all** — not `three`, not
React, not `@lindocara/engine`. That ignorance is load-bearing: `apps/lab` is fenced to `engine` +
`hd2d` + `three` (see its own `AGENTS.md`), so anything it shares with the game has to be cheap
enough to add as a fourth dependency and drag nothing else in behind it.

It holds primitives and assets. It does **not** hold audio POLICY, and the split is deliberate:

- **Shared** — decoding and holding buffers, picking a take, jittering pitch and level, holding a
  loop open at a driven gain, and the per-material footstep levels those were tuned at.
- **Not shared** — when music starts, how zones cross-fade, the day/night ambience bed, the pause
  between passages. The lab keys music off a zone; the game keys it off an authored adventure and a
  situation (exploration/night/discovery/danger/combat/boss, `client/game/dynamic-music.ts`). One
  abstraction over both would serve neither.

**No module-level mutable state**, the same rule `@lindocara/hd2d` follows: every bank owns its own
context, buffers and destination. The lab opens one and the game opens another.

## Files

- `variation.ts` — pure, and the reason a small bank does not sound small. `pickVariant` chooses a
  take; `jitterRate`/`jitterGain` spread it ±8% in pitch and ±15% in level. `random` is a parameter,
  never `Math.random` reached for directly, so a test can pin what reached the mixer.
- `bank.ts` — `createSampleBank`: decode (never throwing for one bad url), `play` a key, `playSource`
  an exact url unvaried (a voice), `loop` a decoded url.
- `held-loop.ts` — `createHeldLoop`: a sound that is HELD, not triggered. Its level is always
  ramped, never assigned — a gain written outright 60 times a second is audible as a rasp. Carries
  `loopEnd` for the Opus tail margin (below).
- `movement.ts` — which ground makes which footstep, and at what level. Takes the material as a
  plain string so the package keeps depending on nothing.
- `assets.ts` — the `import.meta.glob` over `assets/`, and the movement bank's manifest. **Vite-only
  and kept out of `bank.ts` on purpose**: the glob does not exist under the Node test runner, so the
  bank takes urls and knows nothing about where they came from.

## Two things that were learned the hard way

**The Opus tail.** `glisse.ogg` carries padding past `SKID_LOOP_END_SECONDS`. Opus perceptibly
mangles the last samples of an encoded stream — its transform window has no context beyond the end
of the file — and looping straight through that produced a measurable click at the seam, up to 36x
the signal's normal sample-to-sample step. `loopEnd` turns playback around before the damaged
region; the margin is never heard. A re-encode that drops the margin brings the click back, and
nothing will fail.

**A missing sound must never take a scene down.** `load` swallows a failed fetch or a failed decode
per url. The key keeps its full list of takes either way — narrowing a key to whatever happens to be
decoded would quietly cost it its variety while a slow decode is in flight, which is exactly what
this bank exists to prevent.

## Assets

`assets/` holds only what BOTH apps play: footsteps (grass, sand, snow, ice), swimming, jump,
landing, water entry/exit, the glider canopy, and the skid loop. Lab-only content — its doors, its dialogue tick, its ambience beds, its NPC voices, its blade
whoosh — stays in `apps/lab/public/sfx`.

`apps/lab/scripts/sync-assets.sh` is still the single generator for the pack-derived files and
writes the shared ones straight here (`$PARTAGE`). Pointing it back at the lab's `public/sfx` would
resurrect stale copies on the next sync.

## Graph

- **Depends on:** nothing.
- **Depended on by:** `client` (the game's movement audio), `apps/lab`.

## Commands

```bash
npm run typecheck:audio
npm test -w @lindocara/audio   # or: npm run test:audio — node, with a hand-rolled fake context
```
