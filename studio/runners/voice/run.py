#!/usr/bin/env python3
"""CUDA voice runner — Kokoro for stock voices, Qwen3-TTS when cloning.

studio.py calls this on non-Apple machines; on Apple Silicon it calls mlx_audio, which
serves the same two models. The archetype's pitch and speed are applied afterwards by
studio.py with ffmpeg, so they behave identically on both platforms.

Not invoked directly: `python3 studio.py voice ...` builds the command line.
"""
import argparse
import sys

KOKORO_SAMPLE_RATE = 24000


def lang_code_for(voice):
    """Kokoro encodes the accent in the voice prefix: af_/am_ American, bf_/bm_ British."""
    return {"a": "a", "b": "b", "e": "e", "f": "f", "h": "h",
            "i": "i", "j": "j", "p": "p", "z": "z"}.get(voice[:1], "a")


def generate_kokoro(args):
    try:
        from kokoro import KPipeline
    except ImportError:
        sys.exit(
            "kokoro is missing, or espeak-ng is not installed.\n"
            "  Windows: install espeak-ng from https://github.com/espeak-ng/espeak-ng/releases\n"
            "  Linux:   apt install espeak-ng"
        )
    import soundfile as sf
    import numpy as np

    pipeline = KPipeline(lang_code=lang_code_for(args.voice), device="cuda")
    chunks = [audio for _, _, audio in pipeline(args.text, voice=args.voice)]
    if not chunks:
        sys.exit("kokoro returned no audio for that text")
    sf.write(args.out, np.concatenate(chunks), KOKORO_SAMPLE_RATE)


def generate_qwen(args):
    try:
        import torch
        from qwen_tts import Qwen3TTSModel
    except ImportError:
        sys.exit(
            "qwen_tts is missing. It installs from the Qwen3-TTS repo:\n"
            "  uv add --project studio/runners/voice 'qwen-tts @ git+https://github.com/QwenLM/Qwen3-TTS'"
        )
    if not args.ref_text:
        sys.exit("cloning needs --ref-text, the transcript of the reference clip")

    model = Qwen3TTSModel.from_pretrained(args.model, device_map="cuda:0", dtype=torch.bfloat16)
    model.generate(text=args.text, ref_audio=args.ref_audio, ref_text=args.ref_text,
                   output_path=args.out)


def main():
    ap = argparse.ArgumentParser(description="Generate one voice line.")
    ap.add_argument("--model", required=True)
    ap.add_argument("--text", required=True)
    ap.add_argument("--voice", help="Kokoro stock voice, e.g. am_fenrir.")
    ap.add_argument("--ref-audio", dest="ref_audio", help="5-15s of clean speech to clone.")
    ap.add_argument("--ref-text", dest="ref_text", help="Transcript of --ref-audio.")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    if args.ref_audio:
        generate_qwen(args)
    elif args.voice:
        generate_kokoro(args)
    else:
        sys.exit("need either --voice (stock) or --ref-audio (clone)")
    print("wrote %s" % args.out)


if __name__ == "__main__":
    main()
