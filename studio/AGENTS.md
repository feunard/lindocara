# Tiny Swords asset studio

Four generators for one art direction: **sprites, sound effects, voice lines, music**.
Runs locally on macOS (Apple Silicon) and on Windows or Linux with an NVIDIA GPU. Every
model is Apache 2.0 or MIT, so generated assets can ship.

## The one rule

The sprite drawing contract is **LCPixel**, defined in [styles/lcpixel/STYLE.md](styles/lcpixel/STYLE.md)
and selected by `theme.json`. Read it before creating or changing a character. For image tools,
include the locked style board and the character's canonical reference, and save the exact prompt.
Do not replace the style name, proportion targets, palette or approved references implicitly.
Run `yarn style:check`; intentional style/reference revisions use
`uv run studio/styles/lcpixel/build_reference.py` after visual review.
Use `python studio/style_system.py --prompt` to export the full prose contract, including
the numeric limits from the JSON. Single and batch `studio.py` generation inject it automatically.

Call `studio.py`, not the underlying runtimes. It injects the art direction from
`theme.json` into every prompt, which is what makes a goblin sprite, a door creak and a
village theme feel like the same game. `--no-theme` opts out when you want raw output.

## The four commands

Run them from the repo root; `--out` points wherever the asset belongs.

```bash
python3 studio/studio.py sprite --prompt "a goblin archer with a short bow, standing idle" --out apps/lab/assets/generated/goblin.png
```

```bash
python3 studio/studio.py sfx --prompt "a heavy wooden door creaking open" --duration 3 --out packages/client/public/assets/lindocara/audio/door.wav
```

```bash
python3 studio/studio.py voice --text "You shall not pass the gate!" --archetype brute --out packages/client/public/assets/lindocara/audio/vo/warn.wav
```

```bash
python3 studio/studio.py music --prompt "calm village at dawn" --duration 60 --out packages/client/public/assets/lindocara/audio/bgm/village.wav
```

For soundtrack work, use a profile from the central Lindocara Music DNA instead of hand-copying
the art direction:

```bash
python3 studio/studio.py music --list-profiles
python3 studio/studio.py music --profile exploration --variants 3 --seed 18201
```

The profile form stores prompt, seed and parameters in `musics/generations.json` and rebuilds the
typed runtime catalogue. See [`docs/music-system.md`](../docs/music-system.md) for listing,
previewing, regenerating and deleting takes.

Shared flags: `--seed` (default 42), `--variants N` (writes `name_1 … name_N`),
`--no-theme`, `--dry-run` (prints the command it would run and generates nothing — the
fastest way to see what the theme actually did to your prompt).

Sprites usually need the post-processing pass in `apps/lab/scripts/sprite.py` afterwards: the model
renders a smooth 768² illustration, and it is the averaging down that makes the pixels.
See `apps/lab/assets/generated/PROVENANCE.md`.

## Two backends, one behaviour

The backend is picked from the machine — `mlx` on Apple Silicon, `cuda` elsewhere.
`STUDIO_BACKEND=mlx|cuda` forces it. Same command, same theme, same seed semantics.

| Lane | macOS (mlx) | Windows / Linux (cuda) |
| --- | --- | --- |
| sprite | mflux | diffusers `Flux2KleinPipeline` → `runners/sprite/` |
| sfx | mlx-speech | `moss_soundeffect_v2` → `runners/sfx/` |
| voice | mlx-audio | kokoro + qwen-tts → `runners/voice/` |
| music | ACE-Step (MLX LM) | ACE-Step (PyTorch LM) |

Each CUDA lane keeps its **own** `pyproject.toml` and its own virtualenv, created on demand
by `uv run`. That is deliberate: MOSS pins numpy 1.26 and torch 2.9, diffusers wants
something newer, ACE-Step brings its own tree. One shared environment would be a permanent
dependency fight.

Measured on an M4 Pro / 48 GB: sprite ~25 s, sfx ~4 s, voice ~5 s, music ~55 s for 20 s of
audio. A 12 GB NVIDIA card holds the 4B model whole (~8.4 GB) and should land in the same
range; below ~10 GB, pass `--offload` to the sprite runner and expect it to be slow.

## Characters

`characters.json` binds a name to a look and a voice, so a creature stays itself across
lanes:

```bash
python3 studio/studio.py sprite --character elf-druid --prompt "casting a spell, arms raised" --out druid.png
python3 studio/studio.py voice  --character elf-druid --text "The forest remembers."          --out druid.wav
```

- `description` is repeated verbatim into every sprite prompt — this is what holds identity
  together inside one generation.
- `sprite_ref` locks the look *between* generations (mflux edit mode on macOS, a reference
  image passed to the pipeline on CUDA). `--no-ref` skips it.
- `voice_ref` switches the voice lane from Kokoro to Qwen3-TTS cloning. Record 5–15 s of
  clean speech into `voices/refs/<name>.wav` and point the field at it.
- `archetype` picks a stock voice, pitch and speed from `theme.json` when there is no
  `voice_ref`.

## Changing the theme

`theme.json` holds the art direction at the top of each lane and the per-backend plumbing
under `backends`. Editing `sounds.prompt_suffix` or `musics.style_prompt` re-aims every
future generation on **both** machines. The pixel-art `trigger` (`T1NYSW0RDS`) is the
LoRA's trigger word — do not translate or reword it.

The LoRA itself, `models/tinyswords-v2-4000.safetensors`, is trained in the separate
`pixel-art-model` lab. Promote a new one by copying it here and updating `theme.json`.

## Testing

```bash
python3 studio/studio.py doctor
```

Checks every runtime and weight for the detected backend, then generates one artifact per
lane into `studio/examples/_smoke/`. `--fast` skips sprite and music; `--no-gen` does
presence checks only and is the right first command on a fresh machine.

`doctor` proves the plumbing works. It cannot tell you whether a bleat sounds like a sheep
— that stays a human pass.

## Install — macOS (Apple Silicon)

`uv` and `mflux` assumed present.

```bash
uv tool install mlx-speech --python 3.13
```

```bash
uv tool install --force mlx-audio --prerelease=allow --with "misaki[en]" --with "spacy>=3.8,<4" --with "thinc>=8.3,<9" --with "en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"
```

That long line is not decoration. `--prerelease=allow` is required by mlx-audio, but left
alone it resolves spacy 4.0.0.dev3 / thinc 9.0.0, which are compiled against numpy 1.x and
die with `numpy.dtype size changed` the moment Kokoro loads. The pins hold them at stable
versions, and `en_core_web_sm` must be present up front or misaki tries to `pip install` it
at runtime and fails outside a venv.

## Install — Windows / Linux (NVIDIA)

Prerequisites: a recent NVIDIA driver, [uv](https://docs.astral.sh/uv/), ffmpeg on PATH,
and **espeak-ng** (Kokoro's phonemiser) — on Windows grab the installer from the
[espeak-ng releases](https://github.com/espeak-ng/espeak-ng/releases), on Linux
`apt install espeak-ng`.

Every command in this file starts with `python3`, which on Windows is **`python`** (or
`py -3`). `python3` there resolves to a Microsoft Store stub that opens the Store rather
than running anything, so a command that seems to do nothing at all is usually this.

Nothing else to install by hand: each lane's virtualenv is built on first use from its
`pyproject.toml`. Warm them all up and confirm the machine is ready with:

```bash
python3 studio/studio.py doctor --no-gen
```

Then let it actually generate, smallest lanes first:

```bash
python3 studio/studio.py doctor --fast
```

Windows-specific trap worth ten minutes of confusion: in the NVIDIA control panel, set
**CUDA – Sysmem Fallback Policy** to *Prefer No Sysmem Fallback*. Left on, a VRAM overflow
does not fail — it silently spills to system RAM over PCIe and runs 10–100× slower, which
reads as "the model is slow" rather than "the model does not fit".

**The CUDA path has not been executed by its author.** It is written from the upstream
docs of each model, and `doctor` is its acceptance test. If a package name has drifted
upstream, the runner says which one and what to run — the error messages carry the fix.

## Model weights

Downloaded on first use, ~30 GB total, into the HuggingFace cache and
`musics/ACE-Step-1.5/checkpoints`. ACE-Step needs one explicit fetch:

```bash
git clone https://github.com/ace-step/ACE-Step-1.5.git studio/musics/ACE-Step-1.5 && uv sync --project studio/musics/ACE-Step-1.5 && uv run --project studio/musics/ACE-Step-1.5 acestep-download
```

## Lanes

| Lane | Model | Docs |
| --- | --- | --- |
| sprite | FLUX.2-klein-4B + the Tiny Swords LoRA | [pixel-art/AGENTS.md](pixel-art/AGENTS.md) |
| sfx | MOSS-SoundEffect v2 (1.3B, 48 kHz) | [sounds/AGENTS.md](sounds/AGENTS.md) |
| voice | Kokoro-82M + Qwen3-TTS | [voices/AGENTS.md](voices/AGENTS.md) |
| music | ACE-Step 1.5 (3.5B) | [musics/AGENTS.md](musics/AGENTS.md) |

Each lane keeps an `examples/` set — the reference for what "in theme" sounds like.

## Why these models

Licensing drove the picks as much as quality. MusicGen and AudioGen are CC-BY-NC, F5-TTS is
CC-BY-NC, Stable Audio Open ships under the Stability Community Licence — all fine to
experiment with, none shippable. MOSS-SoundEffect, Kokoro, Qwen3-TTS and ACE-Step are
Apache 2.0 or MIT, matching FLUX.2-klein.

The Tiny Swords source art is Pixel Frog's pack, and the LoRA is trained on it: check the
pack's terms before distributing the adapter or generated sprites outside this project.
