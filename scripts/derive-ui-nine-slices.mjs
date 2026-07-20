// Extracts seamless weave tiles from the Tiny Swords packs into src/client/assets/ui/.
//
// Why derive anything at all: the packs ship their parchment boards on spaced grids — 64px cells on
// a 128px stride, gaps left transparent so the artist could draw decorative overhang (curled scroll
// ends, a clasp) past a cell's bounds. CSS `border-image` cannot read that layout: it slices inward
// from the image edges, so it samples the transparent gutters and paints holes through the panel.
// The overhang is also per-corner rather than uniform, so there is no honest nine-slice in there.
//
// What we take instead is each sheet's centre cell, which is pure repeating weave and is exactly
// what a nine-slice engine would have tiled across the middle. The panel's outline and inner band
// are then rebuilt in CSS from the pack's own colours (see theme.css), which scales cleanly to any
// panel size instead of fighting a fixed sheet.
//
// Run with `node scripts/derive-ui-nine-slices.mjs`. Output is committed and is NOT part of the
// build — re-run it only when the upstream pack changes.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every spaced sheet in the packs uses 64px cells; the centre one starts at (192, 192). */
const CELL = 64;
const CENTRE = 192;

const TILES = [
  {
    // The light board. Banner.png is a cream field inside a tan band inside a dark outline; the
    // centre cell is the cream field alone.
    from: "assets/Tiny Swords (Free Pack)/UI Elements/UI Elements/Banners/Banner.png",
    to: "src/client/assets/ui/weave-cream.png",
    left: CENTRE,
    top: CENTRE,
  },
  {
    // The darker zones. Banner_Slots.png is already contiguous, but its outer cells carry ragged
    // alpha edges that would show as seams once repeated, so take its centre cell too.
    from: "assets/Tiny Swords (Free Pack)/UI Elements/UI Elements/Banners/Banner_Slots.png",
    to: "src/client/assets/ui/weave-tan.png",
    left: CELL,
    top: CELL,
  },
];

for (const { from, to, left, top } of TILES) {
  const buffer = await sharp(resolve(root, from))
    .extract({ left, top, width: CELL, height: CELL })
    .png()
    .toBuffer();
  const target = resolve(root, to);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);
  console.log(`${to}  ${CELL}x${CELL}`);
}
