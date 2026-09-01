#!/usr/bin/env python3
"""Score Food-101 LFM predictions against GPT-5.5 teacher labels.

Measures "closeness to teacher" (not true mass) because F101 has no weighed gold.
Per-plate metrics (same plate-matching as score-grams.py):
  - MAE (grams) = mean |plate_pred_g - plate_gold_g|
  - MAPE        = mean |ape_plate|  where ape_plate = |delta|/plate_gold_g

Name matching uses the same fuzzy substring matcher as score-grams.py.
Unmatched teacher items (pred missed them) count fully toward the
plate error — this is deliberate, so the model is not rewarded for
guessing one item well and skipping the rest.

Usage:
  python scripts/eval/score-f101-grams.py \
    --preds evals/data/finetune/preds/lfm-v6-f101/extracts.json \
    --labels evals/data/food101/test.jsonl
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def norm(s: str) -> str:
    s = re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower()).strip()
    return re.sub(r"\s+", " ", s)


def name_match(a: str, b: str) -> bool:
    x, y = norm(a), norm(b)
    if not x or not y:
        return False
    if x == y or x in y or y in x:
        return True
    if x.rstrip("s") == y.rstrip("s") or y.rstrip("s") in x or x.rstrip("s") in y:
        return True
    return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preds", required=True,
                    help="extracts.json with per-id 'items' [{name, grams, ...}]")
    ap.add_argument("--labels", default="evals/data/food101/test.jsonl",
                    help="Ground-truth F101 test rows (meta.gold_foods)")
    ap.add_argument("--out", default="", help="optional scored-plates json dump")
    args = ap.parse_args()

    preds = {r["id"]: r for r in json.loads(Path(args.preds).read_text())}
    labels = [json.loads(l) for l in Path(args.labels).read_text().splitlines() if l.strip()]

    rows = []
    for lab in labels:
        rid = lab.get("id") or (lab.get("meta") or {}).get("id")
        p = preds.get(rid)
        if not p:
            continue
        items = p.get("items") or []
        gold = (lab.get("meta") or {}).get("gold_foods") or []
        gold_total = sum(max(0, float(f.get("grams") or 0)) for f in gold)
        if gold_total <= 0:
            continue

        # Greedy name-match pred items to gold items.
        used = [False] * len(gold)
        pred_matched_g = 0.0
        matched_count = 0
        for it in items:
            try:
                g = float(it.get("grams"))
            except (TypeError, ValueError):
                g = 0.0
            name = it.get("name") or ""
            hit = None
            for j, gf in enumerate(gold):
                if used[j]:
                    continue
                if name_match(name, gf.get("name", "")):
                    hit = j
                    break
            if hit is None:
                continue
            used[hit] = True
            pred_matched_g += max(g, 0.0)
            matched_count += 1

        pred_total = pred_matched_g  # matched subset only
        err = abs(pred_total - gold_total)
        ape = err / gold_total
        rows.append({
            "id": rid,
            "n_items_pred": len(items),
            "n_items_gold": len(gold),
            "matched": matched_count,
            "pred_g": round(pred_total, 1),
            "gold_g": round(gold_total, 1),
            "err_g": round(err, 1),
            "ape": round(ape, 4),
        })

    if not rows:
        print("no scored rows")
        return

    mae_g = statistics.mean(r["err_g"] for r in rows)
    mape = statistics.mean(r["ape"] for r in rows)
    med_mae = statistics.median(r["err_g"] for r in rows)
    within50 = sum(1 for r in rows if r["ape"] < 0.5) / len(rows)
    ratio = statistics.mean(r["pred_g"] / r["gold_g"] for r in rows)

    print(f"scored plates     : {len(rows)}")
    print(f"MAE (grams)       : {mae_g:.1f} g    median {med_mae:.1f} g")
    print(f"MAPE              : {mape*100:.1f}%")
    print(f"|err|<50%         : {within50*100:.1f}%")
    print(f"pred/gold ratio   : mean {ratio:.2f}")
    worst = sorted(rows, key=lambda r: -r["ape"])[:10]
    print("\nworst 10:")
    for r in worst:
        print(f"  {r['id']}  matched {r['matched']}/{r['n_items_gold']}  "
              f"pred {r['pred_g']:>5}  gold {r['gold_g']:>5}  err {r['err_g']:>5}  pe {r['ape']*100:.0f}%")

    if args.out:
        Path(args.out).write_text(json.dumps(rows, indent=2) + "\n")
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
