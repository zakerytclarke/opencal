#!/usr/bin/env python3
"""Score single-pass gram predictions against N5k gold (mass ratio).

N5k gold has per-item gram totals but no per-item kcal density; plate-level
gold is the weighed dish total. We assume ~uniform kcal/100g within a plate,
so predicted plate kcal = gold plate kcal * (pred grams / gold grams) for
matched foods. This isolates gram accuracy: a model that nails grams scores
~100% regardless of food density.
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


def name_match(pred: str, gold: str) -> bool:
    p, g = norm(pred), norm(gold)
    if not p or not g:
        return False
    if p == g or p in g or g in p:
        return True
    if p.rstrip("s") == g.rstrip("s") or g.rstrip("s") in p or p.rstrip("s") in g:
        return True
    return False


def gold_grams(expect: dict) -> float | None:
    """Grams for a gold expect entry (unit g, or ~70g for medium/large pieces)."""
    try:
        q = float(expect.get("quantity"))
    except (TypeError, ValueError):
        q = 1.0
    unit = (expect.get("unit") or "g").lower()
    if unit in ("g", "gram", "grams"):
        return q
    if unit == "slice":
        return q * 60.0
    if unit in ("medium", "large"):
        return q * (90.0 if unit == "large" else 70.0)
    return q


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preds", required=True)
    ap.add_argument("--split", default=str(ROOT / "evals/splits/images.n5k.json"))
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    preds = {r["id"]: r for r in json.loads(Path(args.preds).read_text())}
    gold = json.loads(Path(args.split).read_text())["test"]

    rows = []
    for t in gold:
        tid = t["id"]
        p = preds.get(tid)
        if not p:
            continue
        items = p.get("items") or []
        expect = t.get("expect") or []
        gold_n = (t.get("nutrition") or {}).get("kcal")
        if not gold_n:
            continue

        gold_total_g = 0.0
        gmap: list[tuple[str, float]] = [(e, g) for e in expect if (g := gold_grams(e)) and g > 0]
        gold_total_g = sum(g for _, g in gmap)
        if gold_total_g <= 0:
            continue

        used = [False] * len(gmap)
        pred_matched_g = 0.0
        unmatched_pred = 0
        for it in items:
            try:
                grams = float(it.get("grams"))
            except (TypeError, ValueError):
                grams = -1
            name = it.get("name") or ""
            hit = None
            for j, (e, g) in enumerate(gmap):
                if used[j]:
                    continue
                if name_match(name, e.get("query") or "") or any(name_match(name, a) for a in e.get("aliases", [])):
                    hit = j
                    break
            if hit is None:
                if grams > 0:
                    unmatched_pred += 1
                continue
            used[hit] = True
            pred_matched_g += max(grams, 0.0)

        if pred_matched_g <= 0:
            continue
        pred_kcal = gold_n * (pred_matched_g / gold_total_g)
        ape = abs(pred_kcal - gold_n) / gold_n
        rows.append(
            {
                "id": tid,
                "n_items": len(items),
                "matched": sum(used),
                "pred_g": round(pred_matched_g),
                "gold_g": round(gold_total_g),
                "ratio": round(pred_matched_g / gold_total_g, 2),
                "pred_kcal": round(pred_kcal),
                "gold_kcal": round(gold_n),
                "ape": ape,
            }
        )

    apes = [r["ape"] for r in rows]
    if not apes:
        print("no scored rows")
        return
    print(f"scored plates           : {len(rows)}")
    print(f"meal MAPE (gram model)  : {statistics.mean(apes)*100:.1f}%")
    print(f"median APE              : {statistics.median(apes)*100:.1f}%")
    print(f"|err|<30%               : {sum(1 for a in apes if a<0.30)/len(apes)*100:.1f}%")
    ratios = [r["ratio"] for r in rows]
    print(f"pred/gold mass ratio    : mean {statistics.mean(ratios):.2f}  median {statistics.median(ratios):.2f}")
    worst = sorted(rows, key=lambda r: -r["ape"])[:10]
    print("\nworst 10:")
    for r in worst:
        print(f"  {r['id']}  ratio {r['ratio']:>6}  pred {r['pred_kcal']:>5}  gold {r['gold_kcal']:>5}  err {r['ape']*100:.0f}%")
    if args.out:
        Path(args.out).write_text(json.dumps(rows, indent=2) + "\n")
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
