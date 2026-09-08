"""Immutable visual witnesses and exact historical atlas extraction; no runtime dependency."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parent.parent
MINIMUM = REPO / "studio/styles/lcpixel/minimum"
BASELINE_COMMIT = "e9f4b4402e3f2de5ec8feccf234bdebbe7245c0b"
SCOPE = ["new-character", "modified-character", "new-monster", "modified-monster"]
QUALITY_PROMPT = (
    "LCPixel quality floor: the approved Priest at commit e9f4b440 is the minimum "
    "acceptable finish for every new or modified character and monster, in every "
    "required action and direction. Preserve identity, proportions and equipment; "
    "coordinate the whole body with believable weight transfer and contacts. No "
    "visible jitter, scale pops, stiff puppet motion, excessive stride or foot sliding "
    "at normal gameplay size and speed. Keep loops, turns and action transitions "
    "continuous, with readable anticipation, release/impact and recovery. Adapt "
    "anatomy, size and movement to the creature; do not copy the Priest's body, "
    "equipment, state count or frame count. Final acceptance requires in-engine "
    "visual comparison with the frozen reference and coverage of all states and "
    "directions required by the actual game code; a generated sheet is not approval."
)


def digest(name, data):
    if name.endswith((".json", ".md", ".txt")):
        data = data.decode("utf-8").replace("\r\n", "\n").encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def local_file(folder, name):
    # Lock entries are names inside one reference directory, never arbitrary paths.
    if not name or Path(name).name != name or "/" in name or "\\" in name or name in (".", ".."):
        raise ValueError("Invalid quality reference filename: " + name)
    target = (folder / name).resolve()
    if target.parent != folder.resolve():
        raise ValueError("Quality reference escapes its directory: " + name)
    return target


def check_quality_floor(folder=MINIMUM):
    lock = json.loads((folder / "baseline.lock.json").read_text(encoding="utf-8"))
    if lock["version"] != 1 or lock["referenceCommit"] != BASELINE_COMMIT or lock["scope"] != SCOPE:
        raise ValueError("The approved LCPixel quality floor or its scope changed")
    required = {"manifest.json", "run-review.png", "jump-review.png", "all-directions.webm",
                "paired-keys.png", "turn-detail.png"}
    if set(lock["witnessSha256"]) != required:
        raise ValueError("Incomplete frozen quality witnesses")
    for name, expected in lock["witnessSha256"].items():
        if digest(name, local_file(folder, name).read_bytes()) != expected:
            raise ValueError("Frozen quality witness changed: " + name)
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    assets = {Path(c["asset"]).name: c["sha256"] for c in manifest["clips"].values()}
    if len(manifest["directions"]) != 8 or len(manifest["clips"]) != 18 or len(assets) != 17:
        raise ValueError("Incomplete Priest reference coverage")
    if set(lock["runtimeSha256"]) != {"manifest.json", "portrait.png", *assets}:
        raise ValueError("Incomplete historical runtime fingerprints")
    if lock["runtimeSha256"]["manifest.json"] != lock["witnessSha256"]["manifest.json"]:
        raise ValueError("Historical manifest differs from frozen witness")
    for name, expected in assets.items():
        if lock["runtimeSha256"][name] != expected:
            raise ValueError("Historical atlas fingerprint mismatch: " + name)
    return lock


def materialize_reference():
    lock = check_quality_floor()
    source = "packages/renderer/src/assets/bonus/priest-prototype/"
    # Read and verify every object BEFORE writing any file. A failed extraction
    # must not leave a mixture of reference versions or current working-tree art.
    files = {}
    for name, expected in lock["runtimeSha256"].items():
        local_file(MINIMUM, name)
        result = subprocess.run(["git", "show", f"{BASELINE_COMMIT}:{source}{name}"],
                                cwd=REPO, capture_output=True, check=False)
        if result.returncode:
            raise ValueError("Historical reference is unavailable. Run: git fetch origin " + BASELINE_COMMIT)
        if digest(name, result.stdout) != expected:
            raise ValueError("Historical reference fingerprint mismatch: " + name)
        files[name] = result.stdout
    artifact_root = (REPO / "artifacts").resolve()
    destination = artifact_root / "actor-quality/priest-e9f4b440"
    if not destination.resolve().is_relative_to(artifact_root):
        raise ValueError("Reference output escapes artifacts")
    destination.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        local_file(destination, name).write_bytes(data)
    return destination


if __name__ == "__main__":
    if "--extract" in sys.argv:
        destination = materialize_reference()
        print(f"19 historical runtime files verified and restored: {destination}")
        print("Run yarn priest:studio, then open:")
        print("http://localhost:5330/studio/pixel-art/priest-prototype/compare.html?priest=/artifacts/actor-quality/priest-e9f4b440/manifest.json")
    else:
        check_quality_floor()
        print("LCPixel quality floor: Priest e9f4b440; frozen witnesses intact. Visual review of candidates is still required.")
