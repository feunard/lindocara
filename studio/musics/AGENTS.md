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
