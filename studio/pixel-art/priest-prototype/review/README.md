# Validation — 6 September 2026

Validated with installed Chrome on Windows, using the real HD-2D renderer, its normal
camera and the Priest's 3.65625 tiles/s movement speed. The shipped raster textures are
the inputs; there is no alternate high-quality character in the preview.

![Priest beside Ranger, Assassin V2 and Runic Guardian](lineup.png)

## Checks performed

- Full `yarn verify`: lint, all package typechecks/tests, migrations, generated content,
  both character asset validators, production build and built-artifact boot smoke passed.
- Rebuilt Assassin V2 after sharing the raster interpolation library: approved idle,
  locomotion source poses, five skills and death remain unchanged; `assassin:check` passed.
- Repeated both complete raster builds from the committed source drawings: all delivered
  PNGs were byte-identical to the inspected versions.
- Examined sequential engine captures of run and jump in all eight directions, every
  Priest skill and death, plus swim, glide, hurt and four Priests together. Checked body
  scale, head placement, staff continuity, takeoff/apex/landing and stable death endings.
- Static studio loaded and scrubbed all 18 clips without browser exceptions.
- Real editor: selected Prêtre · Prototype, launched the full server test, cast Radiant
  Bolt, moved and jumped, then returned to the editor. The server sent the action and
  projectile snapshots; no browser exceptions. The selection exposes only Assassin V2.
- Engine emission checks: 48 first projectile positions match the displayed weapon ruby
  within 0.000001 world tile, covering Radiant Bolt/Mend, eight headings and simulated
  delivery delays of 0/100/200 ms. Server authority is covered separately by network tests.
- Character validator: all clips/directions present, source/output hashes agree, fixed
  reconstruction anchors, canonical heads, loop and transition seams, release sockets,
  stable final death, no old Priest runtime files, 160.3 MiB shared decoded textures.

The [normal-speed capture](all-directions.webm) is retained for replay. The visual review
used sequential frame captures; generating this video is not itself a perceptual test.
The preview script regenerates full-resolution witnesses, including each frame before
contact-sheet cropping, under ignored `artifacts/priest-prototype/runtime-review/`.

## Practical limits

At enlarged source scale, motion-compensated cloth and equipment edges can look softer
between authored keys. Exact physical foot contact is not inferred from image hashes;
the gait was evaluated at the normal game camera and tied to actual ground distance.
The delivered result uses the same offline raster method as Assassin V2, with no per-frame
AI, no runtime optical flow and no per-actor render targets.
