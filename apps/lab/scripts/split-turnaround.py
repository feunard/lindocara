"""Split a generated two-panel turnaround into two independent sprite sources.

The asset studio deliberately produces the side and rear in one warm inference so both views keep
the same proportions and material details. `sprite.py` then normalizes each half independently.
"""

from pathlib import Path
import sys

from PIL import Image


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("usage: split-turnaround.py INPUT SIDE_OUTPUT BACK_OUTPUT")
    source_path, side_path, back_path = map(Path, sys.argv[1:])
    source = Image.open(source_path)
    midpoint = source.width // 2
    outputs = (
        (source.crop((0, 0, midpoint, source.height)), side_path),
        (source.crop((midpoint, 0, source.width, source.height)), back_path),
    )
    for image, path in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path)
        print(f"{path}  {image.width}x{image.height}")
