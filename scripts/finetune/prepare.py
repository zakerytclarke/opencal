#!/usr/bin/env python3
"""Build the OpenCal fine-tune mix.

Sources (all calorie numbers come from USDA rows or Nutrition5k's USDA-linked labels):
  1. USDA catalog synth — spoken meals from public/foods.json search foods
  2. OpenCal train split — high-quality held-in examples (never the test split)
  3. Pick letters — gold USDA row among distractors
  4. Nutrition5k (mmathys/food-nutrients) — overhead plates + ingredient grams
  5. Fixture photos in the image train split
  6. Coach / chat — USDA-backed Q&A plus small talk so logging JSON does not
     wipe out conversation

The OpenCal text+image TEST splits are frozen and never written into train JSONL.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FOODS_PATH = ROOT / "public" / "foods.json"
TEXT_SPLIT = ROOT / "evals" / "splits" / "text.json"
IMAGE_SPLIT = ROOT / "evals" / "splits" / "images.json"
COACH_SPLIT = ROOT / "evals" / "splits" / "coach.json"
OUT_DIR = ROOT / "evals" / "data" / "finetune"
IMG_DIR = OUT_DIR / "images"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prompts import (  # noqa: E402
    COACH_SYSTEM,
    EXTRACT_SYSTEM,
    EXTRACT_USER,
    PHOTO_EXTRACT_SYSTEM,
    PHOTO_EXTRACT_USER,
    PICK_SYSTEM,
)

NICE_UNIT = re.compile(
    r"\b(medium|small|large|extra large|slice|sandwich|bar|can|bottle|bowl|"
    r"burrito|taco|cup|tbsp|tablespoon|tsp|egg|bagel|muffin|cookie|patty|"
    r"fillet|container|pouch|grande|wrap|platter|nugget|pizza|piece|item|"
    r"each|serving|scoop|fl oz)\b",
    re.I,
)

MEAL_TEMPLATES = [
    "{items}",
    "I had {items}",
    "I ate {items}",
    "ate {items} for breakfast",
    "ate {items} for lunch",
    "ate {items} for dinner",
    "just {items}",
    "please log {items}",
    "log {items}",
    "can you log {items}",
]


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9\s]", " ", s.lower()).replace("  ", " ").strip()


def load_json(path: Path):
    return json.loads(path.read_text())


def short_name(name: str) -> str:
    first = name.split(",")[0].strip()
    if first == first.upper() and len(first) > 3:
        rest = name.split(",", 1)[-1].strip()
        return rest or first
    return first


def brand_of(name: str) -> str | None:
    m = re.match(r"^([A-Z][A-Z0-9'&. ]{1,40}?)(?:'S)?, ", name)
    if m:
        return m.group(1).replace("'S", "'s").strip()
    return None


def parse_label(label: str) -> tuple[float, str | None]:
    text = re.sub(r"\s+", " ", label).strip()
    m = re.match(r"^([\d.]+|\d+/\d+)\s+(.+)$", text)
    if not m:
        return 1.0, None
    raw, rest = m.group(1), m.group(2).lower()
    if "/" in raw:
        a, b = raw.split("/", 1)
        qty = float(a) / float(b) if float(b) else 1.0
    else:
        qty = float(raw)
    if rest.startswith("fl oz") or rest.startswith("fluid"):
        return qty, "fl oz"
    unit = rest.split(",")[0].split("/")[0].strip().split()[0]
    aliases = {
        "tablespoon": "tbsp",
        "tablespoons": "tbsp",
        "teaspoon": "tsp",
        "teaspoons": "tsp",
        "cups": "cup",
        "slices": "slice",
        "pieces": "piece",
        "grams": "g",
        "ounce": "oz",
        "ounces": "oz",
    }
    unit = aliases.get(unit, unit)
    return qty, unit


def catalog(foods: list[dict]) -> list[dict]:
    out = []
    for f in foods:
        if f.get("visibility") != "search":
            continue
        if f.get("kcal", 0) < 5:
            continue
        name = f.get("name") or ""
        if len(name) > 60:
            continue
        label = f.get("serveLabel") or ""
        if f.get("source") == "compiled" or NICE_UNIT.search(label) or f.get("serveG", 0) >= 40:
            out.append(f)
    return out


def banned_texts() -> set[str]:
    banned = set()
    splits = load_json(TEXT_SPLIT)
    for row in splits.get("test") or []:
        banned.add(norm(row["text"]))
    if COACH_SPLIT.exists():
        for row in load_json(COACH_SPLIT).get("test") or []:
            banned.add(norm(row["user"]))
    return banned


def json_foods(items: list[dict]) -> str:
    return json.dumps({"foods": items}, separators=(",", ":"))


def sample_ok(user: str, banned: set[str]) -> bool:
    return norm(user) not in banned and len(user) >= 4


def extract_record(meal: str, foods: list[dict]) -> dict:
    return {
        "task": "extract_text",
        "image": None,
        "messages": [
            {"role": "system", "content": EXTRACT_SYSTEM},
            {"role": "user", "content": EXTRACT_USER.format(meal=meal)},
            {"role": "assistant", "content": json_foods(foods)},
        ],
        "meta": {"meal": meal},
    }


def phrase_for(food: dict, rng: random.Random) -> tuple[str, dict]:
    qty, unit = parse_label(food.get("serveLabel") or "")
    if unit is None:
        qty, unit = 1.0, "serving"
    if rng.random() < 0.25 and unit in {"medium", "slice", "bar", "can", "bowl", "cup"}:
        qty = 1.0 if rng.random() < 0.7 else 2.0
    name = short_name(food["name"])
    brand = brand_of(food["name"])
    if qty == 1 and unit in {"medium", "small", "large"}:
        spoken = rng.choice([f"a {unit} {name}", f"{name}"])
    elif qty == 1:
        spoken = rng.choice([f"a {unit} of {name}", f"1 {unit} {name}", f"a {name}"])
    else:
        qtxt = "half" if qty == 0.5 else (str(int(qty)) if qty == int(qty) else str(qty))
        spoken = f"{qtxt} {unit} {name}"
    item = {
        "name": name.lower() if name != name.upper() else name,
        "brand": brand,
        "quantity": qty if qty != int(qty) else int(qty),
        "unit": unit,
    }
    return spoken, item


def build_synth(foods: list[dict], n: int, rng: random.Random, banned: set[str]) -> list[dict]:
    pool = catalog(foods)
    compiled = [f for f in pool if f.get("source") == "compiled"]
    rows: list[dict] = []
    attempts = 0
    while len(rows) < n and attempts < n * 20:
        attempts += 1
        k = rng.choices([1, 2, 3], weights=[50, 35, 15])[0]
        src = compiled if compiled and rng.random() < 0.35 else pool
        if len(src) < k:
            continue
        chosen = rng.sample(src, k)
        bits = []
        items = []
        for food in chosen:
            spoken, item = phrase_for(food, rng)
            bits.append(spoken)
            items.append(item)
        joiner = rng.choice([" and ", ", ", " with "])
        items_txt = joiner.join(bits)
        meal = rng.choice(MEAL_TEMPLATES).format(items=items_txt)
        if not sample_ok(meal, banned):
            continue
        rows.append(extract_record(meal, items))
    return rows


def build_opencal_train(banned: set[str]) -> list[dict]:
    splits = load_json(TEXT_SPLIT)
    rows = []
    for row in splits.get("train") or []:
        if not sample_ok(row["text"], banned):
            continue
        foods = []
        for exp in row["expect"]:
            foods.append(
                {
                    "name": exp["query"],
                    "brand": None,
                    "quantity": exp["quantity"],
                    "unit": exp["unit"],
                }
            )
        rec = extract_record(row["text"], foods)
        rec["meta"]["id"] = row["id"]
        rec["meta"]["source"] = "opencal_train"
        rows.append(rec)
    return rows


def scale_kcal(food: dict, grams: float) -> int:
    return int(round(float(food["kcal"]) * grams / 100.0))


def build_pick(foods: list[dict], n: int, rng: random.Random) -> list[dict]:
    pool = catalog(foods)
    rows = []
    attempts = 0
    while len(rows) < n and attempts < n * 10:
        attempts += 1
        gold = rng.choice(pool)
        distractors = rng.sample([f for f in pool if f["id"] != gold["id"]], k=min(7, len(pool) - 1))
        hits = distractors + [gold]
        rng.shuffle(hits)
        idx = hits.index(gold)
        letter = chr(65 + idx)
        qty, unit = parse_label(gold.get("serveLabel") or "")
        unit = unit or "serving"
        qty = qty or 1
        grams = float(gold["serveG"]) * (qty if qty else 1)
        kcal = scale_kcal(gold, grams)
        lines = []
        for i, food in enumerate(hits):
            key = chr(65 + i)
            g = float(food["serveG"])
            k = scale_kcal(food, g)
            lines.append(
                f"{key}. {food['name']} · USDA {food['serveLabel']} ({int(round(g))} g) · "
                f"convert_portion {qty} {unit} → {int(round(g))} g, {k} kcal"
            )
        query = short_name(gold["name"]).lower()
        user = "\n".join(
            [
                f"Meal: {query}",
                f"Item: {query}, about {qty} {unit}",
                "Database hits (USDA reference + convert_portion for this item):",
                *lines,
                "None. no match",
                "Pick the closest nutrition reference letter. Keep the user name, brand, and portion. Do not output grams or calories.",
            ]
        )
        assistant = json.dumps({"pick": letter, "name": gold["name"]}, separators=(",", ":"))
        rows.append(
            {
                "task": "pick",
                "image": None,
                "messages": [
                    {"role": "system", "content": PICK_SYSTEM},
                    {"role": "user", "content": user},
                    {"role": "assistant", "content": assistant},
                ],
                "meta": {"gold_id": gold["id"]},
            }
        )
    return rows


def find_food(foods: list[dict], needle: str) -> dict | None:
    n = norm(needle)
    for f in foods:
        if f.get("visibility") != "search":
            continue
        if n in norm(f["name"]) or any(n == norm(a) for a in f.get("aliases") or []):
            return f
    for f in foods:
        if n in norm(f.get("name") or ""):
            return f
    return None


def kcal_line(food: dict) -> str:
    grams = float(food["serveG"])
    kcal = scale_kcal(food, grams)
    return f"USDA {food['serveLabel']} ({int(round(grams))} g) is {kcal} kcal from the per-100 g value of {food['kcal']:g} kcal."


def build_coach(foods: list[dict], n: int, rng: random.Random, banned: set[str]) -> list[dict]:
    pool = catalog(foods)
    compiled = [f for f in pool if f.get("source") == "compiled"] or pool
    rows: list[dict] = []

    def add(user: str, assistant: str, kind: str) -> None:
        if not sample_ok(user, banned):
            return
        rows.append(
            {
                "task": "coach",
                "image": None,
                "messages": [
                    {"role": "system", "content": COACH_SYSTEM},
                    {"role": "user", "content": user},
                    {"role": "assistant", "content": assistant},
                ],
                "meta": {"kind": kind},
            }
        )

    chats = [
        ("hey", "Hey — want to log a meal, or check how a food fits your day?"),
        ("how's it going", "Going well. Tell me what you ate and I'll log it against USDA servings."),
        ("thanks", "Anytime. Ping me when you're ready to log the next meal."),
        ("what can you do", "I log meals from text or a photo, match them to USDA foods, and can talk through portions. I don't guess calories."),
        ("good morning", "Morning. What did you have for breakfast?"),
        ("I'm hungry", "What's around? If you name it I can log a USDA serving, or we can look at a snack that fits your remaining calories."),
    ]
    for user, assistant in chats:
        add(user, assistant, "chat")

    while len(rows) < n:
        food = rng.choice(compiled if rng.random() < 0.5 else pool)
        name = short_name(food["name"])
        fact = kcal_line(food)
        protein = round(float(food["protein"]) * float(food["serveG"]) / 100, 1)
        kind = rng.choice(["kcal", "protein", "log", "fit", "chat2"])
        if kind == "kcal":
            add(
                rng.choice(
                    [
                        f"how many calories in {name}?",
                        f"calories for {name}?",
                        f"what's a serving of {name}?",
                    ]
                ),
                f"{fact} I use that USDA household weight rather than guessing. Want me to log one?",
                "kcal",
            )
        elif kind == "protein":
            add(
                f"how much protein is in {name}?",
                f"About {protein} g protein on the USDA {food['serveLabel']} ({int(round(food['serveG']))} g). {fact}",
                "protein",
            )
        elif kind == "log":
            qty, unit = parse_label(food.get("serveLabel") or "")
            unit = unit or "serving"
            item = {"name": name.lower(), "brand": brand_of(food["name"]), "quantity": qty if qty != int(qty) else int(qty or 1), "unit": unit}
            add(
                rng.choice([f"log {name}", f"I just had {name}", f"add {name} please"]),
                json_foods([item]),
                "log",
            )
        elif kind == "fit":
            add(
                f"does {name} fit a 500 calorie snack?",
                f"{fact} That's {'well under' if scale_kcal(food, food['serveG']) <= 400 else 'close to or over'} 500 kcal for one serving.",
                "fit",
            )
        else:
            add("what should I eat", "Name what's in front of you and I'll log USDA servings. I won't invent a meal plan from thin air.", "chat")
        if len(rows) >= n:
            break
    return rows[:n]


def build_images_from_split() -> list[dict]:
    splits = load_json(IMAGE_SPLIT)
    rows = []
    for row in splits.get("train") or []:
        path = ROOT / row["path"]
        if not path.exists():
            continue
        foods = [{"name": row["query"], "brand": None, "quantity": row["quantity"], "unit": row["unit"]}]
        rel = str(path)
        rows.append(
            {
                "task": "extract_image",
                "image": rel,
                "messages": [
                    {"role": "system", "content": PHOTO_EXTRACT_SYSTEM},
                    {"role": "user", "content": PHOTO_EXTRACT_USER},
                    {"role": "assistant", "content": json_foods(foods)},
                ],
                "meta": {"id": row["id"], "source": "fixture"},
            }
        )
    return rows


def build_nutrition5k(limit: int, rng: random.Random) -> list[dict]:
    try:
        from datasets import load_dataset
        from PIL import Image
    except ImportError:
        print("datasets/PIL missing — skip Nutrition5k")
        return []

    print("streaming mmathys/food-nutrients (Nutrition5k subset)…", flush=True)
    try:
        ds = load_dataset("mmathys/food-nutrients", split="test", streaming=True)
    except Exception as exc:
        print(f"Nutrition5k download failed ({exc}) — continuing without it")
        return []

    IMG_DIR.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    for i, sample in enumerate(ds):
        if len(rows) >= limit:
            break
        cals = sample.get("total_calories") or 0
        if cals < 20:
            continue
        ingredients = sample.get("ingredients") or []
        foods = []
        for ing in ingredients[:6]:
            name = (ing.get("name") or "").strip()
            grams = ing.get("grams") or 0
            if not name or grams < 5:
                continue
            foods.append(
                {
                    "name": name.lower(),
                    "brand": None,
                    "quantity": int(round(grams)) if grams >= 10 else round(float(grams), 1),
                    "unit": "g",
                }
            )
        if not foods:
            continue
        image = sample.get("image")
        if image is None:
            continue
        if not isinstance(image, Image.Image):
            try:
                image = Image.open(image).convert("RGB")
            except Exception:
                continue
        image = image.convert("RGB")
        image.thumbnail((512, 512))
        sid = str(sample.get("id") or i)
        out_path = IMG_DIR / f"n5k-{sid}.jpg"
        if not out_path.exists():
            image.save(out_path, quality=85)
        rows.append(
            {
                "task": "extract_image",
                "image": str(out_path),
                "messages": [
                    {"role": "system", "content": PHOTO_EXTRACT_SYSTEM},
                    {"role": "user", "content": PHOTO_EXTRACT_USER},
                    {"role": "assistant", "content": json_foods(foods)},
                ],
                "meta": {
                    "id": sid,
                    "source": "nutrition5k",
                    "kcal": cals,
                    "split": sample.get("split"),
                },
            }
        )
    print(f" nutrition5k kept {len(rows)} plates")
    return rows


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--synth", type=int, default=4000)
    p.add_argument("--pick", type=int, default=2000)
    p.add_argument("--coach", type=int, default=1500)
    p.add_argument("--n5k", type=int, default=1800)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--skip-n5k", action="store_true")
    args = p.parse_args()

    rng = random.Random(args.seed)
    foods = load_json(FOODS_PATH)["foods"]
    banned = banned_texts()
    print(f"catalog search foods: {len(catalog(foods))} · banned eval strings: {len(banned)}")

    parts = {
        "opencal_train": build_opencal_train(banned),
        "synth": build_synth(foods, args.synth, rng, banned),
        "pick": build_pick(foods, args.pick, rng),
        "coach": build_coach(foods, args.coach, rng, banned),
        "fixtures": build_images_from_split(),
        "nutrition5k": [] if args.skip_n5k else build_nutrition5k(args.n5k, rng),
    }

    train: list[dict] = []
    val: list[dict] = []
    for name, rows in parts.items():
        n_val = max(1, len(rows) // 20) if len(rows) >= 20 else 0
        rng.shuffle(rows)
        val.extend(rows[:n_val])
        train.extend(rows[n_val:])
        print(f"  {name}: {len(rows)} (val {n_val})")

    rng.shuffle(train)
    rng.shuffle(val)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_jsonl(OUT_DIR / "train.jsonl", train)
    write_jsonl(OUT_DIR / "val.jsonl", val)
    summary = {
        "train": len(train),
        "val": len(val),
        "by_task": {},
        "banned": len(banned),
    }
    for row in train:
        summary["by_task"][row["task"]] = summary["by_task"].get(row["task"], 0) + 1
    (OUT_DIR / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(f"wrote {OUT_DIR / 'train.jsonl'} ({len(train)} train, {len(val)} val)")
    print("tasks", summary["by_task"])


if __name__ == "__main__":
    main()
