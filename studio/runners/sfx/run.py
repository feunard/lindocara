#!/usr/bin/env python3
"""CUDA sound-effect runner — MOSS-SoundEffect v2 through its own PyTorch pipeline.

studio.py calls this on non-Apple machines; on Apple Silicon it calls mlx-speech, which
wraps the same model quantised to 4-bit for MLX.

Not invoked directly: `python3 studio.py sfx ...` builds the command line.
"""
import argparse
import json
import os
import sys


def main():
    ap = argparse.ArgumentParser(description="Generate one sound effect with MOSS-SoundEffect v2.")
    ap.add_argument("--model", required=True)
    ap.add_argument("--text")
    ap.add_argument("--seconds", type=float, default=3.0)
    ap.add_argument("--steps", type=int, default=100)
    ap.add_argument("--cfg-scale", dest="cfg_scale", type=float, default=4.0)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out")
    ap.add_argument(
        "--skip-existing",
        action="store_true",
        help="Keep completed batch outputs so an interrupted manifest can resume.",
    )
    ap.add_argument(
        "--batch-manifest",
        help="JSON list of {text, seconds, seed, out}; keeps the model warm across many cues.",
    )
    args = ap.parse_args()
    if args.batch_manifest:
        with open(args.batch_manifest, encoding="utf-8") as source:
            jobs = json.load(source)
        if not isinstance(jobs, list) or not jobs:
            ap.error("--batch-manifest must contain a non-empty JSON list")
    elif args.text and args.out:
        jobs = [{"text": args.text, "seconds": args.seconds, "seed": args.seed, "out": args.out}]
    else:
        ap.error("provide --text with --out, or --batch-manifest")

    try:
        import torch
    except ImportError:
        sys.exit("torch is missing — `uv sync` in this runner's directory should install it.")

    try:
        from moss_soundeffect_v2 import MossSoundEffectPipeline
    except ImportError:
        sys.exit(
            "moss_soundeffect_v2 is missing. It installs from the MOSS-TTS repo:\n"
            "  uv add --project studio/runners/sfx \\\n"
            "    'moss-soundeffect-v2 @ git+https://github.com/OpenMOSS/MOSS-TTS#subdirectory=moss_soundeffect_v2'"
        )

    if not torch.cuda.is_available():
        sys.exit("no CUDA device visible — check the NVIDIA driver.")

    pipe = MossSoundEffectPipeline.from_pretrained(
        args.model, torch_dtype=torch.bfloat16, device="cuda"
    )
    # Upstream forces Triton CUDA graphs. The Windows launcher currently overflows while building
    # that graph; compile the same denoiser without CUDA graphs when triton-windows is available,
    # with its undecorated eager function as the no-Triton fallback.
    compiled = pipe.engine.model_fn
    try:
        import triton  # noqa: F401
        triton_available = True
    except ImportError:
        triton_available = False
    if sys.platform == "win32" and hasattr(compiled, "__wrapped__"):
        pipe.engine.model_fn = (
            torch.compile(
                compiled.__wrapped__,
                fullgraph=True,
                options={"triton.cudagraphs": False},
            )
            if triton_available
            else compiled.__wrapped__
        )
    # torchaudio 2.9 routes every save through TorchCodec, although this lane already depends on
    # libsndfile and writes plain PCM WAV. Keeping the final write here avoids adding a video/audio
    # codec runtime just to serialize the tensor MOSS has already produced.
    import soundfile as sf

    for index, job in enumerate(jobs, start=1):
        if not isinstance(job, dict):
            sys.exit("batch job %d is not an object" % index)
        text = job.get("text")
        out = job.get("out")
        seconds = job.get("seconds", args.seconds)
        seed = job.get("seed", args.seed)
        if not isinstance(text, str) or not text or not isinstance(out, str) or not out:
            sys.exit("batch job %d needs non-empty text and out strings" % index)
        if not isinstance(seconds, (int, float)) or seconds <= 0 or not isinstance(seed, int):
            sys.exit("batch job %d has invalid seconds or seed" % index)
        if args.skip_existing and os.path.isfile(out):
            try:
                info = sf.info(out)
                completed = info.samplerate > 0 and info.frames / info.samplerate >= seconds * 0.95
            except (OSError, RuntimeError):
                completed = False
            if completed:
                print("kept %s (%d/%d)" % (out, index, len(jobs)), flush=True)
                continue
        parent = os.path.dirname(os.path.abspath(out))
        if parent:
            os.makedirs(parent, exist_ok=True)
        torch.manual_seed(seed)
        audio = pipe(
            prompt=text,
            seconds=seconds,
            num_inference_steps=args.steps,
            cfg_scale=args.cfg_scale,
        )
        wav = audio.detach().cpu()
        if wav.ndim == 3:
            wav = wav[0]
        elif wav.ndim == 1:
            wav = wav.unsqueeze(0)
        sf.write(out, wav.to(torch.float32).numpy().T, pipe.sample_rate, subtype="PCM_16")
        print("wrote %s (%d/%d)" % (out, index, len(jobs)), flush=True)


if __name__ == "__main__":
    main()
