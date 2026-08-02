# @lindocara/lab

A **witness, not a frozen copy**. `apps/lab` reproduces the `~/git/poc-hd-2d` PoC — a hero, a
troop, an island, day/night, dialogue, a house — on top of the real `@lindocara/hd2d` package
rather than the PoC's own copy of the render code. That single fact is the whole point of this
app: it consumes the **same** package the game will eventually consume, so an experiment that works
here works in the game. A screen-for-screen port frozen at Task 12 would drift from `hd2d` within
two weeks of the next change and stop being a witness for anything — every change to `hd2d` gets
proven against the lab before it's trusted, and the lab is kept current with `hd2d`, not the other
way around.

**`apps/lab` depends on exactly `@lindocara/hd2d` and `three`** — no `@lindocara/engine`,
`server`, `client` or `renderer`. It also does not (yet) feed the game: the game's render path is
still PixiJS, and `hd2d` is consumed only here until S3 (see the root
[`AGENTS.md`](../../AGENTS.md) and
[`docs/superpowers/specs/2026-08-02-hd2d-reboot-design.md`](../../docs/superpowers/specs/2026-08-02-hd2d-reboot-design.md)).
`island.ts`/`terrain-query.ts` are the one deliberate exception to "witness, don't build product
here": they are written as the future `@lindocara/engine` collision/generation module, kept pure
and `three`-free on purpose, so S2 can promote them by moving the file, not rewriting it.

## Files

- `main.ts` — the composition root: loading (byte-weighted, `hd2d/loader.js`), world assembly
  (terrain, water, foam, props, Grota, the hero, the house/interior, the harness), the pipeline,
  moods, dialogue, camera and the render loop. Everything else is a factory this file wires
  together — it owns no game rule of its own.
- `bench.ts` — the load-testing harness (`createBench`, Task 13); see "The load-testing harness"
  below.
- `settings.ts` — every tunable that is *content*, not engine: world size/seed, camera, hero
  stats/animation clips, Grota, water, the day/night `MOODS`, and `TEXTURE_URLS` (`hd2d` knows no
  content URL, only filtering policy — the catalogue lives here).
- `core/audio.ts` — WebAudio playback: a suspended context woken on the first click, footstep
  cadence by distance not time, Grota's dubbed lines outside the random-variant path.
- `core/dialog.ts` — the dialogue banner; typing cadence follows the voice line's real duration.
- `core/input.ts` — keyboard/mouse sampling (AZERTY+QWERTY+arrows, wheel zoom, right-drag orbit).
- `world/island.ts` — pure procedural heightmap + beach generation (`generateIsland`,
  `mulberry32`). Destined for `@lindocara/engine` in S2 — see above.
- `world/terrain-query.ts` — `TerrainQuery`: world-space collision queries over a `HeightField`.
  Same S2 destination as `island.ts`, and for the same reason kept `three`-free.
- `world/colliders.ts` — the static circular-footprint spatial grid props/the house register into.
- `world/hero.ts`, `sheep.ts`, `npc.ts`, `chest.ts`, `house.ts`, `interior.ts`, `props.ts` —
  gameplay entities, each a `create*(ctx, textures, ...)` factory returning an `update(dt)` handle.
- `world/debug.ts` — the `B` collision-volume overlay: walkable-cell edges, impassable-step edges,
  prop/hero footprints. When a move looks wrong, this is where you see why.

## The load-testing harness

`bench.ts` answers S1's one open question: does a game-scale population (four players, dozens of
monsters/guards, ground loot, corpses, projectiles, combat effects, and shadow-casting point
lights — see the file's own `POPULATION` table) still fit the frame budget once the PoC's ~30 props
grow into a real game? It shares the textures `main.ts` already decoded — it loads nothing new, so
the measurement is GPU render cost, not decode time — and freezes every sprite on a random sheet
frame rather than animating it, because `Bench.measure()` re-renders the *same* frozen state 40
times (the PoC `CLAUDE.md` method: one warm-up render, a `readPixels` to drain the pipe, 40 timed
renders, a second `readPixels` that blocks until the GPU is actually done) — animating between
those renders would defeat the point of measuring one consistent frame.

Select a level with `?bench=game` or `?bench=heavy` in the URL; `?bench=off` or no parameter leaves
the scene exactly as Task 12 left it. The measured ms/frame appears in the HUD next to the fps
counter, re-measured automatically after the mood fade settles whenever you press `N` — so reading
the day number, then night, is just two waits and two glances at the HUD, per the measurement
method in `task-13-report.md`. `renderer.info.render.calls` resets on every `WebGLRenderer.render()`
call, including each of the composer's own full-screen passes — reading it right after
`pipeline.render()` therefore reports only the last post-fx pass, not the scene. To read the real
scene draw-call count, issue a throwaway `renderer.render(scene, camera)` first (see how
`task-13-report.md` gathered its numbers via `window.lab`).

## `window.lab`

The dev-only debug handle (the lab's equivalent of the PoC's `window.poc`): `THREE`, `scene`,
`camera`, `renderer`, `render` (`pipeline.render`), `field`, `query`, `hero`, `chest`, `house`,
`sakura`, `grota`, `dialog`, `props`, `sun`, `hemi`, `rim`, `sky`, `clouds`, `particles`, `mood`,
`applyMood`, `bench`, `benchLevel`. Console-only wiring — teleporting the hero, forcing a mood,
calling `bench.measure(lab.render, lab.renderer.getContext())` by hand, or instrumenting the audio
context all go through this object rather than adding debug UI.

## Asset discipline

Nothing is copied into `public/` by hand. `scripts/sync-assets.sh` pulls the textures it needs
straight from the Tiny Swords packs already vendored once in `packages/catalog/assets/` (the lab
does not keep its own copy) plus this app's own `assets/generated/` sprites (LoRA-generated —
provenance and prompts in `assets/generated/PROVENANCE.md`), and drops clean, space-free filenames
into `public/tex/`. Adding a texture means adding a line to that script and re-running it, never
dropping a file into `public/` directly.

The SFX pack (371 MB) is **not** in the repo — only the handful of `.ogg` files the lab actually
plays live in `public/sfx/`. Re-running `sync-assets.sh` for sound therefore needs the pack
locally: point `LAB_SFX_PACK` at its `OGG Files` directory, or the script fails loudly rather than
silently skip sound assets.

```bash
LAB_SFX_PACK=/path/to/pack apps/lab/scripts/sync-assets.sh
```

## Graph

- **Depends on:** `@lindocara/hd2d`, `three`. Nothing else — see "witness, not a frozen copy" above.

## Commands

```bash
npm run lab                  # (root) vite dev — http://localhost:5174
npm run build -w @lindocara/lab
npm run typecheck:lab        # tsc
npm test -w @lindocara/lab   # or: npm run test:lab — Node env, pure island/terrain-query tests only
```

See the root [`AGENTS.md`](../../AGENTS.md) for the full monorepo layout, and the `playwright-cli`
skill for driving the lab in a browser — never the Claude-in-Chrome extension.
