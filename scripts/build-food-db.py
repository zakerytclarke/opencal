#!/usr/bin/env python3
"""Compile USDA datasets into a compact on-device food DB.

Sources we use, in order of how people actually log food:

1. Compiled extras (`scripts/food-extras.json` + EXTRAS below)
   Everyday names and household servings (1 medium banana, 1 KIND bar).
   These are always `visibility: search`.

2. USDA Branded Foods (optional dump in /tmp/opencal-usda)
   Grocery / package labels: KIND, Chobani, boxed cereal, cans.
   Filter hard — the dump is ~1.5M SKUs / 3 GB unzipped.
   Download: https://fdc.nal.usda.gov/download-datasets.html
   Place `FoodData_Central_branded_food_json_*.json` (or a folder of shards)
   next to the other USDA files. Always `visibility: search`.

3. USDA FNDDS / Foundation / SR Legacy
   Nutrition reference. Rows with a nice name + household serving are
   `visibility: search` (the catalog people type into). Garnish slices,
   lab stubs, baby food, and 100 g-only rows are `visibility: ref` and
   stay available to the on-device matcher, not the search UI.

Restaurant bowls and sandwiches are rarely in Branded Foods (no UPC).
Add those to food-extras.json from the chain's published facts.

Open Food Facts is a future grocery source (CC-BY-SA, must attribute).
Do not scrape proprietary apps.

Usage:
  python3 scripts/build-food-db.py              # full rebuild from /tmp/opencal-usda
  python3 scripts/build-food-db.py --label-only  # relabel + merge extras into public/foods.json
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

SRC = Path("/tmp/opencal-usda")
OUT = Path(__file__).resolve().parents[1] / "public" / "foods.json"
EXTRAS_FILE = Path(__file__).resolve().parent / "food-extras.json"

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


REF_NAME = re.compile(
    r"baby ?food|baby toddler|\binfant\b|as ingredient|for use (on|with)|topping from|"
    r"dehydrated|usda commodity|imitation|not specified|as to form|as to fat|"
    r"with added vegetables|ns as to|from other sources|for use as",
    re.I,
)
NICE_LABEL = re.compile(
    r"\b(medium|small|large|extra large|extra small|slice|sandwich|bar|can|bottle|"
    r"bowl|burrito|taco|cup|tbsp|tablespoon|tsp|egg|bagel|muffin|cookie|patty|"
    r"fillet|container|pouch|grande|wrap|platter|nugget|pizza|"
    r"piece|item|each|serving|scoops?)\b",
    re.I,
)
UGLY_LABEL = re.compile(r"refuse|yield from|quantity not|^1 fl oz$|^100 g$|fl oz \(with ice\)", re.I)
KEEP_SLICE = re.compile(r"pizza|bread|toast|bagel|muffin|bacon|nugget|pancake|waffle", re.I)
BRAND_HINT = re.compile(
    r"\b(chobani|starbucks|mcdonald|kind |chipotle|applebee|burger king|trader joe|"
    r"kellogg|general mills|pepsi|coca-cola|coke|quest |clif |fairlife|oatly|"
    r"silk |fage|dannon|danone|hormel|tyson|barilla|chick-fil-a|taco bell|"
    r"dunkin|subway|in-n-out)\b",
    re.I,
)

# Popular brand owners to keep from the huge USDA branded dump.
BRANDED_ALLOW = {
    "kind inc",
    "kind llc",
    "chobani llc",
    "chobani",
    "the coca-cola company",
    "pepsico",
    "pepsico, inc.",
    "general mills",
    "kellogg",
    "kellogg company",
    "nestle usa",
    "nestlé usa, inc.",
    "danone",
    "dannon",
    "fairlife",
    "the hain celestial group",
    "clif bar & company",
    "quest nutrition",
    "hormel foods",
    "tyson foods",
    "barilla",
    "campbell soup company",
    "the j.m. smucker company",
    "conagra",
    "kraft heinz",
    "unilever",
    "starbucks coffee company",
    "dunkin",
}


def classify_visibility(food: dict) -> str:
    """search = catalog UI. ref = LLM / matcher only."""
    source = food.get("source") or ""
    if source in ("compiled", "branded"):
        return "search"
    name = food.get("name") or ""
    label = food.get("serveLabel") or ""
    grams = float(food.get("serveG") or 0)
    kcal = float(food.get("kcal") or 0)
    if kcal < 5:
        return "ref"
    if REF_NAME.search(name):
        return "ref"
    if len(name) > 64:
        return "ref"
    racc_ok = "racc" in label.lower() and 40 <= grams <= 220
    if UGLY_LABEL.search(label) and not racc_ok:
        return "ref"
    if name.count(",") >= 3 and not BRAND_HINT.search(name) and not NICE_LABEL.search(label):
        return "ref"
    first = name.split(",")[0].strip()
    branded = first.isupper() and len(first) > 3
    if branded and 30 <= grams <= 650:
        return "search"
    if BRAND_HINT.search(name) and 30 <= grams <= 650:
        return "search"
    if grams < 28:
        if KEEP_SLICE.search(name) and re.search(r"slice|piece", label, re.I) and grams >= 8:
            return "search"
        return "ref"
    if grams > 650:
        return "ref"
    if NICE_LABEL.search(label) or racc_ok:
        return "search"
    return "ref"


def apply_visibility(foods: list[dict]) -> list[dict]:
    for food in foods:
        food["visibility"] = classify_visibility(food)
    return foods


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


def add_extra_record(store: dict, rec: dict) -> None:
    name = rec.get("name") or ""
    key = norm(name)
    if not key:
        return
    aliases = list(rec.get("aliases") or [])
    if key in store:
        existing = store[key]
        existing["aliases"] = sorted(set(existing.get("aliases", [])) | set(aliases))
        return
    store[key] = {
        "id": rec.get("id") or f"extra-{key.replace(' ', '-')[:40]}",
        "name": name,
        "emoji": emoji_for(name),
        "category": category_for(name),
        "kcal": float(rec["kcal"]),
        "protein": float(rec["protein"]),
        "carbs": float(rec["carbs"]),
        "fat": float(rec["fat"]),
        "fiber": float(rec.get("fiber") or 0),
        "sugar": float(rec.get("sugar") or 0),
        "serveG": float(rec["serveG"]),
        "serveLabel": rec.get("serveLabel") or "1 serving",
        "source": "compiled",
        "aliases": aliases,
    }


def merge_json_extras(store: dict) -> int:
    if not EXTRAS_FILE.exists():
        return 0
    payload = json.loads(EXTRAS_FILE.read_text())
    before = len(store)
    for rec in payload.get("foods") or []:
        add_extra_record(store, rec)
    return len(store) - before


def branded_paths() -> list[Path]:
    hits: list[Path] = []
    if not SRC.exists():
        return hits
    hits.extend(sorted(SRC.glob("FoodData_Central_branded_food_json_*.json")))
    folder = SRC / "branded"
    if folder.is_dir():
        hits.extend(sorted(folder.glob("*.json")))
    return hits


def household_ok(text: str) -> bool:
    t = (text or "").lower()
    if not t or t in ("1 onz", "1 oz", "onz"):
        return False
    return bool(
        re.search(
            r"\b(bar|can|bottle|cup|container|pouch|slice|sandwich|bowl|taco|"
            r"cookie|muffin|bagel|bottle|pack|serving|tbsp|tablespoon|piece|"
            r"egg|scoop|wrap|burrito|grande|tall)\b",
            t,
        )
    )


def add_branded(store: dict, item: dict, per_brand: dict[str, int], cap: int = 24) -> None:
    owner = (item.get("brandOwner") or item.get("brandName") or "").strip()
    desc = (item.get("description") or "").strip()
    if not desc:
        return
    owner_key = owner.lower()
    allowed = any(a in owner_key or owner_key in a for a in BRANDED_ALLOW)
    if not allowed:
        return
    country = (item.get("marketCountry") or "United States").lower()
    if country and "united states" not in country and country not in ("us", "usa"):
        return
    nuts = nutrients(item)
    if nuts["kcal"] <= 0:
        return
    serve = item.get("servingSize") or 0
    unit = (item.get("servingSizeUnit") or "g").lower()
    if unit in ("ml", "mlt"):
        grams = float(serve) if serve else 0
    elif unit in ("g", "grm", "gram", "grams"):
        grams = float(serve) if serve else 0
    else:
        grams = float(serve) if serve else 0
    if not (18 <= grams <= 600):
        return
    house = (item.get("householdServingFullText") or "").strip()
    if not household_ok(house) and grams < 30:
        return
    if per_brand.get(owner_key, 0) >= cap:
        return
    brand = (item.get("brandName") or owner).strip()
    pretty = titleish(desc.title() if desc.isupper() else desc)
    name = f"{brand}, {pretty}" if brand and brand.lower() not in pretty.lower() else pretty
    key = norm(name)
    if key in store:
        return
    fdc = item.get("fdcId")
    if not fdc:
        return
    label = house or f"{grams:g} g"
    store[key] = {
        "id": f"branded-{fdc}",
        "name": name[:80],
        "emoji": emoji_for(name),
        "category": category_for(name, item.get("brandedFoodCategory") or ""),
        "kcal": round(nuts["kcal"], 1),
        "protein": round(nuts["protein"], 2),
        "carbs": round(nuts["carbs"], 2),
        "fat": round(nuts["fat"], 2),
        "fiber": round(nuts["fiber"], 2),
        "sugar": round(nuts["sugar"], 2),
        "serveG": round(grams, 1),
        "serveLabel": label,
        "source": "branded",
        "aliases": aliases_for(name) + ([brand.lower()] if brand else []),
    }
    per_brand[owner_key] = per_brand.get(owner_key, 0) + 1


def ingest_branded(store: dict) -> int:
    paths = branded_paths()
    if not paths:
        print(" no USDA branded dump (optional)")
        return 0
    before = len(store)
    per_brand: dict[str, int] = {}
    for path in paths:
        data = load_json(path)
        rows = data.get("BrandedFoods") or data.get("brandedFoods") or []
        if isinstance(data, list):
            rows = data
        for item in rows:
            add_branded(store, item, per_brand)
    print(f" after branded: {len(store)} (+{len(store) - before})")
    return len(store) - before


def write_foods(foods: list[dict]) -> None:
    foods = apply_visibility(sorted((f for f in foods if f.get("name")), key=lambda x: x["name"].lower()))
    search_n = sum(1 for f in foods if f.get("visibility") == "search")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 2,
        "sources": [
            "USDA FNDDS 2021-2023",
            "USDA Foundation Foods 2025-12",
            "USDA SR Legacy 2018",
            "USDA Branded Foods",
            "compiled extras",
        ],
        "count": len(foods),
        "searchCount": search_n,
        "foods": foods,
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    size_mb = OUT.stat().st_size / 1_000_000
    print(f"wrote {OUT} ({len(foods)} foods, {search_n} search catalog, {size_mb:.1f} MB)")


def load_json(path: Path) -> dict:
    print(f"loading {path} ...", flush=True)
    with path.open() as f:
        return json.load(f)


def label_only() -> None:
    payload = json.loads(OUT.read_text())
    foods = list(payload.get("foods") or [])
    ids = {f.get("id") for f in foods}
    names = {norm(f.get("name") or "") for f in foods}
    added = 0
    if EXTRAS_FILE.exists():
        for rec in json.loads(EXTRAS_FILE.read_text()).get("foods") or []:
            key = norm(rec.get("name") or "")
            if rec.get("id") in ids or key in names:
                continue
            store: dict[str, dict] = {}
            add_extra_record(store, rec)
            for food in store.values():
                foods.append(food)
                ids.add(food["id"])
                names.add(norm(food["name"]))
                added += 1
    print(f" merged {added} extras from {EXTRAS_FILE.name}")
    write_foods(foods)


def main() -> None:
    if "--label-only" in sys.argv:
        label_only()
        return

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

    ingest_branded(store)

    for row in EXTRAS:
        add_extra(store, row)
    added = merge_json_extras(store)
    print(f" after extras: {len(store)} (json +{added})")

    write_foods(list(store.values()))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(exc, file=sys.stderr)
        raise
