"""Shared offline raster interpolation and fixed-anchor atlas packing. No runtime dependency."""
import hashlib
import math
import cv2
import numpy as np
from PIL import Image

CELL = 192
cv2.setNumThreads(1)
cv2.setRNGSeed(0)
Y, X = np.mgrid[:CELL, :CELL].astype("float32")
GRID = np.stack([X, Y], axis=-1)


def remap(image, coordinates):
    return cv2.remap(
        image,
        coordinates[:, :, 0].astype("float32"),
        coordinates[:, :, 1].astype("float32"),
        cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
    )


def landmark_flow(shape, source, target):
    """Smooth displacement prior from reviewed correspondences, in native pixels."""
    height, width = shape[:2]
    corners = [(0, 0), (width-1, 0), (0, height-1), (width-1, height-1)]
    points = np.asarray([*corners, *source], dtype='float64')
    displacement = np.asarray([*corners, *target], dtype='float64') - points
    def kernel(a, b):
        squared = ((a[:, None, :] - b[None, :, :]) ** 2).sum(2)
        return squared * np.log(np.maximum(squared, 1))
    polynomial = np.column_stack([np.ones(len(points)), points])
    system = np.block([[kernel(points, points) + np.eye(len(points))*.01, polynomial],
                       [polynomial.T, np.zeros((3, 3))]])
    weights = np.linalg.solve(system, np.vstack([displacement, np.zeros((3, 2))]))
    yy, xx = np.mgrid[:height, :width]
    grid = np.column_stack([xx.ravel(), yy.ravel()])
    value = kernel(grid, points) @ weights[:len(points)] + np.column_stack([np.ones(len(grid)), grid]) @ weights[len(points):]
    return value.reshape(height, width, 2).astype('float32')


class Tween:
    """Bidirectional inverse-warp interpolation. Pixels move before blending, including alpha."""

    def __init__(self, a, b, guides=None):
        if a.shape != b.shape:
            raise ValueError("Interpolation requires registered fixed-size canvases")
        yy, xx = np.mgrid[:a.shape[0], :a.shape[1]].astype("float32")
        self.grid = np.stack([xx, yy], axis=-1)
        self.a = a.astype("float32") / 255
        self.b = b.astype("float32") / 255

        def gray(v):
            return np.clip(
                (
                    cv2.cvtColor(v[:, :, :3], cv2.COLOR_RGB2GRAY) * 0.75
                    + v[:, :, 3] * 0.25
                )
                * 255,
                0,
                255,
            ).astype("uint8")

        forward = landmark_flow(a.shape, *guides) if guides else None
        backward = landmark_flow(a.shape, guides[1], guides[0]) if guides else None
        self.forward = cv2.DISOpticalFlow_create(
            cv2.DISOPTICAL_FLOW_PRESET_MEDIUM
        ).calc(gray(self.a), gray(self.b), forward)
        self.backward = cv2.DISOpticalFlow_create(
            cv2.DISOPTICAL_FLOW_PRESET_MEDIUM
        ).calc(gray(self.b), gray(self.a), backward)
        self.a_unmult = self.a.copy()
        self.b_unmult = self.b.copy()
        # Premultiplied filtering keeps the black transparent canvas out of coloured edges.
        self.a[:, :, :3] *= self.a[:, :, 3:]
        self.b[:, :, :3] *= self.b[:, :, 3:]

    def at(self, t):
        if t <= 0:
            return np.round(self.a_unmult * 255).astype("uint8")
        if t >= 1:
            return np.round(self.b_unmult * 255).astype("uint8")
        ca = self.grid.copy()
        cb = self.grid.copy()
        for _ in range(3):
            ca = self.grid - remap(self.forward, ca) * t
            cb = self.grid - remap(self.backward, cb) * (1 - t)
        a = remap(self.a, ca)
        b = remap(self.b, cb)
        out = a * (1 - t) + b * t
        out[:, :, :3] /= np.maximum(0.001, out[:, :, 3:])
        out[:, :, 3] = (out[:, :, 3] >= 0.5).astype("float32")
        out[out[:, :, 3] == 0] = 0
        return np.clip(np.round(out * 255), 0, 255).astype("uint8")


def interpolate(nodes, count, loop=False, guide=None):
    nodes = sorted(nodes, key=lambda n: n[0])
    pairs = [Tween(a[1], b[1], guide(a[1], b[1]) if guide else None) for a, b in zip(nodes, nodes[1:])]
    result = []
    for i in range(count):
        phase = i / (count if loop else count - 1)
        segment = min(
            len(pairs) - 1,
            next(
                (j for j in range(len(pairs)) if phase <= nodes[j + 1][0]),
                len(pairs) - 1,
            ),
        )
        t = (phase - nodes[segment][0]) / (nodes[segment + 1][0] - nodes[segment][0])
        result.append(pairs[segment].at(float(np.clip(t, 0, 1))))
    return result


def sha(path):
    data = (
        path.read_bytes()
        if path.suffix == ".png"
        else path.read_text(encoding="utf-8").encode("utf-8")
    )
    return hashlib.sha256(data).hexdigest()


def pack(out, name, rows, spec, *, anchor=(96, 136), pixels_per_tile=192 / 2.34):
    """One union crop, fixed anchor, native source density: never resize a body or a limb."""
    mask = np.maximum.reduce([im[:, :, 3] for row in rows for im in row])
    yy, xx = np.nonzero(mask > 128)
    canvas_height, canvas_width = mask.shape
    if xx.min() < 1 or yy.min() < 1 or xx.max() > canvas_width - 2 or yy.max() > canvas_height - 2:
        raise ValueError(f"{name}: clipped pose")
    half = math.ceil(max(anchor[0] - xx.min(), xx.max() - anchor[0]) + 3)
    left = anchor[0] - half
    top = max(0, int(yy.min()) - 3)
    width = half * 2
    height = int(yy.max()) + 4 - top
    count = len(rows[0])
    if count != spec["frames"] or any(len(row) != count for row in rows):
        raise ValueError(f"{name}: frame count does not match the manifest")
    columns = max(n for n in range(1, min(count, 4096 // width) + 1) if count % n == 0)
    lines = math.ceil(count / columns)
    sheet = np.zeros((len(rows) * lines * height, columns * width, 4), "uint8")
    for direction, row in enumerate(rows):
        for i, frame in enumerate(row):
            y = (direction * lines + i // columns) * height
            x = i % columns * width
            sheet[y : y + height, x : x + width] = frame[
                top : top + height, left : left + width
            ]
    path = out / f"{name}.png"
    Image.fromarray(sheet).save(path, optimize=True)
    return {
        **spec,
        "asset": f"{out.name}/{name}.png",
        "pixelsPerTile": pixels_per_tile,
        "frame": {
            "width": width,
            "height": height,
            "anchor": {"x": half, "y": anchor[1] - top},
        },
        "columns": columns,
        "directionStride": lines * columns,
        "directionRows": len(rows),
        "bytes": path.stat().st_size,
        "decodedBytes": sheet.nbytes,
        "sha256": sha(path),
    }
