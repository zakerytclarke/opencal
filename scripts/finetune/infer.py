#!/usr/bin/env python3
"""Run a checkpoint on held-out OpenCal splits (extract + coach)."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import sys
from pathlib import Path

import torch
from PIL import Image
from transformers import AutoModelForImageTextToText, AutoProcessor

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from portions import portion_tool_line  # noqa: E402
from prompts import (  # noqa: E402
    COACH_SYSTEM,
    EXTRACT_SYSTEM,
    EXTRACT_USER,
    GRAM_IMAGE_USER,
    GRAM_SYSTEM,
    GRAM_TEXT_USER,
    PHOTO_EXTRACT_SYSTEM,
    PHOTO_EXTRACT_USER,
    PHOTO_PORTION_SYSTEM,
    PICK_NONE_LINE,
    PICK_SYSTEM,
    PICK_USER_TAIL,
    TEXT_PORTION_SYSTEM,
    photo_portion_user,
    text_portion_user,
)
from rag import catalog_lines  # noqa: E402

EXTRACT_PREFIX = '{"foods":['
PICK_PREFIX = '{"pick":'


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
            grams = row.get("grams")
            try:
                grams = float(grams) if grams is not None else None
            except (TypeError, ValueError):
                grams = None
            foods.append({"name": name, "brand": row.get("brand"), "quantity": qty, "unit": unit, "grams": grams})
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


def parse_pick_letter(text: str) -> str | None:
    cleaned = re.sub(r"<\|[^>]+?\|>", "", text).strip()
    blob = cleaned
    if "{" in cleaned and "}" in cleaned:
        blob = cleaned[cleaned.index("{") : cleaned.rindex("}") + 1]
    obj = None
    try:
        obj = json.loads(blob)
    except json.JSONDecodeError:
        try:
            obj = json.loads(re.sub(r",(\s*[}\]])", r"\1", blob))
        except json.JSONDecodeError:
            obj = None
    value = None
    if isinstance(obj, dict):
        value = obj.get("pick", obj.get("id"))
    if value is None:
        m = re.search(r"\b([A-H]|none|null)\b", cleaned, re.I)
        value = m.group(1) if m else None
    if value is None:
        return None
    s = str(value).strip()
    if not s or re.match(r"^(none|null|no|n)$", s, re.I):
        return None
    return s.upper()[:1] if s else None


def _find_food(foods: list[dict], needle: str) -> dict | None:
    n = needle.lower()
    for f in foods:
        blob = (f.get("name") or "") + " " + " ".join(f.get("aliases") or [])
        if n in blob.lower():
            return f
    return None


def build_pick_case(foods: list[dict], case: dict) -> dict:
    rng = random.Random(int(hashlib.md5(str(case["id"]).encode()).hexdigest(), 16) % (2**31))
    qty = float(case.get("quantity") or 1)
    unit = str(case.get("unit") or "serving")
    query = str(case["query"])
    meal = str(case["meal"])
    hits: list[dict] = []
    gold = None
    true_re = re.compile(case.get("trueFoodRe") or r"$a", re.I)
    if case["mode"] == "exclude_true_food":
        for d in case.get("decoyNeedles") or []:
            hit = _find_food(foods, d)
            if hit and not true_re.search(hit.get("name") or ""):
                hits.append(hit)
        extra = [f for f in foods if f.get("kcal", 0) >= 5 and not true_re.search(f.get("name") or "")]
        rng.shuffle(extra)
        for f in extra:
            if f["id"] not in {h["id"] for h in hits}:
                hits.append(f)
            if len(hits) >= 8:
                break
    elif case["mode"] == "include_true_food":
        gold = next((f for f in foods if true_re.search(f.get("name") or "")), None) or _find_food(
            foods, query
        )
        distractors = [f for f in foods if f.get("kcal", 0) >= 5 and (not gold or f["id"] != gold["id"])]
        rng.shuffle(distractors)
        hits = distractors[:7]
        if gold:
            hits.append(gold)
            rng.shuffle(hits)
    else:
        pool = [f for f in foods if f.get("kcal", 0) >= 5]
        rng.shuffle(pool)
        hits = pool[:8]

    hits = hits[:8]
    lines = []
    gold_letter = None
    for i, food in enumerate(hits):
        letter = chr(65 + i)
        lines.append(f"{letter}. {food['name']} · {portion_tool_line(food, qty, unit)}")
        if gold and food["id"] == gold["id"]:
            gold_letter = letter
    user = "\n".join(
        [
            f"Meal: {meal}",
            f"Item: {query}, about {qty:g} {unit}",
            "Database hits (USDA reference + convert_portion for this item):",
            *lines,
            PICK_NONE_LINE,
            PICK_USER_TAIL,
        ]
    )
    expect = case.get("expectPick")
    return {
        "id": case["id"],
        "user": user,
        "expect": None if expect is None else gold_letter,
        "gold_name": gold["name"] if gold else None,
        "hit_names": [h["name"] for h in hits],
    }


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
    p.add_argument("--task", default="extract", choices=["extract", "gram"], help="gram = single-pass name+grams")
    p.add_argument("--tag", default="run", help="Name for this eval (baseline, finetuned, …)")
    p.add_argument("--split", default="test")
    p.add_argument("--out", default="")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--pick", action="store_true", help="Also run lettered pick eval (not used in production)")
    p.add_argument("--skip-text", action="store_true")
    p.add_argument("--skip-images", action="store_true")
    p.add_argument("--skip-coach", action="store_true")
    p.add_argument("--skip-cite", action="store_true")
    p.add_argument("--no-rag", action="store_true", help="Skip USDA catalog + portion pass")
    p.add_argument("--gram-text", action="store_true", help="Also run transcript→grams on text.json split")
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
    image_rows = []
    for name in ("images.json", "images.foodd.json", "images.n5k.json"):
        path = ROOT / "evals/splits" / name
        if path.exists():
            image_rows.extend(load_json(path).get(args.split) or [])
    coach_split = load_json(ROOT / "evals/splits/coach.json")
    text_rows = text_split[args.split]
    if args.limit:
        text_rows = text_rows[: args.limit]
        image_rows = image_rows[: args.limit]

    catalog = load_json(ROOT / "public/foods.json")["foods"]
    extracts = []
    if args.task == "gram":
        # Image gram on N5k held-out plates (always runs).
        test = load_json(ROOT / "evals/splits/images.n5k.json")["test"]
        if args.limit:
            test = test[: args.limit]
        for i, row in enumerate(test, 1):
            path = ROOT / row["path"]
            if not path.exists():
                extracts.append({"id": row["id"], "modality": "image", "raw": "", "items": [], "error": f"missing {path}"})
                continue
            img = Image.open(path).convert("RGB")
            messages = [
                {"role": "system", "content": [{"type": "text", "text": GRAM_SYSTEM}]},
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "image": img},
                        {"type": "text", "text": GRAM_IMAGE_USER},
                    ],
                },
            ]
            raw = generate(model, processor, messages, 220, device, EXTRACT_PREFIX)
            foods = parse_foods(raw)
            for f in foods:
                if f.get("grams") is None:
                    f["grams"] = None
            extracts.append(
                {
                    "id": row["id"],
                    "modality": "image",
                    "raw": raw,
                    "items": foods,
                    "path": row["path"],
                    "nutr": row.get("nutrition"),
                }
            )
            print(f"GRAM-IMG {i}/{len(test)} {row['id']} → {foods or raw[:80]!r}", flush=True)
        if args.gram_text:
            # Transcript grams on the text.json held-out split.
            test = load_json(ROOT / "evals/splits/text.json")["test"]
            if args.limit:
                test = test[: args.limit]
            for i, row in enumerate(test, 1):
                meal = str(row["text"])
                messages = [
                    {"role": "system", "content": [{"type": "text", "text": GRAM_SYSTEM}]},
                    {"role": "user", "content": [{"type": "text", "text": GRAM_TEXT_USER.format(meal=meal)}]},
                ]
                raw = generate(model, processor, messages, 220, device, EXTRACT_PREFIX)
                foods = parse_foods(raw)
                for f in foods:
                    if f.get("grams") is None:
                        f["grams"] = None
                extracts.append(
                    {
                        "id": row["id"],
                        "modality": "text",
                        "raw": raw,
                        "items": foods,
                        "text": meal,
                        "nutr": None,
                    }
                )
                print(f"GRAM-TEXT {i}/{len(test)} {row['id']} → {foods or raw[:80]!r}", flush=True)
        (out_dir / "extracts.json").write_text(json.dumps(extracts, indent=2) + "\n")
        print(f"wrote {out_dir}")
        return

    if not args.skip_text:
        for row in text_rows:
            messages = [
                {"role": "system", "content": [{"type": "text", "text": EXTRACT_SYSTEM}]},
                {"role": "user", "content": [{"type": "text", "text": EXTRACT_USER.format(meal=row["text"])}]},
            ]
            raw = generate(model, processor, messages, 220, device, EXTRACT_PREFIX)
            identified = parse_foods(raw)
            items = identified
            portion_raw = ""
            if identified and not args.no_rag:
                names = [str(it.get("name") or "") for it in identified]
                lines = catalog_lines(catalog, names)
                portion_user = text_portion_user(row["text"], names, lines)
                portion_messages = [
                    {"role": "system", "content": [{"type": "text", "text": TEXT_PORTION_SYSTEM}]},
                    {"role": "user", "content": [{"type": "text", "text": portion_user}]},
                ]
                portion_raw = generate(model, processor, portion_messages, 280, device, EXTRACT_PREFIX)
                portioned = parse_foods(portion_raw)
                if portioned:
                    items = portioned
            extracts.append(
                {
                    "id": row["id"],
                    "modality": "text",
                    "raw": "\n---\n".join(x for x in (raw, portion_raw) if x),
                    "items": items,
                    "text": row["text"],
                    "identified": identified,
                }
            )
            print(f"TEXT {row['id']} → {items or raw[:80]!r}", flush=True)

    if not args.skip_images:
        for i, row in enumerate(image_rows, 1):
            path = ROOT / row["path"]
            if not path.exists():
                extracts.append({"id": row["id"], "modality": "image", "raw": "", "items": [], "error": f"missing {path}"})
                print(f"IMAGE {i}/{len(image_rows)} {row['id']} missing {path}", flush=True)
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
            identified = parse_foods(raw)
            items = identified
            portion_raw = ""
            if identified and not args.no_rag:
                names = [str(it.get("name") or "") for it in identified]
                lines = catalog_lines(catalog, names)
                portion_user = photo_portion_user(names, lines)
                portion_messages = [
                    {"role": "system", "content": [{"type": "text", "text": PHOTO_PORTION_SYSTEM}]},
                    {
                        "role": "user",
                        "content": [
                            {"type": "image", "image": img},
                            {"type": "text", "text": portion_user},
                        ],
                    },
                ]
                portion_raw = generate(model, processor, portion_messages, 280, device, EXTRACT_PREFIX)
                portioned = parse_foods(portion_raw)
                if portioned:
                    items = portioned
            extracts.append(
                {
                    "id": row["id"],
                    "modality": "image",
                    "raw": "\n---\n".join(x for x in (raw, portion_raw) if x),
                    "items": items,
                    "path": row["path"],
                    "identified": identified,
                }
            )
            print(f"IMAGE {i}/{len(image_rows)} {row['id']} → {items or raw[:80]!r}", flush=True)

    coach = []
    if not args.skip_coach:
        for row in coach_split["test"]:
            messages = [
                {"role": "system", "content": [{"type": "text", "text": COACH_SYSTEM}]},
                {"role": "user", "content": [{"type": "text", "text": row["user"]}]},
            ]
            raw = generate(model, processor, messages, 180, device)
            coach.append({"id": row["id"], "user": row["user"], "raw": raw, "expect": row["expect"]})
            print(f"COACH {row['id']} → {raw[:100]!r}", flush=True)

    pick_split = ROOT / "evals/splits/pick.json"
    pick_preds = []
    if args.pick and pick_split.exists():
        for case in load_json(pick_split)["test"]:
            built = build_pick_case(catalog, case)
            messages = [
                {"role": "system", "content": [{"type": "text", "text": PICK_SYSTEM}]},
                {"role": "user", "content": [{"type": "text", "text": built["user"]}]},
            ]
            raw = generate(model, processor, messages, 80, device, PICK_PREFIX)
            letter = parse_pick_letter(raw)
            expect = built["expect"]
            ok = (letter is None and expect is None) or (letter is not None and letter == expect)
            pick_preds.append(
                {
                    "id": built["id"],
                    "raw": raw,
                    "pick": letter,
                    "expect": expect,
                    "ok": ok,
                    "gold_name": built["gold_name"],
                }
            )
            print(f"PICK {built['id']} → {letter!r} expect {expect!r} {'ok' if ok else 'miss'}", flush=True)
        n_ok = sum(1 for r in pick_preds if r["ok"])
        print(f"pick {n_ok}/{len(pick_preds)}", flush=True)

    cite_split = ROOT / "evals/splits/cite.json"
    cite_preds = []
    if cite_split.exists() and not args.skip_cite:
        for row in load_json(cite_split)["test"]:
            messages = [
                {"role": "system", "content": [{"type": "text", "text": COACH_SYSTEM}]},
                {"role": "user", "content": [{"type": "text", "text": row["user"]}]},
            ]
            raw = generate(model, processor, messages, 180, device)
            is_json = bool(parse_foods(raw))
            must = [m.lower() for m in row.get("must") or []]
            must_not = row.get("mustNot") or []
            ok = (not is_json) and all(m in raw.lower() for m in must) and all(x not in raw for x in must_not)
            cite_preds.append({"id": row["id"], "user": row["user"], "raw": raw, "ok": ok})
            print(f"CITE {row['id']} → {'ok' if ok else 'miss'} {raw[:90]!r}", flush=True)
        print(f"cite {sum(1 for r in cite_preds if r['ok'])}/{len(cite_preds)}", flush=True)

    (out_dir / "extracts.json").write_text(json.dumps(extracts, indent=2) + "\n")
    (out_dir / "coach.json").write_text(json.dumps(coach, indent=2) + "\n")
    if pick_preds:
        (out_dir / "pick.json").write_text(json.dumps(pick_preds, indent=2) + "\n")
    if cite_preds:
        (out_dir / "cite.json").write_text(json.dumps(cite_preds, indent=2) + "\n")
    print(f"wrote {out_dir}")


if __name__ == "__main__":
    main()
