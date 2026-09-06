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
    run = f"""Use case: stylized-concept. Eight authored key drawings of ONE running cycle for the LCPixel Priest, in exactly 4 columns by 2 rows, temporal order left-to-right then next row.
Input 1: canonical Priest identity and exact compact anatomy. Input 2: Assassin V2 motion witness, for coordinated whole-body motion only, never its costume. All eight Priest poses face {view}; absolutely no turning the camera or character to a different view inside this clip.
{style_text}
{identity}
The priority is NATURAL WHOLE-BODY RUNNING. The torso must not stay vertical, centered and rigid. Incline the trunk forward about 15 degrees from the hips; visibly compress and recover through the spine. The pelvis transfers weight over each support, the shoulders counter-rotate against the pelvis, the chest cross follows the curved chest plane, the head rides the spine with a small stabilizing nod. The free arm swings opposite the forward leg with bent elbow. The staff arm flexes naturally and carries the staff with subtle lag; it is not a cane planted on the floor. Coat tails follow one beat behind the hips. Keep skull size, chest length and leg bone lengths CONSTANT, including tucked poses. No stretched neck or detached head.
Draw these EIGHT clearly distinct phases, not eight copies of one leg pose: 1 near-leg forward contact and far leg finishing push-off; 2 near foot supports weight, knee flexes, body settles and far knee swings forward; 3 far knee passes the supporting leg, torso rises and shoulder twist changes smoothly; 4 brief flight after near-leg push-off, near leg recovering behind, far leg reaching forward; 5 FAR-leg forward contact and near leg finishing push-off; 6 far foot supports weight, body settles and near knee swings forward; 7 near knee passes supporting leg, torso rises; 8 brief flight after far-leg push-off, far leg recovering behind, near leg reaching forward. The next frame is pose 1 again. Alternating LEFT and RIGHT legs is essential. Spine flexion, shoulder slope and pelvis tilt must differ appropriately in every phase.
Identical sprite density and body proportions in all eight cells. Compact 2.65-head body, broad readable boots, no long adult legs. Flat exact magenta #ff00ff background, no floor or shadow, no VFX, no labels, no grid. Separate complete figures with generous margins. Preserve the clean pixel clusters of the canonical design; do not add microtexture.
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
    print(f"Wrote fifteen LCPixel run, cast and death prompt templates to {OUTPUT}; accepted source prompts unchanged.")
