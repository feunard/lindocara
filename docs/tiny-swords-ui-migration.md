# Tiny Swords UI migration

This document records the visual boundary established by the catalogue/editor foundation work.
Tiny Swords is the source of truth for game and editor imagery. React, Radix and PixelAct remain
responsible for semantics, keyboard behavior, focus management and responsive layout.

## Migrated foundation

- Buttons use catalogued blue or red normal, hover, pressed and disabled 3-slice images.
- Panels use the catalogued carved 9-slice image without stretching their corners.
- Settings use the shared Tiny Swords panel, icon button, checkbox, range and select controls.
- HUD resource bars mask catalogued base/fill artwork rather than stretching the fill.
- Default, link, interaction, map-move, paint and unavailable cursors resolve through catalogued
  images and retain a standard CSS fallback.
- Inventory, quest and mobile utility icons no longer sample the old generated HUD atlas.
- Account and roster dioramas resolve all image paths through semantic catalogue selections. Their
  former CSS-drawn sun, hills and water streaks were removed; flat backdrop colors only establish
  the authored sprites' scene layers.
- The reusable asset browser loads catalogue metadata once, lazy-loads preview images, animates
  declared strips and supports text, pack, domain and category filtering.

The four former garrison HUD textures (`frame-button`, `frame-panel`, `paper`, `wood`) and the old
`atlas/hud.png` were removed after their last runtime references were replaced.

## Deliberate non-asset CSS

The remaining gradients, borders, shadows and plain colors are limited to layout readability,
focus indicators, translucent atmospheric overlays, masking/fades, debug grids and terrain/map
data previews. They do not depict a button, panel, icon, cursor, bar, unit, prop or other asset for
which Tiny Swords supplies artwork. CSS remains necessary for clipping bar fills and preserving
text contrast over pixel art.

The locally vendored OFL fonts predate this migration and remain because Tiny Swords contains no
font files. Historical design/implementation plans under `docs/superpowers/` retain references to
the prior garrison implementation as an audit trail; they are not current product guidance.

## Runtime art boundary still to consolidate

Existing PixiJS modules still consume several pre-cropped Tiny Swords files under
`public/assets/lindocara/tiny-swords/`. They are derived exclusively from the three authoritative
packs, require no remote runtime resources, and are all covered by the raw catalogue. Moving those
renderer-internal crop recipes behind stable catalogue ids is incremental follow-up work; saved
map data and new editor palette entries must already use stable catalogue ids in this chantier.
