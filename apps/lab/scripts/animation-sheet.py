#!/usr/bin/env python3
"""Normalize a generated horizontal strip into equal transparent game frames.

The image model can keep an actor coherent across several poses when every pose is generated in
one strip, but `sprite.py`'s tight crop would destroy the strip's frame boundaries. This companion
applies the same cutout/downsample/palette/outline pipeline to each source cell separately, then
centres every result on a fixed square frame for deterministic renderer slicing.
"""

import argparse
from pathlib import Path

from PIL import Image

from sprite import couleur_de_fond, detourer, durcir, entourer, quantifier, recadrer, reduire


def normalize_frame(source, content_height, frame_size, colors, rotation):
    background = couleur_de_fond(source)
    cutout = detourer(source)
    # Generated strips sometimes enclose a pocket of their flat background between jaws or fins.
    # Reusing sprite.py's tighter second pass is safe only after the edge flood above.
    from sprite import vider_poches

    cutout = vider_poches(cutout, background)
    sprite = entourer(quantifier(durcir(reduire(recadrer(cutout), content_height)), colors))
    if rotation:
        sprite = sprite.rotate(rotation, resample=Image.Resampling.NEAREST, expand=True)
    if sprite.width > frame_size or sprite.height > frame_size:
        ratio = min(frame_size / sprite.width, frame_size / sprite.height)
        sprite = sprite.resize(
            (max(1, round(sprite.width * ratio)), max(1, round(sprite.height * ratio))),
            Image.Resampling.NEAREST,
        )
    frame = Image.new("RGBA", (frame_size, frame_size), (0, 0, 0, 0))
    frame.alpha_composite(
        sprite,
        ((frame_size - sprite.width) // 2, (frame_size - sprite.height) // 2),
    )
    return frame


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--frames", type=int, required=True)
    parser.add_argument(
        "--sequence",
        help="Comma-separated source-frame indices; for example 0,1,2,1 makes a four-frame loop from three generated poses.",
    )
    parser.add_argument("--rotate", type=int, choices=(0, 180), default=0)
    parser.add_argument("--frame-size", type=int, default=256)
    parser.add_argument("--content-height", type=int, default=150)
    parser.add_argument("--colors", type=int, default=24)
    args = parser.parse_args()

    source = Image.open(args.input).convert("RGBA")
    if args.frames <= 0:
        raise SystemExit("--frames must be positive")
    # Image generators commonly honour the visual frame count but keep a power-of-two canvas.
    # Trimming at most `frames - 1` trailing pixels preserves equal source cells without shifting
    # their centres (for example a 1024px three-pose strip becomes 1023px).
    usable_width = source.width - (source.width % args.frames)
    if usable_width <= 0:
        raise SystemExit("source is too narrow for --frames")
    if usable_width != source.width:
        source = source.crop((0, 0, usable_width, source.height))
    source_frame_width = source.width // args.frames
    try:
        sequence = (
            list(range(args.frames))
            if args.sequence is None
            else [int(value) for value in args.sequence.split(",")]
        )
    except ValueError as error:
        raise SystemExit("--sequence must contain comma-separated integers") from error
    if not sequence or any(index < 0 or index >= args.frames for index in sequence):
        raise SystemExit("--sequence contains a source-frame index outside --frames")
    output = Image.new(
        "RGBA",
        (args.frame_size * len(sequence), args.frame_size),
        (0, 0, 0, 0),
    )
    normalized = []
    for index in range(args.frames):
        cell = source.crop(
            (index * source_frame_width, 0, (index + 1) * source_frame_width, source.height)
        )
        normalized.append(
            normalize_frame(
                cell,
                args.content_height,
                args.frame_size,
                args.colors,
                args.rotate,
            )
        )
    for output_index, source_index in enumerate(sequence):
        frame = normalized[source_index]
        output.alpha_composite(frame, (output_index * args.frame_size, 0))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.save(args.output)
    print(f"{args.output}  {output.width}x{output.height}")


if __name__ == "__main__":
    main()
