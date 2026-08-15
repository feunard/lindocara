"""Normalise le lot v3 de façades et de matières pour le renderer HD-2D.

Les façades passent par le pipeline sprite historique du Lab. Les matières restent opaques :
leur bleu nuit est le mortier entre les pierres, pas un fond à détourer.
"""

from pathlib import Path
import subprocess
import sys

from PIL import Image, ImageChops


ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / "apps/lab/assets/generated/buildings-v3"
OUT = ROOT / "packages/client/public/assets/lindocara/hd2d/buildings"
SPRITE = ROOT / "apps/lab/scripts/sprite.py"

FACADES = {
    "house": 196,
    "tower": 218,
    "archery": 200,
    "barracks": 204,
    "windmill": 222,
}


def process_facades() -> None:
    for name, height in FACADES.items():
        subprocess.run(
            [
                sys.executable,
                str(SPRITE),
                str(RAW / f"{name}-front-raw.png"),
                str(OUT / f"{name}-front.png"),
                str(height),
                "18",
            ],
            check=True,
        )


def material_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    rgb = image.convert("RGB")
    background = Image.new("RGB", rgb.size, rgb.getpixel((0, 0)))
    difference = ImageChops.difference(rgb, background).convert("L")
    mask = difference.point(lambda value: 255 if value > 18 else 0)
    bbox = mask.getbbox()
    if bbox is None:
        raise RuntimeError("generated material contains no pixels distinct from its background")
    return bbox


def process_material(name: str) -> None:
    source = Image.open(RAW / f"{name}-raw.png").convert("RGB")
    sample = source.crop(material_bbox(source)).resize((96, 96), Image.Resampling.BOX)
    sample = sample.quantize(colors=18, method=Image.Quantize.MEDIANCUT).convert("RGB")
    sample.save(OUT / f"{name}.png")
    print(f"{OUT / f'{name}.png'}  96x96")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    process_facades()
    process_material("cream-stone")
    process_material("blue-stone")
