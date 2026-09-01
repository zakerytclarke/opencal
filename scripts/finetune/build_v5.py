#!/usr/bin/env python3
"""Assemble the v5 fine-tune mix from the four ingredient datasets.

Sources (all already in the gram schema):
  1. v4 gram_text   (5 225 rows, USDA/synth)
  2. v4 gram_image  (2 006 rows, N5k gold)
  3. Food-101 gram_image  (GPT-5.5 labels on realistic plates)
  4. Open Food Facts gram_text (brand + grams)

Train/val split: keep v4 val untouched, append F101 val and OFF val.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path


def read_jsonl(p: Path) -> list[dict]:
    rows = [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
    return rows


def write_jsonl(p: Path, rows: list[dict]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--v4-train", default="evals/data/finetune/gram-v4/train.jsonl")
    ap.add_argument("--v4-val", default="evals/data/finetune/gram-v4/val.jsonl")
    ap.add_argument("--f101-train", default="evals/data/food101/train.jsonl")
    ap.add_argument("--f101-val", default="evals/data/food101/val.jsonl")
    ap.add_argument("--off-train", default="evals/data/finetune/gram-v5/off_text.jsonl")
    ap.add_argument("--out-dir", default="evals/data/finetune/gram-v5")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    out_dir = Path(args.out_dir)

    v4_train = read_jsonl(Path(args.v4_train))
    v4_val   = read_jsonl(Path(args.v4_val))           # may be empty/missing

    from collections import Counter
    v4_mix = Counter(r["task"] for r in v4_train)
    print(f"v4 train: {len(v4_train)} rows  {dict(v4_mix)}")
    if v4_val:
        print(f"v4 val:   {len(v4_val)} rows")

    f101_train = []
    f101_val   = read_jsonl(Path(args.f101_val)) if Path(args.f101_val).exists() else []
    # F101 train already built by label_food101.py
    if Path(args.f101_train).exists():
        f101_train = read_jsonl(Path(args.f101_train))
    else:
        print("F101 train.jsonl missing — will be built by label_food101.py --no-build after labels done")
    print(f"f101:   train={len(f101_train)} val={len(f101_val)}")

    off = read_jsonl(Path(args.off_train))
    print(f"off:    {len(off)} text rows")

    # Combine + shuffle
    all_train = v4_train + f101_train + off
    rng.shuffle(all_train)
    all_val   = (v4_val or []) + f101_val
    rng.shuffle(all_val)

    train_path = out_dir / "train.jsonl"
    val_path   = out_dir / "val.jsonl"
    write_jsonl(train_path, all_train)
    write_jsonl(val_path,   all_val)

    final_mix = Counter(r["task"] for r in all_train)
    print(f"\nv5 train: {len(all_train)} rows  {dict(final_mix)}")
    print(f"v5 val:   {len(all_val)} rows")
    print(f"  → {train_path}")
    print(f"  → {val_path}")


if __name__ == "__main__":
    main()
