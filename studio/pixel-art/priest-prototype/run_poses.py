"""Whole painted running keys, with the same offline raster tweening as Rogue V2.

Registration changes only image density and placement. No cut-out limbs, head patch,
skeletal deformation, per-pose resizing, or generated intermediate sprite drawings.
"""
import json
import cv2
import numpy as np
from PIL import Image
from source_tools import transparent, head_box, SOURCE
from registration import body_landmarks, rest_image, CELL, ANCHOR
from palette import colour_frame
from raster_animation import interpolate

SOURCE = SOURCE.parent / "locomotion"
CONFIG = json.loads((SOURCE / "clips.json").read_text(encoding="utf-8"))
FRAMES = CONFIG["frames"]
STRIDE_DISTANCE = CONFIG["strideDistance"]


def extract(direction):
    spec = CONFIG["views"][direction]
    sheet = transparent(Image.open(SOURCE / spec["sheet"]))
    xs = np.linspace(0, sheet.width, spec["columns"] + 1).round().astype(int)
    ys = np.linspace(0, sheet.height, spec["rows"] + 1).round().astype(int)
    paintings = [sheet.crop((xs[x], ys[y], xs[x + 1], ys[y + 1]))
                 for y in range(spec["rows"]) for x in range(spec["columns"])]
    densities = [1.0] * len(paintings)
    if "extra" in spec:
        extra = transparent(Image.open(SOURCE / spec["extra"]))
        # This edit used one original cell as its full-canvas reference. Convert its
        # output resolution once, not from a colour mask that misses part of the hair.
        densities.append(paintings[spec["extraReferenceCell"]].width / extra.width)
        paintings.append(extra)
    return paintings, densities


def registered_keys(direction, colours):
    paintings, densities = extract(direction)
    spec = CONFIG["views"][direction]
    primary = paintings[:spec["columns"] * spec["rows"]]
    widths = [head_box(im)[2] - head_box(im)[0] for im in primary]
    canonical = head_box(rest_image(direction))
    scale = float((canonical[2] - canonical[0]) / np.median(widths))
    keys, records = [], []
    for index, phase, role in zip(spec["keys"], CONFIG["keyPhases"], CONFIG["keyRoles"]):
        source = paintings[index]
        m = body_landmarks(source)
        density = densities[index]
        s = scale * density
        lift = CONFIG["flightLift"] if role.startswith("flight") else 0
        dx = ANCHOR[0] - m["pelvis"][0] * s
        dy = ANCHOR[1] - m["ground"] * s - lift
        matrix = np.array([[s, 0, dx], [0, s, dy]], dtype="float32")
        frame = cv2.warpAffine(np.array(source), matrix, (CELL, CELL),
                               flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT)
        frame[:, :, 3] = np.where(frame[:, :, 3] >= 128, 255, 0)
        frame = colour_frame(frame, colours)
        transform = lambda p: [round(p[0] * s + dx, 4), round(p[1] * s + dy, 4)]
        head = m["head"]
        landmarks = {key: transform(m[key]) for key in ["neck", "chest", "pelvis"]}
        landmarks["head"] = transform([(head[0]+head[2])/2, (head[1]+head[3])/2])
        keys.append(frame)
        records.append({"sourceIndex": index, "phase": phase, "role": role,
                        "frame": round(phase * FRAMES), "scale": scale,
                        "sourceSheetDensity": density, "offset": [dx, dy],
                        "source": m, "landmarks": landmarks})
    return keys, records


def run_cycle(direction):
    colours = json.loads((SOURCE.parent / "simplified/palette.json").read_text(encoding="utf-8"))["colours"]
    keys, records = registered_keys(direction, colours)
    nodes = list(zip(CONFIG["keyPhases"], keys)) + [(1, keys[0])]
    frames = [colour_frame(frame, colours) for frame in interpolate(nodes, FRAMES, True)]
    return frames, records


def source_files():
    return [SOURCE / "clips.json", *sorted(SOURCE.glob("*.png"))]
