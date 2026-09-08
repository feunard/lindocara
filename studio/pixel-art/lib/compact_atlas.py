"""Deduplicate identical painted frames without changing their logical animation indices.

Every cell shares one union crop and one reconstructed pivot. Only exact RGBA duplicates
are removed; this does not approximate poses or discard temporal samples.
"""
import hashlib
import math
import numpy as np
from PIL import Image
from raster_animation import sha


def pack(out, name, rows, spec, *, anchor=(96, 136), pixels_per_tile=192 / 2.34):
    count = spec["frames"]
    if any(len(row) != count for row in rows):
        raise ValueError(f"{name}: incomplete direction")
    mask = np.maximum.reduce([im[:, :, 3] for row in rows for im in row])
    yy, xx = np.nonzero(mask > 128)
    canvas_height, canvas_width = mask.shape
    if xx.min() < 1 or yy.min() < 1 or xx.max() > canvas_width - 2 or yy.max() > canvas_height - 2:
        raise ValueError(f"{name}: clipped pose")
    half = math.ceil(max(anchor[0] - xx.min(), xx.max() - anchor[0]) + 3)
    left = anchor[0] - half
    top = max(0, int(yy.min()) - 3)
    width, height = half * 2, int(yy.max()) + 4 - top
    unique, known, indices = [], {}, []
    for row in rows:
        mapped = []
        for frame in row:
            cell = frame[top:top + height, left:left + width]
            digest = hashlib.sha256(cell.tobytes()).digest()
            index = known.get(digest)
            if index is None:
                index = len(unique)
                known[digest] = index
                unique.append(cell)
            mapped.append(index)
        indices.append(mapped)
    candidates = [(columns, math.ceil(len(unique) / columns))
                  for columns in range(1, min(len(unique), 4096 // width) + 1)
                  if math.ceil(len(unique) / columns) * height <= 4096]
    if not candidates:
        raise ValueError(f"{name}: exceeds 4096-pixel texture limit")
    columns, lines = min(candidates, key=lambda grid: (
        grid[0] * grid[1], max(grid[0] * width, grid[1] * height)))
    sheet = np.zeros((lines * height, columns * width, 4), "uint8")
    for index, cell in enumerate(unique):
        x, y = index % columns * width, index // columns * height
        sheet[y:y + height, x:x + width] = cell
    path = out / f"{name}.png"
    Image.fromarray(sheet).save(path, optimize=True)
    return {**spec, "asset": f"{out.name}/{name}.png", "pixelsPerTile": pixels_per_tile,
            "frame": {"width": width, "height": height,
                      "anchor": {"x": half, "y": anchor[1] - top}},
            "columns": columns, "sheetRows": lines, "directionStride": count,
            "directionRows": len(rows), "frameIndices": indices, "uniqueFrames": len(unique),
            "bytes": path.stat().st_size, "decodedBytes": sheet.nbytes, "sha256": sha(path)}
