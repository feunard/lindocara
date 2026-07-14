# Lindocara art kit

Runtime assets are packed under `atlas/`:

- `world.png` and `world.json`: PixiJS world atlas.
- `hud.png`: CSS HUD icon atlas.

Class equipment layers live under `equipment/`:

- `hunter-bow.svg`: pixel-faithful local vectorization of the CC0 Ninja Adventure bow;
- `heartwood-staff.svg` and `oak-shield.svg`: original local pixel-art derivatives created for
  lindocara because the source kit contains neither a staff nor a shield.

Primary source: Ninja Adventure by Pixel-Boy and AAA.

- Source page: https://pixel-boy.itch.io/ninja-adventure-asset-pack
- Source repository: https://github.com/pixel-boy/NinjaAdventure
- License: Creative Commons Zero v1.0 Universal (CC0).

Local derivatives in the atlas:

- palette variants for player appearances;
- starter bow, Heartwood staff, and oak shield equipment layers;
- terrain detail tiles, wet ground, water tiles, ruin variants, torches, leaves, roots, grass,
  compact slime, potion, gold, crystal, crest, oath, and sword icons drawn to match the same
  16x16 pixel-art constraints.

These derivatives are released under the same CC0 / public domain equivalent terms.
No external runtime URLs are used.

Additional runtime art lives under `tiny-swords/`: pre-cropped/derived sheets (quest-site
resources, UI, etc.) built from the vendored **Tiny Swords** pack by Pixel Frog, whose complete
source lives under `assets/vendor/tiny-swords/`. See
`assets/vendor/tiny-swords/LICENSE.md` for what the pack is, where it came from, and under what
terms it is used. Tiny Swords is the only third-party art pack this game draws from.

Ambient music lives under `audio/`:

- `gloamwood-ambience.mp3`: *Forest Ambience* by TinyWorlds (Ludum Dare 29), CC0.
- Source: https://opengameart.org/content/forest-ambience

Class attack SFX live under `audio/sfx/` (CC0). Curated for a punchy fantasy-RPG feel:

**Sources**

- [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds) — metal / soft / glass impacts
- [80 CC0 RPG SFX](https://opengameart.org/content/80-cc0-rpg-sfx) (rubberduck) — blades, spells, roars
- [100 CC0 SFX](https://opengameart.org/content/100-cc0-sfx) (rubberduck) — hits, UI feedback
- [Bow & Arrow Shot](https://opengameart.org/content/bow-arrow-shot) (dorkster) — ranger bow release

**Warrior** — `warrior-*.ogg` (blade swings, metal guard, charge, roar, Kenney impacts)

**Ranger** — `ranger-*.ogg` (bow shot, volley whoosh, dash, soft impact)

**Priest** — `priest-*.ogg` (spell cast, heal, blink, prayer bell, fire nova, glass impact)

**UI** — `ui-*.ogg` (hit, loot/coins, level-up gong, interact, death, chat)
