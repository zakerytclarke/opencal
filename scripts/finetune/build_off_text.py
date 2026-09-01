#!/usr/bin/env python3
"""Build gram_text rows from Open Food Facts package_weights (brand + grams).

Each OFF row becomes one gram_text training example:
  user:  "Meal:\nI ate a pack of <Brand> <Product Name>\n<GRAM_TEXT_USER>"
  asst:  {"foods":[{"name":"<name lower>","brand":"<brand>","grams":<qty>}] }

This adds brand-aware gram estimation to the fine-tune mix — the gap that
v4 misses (N5k and Food-101 have no brand signal).
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, "scripts/finetune")
from prompts import GRAM_SYSTEM, GRAM_TEXT_USER  # type: ignore


def build_off_rows(sample_path: Path, out_path: Path, n: int, seed: int = 42) -> None:
    rows = [json.loads(l) for l in sample_path.read_text().splitlines() if l.strip()]
    rng = random.Random(seed)
    rng.shuffle(rows)
    rows = rows[:n]

    out_rows = []
    for r in rows:
        name = (r.get("product_name") or [""])[0].strip().lower()
        brand = (r.get("brands_tags") or [""])[0].strip().lower()
        if not name or not brand:
            continue
        qty = int(round(r.get("product_quantity") or 0))
        if qty < 5 or qty > 1000:
            qty = max(5, min(1000, qty))
        meal = f"I ate a pack of {brand.title()} {name.title()}"
        out_rows.append({
            "task": "gram_text",
            "image": None,
            "messages": [
                {"role": "system", "content": GRAM_SYSTEM},
                {"role": "user", "content": GRAM_TEXT_USER.format(meal=meal)},
                {
                    "role": "assistant",
                    "content": json.dumps({"foods": [{"name": name, "brand": brand, "grams": qty}]}),
                },
            ],
            "meta": {"id": f"off-{r['code']}", "brand": brand, "grams": qty, "source": "off-package-gram"},
        })

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        for r in out_rows:
            f.write(json.dumps(r) + "\n")
    print(f"OFF text rows: {len(out_rows)} → {out_path}", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", default="evals/data/off/sample.jsonl")
    ap.add_argument("--out", default="evals/data/finetune/gram-v5/off_text.jsonl")
    ap.add_argument("--n", type=int, default=6000)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    build_off_rows(Path(args.sample), Path(args.out), args.n, args.seed)
