#!/usr/bin/env python3
"""Compare baseline vs fine-tuned extract→USDA nutrition (kcal + macros)."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load(path: Path):
    return json.loads(path.read_text())


def pct(x) -> str:
    if x is None:
        return "n/a"
    return f"{100 * x:.1f}%"


def num(x, digits=1) -> str:
    if x is None:
        return "n/a"
    return f"{x:.{digits}f}"


def delta(a, b, lower_better=False) -> str:
    if a is None or b is None:
        return "n/a"
    d = b - a
    better = (d < 0) if lower_better else (d > 0)
    arrow = "improved" if better else ("worse" if d != 0 else "same")
    return f"{d:+.1f} ({arrow})"


def delta_pp(a, b, lower_better=False) -> str:
    if a is None or b is None:
        return "n/a"
    d = (b - a) * 100
    better = (d < 0) if lower_better else (d > 0)
    arrow = "improved" if better else ("worse" if d != 0 else "same")
    return f"{d:+.1f} pp ({arrow})"


def slice_of(doc: dict, name: str) -> dict:
    summary = doc.get("summary") or {}
    if name in summary:
        return summary[name]
    return {}


def kcal_table(before: dict, after: dict, slices: list[tuple[str, str]]) -> list[str]:
    lines = [
        "| slice | n | kcal MAE | median AE | WAPE | median rel. | within 20% | within 50% | ≥50 kcal within 20% |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for title, key in slices:
        b, a = slice_of(before, key), slice_of(after, key)
        if not a and not b:
            continue
        n = (a or b).get("n", 0)
        lines.append(
            f"| {title} | {n} "
            f"| {num(b.get('kcalMae'))} → **{num(a.get('kcalMae'))}** "
            f"| {num(b.get('kcalMdae'))} → {num(a.get('kcalMdae'))} "
            f"| {pct(b.get('kcalWape'))} → **{pct(a.get('kcalWape'))}** "
            f"| {pct(b.get('kcalMdape'))} → {pct(a.get('kcalMdape'))} "
            f"| {pct(b.get('within20'))} → {pct(a.get('within20'))} "
            f"| {pct(b.get('within50'))} → {pct(a.get('within50'))} "
            f"| {pct(b.get('within20Meal'))} → {pct(a.get('within20Meal'))} |"
        )
    return lines


def macro_table(before: dict, after: dict, key: str) -> list[str]:
    b, a = slice_of(before, key), slice_of(after, key)
    lines = [
        "| nutrient | MAE before | MAE after | WAPE before | WAPE after | median rel. before | median rel. after |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for label, field, unit in (("kcal", None, "kcal"), ("protein", "protein", "g"), ("carbs", "carbs", "g"), ("fat", "fat", "g")):
        if field is None:
            lines.append(
                f"| kcal | {num(b.get('kcalMae'))} {unit} | **{num(a.get('kcalMae'))} {unit}** "
                f"| {pct(b.get('kcalWape'))} | **{pct(a.get('kcalWape'))}** "
                f"| {pct(b.get('kcalMdape'))} | {pct(a.get('kcalMdape'))} |"
            )
            continue
        bn, an = b.get(field) or {}, a.get(field) or {}
        lines.append(
            f"| {label} | {num(bn.get('mae'))} {unit} | **{num(an.get('mae'))} {unit}** "
            f"| {pct(bn.get('wape'))} | **{pct(an.get('wape'))}** "
            f"| {pct(bn.get('mdape'))} | {pct(an.get('mdape'))} |"
        )
    return lines


def change_table(b: dict, a: dict) -> list[str]:
    bp, ap = b.get("protein") or {}, a.get("protein") or {}
    bc, ac = b.get("carbs") or {}, a.get("carbs") or {}
    bf, af = b.get("fat") or {}, a.get("fat") or {}
    return [
        "| metric | original | fine-tuned | change |",
        "|---|---:|---:|---|",
        f"| kcal MAE | {num(b.get('kcalMae'))} | {num(a.get('kcalMae'))} | {delta(b.get('kcalMae'), a.get('kcalMae'), True)} |",
        f"| kcal median AE | {num(b.get('kcalMdae'))} | {num(a.get('kcalMdae'))} | {delta(b.get('kcalMdae'), a.get('kcalMdae'), True)} |",
        f"| kcal WAPE | {pct(b.get('kcalWape'))} | {pct(a.get('kcalWape'))} | {delta_pp(b.get('kcalWape'), a.get('kcalWape'), True)} |",
        f"| kcal median relative error | {pct(b.get('kcalMdape'))} | {pct(a.get('kcalMdape'))} | {delta_pp(b.get('kcalMdape'), a.get('kcalMdape'), True)} |",
        f"| within 20% of gold kcal | {pct(b.get('within20'))} | {pct(a.get('within20'))} | {delta_pp(b.get('within20'), a.get('within20'))} |",
        f"| within 50% of gold kcal | {pct(b.get('within50'))} | {pct(a.get('within50'))} | {delta_pp(b.get('within50'), a.get('within50'))} |",
        f"| meals ≥50 kcal within 20% | {pct(b.get('within20Meal'))} | {pct(a.get('within20Meal'))} | {delta_pp(b.get('within20Meal'), a.get('within20Meal'))} |",
        f"| protein MAE (g) | {num(bp.get('mae'))} | {num(ap.get('mae'))} | {delta(bp.get('mae'), ap.get('mae'), True)} |",
        f"| carbs MAE (g) | {num(bc.get('mae'))} | {num(ac.get('mae'))} | {delta(bc.get('mae'), ac.get('mae'), True)} |",
        f"| fat MAE (g) | {num(bf.get('mae'))} | {num(af.get('mae'))} | {delta(bf.get('mae'), af.get('mae'), True)} |",
        f"| name accuracy (secondary) | {pct(b.get('namedAcc'))} | {pct(a.get('namedAcc'))} | {delta_pp(b.get('namedAcc'), a.get('namedAcc'))} |",
    ]


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--before", default=str(ROOT / "evals/results/ft-base-n5k20.json"))
    p.add_argument("--after", default=str(ROOT / "evals/results/ft-n5k20.json"))
    p.add_argument("--out", default=str(ROOT / "evals/results/ft-compare.md"))
    args = p.parse_args()

    before = load(Path(args.before))
    after = load(Path(args.after))
    b_n5k, a_n5k = slice_of(before, "n5k"), slice_of(after, "n5k")

    lines = [
        "# Original vs fine-tuned: meal nutrition on photos",
        "",
        "Same 20% Nutrition5k test (409 plates, seed `opencal-n5k-eval-v2`).",
        "The VLM only names foods and household portions. Calories and macros come from the host USDA map + `convert_portion`.",
        "Gold is Nutrition5k **dish totals** (weighed ingredients: kcal, protein, carbs, fat) — not a household USDA guess and not name accuracy.",
        "",
        "## Why these metrics",
        "",
        "- **MAE** is mean |pred − gold| in kcal or grams. This is the number that matters for a diary.",
        "- **WAPE** is total absolute error / total gold across the set. Unlike mean % error, a 5 kcal snack does not explode the score.",
        "- **Median relative error** is the typical plate’s |pred − gold| / gold.",
        "- **Within 20% / 50%** is how often the logged meal is close enough to be useful.",
        "",
        "## Nutrition5k 20% (primary)",
        "",
        *change_table(b_n5k, a_n5k),
        "",
        "## kcal by slice",
        "",
        *kcal_table(
            before,
            after,
            [
                ("N5k 20%", "n5k"),
                ("N5k singles", "n5kSingles"),
                ("N5k mixed", "n5kMixed"),
                ("Fixtures", "fixture"),
                ("Text", "text"),
            ],
        ),
        "",
        "## Macros on the 20% image test",
        "",
        *macro_table(before, after, "n5k"),
        "",
        "## What this means",
        "",
        "The original model is not a calorie estimator. It counts pieces and the host maps those to full USDA servings, so a handful of almonds becomes thousands of kcal. Fine-tuning is the difference between unusable and in-the-ballpark.",
        "",
        "The fine-tune is still not accurate enough to trust as a food scale. Median plate is off by ~87% relative, and only about 9% of meals ≥50 kcal land within 20% of the weighed dish. The leftover error is portion size: the model emits household units (1 apple, 1 slice) while Nutrition5k gold is grams on the scale, including oil the camera barely sees.",
        "",
        "Name accuracy is not the product metric. A correctly named food with the wrong portion is still a wrong diary entry.",
    ]
    Path(args.out).write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
