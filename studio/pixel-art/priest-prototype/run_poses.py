"""Whole painted running keys, with the same offline raster tweening as Rogue V2.

Registration changes only image density and placement. No cut-out limbs, head patch,
skeletal deformation, per-pose resizing, or generated intermediate sprite drawings.
"""
import json
import cv2
import numpy as np
from PIL import Image
from source_tools import transparent, SOURCE
from registration import body_landmarks, CELL, ANCHOR
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
    measurements = {i: body_landmarks(paintings[i]) for i in spec["keys"]}
    # Hair width varies with perspective and is not a body-size measurement. Use
    # the six SELECTED whole poses to calibrate ONE density for the entire clip.
    # The staff is excluded, as is the flight translation applied below. Never
    # resize individual frames to a standing bounding box: knee flexion survives.
    heights = [(measurements[i]["ground"] - measurements[i]["head"][1]) * densities[i]
               for i in spec["keys"]]
    source_height = float(np.median(heights))
    scale = CONFIG["bodyHeight"] / source_height
    horizontal = spec.get("horizontalRegistration")
    reference_track = None
    if horizontal:
        reference = horizontal["reference"]
        if CONFIG["views"][reference].get("horizontalRegistration"):
            raise ValueError("Registration references must be independent authored views")
        _, reference_track = registered_keys(reference, colours)
    keys, records = [], []
    for index, phase, role in zip(spec["keys"], CONFIG["keyPhases"], CONFIG["keyRoles"]):
        source = paintings[index]
        m = measurements[index]
        density = densities[index]
        s = scale * density
        lift = CONFIG["flightLift"] if role.startswith("flight") else 0
        dx = ANCHOR[0] - m["pelvis"][0] * s
        dy = ANCHOR[1] - m["ground"] * s - lift
        if reference_track is not None:
            # A staff-holding forearm crosses the belt in the left profile. The
            # brown mask alternated between that hand and the belt, snapping the
            # whole body sideways. Register the WHOLE painting to the approved
            # opposite view's horizontal head trajectory. Keep the painted spine,
            # feet, y placement and the single source density intact.
            target_x = reference_track[len(keys)]["landmarks"]["head"][0]
            if horizontal.get("reflect"):
                target_x = CELL - target_x
            dx = target_x - (m["head"][0] + m["head"][2]) / 2 * s
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
                        "sourceBodyHeight": source_height, "targetBodyHeight": CONFIG["bodyHeight"],
                        "sourceSheetDensity": density, "offset": [dx, dy],
                        "registration": "opposite-view-horizontal" if horizontal else "automatic-foot",
                        "source": m, "landmarks": landmarks})
    return keys, records


def run_cycle(direction):
    colours = json.loads((SOURCE.parent / "simplified/palette.json").read_text(encoding="utf-8"))["colours"]
    keys, records = registered_keys(direction, colours)
    nodes = list(zip(CONFIG["keyPhases"], keys)) + [(1, keys[0])]
    frames = [colour_frame(frame, colours) for frame in interpolate(nodes, FRAMES, True)]
    return frames, records


def source_files():
    names={spec[key] for spec in CONFIG['views'].values() for key in ['sheet','extra'] if key in spec}
    return [SOURCE / "clips.json", *[SOURCE/name for name in sorted(names)]]
