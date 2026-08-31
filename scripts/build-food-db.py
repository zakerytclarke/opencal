#!/usr/bin/env python3
"""Compile USDA Foundation + FNDDS + SR Legacy into a compact on-device food DB."""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

SRC = Path("/tmp/opencal-usda")
OUT = Path(__file__).resolve().parents[1] / "public" / "foods.json"

NUTRIENT_IDS = {
    1008: "kcal",
    1003: "protein",
    1004: "fat",
    1005: "carbs",
    1079: "fiber",
    2000: "sugar",
}

EMOJI_RULES = [
    (r"\b(burger|cheeseburger|hamburger|big mac|whopper)\b", "🍔"),
    (r"\b(pizza|calzone)\b", "🍕"),
    (r"\b(taco|burrito|quesadilla|nacho|enchilada|fajita)\b", "🌮"),
    (r"\b(hot dog|corndog|frankfurter)\b", "🌭"),
    (r"\b(french fries|fries|tater tot)\b", "🍟"),
    (r"\b(sushi|sashimi|maki|nigiri)\b", "🍣"),
    (r"\b(ramen|pho|noodle soup)\b", "🍜"),
    (r"\b(spaghetti|pasta|lasagna|ravioli|macaroni|penne|fettuccine)\b", "🍝"),
    (r"\b(rice|risotto|fried rice)\b", "🍚"),
    (r"\b(bread|toast|bagel|baguette|roll|bun|ciabatta)\b", "🍞"),
    (r"\b(croissant|pastry|danish)\b", "🥐"),
    (r"\b(pancake|waffle|crepe|french toast)\b", "🥞"),
    (r"\b(cereal|granola|cheerio|frosted flake)\b", "🥣"),
    (r"\b(oatmeal|oats|porridge)\b", "🥣"),
    (r"\b(egg|omelet|omelette)\b", "🥚"),
    (r"\b(bacon|sausage|ham|prosciutto)\b", "🥓"),
    (r"\b(steak|beef|brisket|ribs|roast beef)\b", "🥩"),
    (r"\b(chicken|turkey|wing|nugget|tender)\b", "🍗"),
    (r"\b(salmon|tuna|fish|cod|tilapia|sardine|shrimp|prawn|lobster|crab|seafood)\b", "🐟"),
    (r"\b(salad|lettuce|spinach|kale|arugula|greens)\b", "🥗"),
    (r"\b(broccoli|cauliflower|cabbage|brussels)\b", "🥦"),
    (r"\b(carrot)\b", "🥕"),
    (r"\b(corn)\b", "🌽"),
    (r"\b(avocado)\b", "🥑"),
    (r"\b(tomato|marinara)\b", "🍅"),
    (r"\b(potato|mashed|baked potato|sweet potato)\b", "🥔"),
    (r"\b(apple)\b", "🍎"),
    (r"\b(banana)\b", "🍌"),
    (r"\b(orange|clementine|tangerine|grapefruit)\b", "🍊"),
    (r"\b(grape)\b", "🍇"),
    (r"\b(strawberry|blueberry|raspberry|blackberry|berry)\b", "🍓"),
    (r"\b(watermelon|melon|cantaloupe|honeydew)\b", "🍉"),
    (r"\b(peach|nectarine|plum|cherry)\b", "🍑"),
    (r"\b(mango|pineapple|kiwi|papaya)\b", "🥭"),
    (r"\b(lemon|lime)\b", "🍋"),
    (r"\b(coconut)\b", "🥥"),
    (r"\b(peanut|almond|cashew|walnut|pistachio|pecan|nut)\b", "🥜"),
    (r"\b(milk|latte|cappuccino|yogurt|kefir|cream)\b", "🥛"),
    (r"\b(cheese|cheddar|mozzarella|parmesan|feta|brie)\b", "🧀"),
    (r"\b(butter|ghee|margarine)\b", "🧈"),
    (r"\b(ice cream|gelato|sundae|milkshake|frozen yogurt)\b", "🍦"),
    (r"\b(cake|cupcake|brownie|muffin)\b", "🍰"),
    (r"\b(cookie|biscuit)\b", "🍪"),
    (r"\b(donut|doughnut)\b", "🍩"),
    (r"\b(chocolate|candy|snickers|kit kat)\b", "🍫"),
    (r"\b(coffee|espresso|americano)\b", "☕"),
    (r"\b(tea|matcha|chai)\b", "🍵"),
    (r"\b(beer|ale|lager|stout)\b", "🍺"),
    (r"\b(wine|champagne)\b", "🍷"),
    (r"\b(soda|cola|pepsi|sprite|juice|smoothie|lemonade|gatorade)\b", "🥤"),
    (r"\b(water|seltzer|sparkling)\b", "💧"),
    (r"\b(wine)\b", "🍷"),
    (r"\b(soup|stew|chili|chowder|bisque)\b", "🍲"),
    (r"\b(sandwich|sub|wrap|panini|hoagie)\b", "🥪"),
    (r"\b(popcorn)\b", "🍿"),
    (r"\b(pretzel)\b", "🥨"),
    (r"\b(chip|crisp|dorito|cheeto)\b", "🍟"),
    (r"\b(hummus|falafel)\b", "🧆"),
    (r"\b(tofu|tempeh|edamame|soy)\b", "🫘"),
    (r"\b(bean|lentil|chickpea)\b", "🫘"),
    (r"\b(olive oil|oil|dressing)\b", "🫒"),
    (r"\b(honey)\b", "🍯"),
    (r"\b(rice cake)\b", "🍘"),
]

CATEGORY_RULES = [
    (r"\b(burger|pizza|taco|burrito|fries|nugget|hot dog|fast food|fried)\b", "fast-food"),
    (r"\b(soda|cola|juice|coffee|tea|beer|wine|latte|milkshake|smoothie|water)\b", "drinks"),
    (r"\b(ice cream|cake|cookie|donut|candy|chocolate|brownie|dessert|pie)\b", "dessert"),
    (r"\b(apple|banana|berry|orange|grape|melon|peach|mango|fruit)\b", "fruit"),
    (r"\b(salad|broccoli|spinach|kale|carrot|lettuce|vegetable|tomato|pepper)\b", "vegetables"),
    (r"\b(chicken|beef|pork|steak|turkey|fish|salmon|tuna|shrimp|egg|tofu|bacon)\b", "protein"),
    (r"\b(milk|cheese|yogurt|butter|cream|cottage)\b", "dairy"),
    (r"\b(bread|rice|pasta|oat|cereal|bagel|toast|noodle|quinoa|tortilla)\b", "grains"),
    (r"\b(chip|pretzel|popcorn|cracker|snack|nuts|almond|peanut)\b", "snacks"),
    (r"\b(soup|stew|chili)\b", "soup"),
]


def emoji_for(name: str) -> str:
    n = name.lower()
    for pat, emo in EMOJI_RULES:
        if re.search(pat, n):
            return emo
    return "🍽️"


def category_for(name: str, wweia: str = "") -> str:
    blob = f"{name} {wweia}".lower()
    for pat, cat in CATEGORY_RULES:
        if re.search(pat, blob):
            return cat
    return "other"


def norm(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def titleish(s: str) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    s = s.replace("NFS", "").replace("NS", "").strip(" ,")
    if not s:
        return s
    # Keep commas as USDA style but tidy
    parts = [p.strip() for p in s.split(",") if p.strip()]
    return ", ".join(parts)


def nutrients(item: dict) -> dict[str, float]:
    out = {k: 0.0 for k in ("kcal", "protein", "carbs", "fat", "fiber", "sugar")}
    for n in item.get("foodNutrients") or []:
        nut = n.get("nutrient") or {}
        nid = nut.get("id")
        unit = (nut.get("unitName") or "").lower()
        amt = n.get("amount")
        if amt is None:
            continue
        key = NUTRIENT_IDS.get(nid)
        if key == "kcal" and "kj" in unit:
            continue
        if key:
            out[key] = float(amt)
    return out


def best_portion(item: dict) -> tuple[float, str]:
    portions = item.get("foodPortions") or []
    scored: list[tuple[int, float, str]] = []
    for p in portions:
        grams = p.get("gramWeight") or 0
        if not grams or grams <= 0:
            continue
        desc = (p.get("portionDescription") or "").strip()
        modifier = (p.get("modifier") or "").strip()
        unit = ((p.get("measureUnit") or {}).get("name") or "").strip()
        amount = p.get("amount") or 1
        label = desc or (f"{amount:g} {modifier or unit}".strip())
        low = label.lower()
        if "quantity not specified" in low or "guideline" in low or "undetermined" in low:
            continue
        score = 50
        if re.search(r"\b(medium|1 medium|small|large)\b", low):
            score = 10
        elif re.search(r"\b(slice|piece|item|each|unit)\b", low):
            score = 15
        elif re.search(r"\b1 cup\b", low):
            score = 20
        elif re.search(r"\b(tbsp|tablespoon|tsp)\b", low):
            score = 40
        if 20 <= grams <= 400:
            score -= 5
        scored.append((score, float(grams), label))
    if not scored:
        return 100.0, "100 g"
    scored.sort()
    return scored[0][1], scored[0][2]


def aliases_for(name: str) -> list[str]:
    n = titleish(name)
    aliases = set()
    # first clause is often the common name
    first = n.split(",")[0].strip()
    if first and first.lower() != n.lower():
        aliases.add(first.lower())
    # drop cooking method tails
    simple = re.sub(
        r",\s*(raw|cooked|grilled|baked|fried|boiled|roasted|steamed|broiled).*$",
        "",
        n,
        flags=re.I,
    )
    if simple.lower() != n.lower():
        aliases.add(simple.lower())
    return sorted(a for a in aliases if a and a != n.lower())


def add_food(store: dict, item: dict, source: str, wweia: str = "") -> None:
    desc = (item.get("description") or "").strip()
    if not desc:
        return
    nuts = nutrients(item)
    if nuts["kcal"] <= 0 and nuts["protein"] <= 0 and nuts["carbs"] <= 0:
        return
    key = norm(desc)
    if not key or key in store:
        return
    # skip extremely lab-specific SR rows when we already have good coverage
    if source == "sr" and any(
        x in desc.lower()
        for x in ("usda commodity", "fast foods, ", "babyfood, meat,")
    ):
        return
    grams, label = best_portion(item)
    store[key] = {
        "id": f"{source}-{item.get('fdcId') or abs(hash(key)) % 10_000_000}",
        "name": titleish(desc),
        "emoji": emoji_for(desc),
        "category": category_for(desc, wweia),
        "kcal": round(nuts["kcal"], 1),
        "protein": round(nuts["protein"], 2),
        "carbs": round(nuts["carbs"], 2),
        "fat": round(nuts["fat"], 2),
        "fiber": round(nuts["fiber"], 2),
        "sugar": round(nuts["sugar"], 2),
        "serveG": round(grams, 1),
        "serveLabel": label,
        "source": source,
        "aliases": aliases_for(desc),
    }


# Popular restaurant / packaged items people photograph or quick-log.
# Values are typical published per-item or per listed serving, stored as per-100g
# plus a realistic serve weight so the diary matches what people expect.
EXTRAS = [
    # name, kcal/100g, p, c, f, fiber, sugar, serveG, serveLabel, aliases
    ("Big Mac", 257, 11.8, 20.1, 14.8, 1.6, 4.0, 215, "1 sandwich", ["mcdonalds big mac", "big mac burger"]),
    ("McDonald's French Fries, medium", 323, 3.4, 42.7, 15.5, 3.8, 0.3, 117, "1 medium", ["fries", "mcdonalds fries"]),
    ("Quarter Pounder with Cheese", 244, 13.8, 18.0, 13.2, 1.4, 5.1, 242, "1 sandwich", ["quarter pounder"]),
    ("Chicken McNuggets (6 piece)", 302, 15.7, 18.5, 17.8, 0.8, 0.2, 96, "6 pieces", ["mcnuggets", "chicken nuggets"]),
    ("Whopper", 233, 10.8, 18.6, 13.0, 1.6, 4.8, 291, "1 sandwich", ["burger king whopper"]),
    ("Chipotle Chicken Burrito", 196, 11.5, 20.4, 7.2, 2.8, 1.6, 500, "1 burrito", ["chipotle burrito"]),
    ("Chipotle Chicken Bowl", 155, 12.4, 12.8, 5.8, 3.2, 1.8, 540, "1 bowl", ["chipotle bowl", "burrito bowl"]),
    ("Starbucks Caffe Latte, grande 2%", 54, 2.7, 5.4, 2.1, 0, 5.0, 473, "16 fl oz", ["latte", "grande latte"]),
    ("Starbucks Pumpkin Spice Latte, grande", 80, 2.5, 12.5, 2.5, 0, 11.0, 473, "16 fl oz", ["psl", "pumpkin spice latte"]),
    ("Cheese Pizza, 1 large slice", 266, 11.4, 33.3, 9.8, 2.3, 3.6, 107, "1 slice", ["pizza slice", "cheese pizza"]),
    ("Pepperoni Pizza, 1 large slice", 282, 11.8, 31.5, 12.4, 2.1, 3.4, 111, "1 slice", ["pepperoni pizza"]),
    ("New York Bagel with Cream Cheese", 275, 9.5, 48.0, 6.2, 2.0, 6.0, 145, "1 bagel", ["bagel and cream cheese"]),
    ("Avocado Toast", 196, 5.4, 18.2, 11.6, 4.8, 1.4, 170, "1 slice", ["avocado toast"]),
    ("Caesar Salad with Chicken", 145, 12.8, 6.4, 7.8, 1.6, 2.1, 300, "1 salad", ["chicken caesar"]),
    ("Greek Salad", 110, 4.2, 7.1, 7.5, 2.4, 3.8, 250, "1 salad", ["greek salad"]),
    ("Protein Shake, whey", 88, 16.0, 4.0, 1.2, 0.5, 2.5, 325, "1 scoop in water", ["protein shake", "whey shake"]),
    ("Clif Bar, chocolate chip", 412, 10.3, 65.0, 10.3, 5.9, 23.5, 68, "1 bar", ["clif bar"]),
    ("Kind Bar, dark chocolate nuts", 486, 11.4, 40.0, 31.4, 8.6, 14.3, 40, "1 bar", ["kind bar"]),
    ("Quest Bar, chocolate chip cookie", 382, 38.2, 41.2, 14.7, 26.5, 2.0, 60, "1 bar", ["quest bar"]),
    ("Coca-Cola, can", 42, 0, 10.6, 0, 0, 10.6, 355, "12 fl oz", ["coke", "coca cola"]),
    ("Red Bull, regular can", 45, 0, 11.0, 0, 0, 11.0, 250, "8.4 fl oz", ["red bull"]),
    ("Olive Oil", 884, 0, 0, 100, 0, 0, 14, "1 tbsp", ["olive oil"]),
    ("Peanut Butter", 588, 25.1, 20.0, 50.4, 6.0, 9.2, 32, "2 tbsp", ["pb"]),
    ("White Rice, cooked", 130, 2.7, 28.2, 0.3, 0.4, 0.1, 158, "1 cup", ["rice"]),
    ("Brown Rice, cooked", 123, 2.7, 25.6, 1.0, 1.6, 0.2, 195, "1 cup", ["brown rice"]),
    ("Egg", 143, 12.6, 0.7, 9.5, 0, 0.4, 50, "1 large", ["egg", "eggs", "whole egg"]),
    ("Banana", 89, 1.1, 22.8, 0.3, 2.6, 12.2, 118, "1 medium", ["banana", "bananas"]),
    ("Oatmeal", 68, 2.4, 12.0, 1.4, 1.7, 0.5, 234, "1 cup cooked", ["oatmeal", "oats", "bowl of oatmeal"]),
    ("Blueberries", 57, 0.7, 14.5, 0.3, 2.4, 10.0, 148, "1 cup", ["blueberry", "blueberries"]),
    ("Toast", 313, 9.0, 58.0, 4.2, 2.7, 5.7, 27, "1 slice", ["toast", "slice of toast"]),
    ("Butter", 717, 0.9, 0.1, 81.1, 0, 0.1, 5, "1 tsp", ["butter", "pat of butter"]),
    ("Scrambled Eggs, 2 large", 149, 10.0, 1.6, 11.0, 0, 1.4, 122, "2 large eggs", ["scrambled eggs", "scrambled egg"]),
    ("Grilled Chicken Breast", 165, 31.0, 0, 3.6, 0, 0, 120, "4 oz", ["chicken breast", "grilled chicken"]),
    ("Whey Protein Powder", 393, 78.6, 10.7, 3.6, 0, 3.6, 30, "1 scoop", ["whey", "protein powder"]),
]


def add_extra(store: dict, row: tuple) -> None:
    name, kcal, p, c, f, fiber, sugar, serve_g, label, aliases = row
    key = norm(name)
    if key in store:
        # still add aliases onto existing if present
        existing = store[key]
        existing["aliases"] = sorted(set(existing.get("aliases", [])) | set(aliases))
        return
    store[key] = {
        "id": f"extra-{abs(hash(key)) % 10_000_000}",
        "name": name,
        "emoji": emoji_for(name),
        "category": category_for(name),
        "kcal": float(kcal),
        "protein": float(p),
        "carbs": float(c),
        "fat": float(f),
        "fiber": float(fiber),
        "sugar": float(sugar),
        "serveG": float(serve_g),
        "serveLabel": label,
        "source": "compiled",
        "aliases": aliases,
    }


def load_json(path: Path) -> dict:
    print(f"loading {path} ...", flush=True)
    with path.open() as f:
        return json.load(f)


def main() -> None:
    store: dict[str, dict] = {}

    fndds = load_json(SRC / "surveyDownload.json")
    for item in fndds.get("SurveyFoods") or []:
        wweia = ((item.get("wweiaFoodCategory") or {}).get("wweiaFoodCategoryDescription") or "")
        add_food(store, item, "fndds", wweia)
    print(f" after FNDDS: {len(store)}")

    foundation = load_json(SRC / "FoodData_Central_foundation_food_json_2025-12-18.json")
    for item in foundation.get("FoundationFoods") or []:
        add_food(store, item, "foundation")
    print(f" after Foundation: {len(store)}")

    sr_path = SRC / "FoodData_Central_sr_legacy_food_json_2018-04.json"
    if sr_path.exists():
        sr = load_json(sr_path)
        for item in sr.get("SRLegacyFoods") or []:
            add_food(store, item, "sr")
        print(f" after SR Legacy: {len(store)}")

    for row in EXTRAS:
        add_extra(store, row)
    print(f" after extras: {len(store)}")

    foods = sorted(store.values(), key=lambda x: x["name"].lower())
    # drop empty names
    foods = [f for f in foods if f["name"]]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "sources": ["USDA FNDDS 2021-2023", "USDA Foundation Foods 2025-12", "USDA SR Legacy 2018", "compiled extras"],
        "count": len(foods),
        "foods": foods,
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    size_mb = OUT.stat().st_size / 1_000_000
    print(f"wrote {OUT} ({len(foods)} foods, {size_mb:.1f} MB)")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(exc, file=sys.stderr)
        raise
