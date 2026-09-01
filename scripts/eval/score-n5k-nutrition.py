#!/usr/bin/env python3
"""Score predicted name+grams against N5k lab nutrition gold, the way the app actually computes it.

The production path never uses the model's raw output grams for calories.
It maps name -> USDA/FNDDS row -> grams -> scaleNutrition(grams) = per-100g * grams/100.
This script reproduces exactly that: for each predicted item it finds the best
USDA row (by name/alias), takes its per-100g kcal/protein/carbs/fat, and scales
by the item's grams. The plate pred is the sum over items. We then compare the
plate kcal + macros to the lab dish totals (row.nutrition).

Gold = row.nutrition (lab kcal + macros). This is the apples-to-apples number
the user cares about. Run for base / v6 / GPT-5.5 predictions to compare.

Usage:
  python scripts/eval/score-n5k-nutrition.py \
    --preds evals/data/finetune/preds/v6-n5k/extracts.json \
    --split evals/splits/images.n5k.json \
    --out evals/results/n5k-nutrition-v6.json
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
    ps, gs = p.rstrip("s"), g.rstrip("s")
    return ps == gs or gs in p or ps in g


def build_usda_map(foods: list[dict]) -> dict[str, dict[str, float]]:
    """Norm-keyed map -> per-100g kcal/protein/carbs/fat for the best row of a name."""
    m: dict[str, dict[str, float]] = {}
    for f in foods:
        rec = {
            "kcal": float(f.get("kcal") or 0),
            "protein": float(f.get("protein") or 0),
            "carbs": float(f.get("carbs") or 0),
            "fat": float(f.get("fat") or 0),
            "id": f.get("id"),
            "name": f.get("name"),
        }
        for key in [norm(f.get("name") or ""), *map(norm, f.get("aliases") or [])]:
            if key:
                m[key] = rec
    return m


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preds", required=True, help="extracts.json list with id + items[{name,grams}]")
    ap.add_argument("--split", default=str(ROOT / "evals/splits/images.n5k.json"))
    ap.add_argument("--foods", default=str(ROOT / "public/foods.json"))
    ap.add_argument("--out", default="", help="optional per-row dump")
    args = ap.parse_args()

    preds = {r["id"]: r for r in json.loads(Path(args.preds).read_text())}
    gold = {t["id"]: t for t in json.loads(Path(args.split).read_text())["test"]}
    usda = build_usda_map(json.loads(Path(args.foods).read_text())["foods"])

    def lookup(name: str) -> dict[str, float] | None:
        n = norm(name)
        if n in usda:
            return usda[n]
        for key, rec in usda.items():
            if name_match(n, key):
                return rec
        return None

    rows = []
    n_unmatched_items = 0
    for rid, t in gold.items():
        p = preds.get(rid)
        if not p:
            continue
        g = t.get("nutrition") or {}
        gkcal = g.get("kcal") or 0
        if gkcal <= 0:
            continue
        items = p.get("items") or []
        pkcal = pprotein = pcarbs = pfat = 0.0
        matched_items = 0
        for it in items:
            try:
                grams = float(it.get("grams"))
            except (TypeError, ValueError):
                grams = 0.0
            if grams <= 0:
                continue
            rec = lookup(it.get("name") or "")
            if rec is None:
                n_unmatched_items += 1
                continue
            f = grams / 100.0
            pkcal += rec["kcal"] * f
            pprotein += rec["protein"] * f
            pcarbs += rec["carbs"] * f
            pfat += rec["fat"] * f
            matched_items += 1

        rows.append(
            {
                "id": rid,
                "matched_items": matched_items,
                "n_items": len(items),
                "pred_kcal": round(pkcal),
                "gold_kcal": round(gkcal),
                "pred_protein": round(pprotein, 1),
                "gold_protein": round(g.get("protein") or 0, 1),
                "pred_carbs": round(pcarbs, 1),
                "gold_carbs": round(g.get("carbs") or 0, 1),
                "pred_fat": round(pfat, 1),
                "gold_fat": round(g.get("fat") or 0, 1),
                "kcal_ape": abs(pkcal - gkcal) / gkcal if gkcal else 0.0,
            }
        )

    if not rows:
        print("no scored rows")
        return

    def nutrient(pred_key, gold_key):
        ps = [r[pred_key] for r in rows]
        gs = [r[gold_key] for r in rows]
        mae = statistics.mean(abs(p - g) for p, g in zip(ps, gs))
        ape = [abs(p - g) / g for p, g in zip(ps, gs) if g > 0]
        wape = sum(abs(p - q) for p, q in zip(ps, gs)) / sum(gs) if sum(gs) else 0.0
        within50 = sum(1 for a in ape if a < 0.5) / len(ape) if ape else 0.0
        return {"mae": round(mae, 1), "mape_pct": round(statistics.mean(ape) * 100, 1) if ape else 0.0,
                "wape_pct": round(wape * 100, 1), "within50_pct": round(within50 * 100, 1)}

    kcal_apes = [r["kcal_ape"] for r in rows]
    ratios = [r["pred_kcal"] / r["gold_kcal"] for r in rows if r["gold_kcal"]]
    print(f"model               : {Path(args.preds).parent.name}")
    print(f"scored plates       : {len(rows)}")
    print(f"unmatched items     : {n_unmatched_items}")
    print(f"mean items/plate    : {statistics.mean(r['n_items'] for r in rows):.2f}  matched {statistics.mean(r['matched_items'] for r in rows):.2f}")
    print()
    print("calories (primary)")
    print(f"  MAE               : {statistics.mean(abs(r['pred_kcal']-r['gold_kcal']) for r in rows):.0f} kcal  "
          f"median {statistics.median(abs(r['pred_kcal']-r['gold_kcal']) for r in rows):.0f}")
    print(f"  MAPE              : {statistics.mean(kcal_apes)*100:.1f}%   median {statistics.median(kcal_apes)*100:.1f}%")
    print(f"  WAPE (sum-weight) : {sum(abs(r['pred_kcal']-r['gold_kcal']) for r in rows)/sum(r['gold_kcal'] for r in rows)*100:.1f}%")
    print(f"  |err|<50%         : {sum(1 for a in kcal_apes if a<0.5)/len(kcal_apes)*100:.1f}%   <30%: {sum(1 for a in kcal_apes if a<0.3)/len(kcal_apes)*100:.1f}%")
    print(f"  pred/gold ratio   : mean {statistics.mean(ratios):.2f}  median {statistics.median(ratios):.2f}")
    print()
    print("macros (g per plate)")
    for pk, gk in [("pred_protein","gold_protein"),("pred_carbs","gold_carbs"),("pred_fat","gold_fat")]:
        s = nutrient(pk, gk)
        label = pk[len('pred_')].capitalize()
        print(f"  {label:<7} MAE {s['mae']:>6} g   MAPE {s['mape_pct']:>5}%   within50 {s['within50_pct']:>5}%")
    worst = sorted(rows, key=lambda r: -r["kcal_ape"])[:10]
    print("\nworst 10 (kcal APE):")
    for r in worst:
        print(f"  {r['id']}  {r['matched_items']}/{r['n_items']}  pred {r['pred_kcal']:>5}  gold {r['gold_kcal']:>5}  {r['kcal_ape']*100:.0f}%")
    if args.out:
        Path(args.out).write_text(json.dumps(rows, indent=2) + "\n")
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
