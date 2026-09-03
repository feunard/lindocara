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

from sprite import (
    couleur_de_fond,
    detourer,
    durcir,
    entourer,
    quantifier,
    reduire,
    vider_poches,
)


def crop_visible(image, margin=2, alpha_threshold=128):
    """Crop from the pixels that survive the hard-alpha pass.

    Background removal can leave sub-threshold alpha across an otherwise empty part of a cell.
    Measuring that residue made the real character smaller before `durcir` removed it, so key poses
    and generated in-betweens could alternate between two apparent scales.
    """
    alpha = image.getchannel("A").point(
        lambda value: 255 if value >= alpha_threshold else 0
    )
    box = alpha.getbbox()
    if not box:
        return image
    x0, y0, x1, y1 = box
    return image.crop(
        (
            max(0, x0 - margin),
            max(0, y0 - margin),
            min(image.width, x1 + margin),
            min(image.height, y1 + margin),
        )
    )


def opaque_components(image, alpha_threshold=128):
    """Return four-connected opaque components as flat pixel-index lists."""
    alpha = image.getchannel("A")
    width, height = image.size
    visible = bytearray(
        1 if value >= alpha_threshold else 0 for value in alpha.getdata()
    )
    visited = bytearray(width * height)
    components = []
    for start, is_visible in enumerate(visible):
        if not is_visible or visited[start]:
            continue
        visited[start] = 1
        stack = [start]
        component = []
        while stack:
            index = stack.pop()
            component.append(index)
            x = index % width
            for neighbour in (
                index - 1 if x > 0 else -1,
                index + 1 if x + 1 < width else -1,
                index - width if index >= width else -1,
                index + width if index + width < width * height else -1,
            ):
                if neighbour >= 0 and visible[neighbour] and not visited[neighbour]:
                    visited[neighbour] = 1
                    stack.append(neighbour)
        components.append(component)
    return components


def discard_small_components(image, minimum_area_ratio, alpha_threshold=128):
    """Remove detached projectiles and generation debris without touching the actor.

    Generated combat cells often include an already-released arrow beside the caster. Including
    that small island in the crop shifts the actor horizontally even though the runtime draws the
    authoritative projectile separately. Keeping every component whose area is a modest fraction
    of the largest one preserves held weapons and costume parts while dropping those distant specks.
    """
    if minimum_area_ratio <= 0:
        return image
    components = opaque_components(image, alpha_threshold)
    if not components:
        return image
    width, height = image.size
    minimum_area = max(len(component) for component in components) * minimum_area_ratio
    kept = bytearray(width * height)
    for component in components:
        if len(component) >= minimum_area:
            for index in component:
                kept[index] = 1
    result = image.copy()
    result_alpha = result.getchannel("A")
    result_alpha.putdata(
        [
            value if kept[index] else 0
            for index, value in enumerate(result_alpha.getdata())
        ]
    )
    result.putalpha(result_alpha)
    return result


def primary_component_centres(
    image,
    count,
    axis,
    explicit_background,
    background_tolerance,
    pocket_tolerance,
):
    background = (
        couleur_de_fond(image) if explicit_background is None else explicit_background
    )
    cutout = detourer(
        image,
        tolerance=background_tolerance,
        background=explicit_background,
    )
    cutout = vider_poches(cutout, background, tolerance=pocket_tolerance)
    components = sorted(opaque_components(cutout), key=len, reverse=True)[:count]
    if len(components) != count:
        raise SystemExit(f"could not find {count} primary sprites for automatic cell detection")
    width = image.width
    return sorted(
        sum((index % width) if axis == "x" else (index // width) for index in component)
        / len(component)
        for component in components
    )


def automatic_cells(
    image,
    count,
    explicit_background,
    background_tolerance,
    pocket_tolerance,
):
    """Split a generated row around its actual actor centres instead of assumed equal columns."""
    centres = primary_component_centres(
        image,
        count,
        "x",
        explicit_background,
        background_tolerance,
        pocket_tolerance,
    )
    width = image.width
    boundaries = [0]
    boundaries.extend(round((left + right) / 2) for left, right in zip(centres, centres[1:]))
    boundaries.append(width)
    if any(left >= right for left, right in zip(boundaries, boundaries[1:])):
        raise SystemExit("automatic cell detection produced overlapping cells")
    return [
        image.crop((left, 0, right, image.height))
        for left, right in zip(boundaries, boundaries[1:])
    ]


def automatic_rows(
    image,
    row_count,
    column_count,
    explicit_background,
    background_tolerance,
    pocket_tolerance,
):
    """Split a generated grid between the measured centres of its actor rows."""
    sprite_centres = primary_component_centres(
        image,
        row_count * column_count,
        "y",
        explicit_background,
        background_tolerance,
        pocket_tolerance,
    )
    centres = [
        sum(sprite_centres[index : index + column_count]) / column_count
        for index in range(0, len(sprite_centres), column_count)
    ]
    boundaries = [0]
    boundaries.extend(round((top + bottom) / 2) for top, bottom in zip(centres, centres[1:]))
    boundaries.append(image.height)
    if any(top >= bottom for top, bottom in zip(boundaries, boundaries[1:])):
        raise SystemExit("automatic row detection produced overlapping rows")
    return [
        image.crop((0, top, image.width, bottom))
        for top, bottom in zip(boundaries, boundaries[1:])
    ]


def prepare_frame(
    source,
    precutout,
    background_tolerance,
    pocket_tolerance,
    minimum_component_area_ratio,
    explicit_background,
):
    if precutout:
        cutout = source.convert("RGBA")
    else:
        background = couleur_de_fond(source) if explicit_background is None else explicit_background
        cutout = detourer(
            source,
            tolerance=background_tolerance,
            background=explicit_background,
        )
        # Generated strips sometimes enclose a pocket of their flat background between jaws or fins.
        # Reusing sprite.py's tighter second pass is safe only after the edge flood above.
        cutout = vider_poches(cutout, background, tolerance=pocket_tolerance)
    return crop_visible(
        discard_small_components(cutout, minimum_component_area_ratio)
    )


def normalize_frame(
    source,
    content_height,
    frame_size,
    colors,
    rotation,
    foot_offset,
):
    sprite = entourer(quantifier(durcir(reduire(source, content_height)), colors))
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
        "--row-gutter",
        type=int,
        default=0,
        help=(
            "Discard this many pixels from the top and bottom of the selected source row. "
            "Useful when generated effects bleed across nominal row boundaries."
        ),
    )
    parser.add_argument(
        "--row-gutter-top",
        type=int,
        help="Override --row-gutter for only the top edge of the selected row.",
    )
    parser.add_argument(
        "--row-gutter-bottom",
        type=int,
        help="Override --row-gutter for only the bottom edge of the selected row.",
    )
    parser.add_argument(
        "--sequence",
        help="Comma-separated source-frame indices; for example 0,1,2,1 makes a four-frame loop from three generated poses.",
    )
    parser.add_argument(
        "--auto-cells",
        action="store_true",
        help=(
            "Detect the requested number of actor centres and split between them instead of "
            "assuming the generated sheet uses equal-width columns."
        ),
    )
    parser.add_argument(
        "--auto-rows",
        action="store_true",
        help=(
            "Detect actor row centres before selecting --row instead of assuming equal-height "
            "rows in the generated sheet."
        ),
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
        "--background-color",
        help=(
            "Explicit six-digit RGB background colour, for example ff00ff. This avoids sampling "
            "a neighbouring sprite when generated cells touch their nominal edges."
        ),
    )
    parser.add_argument(
        "--pocket-tolerance",
        type=int,
        default=20,
        help="Tighter colour distance used for enclosed background pockets.",
    )
    parser.add_argument(
        "--minimum-component-area-ratio",
        type=float,
        default=0,
        help=(
            "Discard disconnected alpha islands smaller than this fraction of the largest "
            "component. Useful for caster strips whose projectiles render separately."
        ),
    )
    args = parser.parse_args()

    if args.frames <= 0:
        raise SystemExit("--frames must be positive")
    if args.rows <= 0 or not 0 <= args.row < args.rows:
        raise SystemExit("--row must select one of the positive --rows")
    row_gutter_top = (
        args.row_gutter if args.row_gutter_top is None else args.row_gutter_top
    )
    row_gutter_bottom = (
        args.row_gutter if args.row_gutter_bottom is None else args.row_gutter_bottom
    )
    if min(args.row_gutter, row_gutter_top, row_gutter_bottom) < 0:
        raise SystemExit("row gutters must be non-negative")
    if args.background_tolerance < 0:
        raise SystemExit("--background-tolerance must be non-negative")
    if not 0 <= args.pocket_tolerance < args.background_tolerance:
        raise SystemExit("--pocket-tolerance must be non-negative and below --background-tolerance")
    if not 0 <= args.minimum_component_area_ratio <= 1:
        raise SystemExit("--minimum-component-area-ratio must be between zero and one")
    explicit_background = None
    if args.background_color is not None:
        value = args.background_color.removeprefix("#")
        if len(value) != 6:
            raise SystemExit("--background-color must be a six-digit RGB value")
        try:
            explicit_background = tuple(
                int(value[index : index + 2], 16) for index in (0, 2, 4)
            )
        except ValueError as error:
            raise SystemExit("--background-color must be a six-digit RGB value") from error

    def select_row(path):
        image = Image.open(path).convert("RGBA")
        if args.auto_rows:
            rows = automatic_rows(
                image,
                args.rows,
                args.frames,
                explicit_background,
                args.background_tolerance,
                args.pocket_tolerance,
            )
            selected = rows[args.row]
            if row_gutter_top + row_gutter_bottom >= selected.height:
                raise SystemExit("row gutters must leave some pixels in the selected row")
            return selected.crop(
                (
                    0,
                    row_gutter_top,
                    selected.width,
                    selected.height - row_gutter_bottom,
                )
            )
        usable_height = image.height - (image.height % args.rows)
        if usable_height <= 0:
            raise SystemExit(f"{path} is too short for --rows")
        source_row_height = usable_height // args.rows
        if row_gutter_top + row_gutter_bottom >= source_row_height:
            raise SystemExit("row gutters must leave some pixels in the selected row")
        row_top = args.row * source_row_height
        return image.crop(
            (
                0,
                row_top + row_gutter_top,
                image.width,
                row_top + source_row_height - row_gutter_bottom,
            )
        )

    source = select_row(args.input)
    inbetweens = select_row(args.inbetweens) if args.inbetweens else None
    if args.foot_offset is not None and not 0 <= args.foot_offset < args.frame_size:
        raise SystemExit("--foot-offset must fit inside --frame-size")

    def split_cells(image, path):
        if args.auto_cells:
            return automatic_cells(
                image,
                args.frames,
                explicit_background,
                args.background_tolerance,
                args.pocket_tolerance,
            )
        # Image generators commonly honour the visual frame count but keep a power-of-two canvas.
        # Trimming at most `frames - 1` trailing pixels preserves equal source cells without
        # shifting their centres (for example a 1024px three-pose strip becomes 1023px).
        usable_width = image.width - (image.width % args.frames)
        if usable_width <= 0:
            raise SystemExit(f"{path} is too narrow for --frames")
        if usable_width != image.width:
            image = image.crop((0, 0, usable_width, image.height))
        frame_width = image.width // args.frames
        return [
            image.crop((index * frame_width, 0, (index + 1) * frame_width, image.height))
            for index in range(args.frames)
        ]

    source_cells = split_cells(source, args.input)
    inbetween_cells = split_cells(inbetweens, args.inbetweens) if inbetweens is not None else None
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
    def normalize_sheet(cells):
        normalized = []
        for cell in cells:
            normalized.append(
                normalize_frame(
                    prepare_frame(
                        cell,
                        args.precutout,
                        args.background_tolerance,
                        args.pocket_tolerance,
                        args.minimum_component_area_ratio,
                        explicit_background,
                    ),
                    args.content_height,
                    args.frame_size,
                    args.colors,
                    args.rotate,
                    args.foot_offset,
                )
            )
        return normalized

    normalized = normalize_sheet(source_cells)
    normalized_inbetweens = (
        normalize_sheet(inbetween_cells)
        if inbetween_cells is not None
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
