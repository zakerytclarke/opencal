#!/usr/bin/env python3
"""Assemble v6 fine-tune mix: balanced F101-image + N5k-image, image-only.

Sources (all gram_image schema):
  1. F101 image train   — GPT-5.5 teacher-labeled realistic plates (from build_f101_split.py)
  2. N5k image train    — Nutrition 5K weighed gold (gram_image rows in v4)
  Val = v4 N5k image val (monitoring only; never F101 test).

Balanced: the larger image set is subsampled so both image sets are roughly equal.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read_jsonl(p) -> list[dict]:
    p = Path(p)
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]


def write_jsonl(p, rows: list[dict]) -> None:
    Path(p).parent.mkdir(parents=True, exist_ok=True)
    with Path(p).open("w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def is_n5k_image(row: dict) -> bool:
    return "n5k" in (row.get("image") or "")


def is_f101(row: dict) -> bool:
    return "food101" in (row.get("image") or "")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--f101-train", default="evals/data/food101/train.jsonl")
    ap.add_argument("--v4-train", default="evals/data/finetune/gram-v4/train.jsonl")
    ap.add_argument("--v4-val", default="evals/data/finetune/gram-v4/val.jsonl")
    ap.add_argument("--out-dir", default="evals/data/finetune/gram-v6")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    out_dir = Path(args.out_dir)

    f101 = read_jsonl(Path(args.f101_train))
    v4 = read_jsonl(Path(args.v4_train))
    v4_val = [r for r in read_jsonl(Path(args.v4_val)) if is_n5k_image(r)]

    n5k = [r for r in v4 if is_n5k_image(r)]
    print(f"f101 image train: {len(f101)}")
    print(f"n5k image train:  {len(n5k)}  (v4 total {len(v4)}, n5k_img + text)")
    print(f"val (n5k img):    {len(v4_val)}")

    # Balance: keep both image sets at the same size (subsample the larger).
    target = min(len(f101), len(n5k))
    if len(f101) > target:
        f101 = rng.sample(f101, target)
        print(f"[balance] subsampled f101 -> {target}")
    if len(n5k) > target:
        n5k = rng.sample(n5k, target)
        print(f"[balance] subsampled n5k -> {target}")

    all_train = f101 + n5k
    rng.shuffle(all_train)

    mix = Counter("f101" if is_f101(r) else "n5k" for r in all_train)
    print(f"\nv6 train: {len(all_train)} rows  {dict(mix)}  (f101={mix.get('f101',0)} n5k={mix.get('n5k',0)})")
    write_jsonl(out_dir / "train.jsonl", all_train)
    write_jsonl(out_dir / "val.jsonl", v4_val)
    print(f"wrote {out_dir / 'train.jsonl'}")
    print(f"wrote {out_dir / 'val.jsonl'}")


if __name__ == "__main__":
    main()
