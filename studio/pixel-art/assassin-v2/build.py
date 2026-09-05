# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy==2.5.2", "opencv-python-headless==5.0.0.93", "pillow==12.3.0"]
# ///
"""Assassin 2: original image keys -> offline inbetweens -> runtime atlases.

No rig, optical flow model, Python or image generation is loaded by the game.
"""

import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
OUT = REPO / "packages/renderer/src/assets/bonus/assassin-v2"
REVIEW = REPO / "artifacts/assassin-v2"
NAMES = ["front", "front-quarter", "side", "back-quarter", "back"]
CELL = 192
ANCHOR = (96, 136)
PX_PER_TILE = 192 / (2.6 * 0.9)
STRIDE = 2.4  # Two contacts, matching the controller's 1.2-tile footstep interval.
# This stencil ends at the collar: chest, arms, belt and legs retain the source pixels.
# A fixed front-facing hood prevents the alternating yaw/eye shapes in V1's run keys
# from becoming a high-frequency facial vibration at the distance-driven cadence.
HEAD_POLYGON = [
    (60, 25),
    (135, 25),
    (135, 78),
    (122, 81),
    (116, 85),
    (107, 89),
    (84, 89),
    (76, 84),
    (68, 81),
    (60, 78),
]
head_mask_image = Image.new("L", (CELL, CELL))
ImageDraw.Draw(head_mask_image).polygon(HEAD_POLYGON, fill=255)
HEAD_MASK = np.array(head_mask_image) > 0

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


class Tween:
    """Bidirectional inverse-warp interpolation. Pixels move before blending, including alpha."""

    def __init__(self, a, b):
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

        self.forward = cv2.DISOpticalFlow_create(
            cv2.DISOPTICAL_FLOW_PRESET_MEDIUM
        ).calc(gray(self.a), gray(self.b), None)
        self.backward = cv2.DISOpticalFlow_create(
            cv2.DISOPTICAL_FLOW_PRESET_MEDIUM
        ).calc(gray(self.b), gray(self.a), None)
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
        ca = GRID.copy()
        cb = GRID.copy()
        for _ in range(3):
            ca = GRID - remap(self.forward, ca) * t
            cb = GRID - remap(self.backward, cb) * (1 - t)
        a = remap(self.a, ca)
        b = remap(self.b, cb)
        out = a * (1 - t) + b * t
        out[:, :, :3] /= np.maximum(0.001, out[:, :, 3:])
        out[:, :, 3] = (out[:, :, 3] >= 0.5).astype("float32")
        out[out[:, :, 3] == 0] = 0
        return np.clip(np.round(out * 255), 0, 255).astype("uint8")


def interpolate(nodes, count, loop=False):
    nodes = sorted(nodes, key=lambda n: n[0])
    pairs = [Tween(a[1], b[1]) for a, b in zip(nodes, nodes[1:])]
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


ORIGINAL = OUT.parent / "assassin"
INHERITED = {
    "dual-slash": (325, 4),
    "shadow-step": (370, 6),
    "vanish": (200, 6),
    "poisoned-shiv": (425, 6),
    "shadow-dance": (600, 4),
    "death": (900, None),
}
SPECS = {
    "run": dict(
        frames=36,
        durationMs=STRIDE / (312 / 64) * 1000,
        loop=True,
        sourceFrames=[0, 3, 6, 9, 12, 15, 18, 23, 27, 32],
    ),
    "jump": dict(frames=12, durationMs=300, loop=False),
    "jump-run": dict(
        frames=64, durationMs=300, loop=False, phaseBuckets=8, transitionFrames=8
    ),
    "fall": dict(frames=12, durationMs=300, loop=False),
    "land": dict(frames=12, durationMs=180, loop=False),
    "land-run": dict(
        frames=40, durationMs=180, loop=False, phaseBuckets=8, transitionFrames=5
    ),
    "stop": dict(
        frames=32, durationMs=120, loop=False, phaseBuckets=8, transitionFrames=4
    ),
    "start": dict(
        frames=32, durationMs=100, loop=False, phaseBuckets=8, transitionFrames=4
    ),
    "hurt": dict(frames=12, durationMs=200, loop=False),
    "swim": dict(frames=16, durationMs=1000, loop=True),
    "glide": dict(frames=16, durationMs=1800, loop=True),
}


def original_rows(name):
    sheet = np.array(Image.open(ORIGINAL / f"{name}.png").convert("RGBA"))
    return [
        [
            sheet[r * CELL : (r + 1) * CELL, i * CELL : (i + 1) * CELL].copy()
            for i in range(10)
        ]
        for r in range(5)
    ]


def approved_idle():
    spec = json.loads((ROOT / "sources/approved-idle.json").read_text())
    clip = spec["clip"]
    sheet = Image.open(ROOT / "sources/approved-idle.png").convert("RGBA")
    fw, fh = clip["frame"]["width"], clip["frame"]["height"]
    # Reconstruct the source canvas only for baking transitions. The approved idle atlas
    # itself is copied byte-for-byte and retains its original runtime scale and anchor.
    frames = []
    scale = spec["runtimeScale"]
    for r in range(5):
        canvas = Image.new("RGBA", (round(CELL * scale), round(CELL * scale)))
        frame = sheet.crop((0, r * fh, fw, (r + 1) * fh))
        canvas.alpha_composite(
            frame,
            (
                round(ANCHOR[0] * scale) - clip["frame"]["anchor"]["x"],
                round(ANCHOR[1] * scale) - clip["frame"]["anchor"]["y"],
            ),
        )
        frames.append(np.array(canvas.resize((CELL, CELL), Image.Resampling.NEAREST)))
    return spec, frames


def smooth(t):
    t = float(np.clip(t, 0, 1))
    return t * t * (3 - 2 * t)


def head_bob(phase):
    # Two gentle rises per stride. Only translate whole native pixels: no resampling,
    # changing eye spacing, hood scaling or rotation. The loop closes with zero speed.
    return -3 * math.sin(math.tau * phase) ** 2


def stabilize_front(rendered, reference, rest):
    """Offline rigid head registration, after interpolation, with authored neck motion."""
    to_rest = Tween(reference, rest)
    heads = {}
    offsets = {}
    for name, rows in rendered.items():
        if name == "start":
            continue  # The runtime reads the stop atlas backwards.
        spec = SPECS[name]
        offsets[name] = []
        for i, frame in enumerate(rows[0]):
            blend = 0
            if "phaseBuckets" in spec:
                bank, local = divmod(i, spec["transitionFrames"])
                t = local / (spec["transitionFrames"] - 1)
                bank_frame = round(bank / spec["phaseBuckets"] * SPECS["run"]["frames"])
                bank_y = head_bob(bank_frame / SPECS["run"]["frames"])
                if name == "jump-run":
                    y = bank_y + (-3 - bank_y) * smooth(t)
                elif name == "land-run":
                    y = (
                        2 * smooth(t / 0.3)
                        if t < 0.3
                        else 2 + (bank_y - 2) * smooth((t - 0.3) / 0.7)
                    )
                else:
                    blend = smooth(t)
                    y = bank_y * (1 - blend)
            else:
                t = i / (spec["frames"] if spec["loop"] else spec["frames"] - 1)
                if name == "run":
                    y = head_bob(t)
                elif name == "jump":
                    blend = 1 - smooth(t / 0.45)
                    y = -3 * smooth(t)
                elif name == "fall":
                    y = -3 * (1 - smooth(t))
                elif name == "land":
                    blend = smooth((t - 0.3) / 0.7)
                    y = 2 * smooth(t / 0.3) if t < 0.3 else 2 * (1 - blend)
                elif name == "hurt":
                    blend = 1
                    y = math.sin(math.pi * t)
                else:
                    y = -3
            dy = round(y)
            offsets[name].append(dy)
            # A single morph back to the already-approved idle is allowed on stopping;
            # repeated locomotion keys never deform or redraw the face.
            key = round(blend, 6)
            if key not in heads:
                heads[key] = to_rest.at(blend)
            head = np.zeros_like(frame)
            if dy < 0:
                head[:dy] = heads[key][-dy:]
            elif dy > 0:
                head[dy:] = heads[key][:-dy]
            else:
                head[:] = heads[key]
            frame[HEAD_MASK] = head[HEAD_MASK]
    return {
        "direction": "front",
        "sourceAsset": "assassin/run.png",
        "sourceFrame": 0,
        "maskRows": [
            [int(y), int(xs[0]), int(xs[-1]) + 1]
            for y in range(CELL)
            if len(xs := np.flatnonzero(HEAD_MASK[y]))
        ],
        "offsetsY": offsets,
    }


def sha(path):
    data = (
        path.read_bytes()
        if path.suffix == ".png"
        else path.read_text(encoding="utf-8").encode("utf-8")
    )
    return hashlib.sha256(data).hexdigest()


def pack(name, rows, spec):
    """One union crop, fixed anchor, native V1 density: never resize a body or a limb."""
    mask = np.maximum.reduce([im[:, :, 3] for row in rows for im in row])
    yy, xx = np.nonzero(mask > 128)
    if xx.min() < 1 or yy.min() < 1 or xx.max() > CELL - 2 or yy.max() > CELL - 2:
        raise ValueError(f"{name}: clipped pose")
    half = math.ceil(max(ANCHOR[0] - xx.min(), xx.max() - ANCHOR[0]) + 3)
    left = ANCHOR[0] - half
    top = max(0, int(yy.min()) - 3)
    width = half * 2
    height = int(yy.max()) + 4 - top
    count = len(rows[0])
    if count != spec["frames"] or any(len(row) != count for row in rows):
        raise ValueError(f"{name}: frame count does not match the manifest")
    columns = max(n for n in range(1, min(count, 4096 // width) + 1) if count % n == 0)
    lines = math.ceil(count / columns)
    sheet = np.zeros((5 * lines * height, columns * width, 4), "uint8")
    for direction, row in enumerate(rows):
        for i, frame in enumerate(row):
            y = (direction * lines + i // columns) * height
            x = i % columns * width
            sheet[y : y + height, x : x + width] = frame[
                top : top + height, left : left + width
            ]
    path = OUT / f"{name}.png"
    Image.fromarray(sheet).save(path, optimize=True)
    return {
        **spec,
        "asset": f"assassin-v2/{name}.png",
        "pixelsPerTile": PX_PER_TILE,
        "frame": {
            "width": width,
            "height": height,
            "anchor": {"x": half, "y": ANCHOR[1] - top},
        },
        "columns": columns,
        "directionStride": lines * columns,
        "directionRows": 5,
        "bytes": path.stat().st_size,
        "decodedBytes": sheet.nbytes,
        "sha256": sha(path),
    }


def bake():
    OUT.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)
    approved, idle = approved_idle()
    run = original_rows("run")
    death = original_rows("death")
    rendered = {name: [] for name in SPECS}
    for row in range(5):
        k = run[row]
        rest = idle[row]
        # Preserve the original body poses. The two authored contacts (keys 0 and 6) lie
        # exactly half a stride apart instead of at 0% and 60% of the old strip. Mirroring
        # a half cycle therefore also corresponds to the other foot.
        frames = interpolate(
            [(i / 36, im) for i, im in zip(SPECS["run"]["sourceFrames"], k)]
            + [(1, k[0])],
            36,
            True,
        )
        rendered["run"].append(frames)
        apex = k[3]
        reach = k[0]
        compress = k[1]
        for name, spec in SPECS.items():
            if name in ("run", "start"):
                continue
            if "phaseBuckets" in spec:
                bank = []
                for b in range(spec["phaseBuckets"]):
                    pose = frames[
                        round(b / spec["phaseBuckets"] * len(frames)) % len(frames)
                    ]
                    if name == "jump-run":
                        nodes = [(0, pose), (0.55, k[2]), (1, apex)]
                    elif name == "land-run":
                        nodes = [(0, reach), (0.30, compress), (1, pose)]
                    elif name == "start":
                        nodes = [(0, rest), (1, pose)]
                    else:
                        nodes = [(0, pose), (1, rest)]
                    bank.extend(interpolate(nodes, spec["transitionFrames"]))
                rendered[name].append(bank)
                continue
            if name == "jump":
                nodes = [(0, rest), (0.45, k[2]), (1, apex)]
            elif name == "fall":
                nodes = [(0, apex), (0.45, k[4]), (1, reach)]
            elif name == "land":
                nodes = [(0, reach), (0.30, compress), (1, rest)]
            elif name == "hurt":
                nodes = [(0, rest), (0.25, death[row][0]), (1, rest)]
            elif name == "swim":
                nodes = [(0, k[3]), (0.5, k[7]), (1, k[3])]
            else:
                nodes = [(0, k[3]), (0.5, k[5]), (1, k[3])]
            rendered[name].append(interpolate(nodes, spec["frames"], spec["loop"]))
        print(f"Baked {NAMES[row]}", flush=True)
    head_registration = stabilize_front(rendered, run[0][0], idle[0])
    (OUT / "idle.png").write_bytes((ROOT / "sources/approved-idle.png").read_bytes())
    clips = {
        "idle": {
            **approved["clip"],
            "asset": "assassin-v2/idle.png",
            "pixelsPerTile": approved["pixelsPerTile"],
        }
    }
    for name, (duration, contact) in INHERITED.items():
        path = ORIGINAL / f"{name}.png"
        clips[name] = {
            "frames": 10,
            "durationMs": duration,
            "loop": False,
            **({"activeFrame": contact} if contact is not None else {}),
            "asset": f"assassin/{name}.png",
            "pixelsPerTile": PX_PER_TILE,
            "frame": {"width": 192, "height": 192, "anchor": {"x": 96, "y": 136}},
            "columns": 10,
            "directionStride": 10,
            "directionRows": 5,
            "bytes": path.stat().st_size,
            "decodedBytes": 192 * 192 * 10 * 5 * 4,
            "sha256": sha(path),
        }
    for name, rows in rendered.items():
        if name != "start":
            clips[name] = pack(name, rows, SPECS[name])
    clips["start"] = {**clips["stop"], "durationMs": 100}
    inputs = [
        Path(__file__),
        ROOT / "sources/approved-idle.png",
        ROOT / "sources/approved-idle.json",
        *[ORIGINAL / f"{name}.png" for name in ["idle", "run", *INHERITED]],
    ]
    manifest = {
        "version": 2,
        "body": "assassin_v2",
        "method": "original raster body poses, offline inbetweens and rigid front-head registration, distance-driven playback",
        "sourceFrame": {"width": 192, "height": 192, "anchor": {"x": 96, "y": 136}},
        "pixelsPerTile": PX_PER_TILE,
        "runtimeScale": 1,
        "strideDistance": STRIDE,
        "referenceSpeed": 312 / 64,
        "directions": NAMES,
        "headRegistration": head_registration,
        "sourceSha256": {p.relative_to(REPO).as_posix(): sha(p) for p in inputs},
        "clips": clips,
    }
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    Image.open(ORIGINAL / "idle.png").crop((0, 0, CELL, CELL)).save(
        OUT / "portrait.png"
    )
    # A native-density witness, separate from the runtime atlas packing.
    review = Image.new("RGBA", (CELL * 10, CELL * 5), (54, 71, 73, 255))
    for r, frames in enumerate(rendered["run"]):
        for i in range(10):
            review.alpha_composite(
                Image.fromarray(frames[SPECS["run"]["sourceFrames"][i] + 1]),
                (i * CELL, r * CELL),
            )
    review.save(REVIEW / "run-review.png")
    extra = sum(
        c["decodedBytes"]
        for name, c in clips.items()
        if c["asset"].startswith("assassin-v2/") and name != "start"
    )
    print(
        f"Additional atlas memory: {extra / 1048576:.1f} MiB; V1 skills/death shared",
        flush=True,
    )


if __name__ == "__main__":
    bake()
