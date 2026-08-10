#!/usr/bin/env python3
"""Headless ACE-Step 1.5 generation.

ACE-Step's own cli.py is an interactive wizard, so the studio calls this instead.
It must run inside ACE-Step's venv:

    uv run --project musics/ACE-Step-1.5 python musics/run_acestep.py --caption "..." --out bgm.wav

Everything about the art direction comes from the caller (studio.py applies theme.json);
this script only knows how to drive the model.
"""
import argparse
import json
import os
import shutil
import sys
import tempfile

ACE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ACE-Step-1.5")
CHECKPOINTS = os.path.join(ACE_DIR, "checkpoints")


def main():
    ap = argparse.ArgumentParser(description="Generate one music track with ACE-Step 1.5.")
    ap.add_argument("--caption", required=True, help="Style prompt, < 512 characters.")
    ap.add_argument("--duration", type=int, default=60, help="Seconds, 10-600.")
    ap.add_argument("--seed", type=int, default=-1, help="-1 for random.")
    ap.add_argument("--lyrics", default="[Instrumental]")
    ap.add_argument("--vocal", action="store_true", help="Allow vocals (default: instrumental).")
    ap.add_argument("--bpm", type=int, default=None)
    ap.add_argument("--steps", type=int, default=8, help="8 suits the turbo model.")
    ap.add_argument("--reference-audio", default=None,
                    help="Optional style/melodic reference accepted by ACE-Step.")
    ap.add_argument("--format", default="wav",
                    choices=["mp3", "wav", "flac", "wav32", "opus", "aac"])
    ap.add_argument("--mp3-bitrate", default="192k",
                    choices=["128k", "192k", "256k", "320k"])
    ap.add_argument("--lm", default="acestep-5Hz-lm-1.7B")
    ap.add_argument("--dit", default="acestep-v15-turbo")
    ap.add_argument("--lm-backend", dest="lm_backend", default="pt", choices=["mlx", "pt", "vllm"],
                    help="mlx on Apple Silicon, pt on CUDA (vllm is Linux-only).")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    if not 10 <= args.duration <= 600:
        ap.error("--duration must be between 10 and 600 seconds")
    if args.bpm is not None and not 30 <= args.bpm <= 300:
        ap.error("--bpm must be between 30 and 300")
    if args.steps < 1:
        ap.error("--steps must be positive")

    if not os.path.isdir(CHECKPOINTS):
        sys.exit("checkpoints missing — run: "
                 "uv run --project studio/musics/ACE-Step-1.5 acestep-download")

    from acestep.handler import AceStepHandler
    from acestep.llm_inference import LLMHandler
    from acestep.inference import GenerationParams, GenerationConfig, generate_music

    dit_handler = AceStepHandler()
    llm_handler = LLMHandler()

    # device="auto" resolves to MPS on Apple Silicon and CUDA on an NVIDIA box. The LM
    # backend is the part that does not auto-detect: MLX on Apple, PyTorch elsewhere.
    dit_handler.initialize_service(project_root=ACE_DIR, config_path=args.dit, device="auto")
    llm_handler.initialize(
        checkpoint_dir=CHECKPOINTS, lm_model_path=args.lm, backend=args.lm_backend, device="auto"
    )

    params = GenerationParams(
        caption=args.caption,
        lyrics=args.lyrics,
        instrumental=not args.vocal,
        duration=args.duration,
        bpm=args.bpm,
        inference_steps=args.steps,
        seed=args.seed,
        reference_audio=args.reference_audio,
    )
    # `GenerationConfig.use_random_seed` defaults to True and overrides GenerationParams.seed.
    # Always pass the seed through the config as well so a recorded Lindocara generation is truly
    # reproducible. `-1` deliberately retains ACE-Step's random-seed mode.
    deterministic = args.seed >= 0
    config = GenerationConfig(
        batch_size=1,
        use_random_seed=not deterministic,
        seeds=[args.seed] if deterministic else None,
        audio_format=args.format,
        mp3_bitrate=args.mp3_bitrate,
        mp3_sample_rate=48000,
    )

    tmp = tempfile.mkdtemp(prefix="acestep-")
    result = generate_music(dit_handler, llm_handler, params, config, save_dir=tmp)

    if not getattr(result, "success", False):
        sys.exit("generation failed: %s" % getattr(result, "error", "unknown error"))
    if not result.audios:
        sys.exit("generation reported success but produced no audio")

    produced = result.audios[0]["path"]
    out_dir = os.path.dirname(os.path.abspath(args.out))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    # ACE-Step stages under the system temp directory, which can be a different Windows volume
    # from the repository. Copy into a sibling temp file first, then atomically replace the target.
    suffix = os.path.splitext(args.out)[1]
    handle, staged_out = tempfile.mkstemp(prefix=".music-", suffix=suffix, dir=out_dir)
    os.close(handle)
    try:
        shutil.copy2(produced, staged_out)
        os.replace(staged_out, args.out)
    finally:
        if os.path.exists(staged_out):
            os.unlink(staged_out)
    shutil.rmtree(tmp, ignore_errors=True)
    actual_seed = result.audios[0].get("params", {}).get("seed", args.seed)
    print(json.dumps({"path": args.out, "seed": actual_seed, "format": args.format}))


if __name__ == "__main__":
    main()
