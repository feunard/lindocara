#!/usr/bin/env python3
"""Cut the launch backdrop painting into the living-backdrop parallax layers.

Source master: apps/lab/assets/generated/launch-menu-backdrop.png (1536x864,
FLUX.2-klein-4B, seed 42, LoRA scale 0.0 -- see the launch-gate design spec on
the feat-launch-gate branch, docs/superpowers/specs/2026-08-11-launch-gate-design.md).
The PNG master stays out of the client bundle; only the WebP cuts below ship.

Outputs (packages/client/public/assets/lindocara/ui/):
  launch-backdrop-sky.webp     the full painting, the opaque base layer
  launch-backdrop-far.webp     far mountains, alpha-feathered top edge
  launch-backdrop-mid.webp     mid hills, alpha-feathered top edge
  launch-backdrop-fore.webp    foreground slopes, alpha-feathered top edge
  launch-backdrop-clouds.webp  horizontally tileable cloud strip, luminance-keyed
                               from the painting's own sky band

The layers are horizontal bands, not silhouette cuts: each keeps the whole
painting below its feather, so no drift can ever expose a hole. Content inside
a feather zone blends two copies of the painting shifted by the relative layer
drift -- under the spec's 1.5%-of-width parallax ceiling that shift is <= ~9px,
which the 90px feather absorbs invisibly.

Usage: python3 scripts/cut-launch-backdrop.py
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "apps/lab/assets/generated/launch-menu-backdrop.png"
OUT_DIR = ROOT / "packages/client/public/assets/lindocara/ui"

# Band tops, in source rows. Each layer must be fully opaque ABOVE its own
# highest painted content (the tallest far peak sits near row 245), so the
# feather lives in the layer behind it.
FEATHER = 90
FAR_TOP = 150  # opaque by row 240, above the tallest mountain peak
MID_TOP = 340  # opaque by row 430, above the green hill line
FORE_TOP = 470  # opaque by row 560, above the dark foreground slopes

# Cloud strip band and tileability crossfade width. The band must stay ABOVE
# the tallest mountain peak (~row 245) or its silhouette gets keyed into the
# drifting clouds as a ghost ridge.
CLOUD_TOP, CLOUD_BOTTOM = 30, 230
CLOUD_FADE = 256
# High-pass gain for the cloud alpha key: clouds are what sits brighter than
# the heavily blurred local sky, scaled up into a usable alpha ramp.
CLOUD_GAIN = 3.0

WEBP_OPTS = {"quality": 82, "method": 6}


def vertical_ramp(width: int, height: int, stops: list[tuple[int, int]]) -> Image.Image:
    """An L-mode mask whose value is linearly interpolated down the rows.

    `stops` is [(row, value), ...] sorted by row; values hold before the first
    and after the last stop.
    """
    column = Image.new("L", (1, height))
    values = []
    for y in range(height):
        while len(stops) > 1 and y >= stops[1][0]:
            stops = stops[1:]
        if len(stops) == 1 or y <= stops[0][0]:
            values.append(stops[0][1])
        else:
            (y0, v0), (y1, v1) = stops[0], stops[1]
            values.append(round(v0 + (v1 - v0) * (y - y0) / (y1 - y0)))
    column.putdata(values)
    return column.resize((width, height), Image.Resampling.BILINEAR)


def cut_band(source: Image.Image, top: int, name: str) -> None:
    """Crop from `top` down and feather the first FEATHER rows to transparent."""
    band = source.crop((0, top, source.width, source.height)).convert("RGBA")
    alpha = vertical_ramp(band.width, band.height, [(0, 0), (FEATHER, 255)])
    band.putalpha(alpha)
    band.save(OUT_DIR / name, **WEBP_OPTS)


def cut_clouds(source: Image.Image) -> None:
    """Key the sky band's clouds onto alpha and make the strip tile horizontally."""
    strip = source.crop((0, CLOUD_TOP, source.width, CLOUD_BOTTOM)).convert("RGB")
    luma = strip.convert("L")
    blurred = luma.filter(ImageFilter.GaussianBlur(40))
    # (luma - blurred) / (1 / gain): PIL's subtract divides by `scale`.
    alpha = ImageChops.subtract(luma, blurred, scale=1.0 / CLOUD_GAIN)
    alpha = alpha.filter(ImageFilter.GaussianBlur(2))
    # Fade the strip's own top/bottom so it never shows a hard horizontal edge.
    envelope = vertical_ramp(
        strip.width,
        strip.height,
        [(0, 0), (40, 255), (strip.height - 40, 255), (strip.height - 1, 0)],
    )
    alpha = ImageChops.multiply(alpha, envelope)
    clouds = strip.convert("RGBA")
    clouds.putalpha(alpha)

    # Crossfade the head over the tail so column W-F-1 flows into column 0.
    tile_width = clouds.width - CLOUD_FADE
    head = clouds.crop((0, 0, CLOUD_FADE, clouds.height))
    tail = clouds.crop((tile_width, 0, clouds.width, clouds.height))
    # 0 (left) -> 255 (right), built explicitly: at x=0 the blend is pure tail
    # (strip column W-F), so the previous tile's last column flows into it.
    ramp_row = Image.new("L", (CLOUD_FADE, 1))
    ramp_row.putdata([round(255 * x / (CLOUD_FADE - 1)) for x in range(CLOUD_FADE)])
    ramp = ramp_row.resize((CLOUD_FADE, clouds.height), Image.Resampling.NEAREST)
    blended = Image.composite(head, tail, ramp)
    tile = clouds.crop((0, 0, tile_width, clouds.height))
    tile.paste(blended, (0, 0))
    tile.save(OUT_DIR / "launch-backdrop-clouds.webp", **WEBP_OPTS)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGB")
    if (source.width, source.height) != (1536, 864):
        raise SystemExit(f"unexpected master size {source.size}, expected 1536x864")

    source.save(OUT_DIR / "launch-backdrop-sky.webp", **WEBP_OPTS)
    cut_band(source, FAR_TOP, "launch-backdrop-far.webp")
    cut_band(source, MID_TOP, "launch-backdrop-mid.webp")
    cut_band(source, FORE_TOP, "launch-backdrop-fore.webp")
    cut_clouds(source)

    for path in sorted(OUT_DIR.glob("launch-backdrop-*.webp")):
        print(f"{path.relative_to(ROOT)}  {path.stat().st_size // 1024} KiB")


if __name__ == "__main__":
    main()
