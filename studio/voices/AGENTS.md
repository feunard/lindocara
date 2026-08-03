# voices — voice lines

Two models behind one command, chosen automatically:

| Model | When | Cost |
| --- | --- | --- |
| **Kokoro-82M** (Apache 2.0, 355 MB) | default — 54 stock voices | ~5 s per line |
| **Qwen3-TTS 1.7B** (8-bit) | whenever a `voice_ref` exists | slower, clones a real voice |

```bash
python3 studio/studio.py voice --text "You shall not pass the gate!" --archetype brute --out warn.wav
```

```bash
python3 studio/studio.py voice --character elf-druid --text "The forest remembers." --out druid.wav
```

## Archetypes

`theme.json` maps an archetype to a stock voice plus a pitch shift and a speed. The pitch
and speed are applied afterwards with ffmpeg, so they work identically on both models:

| Archetype | Voice | Pitch | Speed |
| --- | --- | --- | --- |
| `brute` | am_fenrir | −3 | 0.92 |
| `elder` | bm_george | −1 | 0.90 |
| `druid` | bf_emma | 0 | 0.95 |
| `trickster` | am_puck | +4 | 1.10 |
| `boss` | am_onyx | −5 | 0.88 |
| `hero_m` / `hero_f` | am_michael / af_heart | 0 | 1.00 |
| `narrator` | bm_fable | 0 | 0.95 |

These are starting points picked by name, not by listening. Tune them by ear against
`examples/` and edit `theme.json` — that is the point of having them in one place. All 54
Kokoro voices are available; the `a`/`b` prefix is American/British, `f`/`m` is the voice's
register.

Pitch shifting is a real shift (resample, then compensate tempo), so ±3 semitones stays
natural. Past about ±6 it turns into a chipmunk or a demon — which may be exactly what a
boss wants.

## Cloning a character voice

1. Record 5–15 s of clean speech — no music, no room echo, no background. Anything in
   the recording gets cloned along with the voice.
2. Save it as `voices/refs/<character>.wav`, 16 kHz or higher.
3. Point `voice_ref` at it in `characters.json`.

Every line for that character then routes through Qwen3-TTS and comes back in that voice.
This is the audio half of the sprite lane's identity lock: `sprite_ref` holds the look,
`voice_ref` holds the voice.

Ad-hoc, without touching `characters.json`:

```bash
python3 studio/studio.py voice --text "Halt!" --ref-audio voices/refs/guard.wav --ref-text "This is what my voice sounds like." --out halt.wav
```

`--ref-text` is the transcript of the reference clip. Qwen3-TTS wants it; accuracy of the
clone drops noticeably without it.

## Writing lines

- **Punctuation is prosody.** Commas make pauses, question marks lift the ending,
  exclamation marks push energy. `Halt. Who goes there?` reads very differently from
  `Halt, who goes there`.
- **Spell out what should sound spelled out.** `HP` becomes "aitch pee"; write "health"
  if you want the word.
- **Numbers and symbols are read literally and often wrongly.** Write "fifty gold", not
  "50g".
- Keep lines short. Long paragraphs drift in pace and the model sometimes swallows the
  last clause.

## Known limits

- **English is what these voices do well.** Kokoro ships French, Spanish, Italian,
  Portuguese, Hindi, Japanese and Chinese voices, but quality varies and the prosody
  rules above are tuned for English.
- **No emotion control on Kokoro.** For genuinely acted delivery — laughing, whispering,
  shouting — `mlx-speech` also carries `fish-s2-pro`, which takes inline tags like
  `[excited]` and `[whisper]`. It is **macOS-only** and not wired into `studio.py`; call it
  directly if a line needs it:

  ```bash
  mlx-speech tts --model fish-s2-pro --text "[whisper] They're inside the walls." -o line.wav
  ```
- **Not a voice actor.** These are good for prototyping, barks, and menu narration. A
  lead character with hundreds of lines still wants a human.
