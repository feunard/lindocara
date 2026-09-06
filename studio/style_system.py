"""The named sprite style contract, shared by single and batch authoring."""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def profile(config):
    name = config.get("style_profile")
    if not name:
        return None
    data = json.loads((ROOT / name).read_text(encoding="utf-8"))
    if not data.get("name") or not data.get("prompt") or not isinstance(data.get("version"), int):
        raise ValueError("Incomplete sprite style profile: " + name)
    return data


def sprite_prompt(config, request, character=None, no_theme=False):
    if no_theme:
        return request
    style = profile(config)
    parts = [config["trigger"]]
    if style:
        if style["name"] == "LCPixel":
            check_references()
        parts.append(style_prompt(style))
    if character and character.get("description"):
        parts.append(character["description"].rstrip(". ") + ".")
    parts.extend([request.rstrip(". ") + ".", config["prompt_suffix"]])
    return " ".join(parts)


def style_prompt(style):
    """Export the numeric contract as prose, not imaginary generator parameters."""
    h=style["humanoid"]
    size=h["nativeBodyHeight"];heads=h["headsHigh"];detail=h["detail"];face=h["face"]
    limits=(
        f"Production proportions: {heads['target']} heads high ({heads['min']}-{heads['max']} by role), "
        f"native body height {size['target']} px ({size['min']}-{size['max']}), excluding weapon and effects. "
        f"Outer outline {h['outlinePixels']['outer'][0]}-{h['outlinePixels']['outer'][1]} native px, inner outline {h['outlinePixels']['inner']} px. "
        f"Use {h['materialTones']} material tones, {h['metalOrMagicTones']} only for metal/magic; "
        f"freeze a {h['paletteColours']['target']}-colour palette, maximum {h['paletteColours']['max']}. "
        f"At most {detail['maximumMajorCostumeMotifs']} major costume motifs; decorative clusters at least {detail['minimumDecorativeClusterArea']} px in area; "
        f"isolated colour pixels outside face/weapon below {detail['maximumIsolatedPixelsOutsideFaceAndWeaponRatio']*100:g} percent. "
        f"Eyes {face['eyeHeightPixels'][0]}-{face['eyeHeightPixels'][1]} px high, {face['irisHighlightPixels']} iris highlight pixel, "
        f"nose {face['nosePixels'][0]}-{face['nosePixels'][1]} px, mouth {face['mouthPixels'][0]}-{face['mouthPixels'][1]} px. "
        "Weapon/body height ratios: "+", ".join(f"{name} {values[0]}-{values[1]}" for name,values in h['equipmentHeightRatio'].items())+". "
        f"HSV saturation at most {h['saturation']['broadSurfacesMaximum']} on broad surfaces, {h['saturation']['accentMaximum']} on accents "
        f"covering at most {h['saturation']['maximumAccentAreaRatio']*100:g} percent. "
        f"Keep the approved orthographic sprite perspective for the {style['view']['worldCameraPitchDegrees']}-degree game camera "
        f"and {style['view']['directionStepDegrees']}-degree direction steps."
    )
    return style["prompt"]+" "+limits+" Forbidden: "+"; ".join(style["forbidden"])+"."


def check_references():
    config = json.loads((ROOT / "theme.json").read_text(encoding="utf-8"))["pixel_art"]
    style = profile(config)
    if style is None or style["name"] != "LCPixel":
        raise ValueError("Lindocara must use the LCPixel profile")
    lock = json.loads((ROOT / "styles/lcpixel/references.lock.json").read_text(encoding="utf-8"))
    if lock["styleVersion"] != style["version"]:
        raise ValueError("LCPixel reference version drift")
    for name, expected in lock["sha256"].items():
        path = ROOT / name
        data = path.read_bytes() if path.suffix == ".png" else path.read_text(encoding="utf-8").replace("\r\n", "\n").encode("utf-8")
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError("LCPixel approved reference changed: " + name)
    return style, lock


if __name__ == "__main__":
    style, lock = check_references()
    if "--prompt" in sys.argv:
        print(style_prompt(style))
    else:
        print(f"{style['name']} v{style['version']}: {len(lock['sha256'])} approved style/identity references verified.")
