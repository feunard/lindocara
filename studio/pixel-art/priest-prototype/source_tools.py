# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy==2.5.2", "opencv-python-headless==5.0.0.93", "pillow==12.3.0"]
# ///
"""Extract canonical and action paintings, never runtime animations."""
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
from PIL import ImageDraw

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SOURCE = ROOT / "sources/simplified"
NAMES = ["front", "front-quarter", "side", "back-quarter", "back"]


def head_box(image):
    a = np.array(image)
    r, g, b = [a[:, :, i].astype("int16") for i in range(3)]
    cream = (r > 25) & (g > 25) & (r < 155) & (g < 155) & (b > r * .77) & (np.abs(r-g)<35) & (a[:, :, 3] > 0)
    # Mid-tone charcoal identifies hair without merging the body's black outline.
    # Do not crop a fraction of total height: a lifted staff raises the image bounds
    # but does not raise the skull, and would otherwise truncate its measurement.
    bounds = image.getbbox()
    if bounds is None:
        raise ValueError("Empty source drawing")
    kernel=max(1,round(image.width/180))
    cream=cv2.morphologyEx(cream.astype("uint8"),cv2.MORPH_CLOSE,np.ones((kernel,kernel),"uint8"))
    count, _, stats, _ = cv2.connectedComponentsWithStats(cream.astype("uint8"), 8)
    if count < 2:
        raise ValueError("No head in source drawing")
    winner = stats[1:, cv2.CC_STAT_AREA].argmax() + 1
    x, y, w, h, _ = stats[winner]
    return [int(x), int(y), int(x + w), int(y + h)]


def cells(name, columns=4, rows=2):
    a = np.array(transparent(Image.open(SOURCE / f"{name}.png")))
    count, labels, stats, centers = cv2.connectedComponentsWithStats((a[:, :, 3] > 0).astype("uint8"), 8)
    bodies = sorted(range(1, count), key=lambda i: -stats[i, cv2.CC_STAT_AREA])[:columns * rows]
    if min(stats[i, cv2.CC_STAT_AREA] for i in bodies) < 1000:
        raise ValueError(f"{name}: missing source body")
    bodies.sort(key=lambda i: centers[i][1])
    ordered = []
    for row in range(rows):
        ordered += sorted(bodies[row * columns:(row + 1) * columns], key=lambda i: centers[i][0])
    result = []
    groups = {i: [i] for i in bodies}
    for i in range(1, count):
        if i in groups or stats[i, cv2.CC_STAT_AREA] < 40:
            continue
        # A dropped weapon is still part of its pose. Associate disconnected artwork
        # with the closest body; nominal equal-cell crops would cut neighbouring staffs.
        nearest = min(bodies, key=lambda j: np.linalg.norm(centers[i] - centers[j]))
        groups[nearest].append(i)
    for i in ordered:
        keep = np.isin(labels, groups[i])
        yy, xx = np.nonzero(keep)
        x, y = xx.min(), yy.min()
        w, h = xx.max() - x + 1, yy.max() - y + 1
        isolated = a[y:y + h, x:x + w].copy()
        isolated[~keep[y:y + h, x:x + w]] = 0
        size = max(512, int(w) + 40, int(h) + 40)
        canvas = Image.new("RGBA", (size, size))
        canvas.alpha_composite(Image.fromarray(isolated), (round((size - w) / 2), 20))
        result.append(canvas)
    return result


def diagnostics():
    review = REPO / "artifacts/priest-prototype"
    review.mkdir(parents=True, exist_ok=True)
    measurements = {}
    for name in NAMES:
        key = f"cast-{name}"
        if not (SOURCE / f"{key}.png").exists():
            continue
        frames = cells(key)
        sheet = Image.new("RGBA", (320 * 4, 320 * 2), (48, 65, 68, 255))
        measurements[key] = []
        for i, frame in enumerate(frames):
            box = head_box(frame)
            measurements[key].append({"head": box, "bounds": frame.getbbox()})
            drawn = frame.resize((320, 320))
            d = ImageDraw.Draw(drawn)
            scale = 320 / frame.width
            d.rectangle(tuple(round(x * scale) for x in box), outline="red", width=1)
            for n in range(40, 320, 40):
                d.line((n, 0, n, 320), fill=(0, 180, 200, 120))
                d.line((0, n, 320, n), fill=(0, 180, 200, 120))
            d.text((4, 4), f"{i} {box}", fill="white")
            sheet.alpha_composite(drawn, (i % 4 * 320, i // 4 * 320))
        sheet.save(review / f"{key}-source.png")
    (review / "measurements.json").write_text(json.dumps(measurements, indent=2))


def transparent(image, checker=False):
    a = np.array(image.convert("RGBA"))
    rgb = a[:, :, :3].astype("int16")
    if checker:
        background = (rgb.max(2) - rgb.min(2) < 12) & (rgb.min(2) > 200)
    else:
        background = (np.minimum(rgb[:, :, 0], rgb[:, :, 2]) - rgb[:, :, 1] > 70)
    a[background] = 0
    # Isolated marks in the background are not parts of the body.
    count, labels, stats, _ = cv2.connectedComponentsWithStats((a[:, :, 3] > 0).astype("uint8"), 8)
    for i in range(1, count):
        if stats[i, cv2.CC_STAT_AREA] < 40:
            a[labels == i] = 0
    return Image.fromarray(a)


def canonical():
    frames = cells("turnaround", 5, 1)
    out = Image.new("RGBA", (192 * 5, 192))
    measurements = []
    for i, (name, cell) in enumerate(zip(NAMES, frames)):
        if i == 3:
            cell = cell.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        cell.save(SOURCE / f"view-{name}.png")
        head = head_box(cell)
        bounds = cell.getbbox()
        scale = .24
        origin_x = (head[0] + head[2]) / 2
        origin_y = bounds[3]
        # A common native density, rooted under the body, never the staff's bounding box.
        cut = cell.resize((round(cell.width * scale), round(cell.height * scale)), Image.Resampling.LANCZOS)
        a = np.array(cut)
        a[:, :, 3] = (a[:, :, 3] >= 128).astype("uint8") * 255
        a[a[:, :, 3] == 0] = 0
        cut = Image.fromarray(a)
        frame = Image.new("RGBA", (192, 192))
        dx, dy = round(96-origin_x*scale), round(136-origin_y*scale)
        frame.alpha_composite(cut, (dx, dy))
        frame.save(SOURCE / f"canonical-{name}.png")
        out.alpha_composite(frame, (i * 192, 0))
        measurements.append({"sourceHead": head, "head": [round(head[0]*scale+dx), round(head[1]*scale+dy), round(head[2]*scale+dx), round(head[3]*scale+dy)], "scale": scale, "origin": [origin_x, origin_y]})
    out.save(SOURCE / "canonical-native.png")
    (SOURCE / "canonical-registration.json").write_text(json.dumps(measurements, indent=2))


if __name__ == "__main__":
    import sys
    canonical()
    if "--canonical" not in sys.argv:
        diagnostics()
