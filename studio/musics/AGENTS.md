# musics — soundtrack

**ACE-Step 1.5**, a 3.5B diffusion music model. Code MIT, weights Apache 2.0. Output is
48 kHz. This is the one lane that was already cross-platform: on Apple Silicon the DiT and
the 5 Hz language model both run in MLX, on NVIDIA both run in PyTorch on CUDA. The only
thing `studio.py` switches is `--lm-backend` (`mlx` vs `pt`), because that part does not
auto-detect.

```bash
python3 studio/studio.py music --prompt "calm village at dawn" --duration 60 --out packages/client/public/assets/lindocara/audio/bgm/village.wav
```

Measured: **55 s wall-clock for a 20 s track**, of which the diffusion itself is 2.3 s
(8 steps at 0.28 s/step). Almost all the time is model load and VAE decode, so a 60 s
track costs barely more than a 20 s one. Generate long, cut down.

Range is 10 s to 10 minutes. Instrumental by default; `--vocal` allows singing.

## Why this lane has its own venv

ACE-Step needs PyTorch and Python 3.11–3.12, and brings its own dependency tree. Every lane
here is isolated the same way, so a change in one cannot break another. `studio.py` shells
out through `uv run --project studio/musics/ACE-Step-1.5`.

Direct use, bypassing the theme:

```bash
uv run --project studio/musics/ACE-Step-1.5 python studio/musics/run_acestep.py --caption "..." --duration 30 --lm-backend mlx --out out.wav
```

ACE-Step's own `cli.py` is an interactive wizard and cannot be scripted — that is why
`run_acestep.py` exists, driving the documented Python API instead.

## Writing prompts

The theme prepends *"heroic medieval fantasy, light orchestral, warm cartoon adventure,
live instruments, clean mix"*, so your prompt only needs to say what is different about
this track: the scene, the mood, the energy.

| Track | Prompt |
| --- | --- |
| Town | `calm village at dawn, gentle strings and flute, unhurried` |
| Combat | `urgent battle music, driving drums, brass stabs, rising tension` |
| Boss | `dark orchestral confrontation, low brass, choir swells, heavy percussion` |
| Victory | `short triumphant fanfare, bright brass, resolving major chord` |
| Menu | `soft looping ambience, harp and low strings, almost still` |

What steers the model, roughly in order of strength: **instruments** > **tempo and
energy** > **mood adjectives** > everything else. `--duration` and the optional `bpm`
field in `run_acestep.py` are honoured directly.

Genre names work well and are worth exploiting: `celtic folk`, `baroque`, `spaghetti
western` all land recognisably and can be blended with the theme's base style.

### The caption is capped at 512 characters, and the overflow is dropped silently

`studio.py` truncates at 512 (`cmd_music`) with no warning — a long prompt does not fail, it
arrives at the model with its tail cut off mid-word. The theme prefix eats the first 95 of
those characters, so **a themed prompt has ~415 characters to work in**, and `--no-theme`
buys back the difference. Count before you generate; the parts authors write last — structure,
"fully instrumental", the mood qualifiers — are exactly the parts that fall off the end.

When something has to go, cut in reverse order of steering strength: structure first (it comes
out loose anyway, see Known limits), then mood adjectives, and keep the instrument list intact.

### A caption that worked

The opening-area theme, 503 characters. Regenerate it with `--no-theme --seed 42 --duration 140`
— the audio itself is not in the repo (`studio/examples/` is git-ignored local scratch), but the
seed makes it reproducible:

> light orchestral chamber ensemble, live instruments, clean mix, warm storybook fantasy,
> gentle instrumental theme for a wide sunlit plain, calm and safe. 90 BPM walking pace, warm
> major key with a lydian lift, wonder and open space. Solo flute melody, oboe answering,
> fingerpicked nylon guitar, harp, soft string bed. Light percussion: frame drum and shaker
> only, no kit. Quiet intro, main theme, warmer middle that rises then settles, theme returns
> and ends softly. Chamber-sized, intimate, never epic.

The skeleton it follows, reusable for any cue: **style prefix, scene in one clause, tempo +
walking/driving pace, key and its colour, lead instrument and who answers it, the accompaniment
bed, the percussion (naming what to leave out), a one-line structure, then the size adjectives.**
Naming the absent instruments (`no kit`) works as well as naming the present ones.

### Drop the theme for anything quiet

`theme.json` prepends *"heroic medieval fantasy, light orchestral, warm cartoon adventure"* to
every track, and **"heroic" actively fights an intimate cue**. Generated at the same seed with
and without it, the no-theme take won for the sunlit-plain theme. For exploration, ambience,
towns and menus, pass `--no-theme` and supply a substitute style prefix that keeps the lane
coherent without the scale — `light orchestral chamber ensemble, live instruments, clean mix,
warm storybook fantasy` is the one already proven. Combat, boss and victory cues want the stock
theme as-is; that is what it was written for.

### Starting points for the other cues

Built on the skeleton above, **none of these have been generated yet** — they are drafts to
edit, not recipes that landed. Check the length before running each one.

| Cue | Prompt after the style prefix |
| --- | --- |
| Combat | `urgent battle music, 140 BPM, driving. Minor key, restless. Low strings carry the ostinato, horns stabbing over it, taiko and snare, no cymbal wash. Rising tension, brief release, straight back in. Muscular but small, a chamber fight not an army.` |
| Boss | `dark confrontation, 100 BPM, heavy tread. Minor key with a flattened second. Low brass leads, choir swelling underneath, timpani and anvil hits. Slow menacing build, a break to almost nothing, then the full weight returns.` |
| Forest | `deep old forest, 70 BPM, unhurried. Dorian mode, green and shadowed. Alto flute over sustained cellos, plucked harp figures, no percussion at all. Drifting and patient, never resolving fully. Chamber-sized, close, mysterious.` |
| Cave | `underground stillness, 60 BPM, barely moving. Ambiguous key, no clear tonic. Bowed vibraphone and low drone strings, single distant harp notes, sparse frame drum. Almost static, cold and wide. No melody.` |
| Coast | `sunlit harbour, 110 BPM, lilting six-eight. Bright major, salt air. Tin whistle melody with fiddle answering, bodhran and strummed bouzouki. Cheerful, working, a little windswept. Small band, never orchestral.` |
| Snow | `frozen plain, 80 BPM, slow steps. Major key turned pale and thin. Solo clarinet over high sustained strings, celesta glints, brushed frame drum. Beautiful and unwelcoming. Chamber-sized, sparse, never epic.` |

## Looping

Generated tracks have an intro and an ending — they do not loop cleanly. Two options:

- Generate 2–3× the length you need and cut a loop out of the middle at a bar line.
- Ask for `soft looping ambience, almost still` and crossfade the seams; sparse, static
  material hides a crossfade far better than a melody does.

## Training a style LoRA

ACE-Step supports LoRA fine-tuning on 20–50 tracks of 30–120 s (WAV or FLAC, 44.1 kHz+),
documented in `ACE-Step-1.5/docs/en/LoRA_Training_Tutorial.md`. That is the same move as
`T1NYSW0RDS` in the sprite lane, and it is the natural next step once a corpus you hold
the rights to exists. Nothing here is trained yet.

## Known limits

- **Song structure is loose.** Verse/chorus arrangement is suggestive at best; for game
  loops that rarely matters.
- **Vocals are a lottery.** `--vocal` produces singing, but lyrics come out slurred often
  enough that instrumental is the sane default for a soundtrack.
- **Mix, not master.** Output is normalised to −1 dBFS peak. Run it through whatever
  bus processing the game uses rather than treating it as finished.
