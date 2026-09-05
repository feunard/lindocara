# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy==2.5.2", "opencv-python-headless==5.0.0.93", "pillow==12.3.0"]
# ///
"""Recover the accepted game-scale sprite without redrawing it or fitting separate body parts."""
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
im = Image.open(ROOT / "sources/lineup.png").convert("RGB")
cell = im.crop((round(im.width * .78), round(im.height * .17), round(im.width * .96), round(im.height * .72)))
rgb = np.array(cell)
mask = np.zeros(rgb.shape[:2], np.uint8)
cv2.setRNGSeed(0)
cv2.grabCut(rgb, mask, (8, 8, cell.width - 16, cell.height - 16), np.zeros((1,65)), np.zeros((1,65)), 8, cv2.GC_INIT_WITH_RECT)
alpha = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype("uint8")
# Remove the enclosed slate backdrop between the body and staff as well as the outer field.
r, g, b = [rgb[:, :, i].astype("int16") for i in range(3)]
backdrop = ((g > r + 8) & (b > r + 8) & (b < g + 16)).astype("uint8")
count, labels, stats, _ = cv2.connectedComponentsWithStats(backdrop, 8)
for i in range(1, count):
    if stats[i, cv2.CC_STAT_AREA] >= 90:
        alpha[labels == i] = 0
rgba = np.dstack([rgb, alpha])
rgba[alpha == 0] = 0
sprite = Image.fromarray(rgba)
sprite = sprite.crop(sprite.getbbox())
sprite.save(ROOT / "sources/design-front.png")
reference = Image.new("RGBA", (512, 512), (255, 0, 255, 255))
scale = min(430 / sprite.height, 390 / sprite.width)
large = sprite.resize((round(sprite.width * scale), round(sprite.height * scale)), Image.Resampling.NEAREST)
reference.alpha_composite(large, ((512-large.width)//2, 470-large.height))
reference.save(ROOT / "sources/design-front-reference.png")
print("Accepted front:", sprite.size)
