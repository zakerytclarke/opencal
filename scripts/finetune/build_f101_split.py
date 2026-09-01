#!/usr/bin/env python3
"""Split Food-101 GPT-5.5 labels into stratified train/test using the v4 row schema.

- Stratify by Food-101 class (2-3 per class into test, rest into train).
- Rows use the same shape as v4/val.jsonl: task=gram_image, image,
  messages=[system (GRAM), user (GRAM_IMAGE_USER), assistant (JSON foods)].
- meta.gold_foods keeps the teacher label for scoring.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from prompts import GRAM_IMAGE_USER, GRAM_SYSTEM  # noqa


def read_jsonl(p: Path) -> list[dict]:
    return [json.loads(l) for l in Path(p).read_text().splitlines() if l.strip()]


def write_jsonl(p: Path, rows: list[dict]) -> None:
    Path(p).parent.mkdir(parents=True, exist_ok=True)
    with Path(p).open("w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def make_row(rec: dict) -> dict:
    foods = [
        {"name": f["name"], "brand": None, "grams": int(round(float(f["grams"])))}
        for f in rec["foods"]
    ]
    return {
        "task": "gram_image",
        "image": str(ROOT / rec["img"]),
        "messages": [
            {"role": "system", "content": GRAM_SYSTEM},
            {"role": "user", "content": GRAM_IMAGE_USER},
            {"role": "assistant", "content": json.dumps({"foods": foods})},
        ],
        "meta": {
            "id": rec["id"],
            "class": rec["class"],
            "source": "food101-gpt55",
            "gold_foods": [{"name": f["name"], "brand": None, "grams": f["grams"]} for f in rec["foods"]],
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--per-class-max", type=int, default=3,
                    help="Max test rows per class (default 3). 59 classes * 3 ~= 177.")
    args = ap.parse_args()

    labels = read_jsonl(ROOT / "evals" / "data" / "food101" / "labels.jsonl")
    rng = random.Random(args.seed)

    by_class: dict[int, list[dict]] = defaultdict(list)
    for r in labels:
        by_class[r["class"]].append(r)
    for c in by_class:
        rng.shuffle(by_class[c])

    test_rows, train_rows = [], []
    for c in sorted(by_class):
        rows = by_class[c]
        take = min(args.per_class_max, len(rows))
        test_rows.extend(rows[:take])
        train_rows.extend(rows[take:])
    rng.shuffle(test_rows)
    rng.shuffle(train_rows)

    test_path = ROOT / "evals" / "data" / "food101" / "test.jsonl"
    train_path = ROOT / "evals" / "data" / "food101" / "train.jsonl"
    write_jsonl(test_path, [make_row(r) for r in test_rows])
    write_jsonl(train_path, [make_row(r) for r in train_rows])

    print(f"labels:     {len(labels)}  classes={len(by_class)}")
    print(f"test rows:  {len(test_rows)}  (max_per_class={args.per_class_max})")
    print(f"train rows: {len(train_rows)}")
    print(f"  {test_path}")
    print(f"  {train_path}")


if __name__ == "__main__":
    main()
