"""Lindocara's data-driven music identity and reproducible generation registry.

This module deliberately contains no model code. `studio.py music` remains the one generation
entry point and delegates the actual render to the existing ACE-Step runner.
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone


STUDIO_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(STUDIO_DIR)
MUSIC_DIR = os.path.join(STUDIO_DIR, "musics")
CONFIG_PATH = os.path.join(MUSIC_DIR, "lindocara-music.json")
REGISTRY_PATH = os.path.join(MUSIC_DIR, "generations.json")
PUBLIC_MUSIC_DIR = os.path.join(
    REPO_ROOT, "packages", "client", "public", "assets", "lindocara", "audio", "music"
)
PUBLIC_MUSIC_URL = "/assets/lindocara/audio/music"


def _read_json(path: str) -> dict:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def music_config() -> dict:
    return _read_json(CONFIG_PATH)


def generation_registry() -> dict:
    return _read_json(REGISTRY_PATH)


def profile(profile_id: str) -> dict:
    for candidate in music_config()["profiles"]:
        if candidate["id"] == profile_id:
            return candidate
    known = ", ".join(item["id"] for item in music_config()["profiles"])
    raise ValueError("unknown music profile %r. known: %s" % (profile_id, known))


def generation(generation_id: str) -> dict:
    for candidate in generation_registry()["generations"]:
        if candidate["id"] == generation_id:
            return candidate
    raise ValueError("unknown music generation %r" % generation_id)


def list_profiles() -> None:
    print("%-18s %-30s %5s %9s" % ("PROFILE", "TITLE", "BPM", "INTENSITY"))
    for item in music_config()["profiles"]:
        print("%-18s %-30s %5d %9.2f" % (
            item["id"], item["title"], item["bpm"], item["intensity"]
        ))


def list_generations() -> None:
    rows = generation_registry()["generations"]
    if not rows:
        print("No registered Lindocara music generation.")
        return
    print("%-25s %-18s %8s %5s %8s" % ("ID", "PROFILE", "SEED", "BPM", "DURATION"))
    for item in rows:
        print("%-25s %-18s %8d %5d %7ss" % (
            item["id"], item["profile"], item["seed"], item["bpm"], item["duration"]
        ))


def show_generation(generation_id: str) -> None:
    print(json.dumps(generation(generation_id), ensure_ascii=False, indent=2))


def _trim_words(value: str, max_chars: int) -> str:
    if len(value) <= max_chars:
        return value
    shortened = value[: max(0, max_chars - 1)].rsplit(" ", 1)[0].rstrip(" ,;:.")
    return shortened + "."


def compose_prompt(profile_id: str, context: str | None = None) -> str:
    """Compose the effective ACE-Step caption from DNA + motif + profile + context + limits."""
    config = music_config()
    item = profile(profile_id)
    motif = config["mainMotif"]
    limit = int(config["generator"]["captionLimit"])

    base = (
        "Lindocara organic ancient-world RPG underscore; adventure, wonder, mystery, "
        "melancholy, vastness."
    )
    motif_text = " Five-note motif %s, a recurring question, may transpose." % "-".join(
        motif["notes"]
    )
    identity = " %s; %s. %s" % (
        item["title"], ", ".join(item["instruments"]), item["prompt"]
    )
    context_text = " Context: %s." % context.strip().rstrip(". ") if context else ""
    voice_limit = (
        "No vocals; choir only as a rare accent"
        if profile_id == "boss"
        else "No vocals/choir"
    )
    constraints = (
        " %d BPM; instrumental, unobtrusive long-form background, loop-friendly. "
        "%s, drum kit, EDM, synth lead, trailer bombast, constant epic percussion."
        % (item["bpm"], voice_limit)
    )
    fixed_length = len(base + motif_text + constraints + context_text)
    identity = _trim_words(identity, max(48, limit - fixed_length))
    caption = base + motif_text + identity + context_text + constraints
    if len(caption) > limit and context_text:
        context_text = _trim_words(context_text, max(0, len(context_text) - (len(caption) - limit)))
        caption = base + motif_text + identity + context_text + constraints
    if len(caption) > limit:
        caption = _trim_words(caption, limit)
    return caption


def compose_generic_prompt(context: str, bpm: int | None = None, allow_vocals: bool = False) -> str:
    """Apply Music DNA and the motif to a free-form cue outside a named runtime profile."""
    config = music_config()
    motif = config["mainMotif"]
    limit = int(config["generator"]["captionLimit"])
    base = (
        "Lindocara organic ancient-world RPG underscore; wooden flute, acoustic lute, cello, "
        "small strings, harp, restrained horn, subtle frame drum; wonder, mystery, melancholy, "
        "vastness. Five-note motif %s, recurring or transposed. " % "-".join(motif["notes"])
    )
    constraints = (
        ("%d BPM; " % bpm if bpm is not None else "")
        + "unobtrusive game background. "
        + ("Vocals allowed sparingly; " if allow_vocals else "Instrumental, no vocals/choir; ")
        + "no drum kit, EDM, synth lead, trailer bombast or constant epic percussion."
    )
    available = max(24, limit - len(base + constraints) - 1)
    return base + _trim_words(context.strip(), available) + " " + constraints


def next_profile_index(profile_id: str) -> int:
    prefix = profile_id + "-"
    indexes = []
    for item in generation_registry()["generations"]:
        if not item["id"].startswith(prefix):
            continue
        try:
            indexes.append(int(item["id"][len(prefix):]))
        except ValueError:
            pass
    return max(indexes, default=0) + 1


def output_for(profile_id: str, index: int, audio_format: str) -> tuple[str, str, str]:
    generation_id = "%s-%02d" % (profile_id, index)
    filename = "%s_%02d.%s" % (profile_id.replace("-", "_"), index, audio_format)
    return (
        generation_id,
        os.path.join(PUBLIC_MUSIC_DIR, filename),
        "%s/%s" % (PUBLIC_MUSIC_URL, filename),
    )


def relative_repo_path(path: str | None) -> str | None:
    if not path:
        return None
    absolute = os.path.abspath(path)
    try:
        relative = os.path.relpath(absolute, REPO_ROOT)
    except ValueError:
        return absolute.replace("\\", "/")
    if relative.startswith(".."):
        return absolute.replace("\\", "/")
    return relative.replace("\\", "/")


def make_generation_record(
    generation_id: str,
    profile_id: str,
    title: str,
    src: str,
    output_path: str,
    prompt: str,
    seed: int,
    duration: int,
    bpm: int,
    steps: int,
    audio_format: str,
    mp3_bitrate: str,
    reference_audio: str | None,
    language_model_backend: str,
) -> dict:
    config = music_config()
    item = profile(profile_id)
    generator = config["generator"]
    return {
        "id": generation_id,
        "title": title,
        "profile": profile_id,
        "biome": item["biomes"],
        "mood": item["moods"],
        "intensity": item["intensity"],
        "bpm": bpm,
        "duration": duration,
        "loopable": item["loopable"],
        "seed": seed,
        "generator": "%s %s / %s" % (
            generator["name"], generator["version"], generator["model"]
        ),
        "generationPrompt": prompt,
        "generationParams": {
            "duration": duration,
            "bpm": bpm,
            "steps": steps,
            "format": audio_format,
            "mp3Bitrate": mp3_bitrate if audio_format == "mp3" else None,
            "referenceAudio": relative_repo_path(reference_audio),
            "instrumental": True,
            "diffusionModel": generator["model"],
            "languageModel": generator["languageModel"],
            "languageModelBackend": language_model_backend,
            "sampleRate": generator["sampleRate"],
        },
        "src": src,
        "file": relative_repo_path(output_path),
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def _write_registry(registry: dict) -> None:
    directory = os.path.dirname(REGISTRY_PATH)
    handle, temporary = tempfile.mkstemp(prefix="generations-", suffix=".json", dir=directory)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as output:
            json.dump(registry, output, ensure_ascii=False, indent=2)
            output.write("\n")
        os.replace(temporary, REGISTRY_PATH)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def rebuild_runtime_catalog() -> None:
    npm = shutil.which("npm")
    if not npm:
        raise RuntimeError("npm is required to rebuild the runtime music catalogue")
    subprocess.run(
        [npm, "run", "music:catalog"], cwd=REPO_ROOT, check=True,
    )


def register_generation(record: dict) -> None:
    registry = generation_registry()
    rows = registry["generations"]
    if any(item["id"] == record["id"] for item in rows):
        raise ValueError("generation %r is already registered" % record["id"])
    rows.append(record)
    rows.sort(key=lambda item: item["id"])
    _write_registry(registry)
    rebuild_runtime_catalog()


def update_generation(record: dict) -> None:
    registry = generation_registry()
    for index, item in enumerate(registry["generations"]):
        if item["id"] == record["id"]:
            registry["generations"][index] = record
            _write_registry(registry)
            rebuild_runtime_catalog()
            return
    raise ValueError("unknown music generation %r" % record["id"])


def _generation_file(record: dict) -> str:
    path = os.path.abspath(os.path.join(REPO_ROOT, record["file"]))
    public_root = os.path.abspath(PUBLIC_MUSIC_DIR)
    try:
        is_managed = os.path.commonpath([path, public_root]) == public_root
    except ValueError:
        is_managed = False
    if not is_managed:
        raise ValueError("refusing to manage a music file outside %s" % PUBLIC_MUSIC_DIR)
    return path


def preview_generation(generation_id: str) -> None:
    path = _generation_file(generation(generation_id))
    if not os.path.isfile(path):
        raise ValueError("generated audio is missing: %s" % path)
    system = platform.system()
    if system == "Windows":
        os.startfile(path)  # type: ignore[attr-defined]
    elif system == "Darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])
    print("opened %s" % path)


def delete_generation(generation_id: str) -> None:
    record = generation(generation_id)
    source = _generation_file(record)
    if os.path.isfile(source):
        trash = os.path.join(STUDIO_DIR, "examples", "_deleted-music")
        os.makedirs(trash, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        shutil.move(source, os.path.join(trash, "%s-%s" % (stamp, os.path.basename(source))))
    registry = generation_registry()
    registry["generations"] = [
        item for item in registry["generations"] if item["id"] != generation_id
    ]
    _write_registry(registry)
    rebuild_runtime_catalog()
    print("removed %s; any audio file was moved to studio/examples/_deleted-music" % generation_id)
