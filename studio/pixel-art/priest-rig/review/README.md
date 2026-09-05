# Validation record — 2026-09-05

Reviewed at the ordinary HD-2D camera and class speed, in Chrome on Windows / RTX 3060.
The reference actors are the shipped Assassin and Runic Guardian. Review exports are evidence,
not runtime inputs or fallback art.

- [Locomotion and transitions](locomotion.png): successive samples 47 ms apart over more than
  one stride, then a 180-degree turn, stop/settling and the real controller's jump/landing.
- [Casts, death, glider, swimming and damage](actions.png): real renderer, with casts aimed
  opposite travel. The death sequence includes a further one-second hold of the settled pose.
- [All orientations, movement clips](coverage-0.png) and [action clips](coverage-1.png): three
  key phases of every delivered clip, rebuilt using its anchor metadata, without pose rescaling.
- The atlas preview was also played at 1× with foot tracks and previous-frame overlays.
  Normal-size review showed continuous weight shifts, stable identity/equipment and no distracting
  positional pop. The generated frame inventory alone was not used as a visual acceptance test.

In an isolated local party, Aurel (Priest level 10) entered the map, cast all five skills, jumped,
died, held the corpse pose and used ordinary release to respawn. The real WebSocket emitted these
accepted anticipation/recovery timings: Radiant Bolt 140/185 ms, Mend 240/600 ms, Lumen Step
180 ms plus held travel, Prayer 320/640 ms and Divine Nova 400/700 ms. The healing projectile
was observed, and no failure/cooldown/resource error occurred in that sequence. Auto-aim selected
a target behind the travel direction; the Priest turned toward it. Screenshots of this local
account remain in `artifacts/priest/live-*.png` rather than becoming game assets.

| Normal-speed eight-heading route | One Priest + references | Four Priests |
| --- | ---: | ---: |
| Duration | 12 seconds | 12 seconds |
| Presented frames/s | 57.58 | 57.63 |
| CPU composition median / p95 | 0.30 / 0.40 ms | 0.50 / 0.60 ms |
| Additional skin/pixel draws | 2 | 8 |
| Intermediate targets | 0.88 MiB | 1.17 MiB |
| Unexpected airborne/swimming frames | 0 | 0 |

This is a local browser measurement, not a mobile-device or GPU-timing certification. The runtime
uses light skeletal interpolation and contact correction, rather than exclusively baked 2D frames;
this composition is what lets a cast coexist with movement. Two limbs use rigid weights: geometry
is deliberately simple and readable at gameplay size rather than intended for portrait close-ups.

Automated validation checks all 2,008 exported frames, eight directions, source/output hashes,
fixed scale/anchors, binary alpha, atlas bounds, loop joins and source bone/contact invariants.
Tests also load the actual compiled skin and measure support drift below 0.005 tile at 30, 60 and
144 Hz, including backward/sideways moving casts, plus continuous turns, stopped swing settling,
fractional server contact timing, held release and corpse pose/orientation inheritance.

The complete local `yarn verify` passed: lint, every package's typecheck/test suite, migrations
drift, catalog/map/music/animation content checks, production build and boot smoke. Existing
Assassin, Runic Guardian and other roster tests remain in that full suite.

Regenerate these images with `review-sequences.pw.cjs` then `review-sheets.mjs`, as documented in
the parent README. The comparison retains the other actors' original playback behavior.
