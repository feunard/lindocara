#!/usr/bin/env python3
"""CUDA sound-effect runner — MOSS-SoundEffect v2 through its own PyTorch pipeline.

studio.py calls this on non-Apple machines; on Apple Silicon it calls mlx-speech, which
wraps the same model quantised to 4-bit for MLX.

Not invoked directly: `python3 studio.py sfx ...` builds the command line.
"""
import argparse
import sys


def main():
    ap = argparse.ArgumentParser(description="Generate one sound effect with MOSS-SoundEffect v2.")
    ap.add_argument("--model", required=True)
    ap.add_argument("--text", required=True)
    ap.add_argument("--seconds", type=float, default=3.0)
    ap.add_argument("--steps", type=int, default=100)
    ap.add_argument("--cfg-scale", dest="cfg_scale", type=float, default=4.0)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

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

    torch.manual_seed(args.seed)
    pipe = MossSoundEffectPipeline.from_pretrained(
        args.model, torch_dtype=torch.bfloat16, device="cuda"
    )
    audio = pipe(
        prompt=args.text,
        seconds=args.seconds,
        num_inference_steps=args.steps,
        cfg_scale=args.cfg_scale,
    )
    pipe.save_audio(audio, args.out)
    print("wrote %s" % args.out)


if __name__ == "__main__":
    main()
