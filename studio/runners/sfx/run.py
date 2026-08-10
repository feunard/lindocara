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
    audio = pipe(
        prompt=args.text,
        seconds=args.seconds,
        num_inference_steps=args.steps,
        cfg_scale=args.cfg_scale,
    )
    # torchaudio 2.9 routes every save through TorchCodec, although this lane already depends on
    # libsndfile and writes plain PCM WAV. Keeping the final write here avoids adding a video/audio
    # codec runtime just to serialize the tensor MOSS has already produced.
    import soundfile as sf

    wav = audio.detach().cpu()
    if wav.ndim == 3:
        wav = wav[0]
    elif wav.ndim == 1:
        wav = wav.unsqueeze(0)
    sf.write(args.out, wav.to(torch.float32).numpy().T, pipe.sample_rate, subtype="PCM_16")
    print("wrote %s" % args.out)


if __name__ == "__main__":
    main()
