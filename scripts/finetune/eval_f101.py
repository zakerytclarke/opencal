#!/usr/bin/env python3
"""LFM single-pass grams inference on Food-101 test set.

Writes preds to evals/data/finetune/preds/<tag>/extracts.json in the same
format as infer.py (id, modality=image, items=[{name, brand, grams, ...}]).

Uses GRAM_SYSTEM + GRAM_IMAGE_USER prompts, matches training rows.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch
from PIL import Image
from transformers import AutoModelForImageTextToText, AutoProcessor

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from prompts import GRAM_IMAGE_USER, GRAM_SYSTEM  # noqa
from infer import EXTRACT_PREFIX, generate, parse_foods  # noqa


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="LiquidAI/LFM2.5-VL-450M")
    ap.add_argument("--tag", required=True)
    ap.add_argument("--split", default="evals/data/food101/test.jsonl")
    ap.add_argument("--out", default="")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    out_dir = Path(args.out) if args.out else Path("evals/data/finetune/preds") / args.tag
    out_dir.mkdir(parents=True, exist_ok=True)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"loading {args.model} on {device}", flush=True)
    processor = AutoProcessor.from_pretrained(args.model, trust_remote_code=True, max_image_tokens=256)
    model = AutoModelForImageTextToText.from_pretrained(
        args.model,
        dtype=torch.bfloat16 if device.type == "cuda" else torch.float32,
        device_map="auto" if device.type == "cuda" else None,
        trust_remote_code=True,
    )
    model.eval()

    rows = [json.loads(l) for l in Path(args.split).read_text().splitlines() if l.strip()]
    if args.limit:
        rows = rows[: args.limit]

    extracts = []
    for i, lab in enumerate(rows, 1):
        img_path = ROOT / lab["image"]
        if not img_path.exists():
            extracts.append({"id": lab["meta"]["id"], "modality": "image", "raw": "", "items": [],
                             "error": f"missing {img_path}"})
            continue
        img = Image.open(img_path).convert("RGB")
        messages = [
            {"role": "system", "content": [{"type": "text", "text": GRAM_SYSTEM}]},
            {"role": "user", "content": [
                {"type": "image", "image": img},
                {"type": "text", "text": GRAM_IMAGE_USER},
            ]},
        ]
        try:
            raw = generate(model, processor, messages, 220, device, EXTRACT_PREFIX)
            foods = parse_foods(raw)
            for f in foods:
                if f.get("grams") is None:
                    f["grams"] = None
            extracts.append({
                "id": lab["meta"]["id"],
                "modality": "image",
                "raw": raw,
                "items": foods,
                "path": lab["image"],
            })
            print(f"{i}/{len(rows)} {lab['meta']['id']} -> {[f.get('name') for f in foods]}", flush=True)
        except Exception as e:
            extracts.append({"id": lab["meta"]["id"], "modality": "image", "raw": "", "items": [],
                             "error": str(e)})
            print(f"{i}/{len(rows)} ERR {e}", flush=True)

    (out_dir / "extracts.json").write_text(json.dumps(extracts, indent=2) + "\n")
    print(f"wrote {out_dir / 'extracts.json'}")


if __name__ == "__main__":
    main()
