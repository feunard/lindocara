#!/usr/bin/env python3
"""Normalize generated animation cells into equal transparent game frames.

The image model can keep an actor coherent across several poses when every pose is generated in
one sheet, but `sprite.py`'s tight crop would destroy its frame boundaries. This companion applies
the same cutout/downsample/palette/outline pipeline to each source cell separately, can interleave a
second transition pass, then centres every result on a fixed square frame for deterministic slicing.
"""

import argparse
from pathlib import Path

from PIL import Image

from sprite import couleur_de_fond, detourer, durcir, entourer, quantifier, recadrer, reduire


def normalize_frame(
    source,
    content_height,
    frame_size,
    colors,
    rotation,
    precutout,
    foot_offset,
    background_tolerance,
    pocket_tolerance,
):
    if precutout:
        cutout = source.convert("RGBA")
    else:
        background = couleur_de_fond(source)
        cutout = detourer(source, tolerance=background_tolerance)
        # Generated strips sometimes enclose a pocket of their flat background between jaws or fins.
        # Reusing sprite.py's tighter second pass is safe only after the edge flood above.
        from sprite import vider_poches

        cutout = vider_poches(cutout, background, tolerance=pocket_tolerance)
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
    y = (
        (frame_size - sprite.height) // 2
        if foot_offset is None
        else frame_size - foot_offset - sprite.height
    )
    frame.alpha_composite(sprite, ((frame_size - sprite.width) // 2, y))
    return frame


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--inbetweens",
        type=Path,
        help=(
            "A second sheet with the same grid. Its frames are interleaved after the primary "
            "sheet's frames, turning two four-pose passes into one eight-frame animation."
        ),
    )
    parser.add_argument("--frames", type=int, required=True)
    parser.add_argument("--rows", type=int, default=1)
    parser.add_argument("--row", type=int, default=0)
    parser.add_argument(
        "--sequence",
        help="Comma-separated source-frame indices; for example 0,1,2,1 makes a four-frame loop from three generated poses.",
    )
    parser.add_argument("--rotate", type=int, choices=(0, 180), default=0)
    parser.add_argument("--frame-size", type=int, default=256)
    parser.add_argument("--content-height", type=int, default=150)
    parser.add_argument("--colors", type=int, default=24)
    parser.add_argument(
        "--precutout",
        action="store_true",
        help="Input already carries transparency; skip flat-background removal.",
    )
    parser.add_argument(
        "--foot-offset",
        type=int,
        help="Anchor the sprite's bottom this many pixels above the frame bottom.",
    )
    parser.add_argument(
        "--background-tolerance",
        type=int,
        default=42,
        help="Edge-connected background colour distance accepted by the cutout pass.",
    )
    parser.add_argument(
        "--pocket-tolerance",
        type=int,
        default=20,
        help="Tighter colour distance used for enclosed background pockets.",
    )
    args = parser.parse_args()

    if args.frames <= 0:
        raise SystemExit("--frames must be positive")
    if args.rows <= 0 or not 0 <= args.row < args.rows:
        raise SystemExit("--row must select one of the positive --rows")

    def select_row(path):
        image = Image.open(path).convert("RGBA")
        usable_height = image.height - (image.height % args.rows)
        if usable_height <= 0:
            raise SystemExit(f"{path} is too short for --rows")
        source_row_height = usable_height // args.rows
        return image.crop(
            (
                0,
                args.row * source_row_height,
                image.width,
                (args.row + 1) * source_row_height,
            )
        )

    source = select_row(args.input)
    inbetweens = select_row(args.inbetweens) if args.inbetweens else None
    if args.foot_offset is not None and not 0 <= args.foot_offset < args.frame_size:
        raise SystemExit("--foot-offset must fit inside --frame-size")
    if args.background_tolerance < 0:
        raise SystemExit("--background-tolerance must be non-negative")
    if not 0 <= args.pocket_tolerance < args.background_tolerance:
        raise SystemExit("--pocket-tolerance must be non-negative and below --background-tolerance")
    def equal_cells(image, path):
        # Image generators commonly honour the visual frame count but keep a power-of-two canvas.
        # Trimming at most `frames - 1` trailing pixels preserves equal source cells without
        # shifting their centres (for example a 1024px three-pose strip becomes 1023px).
        usable_width = image.width - (image.width % args.frames)
        if usable_width <= 0:
            raise SystemExit(f"{path} is too narrow for --frames")
        if usable_width != image.width:
            image = image.crop((0, 0, usable_width, image.height))
        return image, image.width // args.frames

    source, source_frame_width = equal_cells(source, args.input)
    if inbetweens is not None:
        inbetweens, inbetween_frame_width = equal_cells(inbetweens, args.inbetweens)
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
    output_frames = len(sequence) * (2 if inbetweens is not None else 1)
    output = Image.new(
        "RGBA",
        (args.frame_size * output_frames, args.frame_size),
        (0, 0, 0, 0),
    )
    def normalize_sheet(image, frame_width):
        normalized = []
        for index in range(args.frames):
            cell = image.crop(
                (index * frame_width, 0, (index + 1) * frame_width, image.height)
            )
            normalized.append(
                normalize_frame(
                    cell,
                    args.content_height,
                    args.frame_size,
                    args.colors,
                    args.rotate,
                    args.precutout,
                    args.foot_offset,
                    args.background_tolerance,
                    args.pocket_tolerance,
                )
            )
        return normalized

    normalized = normalize_sheet(source, source_frame_width)
    normalized_inbetweens = (
        normalize_sheet(inbetweens, inbetween_frame_width)
        if inbetweens is not None
        else None
    )
    for output_index, source_index in enumerate(sequence):
        target_index = output_index * (2 if normalized_inbetweens is not None else 1)
        output.alpha_composite(normalized[source_index], (target_index * args.frame_size, 0))
        if normalized_inbetweens is not None:
            output.alpha_composite(
                normalized_inbetweens[source_index],
                ((target_index + 1) * args.frame_size, 0),
            )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.save(args.output)
    print(f"{args.output}  {output.width}x{output.height}")


if __name__ == "__main__":
    main()
