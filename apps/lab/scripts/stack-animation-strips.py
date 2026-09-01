#!/usr/bin/env python3
"""Stack equal horizontal animation strips into one directional sprite atlas."""

import argparse
from pathlib import Path

from PIL import Image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("inputs", nargs="+", type=Path)
    args = parser.parse_args()

    strips = [Image.open(path).convert("RGBA") for path in args.inputs]
    width, height = strips[0].size
    if any(strip.size != (width, height) for strip in strips[1:]):
        raise SystemExit("all directional strips must have identical dimensions")

    output = Image.new("RGBA", (width, height * len(strips)), (0, 0, 0, 0))
    for row, strip in enumerate(strips):
        output.alpha_composite(strip, (0, row * height))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.save(args.output)
    print(f"{args.output}  {output.width}x{output.height}")


if __name__ == "__main__":
    main()
