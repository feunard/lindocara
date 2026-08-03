# sounds — sound effects

**MOSS-SoundEffect v2.0**, a 1.3B DiT flow-matching text-to-audio model. Apache 2.0, up to
30 s per clip. On macOS it runs through the pure-MLX `mlx-speech` runtime (4.7 GB in 4-bit,
24 kHz mono); on NVIDIA it runs through its own PyTorch pipeline in `runners/sfx/` at bf16.
Same prompts, same theme suffix.

```bash
python3 studio/studio.py sfx --prompt "a heavy wooden door creaking open" --duration 3 --out packages/client/public/assets/lindocara/audio/door.wav
```

~4 s for a 2 s clip on the M4 Pro. The model reloads on every call, so generating ten
effects costs ten loads — use `--variants` when you want several takes of the same thing.

## Writing prompts

The model wants a **physical description of one event**, not a game-design label. It has
no idea what "player takes damage" sounds like.

| Instead of | Write |
| --- | --- |
| `sword attack sound` | `a steel sword swinging fast through air, sharp whoosh` |
| `player hurt` | `a short pained grunt followed by a dull body impact` |
| `magic spell` | `a low rising hum building into a bright crystalline chime burst` |
| `enemy dies` | `a wet squelch followed by a soft collapsing thud` |
| `pickup coin` | `two small metal coins clinking together, bright and short` |

Useful vocabulary: materials (`wood`, `wet leather`, `iron`, `stone`), mic distance
(`close mic`, `distant`), acoustics (`dry`, `in a stone corridor`), and shape over time
(`sharp attack, quick decay`, `slow rising`).

The theme appends *"clean isolated single sound effect, dry close recording, no music,
no speech, no background ambience"*. That suffix is doing real work: without it the model
happily adds room tone, birdsong and a music bed under your door creak.

`prompts/` holds the recipes that worked, grouped by family. Add to it when you find a
phrasing that lands.

## Duration

`--duration` is a target, not a contract. Ask for 3 s and you get roughly 3 s, sometimes
with silence at the tail. Trim in the game engine or with ffmpeg:

```bash
ffmpeg -i in.wav -af "silenceremove=start_periods=1:stop_periods=1:stop_threshold=-50dB" out.wav
```

Short effects (impacts, clicks) do better at 1–2 s than at 5 s padded with nothing.

## Retro crunch

Off by default: Tiny Swords is HD pixel art with clean cartoon audio, not chiptune. If
you do want 8-bit texture, `--crunch light` (22 kHz / 12-bit) or `--crunch heavy`
(11 kHz / 8-bit) runs the output through ffmpeg's `acrusher`.

For genuinely retro *game* sounds — jumps, blips, power-ups — a procedural generator
(sfxr, Bfxr, jsfxr) beats any AI model: deterministic, instant, and built for exactly
those shapes. Same split as the sprite lane, where the procedural generator still owns
frame-coherent animation.

## Known limits

- **No looping.** Output has an attack and a decay; seamless ambience loops need a manual
  crossfade pass.
- **Not sample-accurate twice.** Same prompt and seed give the same file, but a small
  prompt edit changes the whole character of the sound. Lock a phrasing once it works.
- **Sound design words are ignored.** `punchy`, `juicy`, `satisfying` do nothing. Describe
  the physical event instead.
