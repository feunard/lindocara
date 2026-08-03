#!/usr/bin/env python3
"""Tiny Swords asset studio — one entry point for the four lanes.

    python3 studio/studio.py sprite --prompt "a goblin archer, idle"  --out apps/lab/assets/generated/goblin.png
    python3 studio/studio.py sfx    --prompt "a sheep bleating"       --out packages/client/public/assets/lindocara/audio/sheep.wav
    python3 studio/studio.py voice  --text "You shall not pass!"      --out .../line01.wav
    python3 studio/studio.py music  --prompt "calm village at dawn"   --out .../village.wav
    python3 studio/studio.py doctor

Every subcommand injects the art direction from theme.json before calling its runtime,
so output is in-theme by default. --no-theme sends the raw prompt through instead.

Runs on macOS (Apple Silicon, MLX) and on Windows/Linux with an NVIDIA GPU (CUDA). The
backend is detected from the machine; STUDIO_BACKEND=mlx|cuda overrides it. Same command,
same theme, same assets on both.

Standard library only: this runs on the system python, no venv, no install.
"""
import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
ACE_PROJECT = os.path.join(ROOT, "musics", "ACE-Step-1.5")


# --------------------------------------------------------------------------- backend


def detect_backend():
    """mlx on Apple Silicon, cuda everywhere else. STUDIO_BACKEND wins."""
    forced = os.environ.get("STUDIO_BACKEND")
    if forced:
        if forced not in ("mlx", "cuda"):
            sys.exit("STUDIO_BACKEND must be 'mlx' or 'cuda', got %r" % forced)
        return forced
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        return "mlx"
    return "cuda"


BACKEND = detect_backend()


def lane_config(theme, lane):
    """Return (art direction, backend plumbing) for a lane."""
    cfg = theme[lane]
    backends = cfg.get("backends", {})
    if BACKEND not in backends:
        sys.exit("lane %s has no %s backend in theme.json" % (lane, BACKEND))
    return cfg, backends[BACKEND]


def runner_cmd(lane, script_args):
    """Build the `uv run` invocation for a CUDA lane runner.

    Each runner keeps its own pyproject and its own venv: MOSS pins numpy 1.26 and
    torch 2.9, diffusers wants something newer, and ACE-Step brings its own tree.
    One shared environment would be a permanent dependency fight.
    """
    project = os.path.join(ROOT, "runners", lane)
    return ["uv", "run", "--project", project,
            "python", os.path.join(project, "run.py")] + script_args


# --------------------------------------------------------------------------- config


def load_json(name):
    path = os.path.join(ROOT, name)
    try:
        with open(path) as fh:
            return json.load(fh)
    except IOError:
        sys.exit("missing %s — this script must stay next to theme.json" % name)


def get_character(name):
    if name is None:
        return None
    chars = load_json("characters.json")
    if name not in chars:
        known = ", ".join(k for k in sorted(chars) if not k.startswith("_"))
        sys.exit("unknown character %r. known: %s" % (name, known))
    return chars[name]


def rooted(path):
    """Resolve a theme-relative path against the studio root."""
    return path if os.path.isabs(path) else os.path.join(ROOT, path)


# --------------------------------------------------------------------------- helpers


DRY_RUN = False


def run(cmd, label):
    if DRY_RUN:
        print("[dry-run] %s\n  %s" % (label, " ".join(repr(c) if " " in c else c for c in cmd)))
        return 0.0
    started = time.time()
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    except OSError as exc:
        sys.exit("%s could not be started (%s) — run `studio.py doctor`" % (label, exc))
    elapsed = time.time() - started
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout.decode("utf-8", "replace"))
        sys.exit("%s failed (exit %d)" % (label, proc.returncode))
    return elapsed


def ensure_parent(path):
    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)


def numbered(path, index, total):
    """out.wav -> out_2.wav, but only when more than one variant is asked for."""
    if total == 1:
        return path
    base, ext = os.path.splitext(path)
    return "%s_%d%s" % (base, index + 1, ext)


def take_single_output(staging, suffix, label, out):
    """Move the one file a runtime produced into the path the caller asked for.

    Both mflux and mlx_audio refuse to overwrite and silently rename to name_1.ext,
    so every lane generates into a staging directory and we place the result.
    """
    if DRY_RUN:
        return
    produced = [f for f in sorted(os.listdir(staging)) if f.lower().endswith(suffix)]
    if not produced:
        sys.exit("%s produced no %s file in %s" % (label, suffix, staging))
    shutil.move(os.path.join(staging, produced[0]), out)
    shutil.rmtree(staging, ignore_errors=True)


def sample_rate_of(path):
    """asetrate needs the file's real rate — the lanes emit 24 kHz and 48 kHz."""
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-select_streams", "a:0",
             "-show_entries", "stream=sample_rate", "-of", "csv=p=0", path],
            stderr=subprocess.STDOUT,
        )
        return int(out.decode().strip())
    except (subprocess.CalledProcessError, OSError, ValueError):
        return None


def ffmpeg_filters(pitch, speed, crunch, theme, rate):
    """Pitch in semitones, speed as a multiplier, crunch as a preset name."""
    filters = []
    if pitch and rate:
        ratio = 2.0 ** (pitch / 12.0)
        # Resample to shift pitch, then undo the tempo change it caused.
        filters.append("asetrate=%d" % int(round(rate * ratio)))
        filters.append("aresample=%d" % rate)
        filters.append("atempo=%.6f" % (1.0 / ratio))
    elif pitch:
        sys.stderr.write("warning: could not read sample rate, skipping pitch shift\n")
    if speed and abs(speed - 1.0) > 1e-6:
        filters.append("atempo=%.6f" % speed)
    if crunch and crunch != "off":
        preset = theme.get("crunch_presets", {}).get(crunch)
        if preset is None:
            sys.exit("unknown crunch preset %r" % crunch)
        filters.append("aresample=%d" % preset["rate"])
        filters.append("acrusher=bits=%d:mode=lin" % preset["bits"])
    return filters


def postprocess(path, pitch, speed, crunch, theme):
    wanted = pitch or (crunch not in (None, "off")) or (speed and abs(speed - 1.0) > 1e-6)
    if DRY_RUN or not wanted:
        return
    if shutil.which("ffmpeg") is None:
        sys.stderr.write("warning: ffmpeg not found, skipping pitch/speed/crunch\n")
        return
    filters = ffmpeg_filters(pitch, speed, crunch, theme, sample_rate_of(path))
    if not filters:
        return
    tmp = path + ".post.wav"
    run(["ffmpeg", "-v", "error", "-y", "-i", path, "-af", ",".join(filters), tmp], "ffmpeg")
    shutil.move(tmp, path)


def report(kind, path, elapsed):
    if DRY_RUN:
        return
    size = os.path.getsize(path) if os.path.exists(path) else 0
    print("%-6s %s  (%.1fs, %.0f KB)" % (kind, path, elapsed, size / 1024.0))


# --------------------------------------------------------------------------- lanes


def cmd_sprite(args):
    theme = load_json("theme.json")
    t, b = lane_config(theme, "pixel_art")
    char = get_character(args.character)

    if args.no_theme:
        prompt = args.prompt
    else:
        parts = [t["trigger"]]
        if char and char.get("description"):
            parts.append(char["description"] + ",")
        parts.append(args.prompt.rstrip(". ") + ".")
        parts.append(t["prompt_suffix"])
        prompt = " ".join(parts)

    ref = char.get("sprite_ref") if char else None
    if ref and not args.no_ref:
        ref = rooted(ref)
        if not os.path.exists(ref):
            sys.exit("sprite_ref for %s does not exist: %s" % (args.character, ref))
    else:
        ref = None

    lora = rooted(t["lora"])
    width = str(args.width or t["width"])
    height = str(args.height or t["height"])
    scale = str(args.lora_scale or t["lora_scale"])

    ensure_parent(args.out)
    for i in range(args.variants):
        out = numbered(args.out, i, args.variants)
        seed = str(args.seed + i)
        staging = tempfile.mkdtemp(prefix="studio-sprite-")
        target = os.path.join(staging, "sprite.png")

        if BACKEND == "mlx":
            binary = "mflux-generate-flux2-edit" if ref else "mflux-generate-flux2"
            cmd = [binary,
                   "--model", b["model"],
                   "--quantize", str(b["quantize"]),
                   "--steps", str(t["steps"]),
                   "--width", width, "--height", height,
                   "--seed", seed,
                   "--lora-paths", lora, "--lora-scales", scale,
                   "--prompt", prompt,
                   "--output", target]
            if ref:
                cmd += ["--image-paths", ref]
            label = "mflux"
        else:
            cmd = runner_cmd("sprite", [
                "--model", b["model"],
                "--dtype", b.get("dtype", "bfloat16"),
                "--steps", str(t["steps"]),
                "--guidance", str(b.get("guidance", 4.0)),
                "--width", width, "--height", height,
                "--seed", seed,
                "--lora", lora, "--lora-scale", scale,
                "--prompt", prompt,
                "--out", target,
            ])
            if ref:
                cmd += ["--image", ref]
            label = "diffusers runner"

        elapsed = run(cmd, label)
        take_single_output(staging, ".png", label, out)
        report("sprite", out, elapsed)


def cmd_sfx(args):
    theme = load_json("theme.json")
    t, b = lane_config(theme, "sounds")
    text = args.prompt if args.no_theme else "%s. %s" % (args.prompt.rstrip(". "), t["prompt_suffix"])
    crunch = args.crunch or t.get("crunch", "off")
    duration = str(args.duration or t["default_duration"])

    ensure_parent(args.out)
    for i in range(args.variants):
        out = numbered(args.out, i, args.variants)
        seed = str(args.seed + i)

        if BACKEND == "mlx":
            cmd = ["mlx-speech", "tts",
                   "--model", b["model"],
                   "--text", text,
                   "--duration-seconds", duration,
                   "-o", out]
            label = "mlx-speech"
        else:
            cmd = runner_cmd("sfx", [
                "--model", b["model"],
                "--text", text,
                "--seconds", duration,
                "--steps", str(b.get("steps", 100)),
                "--cfg-scale", str(b.get("cfg_scale", 4.0)),
                "--seed", seed,
                "--out", out,
            ])
            label = "moss runner"

        elapsed = run(cmd, label)
        postprocess(out, 0, 1.0, crunch, theme)
        report("sfx", out, elapsed)


def cmd_voice(args):
    theme = load_json("theme.json")
    t, b = lane_config(theme, "voices")
    char = get_character(args.character)

    archetype_name = args.archetype or (char or {}).get("archetype") or t["default_archetype"]
    if archetype_name not in t["archetypes"]:
        sys.exit("unknown archetype %r. known: %s" % (archetype_name, ", ".join(sorted(t["archetypes"]))))
    archetype = t["archetypes"][archetype_name]

    voice_ref = args.ref_audio or (char or {}).get("voice_ref")
    if voice_ref:
        voice_ref = rooted(voice_ref)
        if not os.path.exists(voice_ref):
            sys.exit("voice_ref does not exist: %s" % voice_ref)

    pitch = 0 if args.no_theme else archetype.get("pitch", 0)
    speed = 1.0 if args.no_theme else archetype.get("speed", 1.0)
    model = b["clone"] if voice_ref else b["draft"]

    ensure_parent(args.out)
    for i in range(args.variants):
        out = numbered(args.out, i, args.variants)
        staging = tempfile.mkdtemp(prefix="studio-voice-")

        if BACKEND == "mlx":
            cmd = ["mlx_audio.tts.generate",
                   "--model", model,
                   "--text", args.text,
                   "--output_path", staging,
                   "--file_prefix", "line",
                   "--audio_format", "wav"]
            if voice_ref:
                cmd += ["--ref_audio", voice_ref]
                if args.ref_text:
                    cmd += ["--ref_text", args.ref_text]
            else:
                cmd += ["--voice", archetype["voice"]]
            label = "mlx_audio"
        else:
            cmd = runner_cmd("voice", [
                "--model", model,
                "--text", args.text,
                "--out", os.path.join(staging, "line.wav"),
            ])
            if voice_ref:
                cmd += ["--ref-audio", voice_ref]
                if args.ref_text:
                    cmd += ["--ref-text", args.ref_text]
            else:
                cmd += ["--voice", archetype["voice"]]
            label = "torch-tts runner"

        elapsed = run(cmd, label)
        take_single_output(staging, ".wav", label, out)
        postprocess(out, pitch, speed, args.crunch, theme)
        report("voice", out, elapsed)


def cmd_music(args):
    theme = load_json("theme.json")
    t, b = lane_config(theme, "musics")
    caption = args.prompt if args.no_theme else "%s, %s" % (t["style_prompt"], args.prompt)
    if len(caption) > 512:
        caption = caption[:512]

    ensure_parent(args.out)
    for i in range(args.variants):
        out = numbered(args.out, i, args.variants)
        cmd = ["uv", "run", "--project", ACE_PROJECT,
               "python", os.path.join(ROOT, "musics", "run_acestep.py"),
               "--caption", caption,
               "--duration", str(args.duration or t["default_duration"]),
               "--seed", str(args.seed + i),
               "--lm-backend", b.get("lm_backend", "pt"),
               "--out", out]
        if not t.get("instrumental", True) or args.vocal:
            cmd.append("--vocal")
        report("music", out, run(cmd, "acestep"))


# --------------------------------------------------------------------------- doctor


def check(label, ok, detail="", fix=""):
    note = detail if ok else (fix or detail)
    print("  [%s] %s%s" % ("ok" if ok else "--", label, ("  " + note) if note else ""), flush=True)
    return ok


def cmd_doctor(args):
    theme = load_json("theme.json")
    print("Backend: %s (%s %s)" % (BACKEND, platform.system(), platform.machine()), flush=True)

    print("Runtimes", flush=True)
    healthy = True
    if BACKEND == "mlx":
        healthy &= check("mflux-generate-flux2", shutil.which("mflux-generate-flux2") is not None,
                         fix="uv tool install mflux")
        healthy &= check("mlx-speech", shutil.which("mlx-speech") is not None,
                         fix="uv tool install mlx-speech --python 3.13")
        healthy &= check("mlx_audio.tts.generate", shutil.which("mlx_audio.tts.generate") is not None,
                         fix="see INSTALL in studio/AGENTS.md — the pins matter")
    else:
        healthy &= check("uv", shutil.which("uv") is not None,
                         fix="https://docs.astral.sh/uv/ — every CUDA lane runs through it")
        for lane in ("sprite", "sfx", "voice"):
            path = os.path.join(ROOT, "runners", lane, "pyproject.toml")
            healthy &= check("runner: %s" % lane, os.path.exists(path), fix="missing %s" % path)
        healthy &= check("nvidia-smi", shutil.which("nvidia-smi") is not None,
                         fix="no NVIDIA driver found — the CUDA lanes need one")
    healthy &= check("uv (for ACE-Step)", shutil.which("uv") is not None)
    check("ffmpeg (pitch/crunch)", shutil.which("ffmpeg") is not None, "optional")

    print("Weights", flush=True)
    lora = rooted(theme["pixel_art"]["lora"])
    healthy &= check("pixel-art LoRA", os.path.exists(lora), lora)
    ckpt = os.path.join(ACE_PROJECT, "checkpoints")
    healthy &= check("ACE-Step checkpoints", os.path.isdir(ckpt),
                     fix="uv run --project studio/musics/ACE-Step-1.5 acestep-download")

    if not healthy:
        sys.exit("\nSomething is missing — see INSTALL in studio/AGENTS.md.")
    if args.no_gen:
        return

    print("Smoke test", flush=True)
    smoke = os.path.join(ROOT, "examples", "_smoke")
    lanes = [
        ("sfx", ["sfx", "--prompt", "a wooden door creaking open", "--duration", "2",
                 "--out", os.path.join(smoke, "door.wav")]),
        ("voice", ["voice", "--text", "The gate is barred, traveller.",
                   "--out", os.path.join(smoke, "line.wav")]),
    ]
    if not args.fast:
        lanes.insert(0, ("sprite", ["sprite", "--prompt", "a goblin archer, standing idle",
                                    "--out", os.path.join(smoke, "goblin.png")]))
        lanes.append(("music", ["music", "--prompt", "calm village at dawn", "--duration", "20",
                                "--out", os.path.join(smoke, "village.wav")]))

    for name, argv in lanes:
        print("  %s..." % name, flush=True)
        proc = subprocess.run([sys.executable, os.path.abspath(__file__)] + argv)
        if proc.returncode != 0:
            sys.exit("lane %s failed" % name)
    print("\nAll lanes answered.")


# --------------------------------------------------------------------------- cli


def add_common(sub, with_duration=False):
    sub.add_argument("--out", required=True, help="Output path, inside the game project.")
    sub.add_argument("--seed", type=int, default=42)
    sub.add_argument("--variants", type=int, default=1, help="Generate N, suffixed _1.._N.")
    sub.add_argument("--no-theme", action="store_true", help="Send the raw prompt, no theme injection.")
    sub.add_argument("--dry-run", action="store_true",
                     help="Print the command that would run, generate nothing.")
    if with_duration:
        sub.add_argument("--duration", type=int, default=None, help="Seconds.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    subs = ap.add_subparsers(dest="cmd")

    p = subs.add_parser("sprite", help="Pixel art sprite via FLUX.2-klein + the Tiny Swords LoRA.")
    p.add_argument("--prompt", required=True)
    p.add_argument("--character", help="Name from characters.json — adds its description and sprite_ref.")
    p.add_argument("--no-ref", action="store_true", help="Ignore the character's sprite_ref.")
    p.add_argument("--width", type=int, default=None)
    p.add_argument("--height", type=int, default=None)
    p.add_argument("--lora-scale", type=float, default=None)
    add_common(p)
    p.set_defaults(func=cmd_sprite)

    p = subs.add_parser("sfx", help="Sound effect via MOSS-SoundEffect.")
    p.add_argument("--prompt", required=True)
    p.add_argument("--crunch", choices=["off", "light", "heavy"], default=None)
    add_common(p, with_duration=True)
    p.set_defaults(func=cmd_sfx)

    p = subs.add_parser("voice", help="Voice line via Kokoro, or Qwen3-TTS when a voice_ref exists.")
    p.add_argument("--text", required=True)
    p.add_argument("--character", help="Name from characters.json — picks its archetype and voice_ref.")
    p.add_argument("--archetype", help="Override the archetype (see theme.json).")
    p.add_argument("--ref-audio", dest="ref_audio", help="5-15s of clean speech to clone.")
    p.add_argument("--ref-text", dest="ref_text", help="Transcript of --ref-audio.")
    p.add_argument("--crunch", choices=["off", "light", "heavy"], default=None)
    add_common(p)
    p.set_defaults(func=cmd_voice)

    p = subs.add_parser("music", help="Music track via ACE-Step 1.5.")
    p.add_argument("--prompt", required=True)
    p.add_argument("--vocal", action="store_true", help="Allow vocals (default: instrumental).")
    add_common(p, with_duration=True)
    p.set_defaults(func=cmd_music)

    p = subs.add_parser("doctor", help="Check every runtime and weight, then generate one artifact per lane.")
    p.add_argument("--fast", action="store_true", help="Skip the slow sprite and music lanes.")
    p.add_argument("--no-gen", action="store_true", help="Presence checks only.")
    p.set_defaults(func=cmd_doctor)

    args = ap.parse_args()
    if not args.cmd:
        ap.print_help()
        sys.exit(1)
    global DRY_RUN
    DRY_RUN = getattr(args, "dry_run", False)
    args.func(args)


if __name__ == "__main__":
    main()
