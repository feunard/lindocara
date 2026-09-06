"""Write future LCPixel prompt templates without overwriting accepted generation history."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--out", type=Path, default=ROOT.parents[2] / "artifacts/priest-prototype/prompt-templates")
OUTPUT = parser.parse_args().out
OUTPUT.mkdir(parents=True, exist_ok=True)
STYLE = ROOT.parents[1] / "styles/lcpixel/style.json"
sys.path.insert(0,str(ROOT.parents[1]))
from style_system import style_prompt
style = json.loads(STYLE.read_text(encoding="utf-8"))
style_text=style_prompt(style)
identity = "The SAME simplified Priest from the canonical reference: swept charcoal hair, short dark full beard, warm tan skin, ivory short split coat, one bold gold chest cross, simple gold-edged shoulder capelets with two round clasps, brown belt/gloves/boots, charcoal trousers. One straight wooden staff with plain gold halo and yellow-gold orb. No wings, ruby, beads, tassels or extra decorations."
views = {"front":"directly towards the viewer", "front-quarter":"towards the viewer and image right, three-quarter front", "side":"directly towards image right, exact right profile", "back-quarter":"away from the viewer towards image right, three-quarter rear", "back":"directly away from the viewer"}
for direction, view in views.items():
    canonical = f"""Use case: stylized-concept. One complete neutral LCPixel Priest facing {view}.
Use the existing canonical painting and the locked LCPixel style board as references.
{style_text}
{identity}
Preserve exact compact proportions, contours, material shading and face treatment.
Show clear garment edges, natural connected shoulders and chin, boots, and the staff grip.
Flat magenta #ff00ff background; no text, floor, shadow or effects.
This is one identity painting, not an animation sheet. After review, running keys are
painted as complete bodies and tweened offline with the Rogue V2 raster pipeline.
"""
    (OUTPUT / f"canonical-{direction}.prompt.txt").write_text(canonical,encoding="utf-8")
    run = f"""Repaint the ten complete running poses of the corresponding Rogue witness as the approved Priest. Image 1 is the Priest identity, image 2 the pose witness (five columns, two rows), image 3 the mandatory LCPixel style board.
All figures face {view}. {identity}
Preserve connected whole-body acting: forward lean, shoulder/pelvis opposition, bent knees, ankles, two complementary foot contacts, passing poses and flight. Arms remain restrained near the ribs; staff hand keeps the same grip and carries the complete staff. Keep the same scale and perspective. No independently rotated cut-out limbs, stiff torso, repeated lead leg or idle substitution. No daggers or Rogue costume remain.
{style_text}
Flat magenta #ff00ff, complete staff and feet, no text, grid, effects, floor or shadows.
"""
    (OUTPUT / f"run-{direction}.prompt.txt").write_text(run,encoding="utf-8")
    for kind in ["cast","death"]:
        action="casting poses: preserve the anticipation, staff extension/release, free-hand blessing and recovery of each corresponding pose" if kind=="cast" else "a continuous death collapse: preserve the standing flinch, knees buckling, loss of balance, fall to the floor and stable final lying pose, with the staff falling naturally alongside him"
        prompt=f"""Edit the SECOND image, replacing the previous Priest design with the simplified Priest from the FIRST image. Preserve the exact pose, location, view and gesture of EVERY corresponding figure in the existing 4-column 2-row sheet. This is a costume/identity update of an already authored action sequence: {action}.
The FIRST image is the exact new identity, compact anatomy and LCPixel drawing reference. All figures face {view}. Do not turn the camera or change head size. {identity}
{style_text}
LCPixel: one-to-two-native-pixel charcoal contours, simple pixel clusters and four-tone material shading, compact 2.65-head anatomy, broad readable boots, restrained detail. Keep the same face, hair, beard, proportions, clothing, gold motifs and staff in every pose. The head remains connected to the neck and the shoulders follow the body's action. No enlarged skull, shrinking torso, shrinking limbs or rectangular head seam.
Keep all eight complete figures in the exact original 4-by-2 layout on flat exact magenta #ff00ff. The staff's yellow-gold orb must be clearly visible, replacing every red gem/winged staff. No added effects, glow, motion trails, text, grid, floor or cast shadows. Match the existing pose mechanics rather than repeating the first image's neutral stance.
"""
        (OUTPUT/f"{kind}-{direction}.prompt.txt").write_text(prompt,encoding="utf-8")

if __name__ == "__main__":
    print(f"Wrote twenty LCPixel canonical, run, cast and death prompt templates to {OUTPUT}; accepted source prompts unchanged.")
