---
name: game-assets
description: Generate game assets — sprites, sound effects, voice lines and music — in Lindocara's Tiny Swords art direction, locally on this machine. Use when any art or audio asset is needed: a character or enemy sprite, a prop, an icon, a UI sound, an impact or magic effect, an NPC line or bark, a background track or menu theme. Also use when the user asks for placeholder art or audio, or says an asset should match the rest of the game's style.
---

# Game assets, in the Tiny Swords style

`studio/` is a local four-lane asset studio. It runs on macOS (Apple Silicon, MLX) and on
Windows or Linux with an NVIDIA GPU (CUDA) — the backend is detected, the commands are the
same. Every model is Apache 2.0 or MIT, so the output can ship.

Run from the repo root and write straight to where the asset belongs.

## Commands

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

Shared flags: `--seed`, `--variants N`, `--no-theme`, `--dry-run`. Rough cost: sprite ~25 s,
sfx ~4 s, voice ~5 s, music ~55 s.

## Rules that matter

1. **Always go through `studio.py`.** It injects the art direction from `studio/theme.json`;
   calling the models directly produces assets that do not match the rest of the game.
2. **A sprite is not finished when it comes out.** The model renders a smooth 768²
   illustration — `scripts/sprite.py` reduces it to the game's pixel density. Then record the
   prompt and seed in `apps/lab/assets/generated/PROVENANCE.md`, or it cannot be regenerated.
3. **Describe sound effects physically.** `a steel sword swinging fast through air, sharp
   whoosh` works; `sword attack sound` does not. The model has no idea what a game event is
   supposed to sound like.
4. **Use `--character <name>`** for anything belonging to a recurring character — it pulls
   that character's description, visual reference and voice from `studio/characters.json` so
   the sprite and the voice line agree. Read that file to see who exists.
5. **Generate 2–3 variants and pick.** `--variants 3` is cheap next to regenerating later.

## Before a first run on a new machine

```bash
python3 studio/studio.py doctor --no-gen
```

It names what is missing and the command that fixes it. Install steps for both platforms
are in `studio/AGENTS.md`.

## Going deeper

Each lane has its own guide with prompt recipes and known limits — read the relevant one
before a large batch: `studio/pixel-art/AGENTS.md`, `studio/sounds/AGENTS.md`,
`studio/voices/AGENTS.md`, `studio/musics/AGENTS.md`.
