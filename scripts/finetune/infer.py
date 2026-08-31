#!/usr/bin/env python3
"""Run a checkpoint on held-out OpenCal splits (extract + coach)."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import torch
from PIL import Image
from transformers import AutoModelForImageTextToText, AutoProcessor

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from prompts import (  # noqa: E402
    COACH_SYSTEM,
    EXTRACT_SYSTEM,
    EXTRACT_USER,
    PHOTO_EXTRACT_SYSTEM,
    PHOTO_EXTRACT_USER,
)

EXTRACT_PREFIX = '{"foods":['


def load_json(path: Path):
    return json.loads(path.read_text())


def parse_foods(text: str) -> list[dict]:
    cleaned = re.sub(r"<\|[^>]+?\|>", "", text).strip()
    blobs = []
    if "{" in cleaned and "}" in cleaned:
        blobs.append(cleaned[cleaned.index("{") : cleaned.rindex("}") + 1])
    blobs.append(cleaned)
    for blob in blobs:
        try:
            obj = json.loads(blob)
        except json.JSONDecodeError:
            blob2 = re.sub(r",(\s*[}\]])", r"\1", blob)
            try:
                obj = json.loads(blob2)
            except json.JSONDecodeError:
                continue
        rows = obj if isinstance(obj, list) else (obj.get("foods") or obj.get("items") or [])
        foods = []
        for row in rows:
            if isinstance(row, str) and row.strip():
                foods.append({"name": row.strip(), "brand": None, "quantity": 1, "unit": None})
                continue
            if not isinstance(row, dict):
                continue
            name = (row.get("name") or row.get("query") or row.get("food") or "").strip()
            if not name:
                continue
            qty = row.get("quantity") or 1
            try:
                qty = float(qty)
            except (TypeError, ValueError):
                qty = 1
            unit = row.get("unit")
            if unit in ("null", "none", ""):
                unit = None
            foods.append({"name": name, "brand": row.get("brand"), "quantity": qty, "unit": unit})
        if foods:
            return foods
    return parse_numbered(cleaned)


def parse_numbered(text: str) -> list[dict]:
    foods = []
    for m in re.finditer(r"(?:^|\n)\s*(?:\d+[.)]\s+|[-*•]\s+)([^\n]+)", text):
        name = re.sub(r"\s*\([^)]*\)\s*", " ", m.group(1)).strip()
        if not name or len(name) > 48:
            continue
        if re.search(r"\b(background|plate|cutting board|table|utensil)\b", name, re.I):
            continue
        qty = 1.0
        qm = re.match(r"^(\d+(?:\.\d+)?)\s+(.+)$", name)
        if qm:
            qty = float(qm.group(1))
            name = qm.group(2)
        foods.append({"name": name, "brand": None, "quantity": qty, "unit": None})
    return foods


@torch.inference_mode()
def generate(model, processor, messages: list[dict], max_new: int, device, prefix: str = "") -> str:
    encoded = processor.apply_chat_template(
        messages,
        add_generation_prompt=True,
        tokenize=True,
        return_dict=True,
        return_tensors="pt",
    )
    encoded = {k: v.to(device) if torch.is_tensor(v) else v for k, v in encoded.items()}
    if prefix:
        tok = processor.tokenizer
        extra = tok.encode(prefix, add_special_tokens=False, return_tensors="pt").to(device)
        if extra.dim() == 1:
            extra = extra.unsqueeze(0)
        encoded["input_ids"] = torch.cat([encoded["input_ids"], extra], dim=1)
        if "attention_mask" in encoded:
            extra_mask = torch.ones(extra.shape, dtype=encoded["attention_mask"].dtype, device=device)
            encoded["attention_mask"] = torch.cat([encoded["attention_mask"], extra_mask], dim=1)
    out = model.generate(
        **encoded,
        max_new_tokens=max_new,
        do_sample=False,
        repetition_penalty=1.05,
    )
    prompt_len = encoded["input_ids"].shape[-1]
    text = processor.batch_decode(out[:, prompt_len:], skip_special_tokens=True)[0]
    text = (text or "").strip()
    # Prefix tokens were already in the prompt; decode is only the continuation.
    if prefix:
        text = prefix + text
    return text


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True, help="HF id or local checkpoint")
    p.add_argument("--tag", default="run", help="Name for this eval (baseline, finetuned, …)")
    p.add_argument("--split", default="test")
    p.add_argument("--out", default="")
    p.add_argument("--limit", type=int, default=0)
    args = p.parse_args()

    out_dir = Path(args.out) if args.out else ROOT / "evals" / "data" / "finetune" / "preds" / args.tag
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

    text_split = load_json(ROOT / "evals/splits/text.json")
    image_split = load_json(ROOT / "evals/splits/images.json")
    coach_split = load_json(ROOT / "evals/splits/coach.json")
    text_rows = text_split[args.split]
    image_rows = image_split[args.split]
    if args.limit:
        text_rows = text_rows[: args.limit]
        image_rows = image_rows[: args.limit]

    extracts = []
    for row in text_rows:
        messages = [
            {"role": "system", "content": [{"type": "text", "text": EXTRACT_SYSTEM}]},
            {"role": "user", "content": [{"type": "text", "text": EXTRACT_USER.format(meal=row["text"])}]},
        ]
        raw = generate(model, processor, messages, 220, device, EXTRACT_PREFIX)
        items = parse_foods(raw)
        extracts.append({"id": row["id"], "modality": "text", "raw": raw, "items": items, "text": row["text"]})
        print(f"TEXT {row['id']} → {items or raw[:80]!r}", flush=True)

    for row in image_rows:
        path = ROOT / row["path"]
        if not path.exists():
            extracts.append({"id": row["id"], "modality": "image", "raw": "", "items": [], "error": f"missing {path}"})
            continue
        img = Image.open(path).convert("RGB")
        messages = [
            {"role": "system", "content": [{"type": "text", "text": PHOTO_EXTRACT_SYSTEM}]},
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": img},
                    {"type": "text", "text": PHOTO_EXTRACT_USER},
                ],
            },
        ]
        raw = generate(model, processor, messages, 220, device, EXTRACT_PREFIX)
        items = parse_foods(raw)
        extracts.append({"id": row["id"], "modality": "image", "raw": raw, "items": items, "path": row["path"]})
        print(f"IMAGE {row['id']} → {items or raw[:80]!r}", flush=True)

    coach = []
    for row in coach_split["test"]:
        messages = [
            {"role": "system", "content": [{"type": "text", "text": COACH_SYSTEM}]},
            {"role": "user", "content": [{"type": "text", "text": row["user"]}]},
        ]
        raw = generate(model, processor, messages, 180, device)
        coach.append({"id": row["id"], "user": row["user"], "raw": raw, "expect": row["expect"]})
        print(f"COACH {row['id']} → {raw[:100]!r}", flush=True)

    (out_dir / "extracts.json").write_text(json.dumps(extracts, indent=2) + "\n")
    (out_dir / "coach.json").write_text(json.dumps(coach, indent=2) + "\n")
    print(f"wrote {out_dir}")


if __name__ == "__main__":
    main()
