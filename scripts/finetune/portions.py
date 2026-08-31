"""Python port of src/lib/portions.ts convert_portion.

Grams from NIST/FDA/USDA household weights. Calories from USDA per 100 g only.
"""

from __future__ import annotations

import re
from typing import Any

UNIT_ALIAS = {
    "gram": "g",
    "grams": "g",
    "kilogram": "kg",
    "kilograms": "kg",
    "ounce": "oz",
    "ounces": "oz",
    "pound": "lb",
    "pounds": "lb",
    "lbs": "lb",
    "milliliter": "ml",
    "milliliters": "ml",
    "millilitre": "ml",
    "millilitres": "ml",
    "liter": "l",
    "liters": "l",
    "litre": "l",
    "litres": "l",
    "cups": "cup",
    "tablespoon": "tbsp",
    "tablespoons": "tbsp",
    "teaspoon": "tsp",
    "teaspoons": "tsp",
    "slices": "slice",
    "pieces": "piece",
    "items": "item",
    "servings": "serving",
    "bars": "bar",
    "cans": "can",
    "bottles": "bottle",
    "bowls": "bowl",
    "handfuls": "handful",
    "scoops": "scoop",
    "glasses": "glass",
    "plates": "plate",
    "sandwiches": "sandwich",
    "tacos": "taco",
    "burritos": "burrito",
    "wraps": "wrap",
    "eggs": "egg",
    "muffins": "muffin",
    "cookies": "cookie",
    "bagels": "bagel",
    "nuggets": "nugget",
    "patties": "patty",
    "containers": "container",
    "pouches": "pouch",
}

MASS_G = {"g": 1.0, "kg": 1000.0, "oz": 28.349523125, "lb": 453.59237}
VOLUME_ML = {"ml": 1.0, "l": 1000.0, "cup": 240.0, "tbsp": 15.0, "tsp": 5.0, "fl oz": 29.5735295625}
FLOZ = VOLUME_ML["fl oz"]
NAMED_ML = {
    "short": 8 * FLOZ,
    "tall": 12 * FLOZ,
    "grande": 16 * FLOZ,
    "venti": 20 * FLOZ,
}
COUNT_UNITS = {
    "slice",
    "piece",
    "item",
    "each",
    "serving",
    "bar",
    "can",
    "bottle",
    "bowl",
    "handful",
    "scoop",
    "glass",
    "plate",
    "sandwich",
    "taco",
    "burrito",
    "wrap",
    "egg",
    "muffin",
    "cookie",
    "bagel",
    "nugget",
    "patty",
    "container",
    "pouch",
}
SIZE_FACTOR = {
    "extra small": 0.75,
    "small": 0.75,
    "medium": 1.0,
    "large": 1.25,
    "extra large": 1.25,
}


def canon_unit(unit: str | None) -> str:
    if not unit:
        return ""
    s = re.sub(r"\s+", " ", unit.lower().replace(".", "")).strip()
    if s in {"fl oz", "floz", "fluid ounce", "fluid ounces"}:
        return "fl oz"
    return UNIT_ALIAS.get(s, s)


def _parse_qty(raw: str) -> float | None:
    t = raw.strip()
    if re.fullmatch(r"\d+/\d+", t):
        a, b = t.split("/")
        return float(a) / float(b) if float(b) else None
    try:
        n = float(t)
    except ValueError:
        return None
    return n if n > 0 else None


def parse_household(label: str) -> dict | None:
    text = re.sub(r"\s+", " ", label).strip()
    m = re.match(r"^([\d.]+|\d+/\d+)\s+(.+)$", text, re.I)
    if not m:
        return None
    qty = _parse_qty(m.group(1))
    if qty is None:
        return None
    rest = m.group(2).lower()
    if rest.startswith("fl oz") or rest.startswith("fluid oz"):
        return {"qty": qty, "unit": "fl oz", "ml": qty * VOLUME_ML["fl oz"], "massG": None}
    first = re.split(r"[,/]", rest)[0].strip()
    unit = canon_unit(first.split()[0] if first else rest)
    if not unit:
        return None
    if unit in MASS_G:
        return {"qty": qty, "unit": unit, "ml": None, "massG": qty * MASS_G[unit]}
    if unit in VOLUME_ML:
        return {"qty": qty, "unit": unit, "ml": qty * VOLUME_ML[unit], "massG": None}
    return {"qty": qty, "unit": unit, "ml": None, "massG": None}


def scale_nutrition(food: dict, grams: float) -> dict:
    f = grams / 100.0
    return {
        "kcal": int(round(float(food["kcal"]) * f)),
        "protein": round(float(food.get("protein") or 0) * f, 1),
        "carbs": round(float(food.get("carbs") or 0) * f, 1),
        "fat": round(float(food.get("fat") or 0) * f, 1),
    }


def _pack(food: dict, grams: float, method: str, detail: str) -> dict:
    g = max(0.1, grams)
    return {"grams": g, "method": method, "detail": detail, **scale_nutrition(food, g)}


def _density(food: dict) -> float | None:
    house = parse_household(food.get("serveLabel") or "")
    serve_g = float(food.get("serveG") or 0)
    if house and house.get("ml") and house["ml"] > 0 and serve_g > 0:
        return serve_g / house["ml"]
    return None


def _volume_grams(food: dict, user_ml: float, named: bool) -> dict:
    density = _density(food)
    house = parse_household(food.get("serveLabel") or "")
    serve_g = float(food.get("serveG") or 0)
    if density is not None and house and house.get("ml"):
        grams = serve_g * (user_ml / house["ml"])
        method = "named-size+usda-density" if named else "fda-volume+usda-density"
        return _pack(
            food,
            grams,
            method,
            f"{user_ml:.0f} mL × USDA {food.get('serveLabel')} ({serve_g} g / {house['ml']:.0f} mL)",
        )
    return _pack(food, user_ml, "fda-volume+water", f"{user_ml:.0f} mL at 1 g/mL")


def _household_count(food: dict, user_qty: float, unit: str) -> float:
    house = parse_household(food.get("serveLabel") or "")
    serve_g = float(food.get("serveG") or 0)
    label = (food.get("serveLabel") or "").lower()
    if house and (house["unit"] == unit or unit in label):
        return serve_g * (user_qty / house["qty"])
    return serve_g * user_qty


def convert_portion(food: dict, qty: float, unit: str | None) -> dict:
    qty = qty if qty and qty > 0 else 1.0
    unit = canon_unit(unit)
    serve_g = float(food.get("serveG") or 0)
    label = food.get("serveLabel") or ""

    if unit in MASS_G:
        grams = MASS_G[unit] * qty
        return _pack(food, grams, "nist-mass", f"{qty} {unit} × NIST {MASS_G[unit]} g")

    if unit in NAMED_ML:
        return _volume_grams(food, NAMED_ML[unit] * qty, True)

    if unit in VOLUME_ML:
        house = parse_household(label)
        if house and (house["unit"] == unit or (house.get("ml") and canon_unit(house["unit"]) == unit)):
            return _pack(
                food,
                serve_g * (qty / house["qty"]),
                "usda-household",
                f"{qty} {unit} from USDA {label} = {serve_g} g",
            )
        if house and house.get("ml"):
            return _volume_grams(food, VOLUME_ML[unit] * qty, False)
        if unit in label.lower() or (unit == "cup" and re.search(r"\bcups?\b", label.lower())):
            return _pack(food, serve_g * qty, "usda-household", f"{qty} × USDA {label}")
        return _volume_grams(food, VOLUME_ML[unit] * qty, False)

    if not unit:
        return _pack(food, serve_g * qty, "usda-serving", f"{qty} × USDA {label} ({serve_g} g)")

    if unit in SIZE_FACTOR:
        house = parse_household(label)
        if house and (house["unit"] == unit or re.search(r"medium|small|large", label.lower())):
            base = serve_g * (qty / house["qty"])
        else:
            base = serve_g * qty
        return _pack(
            food,
            base * SIZE_FACTOR[unit],
            "usda-household",
            f"{qty} {unit} × USDA {label}",
        )

    if unit in COUNT_UNITS:
        return _pack(
            food,
            _household_count(food, qty, unit),
            "usda-household",
            f"{qty} {unit} × USDA {label} ({serve_g} g)",
        )

    blob = f"{label} {food.get('name') or ''}".lower()
    if unit in blob:
        return _pack(food, serve_g * qty, "usda-household", f"{qty} × USDA {label}")
    return _pack(food, serve_g * qty, "usda-serving", f"{qty} {unit} → USDA serving {serve_g} g")


def portion_tool_line(food: dict, qty: float, unit: str | None) -> str:
    result = convert_portion(food, qty, unit)
    u = unit or "serving"
    grams = int(round(result["grams"]))
    serve_g = int(round(float(food.get("serveG") or 0)))
    return (
        f"USDA {food.get('serveLabel')} ({serve_g} g) · "
        f"convert_portion {qty} {u} → {grams} g, {result['kcal']} kcal"
    )
