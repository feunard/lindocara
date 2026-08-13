#!/usr/bin/env python3
"""CUDA sprite runner — FLUX.2-klein + the Tiny Swords LoRA through diffusers.

studio.py calls this on non-Apple machines; on Apple Silicon it calls mflux instead.
Both produce the same thing from the same prompt, LoRA and seed.

Not invoked directly: `python3 studio.py sprite ...` builds the command line.
"""
import argparse
import json
import os
import sys


def load_tinyswords_lora(pipe, path):
    """Load the project LoRA across the current FLUX.2 Diffusers module layout.

    The adapter was trained against an attention `to_out` linear projection. Recent
    Flux2KleinPipeline builds wrap that projection in `ModuleList(Linear, Dropout)` for the
    double transformer blocks; PEFT otherwise tries to attach the adapter to the container and
    rejects it. Pointing those keys at element zero preserves the exact trained linear layer.
    """
    from safetensors.torch import load_file

    state = load_file(path)
    compatible = {
        key.replace(".attn.to_out.lora_", ".attn.to_out.0.lora_")
        if ".transformer_blocks." in key and ".single_transformer_blocks." not in key
        else key: value
        for key, value in state.items()
    }
    pipe.load_lora_weights(compatible, adapter_name="tinyswords")


def main():
    ap = argparse.ArgumentParser(description="Generate one sprite with FLUX.2-klein + a LoRA.")
    ap.add_argument("--model", required=True)
    ap.add_argument("--prompt")
    ap.add_argument("--lora", required=True)
    ap.add_argument("--lora-scale", type=float, default=1.4)
    ap.add_argument("--steps", type=int, default=4)
    ap.add_argument("--guidance", type=float, default=4.0)
    ap.add_argument("--width", type=int, default=768)
    ap.add_argument("--height", type=int, default=768)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--dtype", default="bfloat16")
    ap.add_argument("--image", help="Reference image — locks a character's look between generations.")
    ap.add_argument("--offload", action="store_true",
                    help="Stream the model from system RAM. Only for cards under ~10 GB: it is slow.")
    ap.add_argument("--out")
    ap.add_argument(
        "--batch-manifest",
        help="JSON list of {prompt, width, height, seed, out}; keeps FLUX warm across sprites.",
    )
    args = ap.parse_args()
    if args.batch_manifest:
        with open(args.batch_manifest, encoding="utf-8") as source:
            jobs = json.load(source)
        if not isinstance(jobs, list) or not jobs:
            ap.error("--batch-manifest must contain a non-empty JSON list")
    elif args.prompt and args.out:
        jobs = [
            {
                "prompt": args.prompt,
                "width": args.width,
                "height": args.height,
                "seed": args.seed,
                "out": args.out,
                **({"image": args.image} if args.image else {}),
            }
        ]
    else:
        ap.error("provide --prompt with --out, or --batch-manifest")

    try:
        import torch
    except ImportError:
        sys.exit("torch is missing — `uv sync` in this runner's directory should install it.")

    try:
        from diffusers import Flux2KleinPipeline
    except ImportError:
        sys.exit(
            "diffusers has no Flux2KleinPipeline. It needs a build with FLUX.2 support:\n"
            "  uv add --project studio/runners/sprite 'diffusers @ git+https://github.com/huggingface/diffusers'"
        )

    if not torch.cuda.is_available():
        sys.exit("no CUDA device visible — check the NVIDIA driver, or run with STUDIO_BACKEND=mlx on a Mac.")

    dtype = getattr(torch, args.dtype, None)
    if dtype is None:
        sys.exit("unknown dtype %r" % args.dtype)

    pipe = Flux2KleinPipeline.from_pretrained(args.model, torch_dtype=dtype)
    # A 12 GB card holds the 4B distilled model whole (~8.4 GB); offloading is a fallback,
    # and a costly one when system RAM is slow.
    if args.offload:
        pipe.enable_model_cpu_offload()
    else:
        pipe.to("cuda")

    load_tinyswords_lora(pipe, args.lora)
    pipe.set_adapters("tinyswords", adapter_weights=args.lora_scale)

    for index, job in enumerate(jobs, start=1):
        if not isinstance(job, dict):
            sys.exit("batch job %d is not an object" % index)
        prompt = job.get("prompt")
        out = job.get("out")
        width = job.get("width", args.width)
        height = job.get("height", args.height)
        seed = job.get("seed", args.seed)
        if not isinstance(prompt, str) or not prompt or not isinstance(out, str) or not out:
            sys.exit("batch job %d needs non-empty prompt and out strings" % index)
        if not isinstance(width, int) or not isinstance(height, int) or not isinstance(seed, int):
            sys.exit("batch job %d has invalid dimensions or seed" % index)
        parent = os.path.dirname(os.path.abspath(out))
        if parent:
            os.makedirs(parent, exist_ok=True)
        call = {
            "prompt": prompt,
            "height": height,
            "width": width,
            "num_inference_steps": args.steps,
            "guidance_scale": args.guidance,
            "generator": torch.Generator(device="cuda").manual_seed(seed),
        }
        image = job.get("image")
        if image:
            from PIL import Image
            call["image"] = [Image.open(image).convert("RGB")]
        pipe(**call).images[0].save(out)
        print("wrote %s (%d/%d)" % (out, index, len(jobs)), flush=True)


if __name__ == "__main__":
    main()
