# Painted motion review — 2026-09-05

This revision replaces the visible primitive 3D Priest with illustrated, articulated parts and
revises the gait after the user's feedback about an excessively straight back. The comparison
uses the ordinary HD-2D camera and actual 3.65625 tiles/s class speed in Chrome / Windows / RTX 3060.
Review images are evidence, never runtime inputs or fallback artwork.

- [Game comparison](game-comparison.png): Ranger, Assassin, the painted Priest and Runic Guardian
  side by side at normal game size, with the reference actors' shipped art and playback unchanged.
- [Normal-speed recording](locomotion.webm): the live browser's eight-heading route, cropped without
  enlarging the characters. Recorded playback is separate from the performance measurements below.
- [Locomotion and transitions](locomotion.png): successive 47 ms samples across a complete stride,
  followed by a 180-degree reversal, stop/settling and the real controller's jump/landing.
- [Actions](actions.png): all five casts aimed opposite travel, continuous death plus a further
  one-second final hold, glider, swimming and damage reaction.
- [Movement coverage](coverage-0.png) and [action coverage](coverage-1.png): three phases of every
  delivered clip in all eight directions, reconstructed from fixed anchor metadata.

The live browser route ran at 1× across eight headings. Sequence comparisons show the new forward
weight transfer, opposing pelvis/chest rotation, head compensation and trailing equipment/cloth.
The atlas studio was also checked with its full-body skeleton display and artwork overlay.
Source arms were unbent before articulation so the illustration does not add a second elbow bend.
The staff's rest pitch was corrected after its first motion cancelled the body's forward lean.

| Twelve-second route at normal speed | One Priest + three references | Four Priests |
| --- | ---: | ---: |
| Presented frames/s | 56.96 | 56.91 |
| CPU composition median / p95 | 0.40 / 0.60 ms | 1.10 / 1.40 ms |
| Additional painted-mesh / pixel draws | 2 | 8 |
| Intermediate targets | 0.88 MiB | 1.17 MiB |
| Unexpected airborne/swimming frames | 0 | 0 |

These measurements precede the full verification workload. They measure CPU submission on this
machine, not GPU time or mobile performance. One shared painted texture uses 7.5 MiB decoded;
the 4,508-byte skeleton contains no visible geometry. Exported review atlases total 83.4 MiB
decoded and are not all loaded by gameplay.

Automated validation checks 2,008 frames, eight directions, fourteen clips, source/output hashes,
fixed scale/anchors, binary alpha, atlas bounds, loop joins and source bone/contact invariants.
Renderer tests load the compiled skeleton and measure support drift at 30, 60 and 144 Hz,
including moving casts, continuous turns, settling, fractional server contact timing, held
release and corpse inheritance. An additional test measures the actual painted sole vertices
through 180 moving samples in three headings: over 300 contact samples must stay below 0.3 pixel.
Repeated render timestamps during a backward-moving cast also preserve body lean and foot positions;
the travel direction is retained instead of being inferred from a zero displacement.

The complete local `yarn verify` passed: lint, all package typechecks and tests, migration drift,
catalog/map/music/animation content checks, production build and boot smoke. The final timestamp
correction additionally passed all seven compiled-Priest renderer tests.

The artwork revision does not change server outcomes, skill timings, movement speed or the shared
animation behavior of other classes. Its visual witness uses simulated accepted server timestamps;
the earlier real-party gameplay rehearsal is not presented as a new test of this artwork.

Remaining scope limits: artwork uses five authored orientations reflected into eight game headings,
as documented in the parent README. Feature shapes are directional illustrations, not freely
rotatable 3D surfaces; extreme portrait magnification can expose the painted-part construction.
Acceptance targets the ordinary game camera and speed, not a close-up cinematic character.

Regenerate the images with `review-sequences.pw.cjs`, then `review-sheets.mjs`. The parent README
documents the build, full `yarn verify`, preview controls and diagnostic capture commands.
