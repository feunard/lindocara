from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw


@dataclass(frozen=True)
class SourceCrop:
    name: str
    source: str
    box: tuple[int, int, int, int]
    trim: bool = True
    transform: Callable[[Image.Image], Image.Image] | None = None


PADDING = 2
ATLAS_WIDTH = 256


def trim_alpha(image: Image.Image) -> Image.Image:
    bbox = image.getbbox()
    return image.crop(bbox) if bbox else image


def shift_palette(image: Image.Image, mapping: dict[tuple[int, int, int], tuple[int, int, int]]) -> Image.Image:
    image = image.convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            replacement = mapping.get((r, g, b))
            if replacement:
                pixels[x, y] = (*replacement, a)
    return image


def make_slime() -> Image.Image:
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    outline = "#17231c"
    dark = "#315f3f"
    mid = "#5fae63"
    light = "#9be37a"
    glow = "#d7f7a1"
    draw.rectangle((4, 12, 11, 13), fill=outline)
    draw.rectangle((2, 9, 13, 12), fill=outline)
    draw.rectangle((3, 6, 12, 10), fill=outline)
    draw.rectangle((5, 4, 10, 6), fill=outline)
    draw.rectangle((4, 7, 11, 11), fill=mid)
    draw.rectangle((3, 9, 12, 12), fill=mid)
    draw.rectangle((5, 5, 10, 8), fill=mid)
    draw.rectangle((4, 11, 11, 12), fill=dark)
    draw.rectangle((6, 5, 9, 6), fill=light)
    draw.point((6, 8), fill=outline)
    draw.point((10, 8), fill=outline)
    draw.point((7, 10), fill=outline)
    draw.point((8, 11), fill=outline)
    draw.point((9, 10), fill=outline)
    draw.point((7, 6), fill=glow)
    return image


def make_potion() -> Image.Image:
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((6, 1, 9, 3), fill="#d9d0bd")
    draw.rectangle((5, 3, 10, 4), fill="#46313a")
    draw.rectangle((4, 5, 11, 13), fill="#2a1c25")
    draw.rectangle((5, 6, 10, 12), fill="#d85c8f")
    draw.rectangle((5, 10, 10, 12), fill="#7bc46f")
    draw.point((7, 6), fill="#ffd1df")
    return image


def make_gold() -> Image.Image:
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((4, 5, 11, 11), fill="#4a3420")
    draw.rectangle((5, 4, 10, 10), fill="#d99638")
    draw.rectangle((6, 5, 11, 9), fill="#f3c96a")
    draw.rectangle((7, 6, 9, 7), fill="#fff0a6")
    return image


def make_crystal() -> Image.Image:
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.polygon([(8, 1), (13, 6), (10, 14), (6, 14), (3, 6)], fill="#17334c")
    draw.polygon([(8, 2), (12, 6), (9, 13), (6, 13), (4, 6)], fill="#67c7df")
    draw.polygon([(8, 2), (8, 13), (4, 6)], fill="#9be7ef")
    draw.line([(8, 2), (12, 6), (4, 6), (8, 2)], fill="#e8fff0")
    return image


def make_crest() -> Image.Image:
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((5, 1, 10, 14), fill="#183827")
    draw.rectangle((6, 2, 9, 13), fill="#5fae63")
    draw.polygon([(8, 1), (12, 8), (8, 15), (4, 8)], outline="#f3c96a", fill=None)
    draw.point((8, 8), fill="#fff0a6")
    return image


def make_oath() -> Image.Image:
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.polygon([(8, 1), (10, 6), (15, 8), (10, 10), (8, 15), (6, 10), (1, 8), (6, 6)], fill="#f3c96a")
    draw.polygon([(8, 5), (9, 7), (11, 8), (9, 9), (8, 11), (7, 9), (5, 8), (7, 7)], fill="#fff4c8")
    return image


def make_sword() -> Image.Image:
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.polygon([(10, 1), (13, 1), (10, 10), (7, 10)], fill="#ddd8c8")
    draw.line([(10, 1), (7, 10)], fill="#f7f2df")
    draw.rectangle((4, 10, 11, 12), fill="#f3c96a")
    draw.rectangle((6, 12, 8, 15), fill="#6f4b32")
    return image


def build_entries() -> list[SourceCrop]:
    floor = "map/tileset_floor.png"
    village = "map/tileset_village_abandoned.png"
    return [
        SourceCrop("tile.grass.a", floor, (0, 176, 16, 192), False),
        SourceCrop("tile.grass.b", floor, (16, 176, 32, 192), False),
        SourceCrop("tile.grass.c", floor, (32, 176, 48, 192), False),
        SourceCrop("tile.grass.d", floor, (48, 176, 64, 192), False),
        SourceCrop("tile.path.a", floor, (16, 128, 32, 144), False),
        SourceCrop("tile.path.b", floor, (32, 128, 48, 144), False),
        SourceCrop("tile.path.c", floor, (16, 144, 32, 160), False),
        SourceCrop("tile.sanctuary", floor, (192, 192, 208, 208), False),
        SourceCrop("prop.tree.large", village, (0, 88, 64, 144)),
        SourceCrop("prop.tree.round", village, (64, 88, 112, 128)),
        SourceCrop("prop.tree.small", village, (112, 88, 144, 128)),
        SourceCrop("prop.ruin.gate", village, (0, 0, 64, 48)),
        SourceCrop("prop.ruin.wall", village, (176, 0, 224, 64)),
        SourceCrop("prop.ruin.house", village, (192, 96, 272, 176)),
        SourceCrop("prop.hut", village, (256, 96, 320, 160)),
        SourceCrop("prop.fence", village, (272, 160, 320, 192)),
        SourceCrop("prop.stump", village, (96, 96, 112, 128)),
        SourceCrop("prop.log", village, (96, 128, 112, 160)),
        SourceCrop("prop.rock.a", village, (112, 64, 128, 80)),
        SourceCrop("prop.rock.b", village, (128, 64, 144, 80)),
        SourceCrop("prop.rock.c", village, (144, 64, 160, 80)),
        SourceCrop("prop.mushroom.a", village, (64, 128, 80, 144)),
        SourceCrop("prop.mushroom.b", village, (80, 128, 96, 144)),
        SourceCrop("player.azure", "character/ninja_blue/sprite.png", (0, 0, 16, 16), False),
        SourceCrop(
            "player.violet",
            "character/ninja_blue/sprite.png",
            (0, 0, 16, 16),
            False,
            lambda image: shift_palette(
                image,
                {
                    (63, 148, 155): (111, 88, 169),
                    (60, 104, 133): (80, 61, 130),
                    (84, 204, 218): (163, 129, 225),
                },
            ),
        ),
        SourceCrop("player.ember", "character/samurai_blue/sprite.png", (0, 0, 16, 16), False),
        SourceCrop("player.moss", "character/samurai_green/samurai_green.png", (0, 0, 16, 16), False),
        SourceCrop("npc.keeper", "character/samurai_green/samurai_green.png", (32, 0, 48, 16), False),
        SourceCrop("weapon.sword", "weapon/big_sword/sprite.png", (0, 0, 7, 16)),
    ]


def pack(entries: dict[str, Image.Image], out_image: Path, out_json: Path) -> None:
    x = PADDING
    y = PADDING
    row_height = 0
    frames: dict[str, dict[str, int]] = {}
    placements: list[tuple[str, Image.Image, int, int]] = []

    for name, image in entries.items():
        if x + image.width + PADDING > ATLAS_WIDTH:
            x = PADDING
            y += row_height + PADDING
            row_height = 0
        placements.append((name, image, x, y))
        frames[name] = {"x": x, "y": y, "w": image.width, "h": image.height}
        x += image.width + PADDING
        row_height = max(row_height, image.height)

    height = 1
    while height < y + row_height + PADDING:
        height *= 2

    atlas = Image.new("RGBA", (ATLAS_WIDTH, height), (0, 0, 0, 0))
    for _name, image, px, py in placements:
        atlas.alpha_composite(image, (px, py))

    out_image.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(out_image, optimize=True)
    out_json.write_text(
        json.dumps(
            {
                "image": out_image.name,
                "frames": frames,
                "license": "CC0-1.0",
                "source": "Ninja Adventure by Pixel-Boy and AAA, plus CC0-compatible local derivatives.",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path("public/assets/lindocara/atlas"))
    args = parser.parse_args()

    content = args.source
    entries: dict[str, Image.Image] = {}
    for entry in build_entries():
        image = Image.open(content / entry.source).convert("RGBA").crop(entry.box)
        if entry.transform:
            image = entry.transform(image)
        entries[entry.name] = trim_alpha(image) if entry.trim else image

    entries["monster.slime"] = make_slime()
    entries["loot.potion"] = make_potion()
    entries["loot.gold"] = make_gold()
    entries["loot.crystal"] = make_crystal()
    entries["ui.crest"] = make_crest()
    entries["ui.oath"] = make_oath()
    entries["ui.sword"] = make_sword()
    entries["ui.potion"] = make_potion()
    entries["ui.gold"] = make_gold()
    entries["ui.crystal"] = make_crystal()

    pack(entries, args.out / "world.png", args.out / "world.json")

    hud_names = ["ui.crest", "ui.oath", "ui.sword", "ui.potion", "ui.gold", "ui.crystal"]
    hud = Image.new("RGBA", (16 * len(hud_names), 16), (0, 0, 0, 0))
    for index, name in enumerate(hud_names):
        hud.alpha_composite(entries[name], (index * 16, 0))
    hud.save(args.out / "hud.png", optimize=True)


if __name__ == "__main__":
    main()
