# Audio credits

**All music is generated in-house** — see "Generated in-house" below. The third-party music this
project used to ship (seven OpenGameArt tracks) was removed along with its catalogue entries; do
not reintroduce borrowed music without adding it back here first.

What remains third-party is the menu SFX and the two ambience beds, listed here with their licence.

## Menu / title

- **`sfx/title-confirm.mp3`** (confirm / select), **`sfx/title-hover.mp3`** (cursor move) and
  **`sfx/title-back.mp3`** (back) — the menu UI sounds. From *"10 Retro RPG Menu Sounds"* by
  **leohpaz** (`013_Confirm_03`, `001_Hover_01`, `029_Decline_09`), OpenGameArt.
  Licence: **CC-BY 4.0** — attribution required.
  https://opengameart.org/content/10-retro-rpg-menu-sounds

The menu music bed is now `menu_1.mp3`, generated in-house.

## Adventure and map soundscapes

- **`gloamwood-ambience.mp3`** — *"Forest Ambience"* by **TinyWorlds**, OpenGameArt.
  Licence: **CC0**.
  https://opengameart.org/content/forest-ambience
- **`swamp-ambience.ogg`** — *"Swamp Environment Audio"* by **LokiF**, OpenGameArt.
  Licence: **CC0**.
  https://opengameart.org/node/5041

CC-BY entries must keep their credit if the associated asset ships. CC0 entries need no
attribution and are listed only for provenance.

## Generated in-house

Not third-party. Generated locally with the studio's music lane (ACE-Step 1.5 — code MIT,
weights Apache 2.0), so these are ours to ship and need no attribution. Recorded here so nobody
mistakes them for the OpenGameArt tracks above, and so they can be regenerated: every one is
`python3 studio/studio.py music --duration 140 --out <path>.wav` with the caption and seed below,
converted with `ffmpeg -codec:a libmp3lame -q:a 2`. See `studio/musics/AGENTS.md`.

- **`plain_1.mp3`** — opening-area theme, a wide sunlit plain. `--no-theme`, seed 42.
  Caption: *light orchestral chamber ensemble, live instruments, clean mix, warm storybook
  fantasy, gentle instrumental theme for a wide sunlit plain, calm and safe. 90 BPM walking pace,
  warm major key with a lydian lift, wonder and open space. Solo flute melody, oboe answering,
  fingerpicked nylon guitar, harp, soft string bed. Light percussion: frame drum and shaker only,
  no kit. Quiet intro, main theme, warmer middle that rises then settles, theme returns and ends
  softly. Chamber-sized, intimate, never epic.*
- **`forest_1.mp3`** (seed 42) and **`forest_2.mp3`** (seed 43) — deep forest. `--no-theme`.
  Caption: the same style prefix as `plain_1`, then *deep old forest, 70 BPM, unhurried. Dorian
  mode, green and shadowed. Alto flute over sustained cellos, plucked harp figures, no percussion
  at all. Drifting and patient, never resolving fully. Chamber-sized, close, mysterious.*
- **`menu_1.mp3`** (seed 42) and **`menu_2.mp3`** (seed 43) — the launch-menu bed; `menu_1` is the
  one `menu-audio.ts` plays. `--no-theme`. Caption: the same style prefix as `plain_1`, then *quiet
  menu bed for a title screen, 60 BPM, almost still. Warm major key, patient and welcoming. Harp
  arpeggios with low sustained strings beneath, a distant flute holding long notes, no percussion at
  all. No strong melody and nothing that resolves, a texture that can sit under a menu forever.
  Chamber-sized, intimate, never epic.*
- **`boss_1.mp3`** — seed 42, with the stock `theme.json` prefix (*heroic medieval fantasy, light
  orchestral, warm cartoon adventure, live instruments, clean mix*). Caption: *urgent battle music,
  140 BPM, driving. Minor key, restless. Low strings carry the ostinato, horns stabbing over it,
  taiko and snare, no cymbal wash. Rising tension, brief release, straight back in. Muscular but
  small, a chamber fight not an army.* Note it was written as a general battle cue and filed as a
  boss track.

All four are 140 s, 48 kHz, peak-normalised to −1 dBFS, and **none of them loops** — each has an
intro and an ending, so a loop still has to be cut out of the middle at a bar line. The lossless
WAV masters are not in the repo; regenerate from the captions above if they are needed.
