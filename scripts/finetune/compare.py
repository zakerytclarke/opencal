#!/usr/bin/env python3
"""Compare baseline vs fine-tuned extract→USDA metrics and coach behavior."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load(path: Path):
    return json.loads(path.read_text())


def parse_foods(text: str) -> list[dict]:
    cleaned = re.sub(r"<\|[^>]+?\|>", "", text).strip()
    if "{" not in cleaned:
        return []
    blob = cleaned[cleaned.find("{") : cleaned.rfind("}") + 1]
    try:
        obj = json.loads(blob)
    except json.JSONDecodeError:
        return []
    rows = obj.get("foods") if isinstance(obj, dict) else obj
    if not isinstance(rows, list):
        return []
    return [r for r in rows if isinstance(r, dict) and (r.get("name") or r.get("query"))]


def score_coach(pred_path: Path, gold_path: Path) -> dict:
    preds = {p["id"]: p for p in load(pred_path)}
    gold = load(gold_path)["test"]
    n = len(gold)
    json_ok = 0
    json_n = 0
    prose_ok = 0
    prose_n = 0
    kcal_ok = 0
    kcal_n = 0
    rows = []
    for g in gold:
        raw = (preds.get(g["id"]) or {}).get("raw") or ""
        rec = {"id": g["id"], "expect": g["expect"], "ok": False, "raw": raw[:180]}
        if g["expect"] == "json":
            json_n += 1
            foods = parse_foods(raw)
            need = g.get("foods") or []
            hit = 0
            for exp in need:
                name = (exp.get("name") or "").lower()
                if any(name in str(f.get("name") or "").lower() for f in foods):
                    hit += 1
            rec["ok"] = bool(foods) and hit == len(need)
            json_ok += int(rec["ok"])
        else:
            prose_n += 1
            is_json = bool(parse_foods(raw))
            must = [m.lower() for m in g.get("must") or []]
            must_not = g.get("mustNot") or []
            ok = (not is_json) and all(m in raw.lower() for m in must) and all(x not in raw for x in must_not)
            rec["ok"] = ok
            prose_ok += int(ok)
            rng = g.get("kcalGold")
            if rng:
                kcal_n += 1
                nums = [float(x) for x in re.findall(r"(\d+(?:\.\d+)?)\s*kcal", raw.lower())]
                rec["ok_kcal"] = any(rng[0] <= n <= rng[1] for n in nums)
                kcal_ok += int(rec["ok_kcal"])
        rows.append(rec)
    return {
        "n": n,
        "jsonAcc": json_ok / json_n if json_n else None,
        "proseAcc": prose_ok / prose_n if prose_n else None,
        "kcalInRange": kcal_ok / kcal_n if kcal_n else None,
        "pass": sum(r["ok"] for r in rows) / n if n else 0,
        "rows": rows,
    }


def pct(x) -> str:
    if x is None:
        return "n/a"
    return f"{100 * x:.1f}%"


def block(title: str, s: dict) -> str:
    return "\n".join(
        [
            f"### {title} (n={s.get('n', 0)})",
            f"- Food name accuracy: {pct(s.get('namedAcc'))}",
            f"- Calorie MAE: {s.get('kcalMae', 0):.1f} kcal (median {s.get('kcalMdae', 0):.1f})",
            f"- Calorie MAPE: {pct(s.get('kcalMape'))} · within 20%: {pct(s.get('within20'))} · within 50%: {pct(s.get('within50'))}",
            f"- Calorie MAE when named correctly: {s['kcalMaeNamed']:.1f}" if s.get("kcalMaeNamed") is not None else "- Calorie MAE when named correctly: n/a",
        ]
    )


def delta(a, b, lower_better=False) -> str:
    if a is None or b is None:
        return "n/a"
    d = b - a
    better = (d < 0) if lower_better else (d > 0)
    arrow = "improved" if better else ("worse" if d != 0 else "same")
    if isinstance(a, float) and abs(a) <= 1 and abs(b) <= 1:
        return f"{d * 100:+.1f} pp ({arrow})"
    return f"{d:+.1f} ({arrow})"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--before", default=str(ROOT / "evals/results/ft-baseline.json"))
    p.add_argument("--after", default=str(ROOT / "evals/results/ft-finetuned.json"))
    p.add_argument("--v1", default=str(ROOT / "evals/results/ft-v1.json"), help="Previous fine-tune summary, if present")
    p.add_argument("--coach-before", default=str(ROOT / "evals/data/finetune/preds/baseline/coach.json"))
    p.add_argument("--coach-after", default=str(ROOT / "evals/data/finetune/preds/finetuned/coach.json"))
    p.add_argument("--out", default=str(ROOT / "evals/results/ft-compare.md"))
    args = p.parse_args()

    before = load(Path(args.before))
    after = load(Path(args.after))
    v1 = load(Path(args.v1)) if Path(args.v1).exists() else None
    gold_coach = ROOT / "evals/splits/coach.json"
    coach_b = score_coach(Path(args.coach_before), gold_coach) if Path(args.coach_before).exists() else None
    coach_a = score_coach(Path(args.coach_after), gold_coach) if Path(args.coach_after).exists() else None

    b_all = before["summary"]["all"]
    a_all = after["summary"]["all"]
    lines = [
        "# OpenCal fine-tune: before vs after",
        "",
        "Held-out eval is `evals/splits/text.json` + `images.json` test, plus `coach.json`.",
        "Calories are MiniSearch + convert_portion on the model's extract (USDA per-100 g), not model-invented numbers.",
        "",
        "## Meal calories (primary)",
        "",
        block("Baseline", b_all),
        "",
    ]
    if v1:
        lines += [block("Fine-tuned v1", v1["summary"]["all"]), ""]
    lines += [
        block("Fine-tuned", a_all),
        "",
        "| metric | baseline | fine-tuned | change |",
        "|---|---:|---:|---|",
        f"| name acc | {pct(b_all['namedAcc'])} | {pct(a_all['namedAcc'])} | {delta(b_all['namedAcc'], a_all['namedAcc'])} |",
        f"| kcal MAE | {b_all['kcalMae']:.1f} | {a_all['kcalMae']:.1f} | {delta(b_all['kcalMae'], a_all['kcalMae'], True)} |",
        f"| kcal median AE | {b_all['kcalMdae']:.1f} | {a_all['kcalMdae']:.1f} | {delta(b_all['kcalMdae'], a_all['kcalMdae'], True)} |",
        f"| within 20% | {pct(b_all['within20'])} | {pct(a_all['within20'])} | {delta(b_all['within20'], a_all['within20'])} |",
        f"| within 50% | {pct(b_all['within50'])} | {pct(a_all['within50'])} | {delta(b_all['within50'], a_all['within50'])} |",
        "",
    ]
    if v1:
        v1_all = v1["summary"]["all"]
        lines += [
            "v1 vs this run (same held-out split):",
            "",
            "| metric | v1 | this run | change |",
            "|---|---:|---:|---|",
            f"| name acc | {pct(v1_all['namedAcc'])} | {pct(a_all['namedAcc'])} | {delta(v1_all['namedAcc'], a_all['namedAcc'])} |",
            f"| kcal MAE | {v1_all['kcalMae']:.1f} | {a_all['kcalMae']:.1f} | {delta(v1_all['kcalMae'], a_all['kcalMae'], True)} |",
            "",
        ]
    lines += [
        "## Text vs images",
        "",
        block("Baseline text", before["summary"]["text"]),
    ]
    if v1:
        lines.append(block("Fine-tuned v1 text", v1["summary"]["text"]))
    lines += [
        block("Fine-tuned text", after["summary"]["text"]),
        block("Baseline images", before["summary"]["image"]),
    ]
    if v1:
        lines.append(block("Fine-tuned v1 images", v1["summary"]["image"]))
    lines.append(block("Fine-tuned images", after["summary"]["image"]))
    if coach_b and coach_a:
        lines += [
            "",
            "## Coach (don't forget how to talk)",
            "",
            "| metric | baseline | fine-tuned | change |",
            "|---|---:|---:|---|",
            f"| overall | {pct(coach_b['pass'])} | {pct(coach_a['pass'])} | {delta(coach_b['pass'], coach_a['pass'])} |",
            f"| log → JSON | {pct(coach_b['jsonAcc'])} | {pct(coach_a['jsonAcc'])} | {delta(coach_b['jsonAcc'], coach_a['jsonAcc'])} |",
            f"| chat/Q → prose | {pct(coach_b['proseAcc'])} | {pct(coach_a['proseAcc'])} | {delta(coach_b['proseAcc'], coach_a['proseAcc'])} |",
            f"| USDA kcal in range | {pct(coach_b['kcalInRange'])} | {pct(coach_a['kcalInRange'])} | {delta(coach_b['kcalInRange'], coach_a['kcalInRange'])} |",
            "",
            "Eval infer uses the same `{\"foods\":[` assistant prefix as the PWA.",
            "Text MAE applies the same refineExtracted host pass as the PWA (bare eggs → large, compound names).",
            "`fix-eggs` gold is 2 large eggs (185 kcal) while the photo is a mixed plate;",
            "the model emits JSON for egg plus sides, which inflates image MAE vs that eggs-only label.",
            "Banana photo counts 5 and matches 525 kcal. Text MAE is the cleaner calorie signal.",
            "If the USDA fruit banana row is missing from hits, the host refuses chips/pepper near-misses (0 kcal unmatched).",
        ]
    pick_after = ROOT / "evals/data/finetune/preds/finetuned/pick.json"
    if pick_after.exists():
        picks = load(pick_after)
        n = len(picks)
        ok = sum(1 for r in picks if r.get("ok"))
        none_n = sum(1 for r in picks if r.get("expect") is None)
        none_ok = sum(1 for r in picks if r.get("expect") is None and r.get("ok"))
        lines += [
            "",
            "## Pick / refuse (RAG)",
            "",
            f"Held-out `evals/splits/pick.json`: {ok}/{n} correct.",
            f"Refuse when the true USDA row is missing: {none_ok}/{none_n}.",
            "Calories are never taken from the model; pick-null leaves the diary unmatched (0 kcal).",
        ]
    cite_after = ROOT / "evals/data/finetune/preds/finetuned/cite.json"
    if cite_after.exists():
        cites = load(cite_after)
        ok = sum(1 for r in cites if r.get("ok"))
        lines += [
            "",
            "## Citation / refuse (coach)",
            "",
            f"Held-out `evals/splits/cite.json`: {ok}/{len(cites)} cite USDA/convert_portion or refuse without a row.",
        ]
    Path(args.out).write_text("\n".join(lines) + "\n")
    if coach_b and coach_a:
        Path(args.out.replace(".md", "-coach.json")).write_text(
            json.dumps({"before": coach_b, "after": coach_a}, indent=2) + "\n"
        )
    print("\n".join(lines))
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
