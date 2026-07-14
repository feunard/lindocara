# Tiny Swords — asset licence

**What it is.** Tiny Swords is a 2D pixel-art asset pack by **Pixel Frog**: terrain tiles,
buildings, playable-faction units, the paid Enemy Pack (goblins, gnolls, minotaurs, skulls,
trolls), particle effects and UI elements, all built around a 64x64 tile grid. Every texture the
game draws — terrain, buildings, player classes, monsters, UI, effects — comes from this one pack
as of this repository's "one asset pack" cleanup.

**Where it came from.** Purchased/downloaded from the author's itch.io page:

- https://pixelfrog-assets.itch.io/tiny-swords
- Author: Pixel Frog (https://pixelfrog-assets.itch.io/)
- Covers the base "Free Pack", the "Update 010" content drop, and the separately-priced "Enemy
  Pack" expansion — all published under the same Tiny Swords listing by the same author.

**Under what terms.** Per the terms published on the itch.io product page (last checked
2026-07-14): usable in personal and commercial projects, including modifying the source files;
redistribution, resale, or repackaging of the asset files — modified or not — is not permitted;
crediting the author is not required but is appreciated. This game is deployed publicly and does
not redistribute the raw asset files: only derived, in-engine sheets are shipped as part of the
built client.

**A note on verification.** Sellers can update itch.io product terms after purchase. This file
records the terms as read at the date above; if the pack is ever re-vendored or updated, re-check
https://pixelfrog-assets.itch.io/tiny-swords for the current wording.

**Where it lives in this repo.**

- `assets/vendor/tiny-swords/` — the vendored source pack, bundled by Vite via `import.meta.url`
  (see `src/client/game/tiny-swords-art.ts`).
- `public/assets/lindocara/tiny-swords/` — pre-cropped/derived sheets and quest-site textures
  built from the same pack, served directly as static assets.
