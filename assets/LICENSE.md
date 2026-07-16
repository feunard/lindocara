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

**Under what terms — and how this was determined.** Nobody on this project has read the itch.io
product page. Automated fetches of both
`https://pixelfrog-assets.itch.io/tiny-swords` and its purchase page returned **HTTP 403** every
time they were attempted (most recently 2026-07-14); the page's actual wording remains unread.

In its place, the terms below were **reconstructed from three independent web searches** that
converged on the same wording:

- usable in personal and commercial projects, including modifying the source files;
- redistribution, resale, or repackaging of the asset files — modified or not — is not permitted;
- crediting the author is not required but is appreciated.

One additional source turned up during that search — a Scribd reproduction claiming the pack is
**CC0 / public domain** — directly contradicts the three above. It was **discarded, not
reconciled**: it reads as a mis-scrape or a mislabelled re-upload rather than the seller's actual
terms, but it was not independently disproved either. Its existence is recorded here rather than
silently dropped.

**Net effect: the bullet points above are second-hand and unconfirmed, not a transcription of a
page anyone here has read.** They should not be treated as established fact for a legal question.

**Before this is relied on for anything consequential** — a licensing question, a takedown
inquiry, re-vendoring the pack, or a dispute — a human must confirm the actual terms directly,
either by loading `https://pixelfrog-assets.itch.io/tiny-swords` in a browser (it is only
automated fetches that were blocked; a human with a browser may see it fine) or by checking the
purchase receipt/email from the original download. This file is a pointer to that step, not a
substitute for it.

**What this game actually ships.** This is *not* a pack that ships only derived, in-engine sheets —
some raw pack files ship verbatim. `src/client/game/tiny-swords-art.ts` references five building
textures and one banner straight from `assets/Tiny Swords (Free Pack)/` via
`new URL("../../../assets/Tiny Swords (Free Pack)/...", import.meta.url)`, and Vite's client build
copies each of those into the deployed bundle content-hashed but **byte-identical** to the pack
original — verified by building the client and comparing checksums: e.g. `Buildings/Red
Buildings/House1.png` matches `dist/client/assets/House1-*.png`, and `UI
Elements/.../Banners/Banner.png` matches `dist/client/assets/Banner-*.png`. Those sit alongside the
separately pre-cropped/derived sheets served from `public/assets/lindocara/tiny-swords/`, which
*are* derived. Whether shipping a handful of original files *inside a built game* (as opposed to
redistributing the asset pack itself) falls within the reconstructed terms above is exactly the
kind of question that needs the human confirmation described above, not a guess recorded here.

**Where it lives in this repo.**

- `assets/Tiny Swords (Free Pack)/`, `assets/Tiny Swords (Update 010)/`,
  `assets/Tiny Swords (Enemy Pack)/` — the three packs as downloaded, the source of truth. A few
  files are bundled straight from here by Vite via `import.meta.url` (see
  `src/client/game/tiny-swords-art.ts`); the rest are the source for the derived sheets below.
- `assets/index.json` — generated catalogue of all 730 PNGs across the three packs (dimensions,
  alpha bounding box, inferred frame counts). Metadata about the pack, not pack content.
- `public/assets/lindocara/tiny-swords/` — pre-cropped/derived sheets and quest-site textures
  built from the same packs, served directly as static assets.

There is no longer an `assets/vendor/` directory, and nothing outside these three packs. It used to
hold two things:

- `vendor/tiny-swords/` — a partial, redundant fourth copy of the Free Pack. Deleted once its six
  still-referenced files were confirmed byte-identical to their `assets/Tiny Swords (Free Pack)/`
  originals and the references repointed there. This licence file is that directory's record,
  moved up: it was never specific to the copy it happened to live in, and it covers all three packs.
- `vendor/ocean_surface/` — a 3.6 MB photographic sea texture, not Pixel Frog's work and under no
  recorded terms, which briefly drew the water. Removed: the water is Tiny Swords' own flat colour
  plus its animated shoreline foam again, so nothing here needs a licence this file cannot vouch
  for.
