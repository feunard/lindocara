# pixel-art — sprites

**FLUX.2-klein-4B** (Apache 2.0) plus `models/tinyswords-v2-4000.safetensors`, our LoRA
trained on the Tiny Swords packs. Trigger word `T1NYSW0RDS`, LoRA scale 1.4, 4 steps,
768×768.

```bash
python3 studio/studio.py sprite --prompt "a goblin archer with a short bow, standing idle" --out apps/lab/assets/generated/goblin.png
```

~25 s per image on an M4 Pro; a 12 GB NVIDIA card should be in the same range.

## What comes out, and what to do with it

The model renders a **smooth 768² illustration**, not pixel art. What makes it pixel art is
the averaging-down pass in `apps/lab/scripts/sprite.py`: background cutout, crop, reduce to the
game's pixel density, binary alpha, palette reduction, outline in rgb(22,28,46). Skip it
and your new prop is ten times more detailed than the trees around it.

`apps/lab/assets/generated/PROVENANCE.md` records the prompt, seed and post-processing for
every sprite already in the game. Add to it when you add a sprite — a sprite whose prompt
is lost cannot be regenerated consistently.

## Prompting

Structure that works: `<trigger>. <subject with its distinguishing features>, <pose or
action>. <suffix>`. `studio.py` adds the trigger and the suffix; write the middle.

- **Describe features, not style.** The style lives in the trigger word. Words like "pixel
  art" in the prompt make it leak into ordinary vocabulary.
- **Say the view.** `three-quarter view`, `seen from above`, `side view`. Ground props read
  very differently flat versus standing.
- **Same seed for a matched pair.** The open and closed chest share seed 43 — that is what
  makes them the same object.

## Locking a character

Two mechanisms, both driven from `characters.json`:

1. **`description`** is repeated verbatim into every prompt. It holds identity together
   *within* one generation, and it is what keeps a sheet's frames the same creature.
2. **`sprite_ref`** holds identity *between* generations — mflux edit mode on macOS, a
   reference image passed to the pipeline on CUDA. Pick one hero frame, point the field at
   it, and every later sheet matches it.

Trade-off worth knowing: reference conditioning also freezes poses. Counter it with
exaggerated motion language ("legs lifted high, big strides, every frame a clearly
different phase"). And **retrying a failed edit-mode sheet with a new seed reproduces the
same failure** — the reference dominates. Change the wording instead, or generate the
problem frame standalone and pair it with the good ones.

## Training a new LoRA

Not here. The lab is the separate `pixel-art-model` repo: dataset construction, training
config, checkpoint selection and the memory constraints that make it work on 48 GB. When a
new checkpoint wins, copy it into `studio/models/` and update `theme.json`.
