# The glider — design

Date: 2026-08-04
Status: approved in brainstorming

## Goal

Give the hero a Zelda-style glider: airborne, one more press of the jump key opens a sailcloth
canopy and the fall becomes a slow, steady descent with full horizontal control. The asset is
generated locally with `studio/`, post-processed by `apps/lab/scripts/sprite.py`, and proven on
screen in `apps/lab` — the HD-2D witness, which is where a render-facing asset has to be judged.

Two things are being delivered together on purpose: the sprite alone cannot be validated without a
scene that flies it, and the rule alone would have nothing to draw.

## What "well oriented" means here

The orientation of this sprite is dictated by the engine, not by taste. Three constraints, each
already paid for once by an existing asset:

1. **Side-facing, drawn asymmetrically.** The lab hero is a side-view billboard with a left/right
   flip — `state.facing` is `±1` and `world/hero.ts` calls `billboard.setFlip(state.facing < 0)`.
   There is no second row of directional art. A canopy drawn symmetrically would make that flip a
   no-op and the glider would read as facing nowhere. The canopy's leading edge therefore points in
   the facing direction and the wing tilts slightly nose-down, so mirroring the sprite genuinely
   reverses it.

2. **Seen from roughly 38° above.** The camera is near-orthographic (`CAMERA.fov` 22,
   `CAMERA.pitch` 38°, orbit limited to `CAMERA.yawRange` ±20°). The glider hangs above the hero's
   head, well below camera height, so it is seen from above: the top surface of the canopy shows,
   foreshortened. This is the same call `campfire-base.png` made — a fire pit is a ground element
   and the model drew it from above, so it was laid flat instead of standing up as a disc
   (`assets/generated/PROVENANCE.md`).

3. **The hero's pixel density, not the model's.** `warrior.png` is 1152×1536 — 6 columns × 8 rows,
   192 px per frame — rendered at `HERO.size` 2.6 world units, so about 74 px per world unit. A
   canopy spanning ~2.3 units is ~170 px wide, which puts `sprite.py`'s target height near 100 px
   for a wing wider than it is tall. The generator outputs a smooth 768² illustration; the BOX
   downscale is what makes it pixel art at the surrounding density. Skipping it would make the
   glider ten times more detailed than the trees under it — the exact failure PROVENANCE.md
   records for the chest.

## The asset

**`glider.png`** — the glider alone, with no person under it, so it composes over any character.

Look: a curved sailcloth canopy in the pack's warm off-white with a blue trim band, four rope
risers converging on a carved wooden handle bar. Deliberately our own design: Nintendo's paraglider
and its Sheikah eye are not reproduced. The chosen shape also matches art already in the Tiny
Swords pack (tents, sails, banners), which is what keeps a generated asset from reading as
imported.

Pipeline — the established one, no new tooling:

```
python3 studio/studio.py sprite \
  --prompt "a small paraglider with a curved off-white sailcloth canopy edged with a blue trim \
band, four taut rope risers, a carved wooden handle bar hanging below, gliding forward and tilted \
slightly nose-down, seen from the side and from above, nobody holding it, empty glider" \
  --seed 42 --variants 4 --out apps/lab/assets/generated/glider-raw.png

python3 apps/lab/scripts/sprite.py \
  apps/lab/assets/generated/glider-raw.png apps/lab/assets/generated/glider.png 100
```

The trigger word and the `video game sprite on a dark navy background` suffix are appended by
`studio.py` from `theme.json` and are not repeated in the prompt. `--variants 4` is there because
the three orientation constraints above are exactly the kind a single sample misses; the pick is a
human judgement, as PROVENANCE.md's sprite entries already assume. The `100` is the starting target
height derived above and is re-checked on screen — it, and the optional colour count, are the two
numbers most likely to move after the first look.

then a `cp` line in `apps/lab/scripts/sync-assets.sh` (the only sanctioned route into `public/`)
and an entry in `TEXTURE_URLS` (`settings.ts`). Prompt, seed and post-processing parameters are
recorded in `assets/generated/PROVENANCE.md` beside the chest and the snow props.

`studio.py` is always called rather than the underlying runtime: it injects the art direction from
`studio/theme.json`, which is what makes this glider belong to the same game as the chest.

**One sound effect** from the studio's `sfx` lane: a canvas canopy snapping open in the wind,
played on deploy. Same rule — generated through `studio.py`, recorded in PROVENANCE.

The glider gets no `studio/characters.json` entry. That file binds a *character* to a look and a
voice; a prop has neither.

## The rule

Gliding is movement truth, so it belongs in the pure module `@lindocara/engine/hd2d/`, beside
jumping and swimming — not in the lab's adapter. `apps/lab/AGENTS.md` is explicit that
`world/hero.ts` holds presentation and keeps only two documented exceptions; this is not a third.

### State

`HeroState` gains two fields:

- `gliding: boolean` — the canopy is open.
- `jumpHeld: boolean` — a latch on the jump input.

The latch is load-bearing. `HeroInput.jump` is a **level**, not an edge — `hero-step.ts` reads
`if (input.jump && state.coyote > 0)` and relies on `coyote` being zeroed to stop a held key from
jumping twice. Deploying on a level would pop the canopy on the frame after take-off, every single
jump. The latch keeps the edge inside the pure rule and leaves the input contract untouched, which
matters because `HeroInput` is also what a future server tick would consume.

### Transitions

- **Deploy** — a rising edge on jump while `airborne` and not swimming. Sets `gliding = true` and
  `vy = -HERO.glide.fall` immediately, so deploying at the top of a jump drops you straight into
  the slow descent rather than letting the arc finish.
- **While gliding** — gravity stops accumulating and `vy` stays pinned at `-HERO.glide.fall`. A
  glide never gains altitude. Horizontal movement is untouched: full air control, same friction
  model as any other airborne frame.
- **Stow** — landing, entering water, or a second rising edge on jump (a toggle: you fold the
  canopy and drop). Landing and water entry already have their own paths in `hero-step.ts`; this
  only clears the flag there.

### Events

Two new `HeroEvent` members, `deployGlider` and `stowGlider`. The pure rule narrates what it
caused; the adapter decides that this means showing a billboard and playing a sound. The rule
learns nothing about textures or audio, which is the boundary `hero-step.ts` already holds for
footsteps, splashes and ice cracks.

### Tunables

`HERO.glide` in `apps/lab/src/settings.ts`: `fall` (descent speed, world units per second) plus the
billboard's `size`, `aspect` and vertical `offset`. Content, not engine — the same split
`settings.ts` already documents.

## The adapter

`world/hero.ts` creates one extra billboard, hidden at construction, positioned above the hero's
head each frame and flipped by the **same** `state.facing` test the body already uses — one source
for the facing, so body and canopy cannot disagree. It is shown on `deployGlider`, hidden on
`stowGlider`, and the sound plays through the existing `core/audio.ts` path.

No new system, no new file: the glider is one more billboard in a factory that already manages
several (splash, ripples, breath puffs, footprints).

## Testing

**Pure rule** (`packages/engine/test/hd2d/`, node, no DOM):

- Holding jump through a whole jump never deploys — the edge is required.
- A rising edge while airborne deploys and pins `vy`.
- Descent is constant: `vy` after N gliding steps equals `-fall`, never accelerating.
- A glide never increases `y` between two steps.
- Landing stows; entering water stows; a second edge stows and the fall resumes under gravity.
- Deploying is refused while swimming and while indoors (the room floor has no vertical block).

**On screen** (`npm run lab`, driven with the `playwright-cli` skill): the orientation claim above
is the one thing no unit test can check. The witness is a screenshot of the hero gliding in both
facings, confirming the canopy reverses and reads as seen from above.

## Out of scope

- No stamina or gauge. The glide costs nothing in this increment; the lab has no stamina concept
  and inventing one here would be a second feature.
- No glider in the game itself. `apps/lab` is the witness; wiring the game's own hero is a later
  increment, and today the game's hero movement still runs on the pixel-unit `simulation.ts`
  rather than `stepHero` (see `packages/engine/AGENTS.md`).
- No animated canopy. A single still frame; a sway loop would multiply the generation and
  post-processing work for an effect that a first pass cannot yet judge.
- No per-character glider. One prop sprite composing over any billboard is the whole point of
  keeping the person out of the image.
