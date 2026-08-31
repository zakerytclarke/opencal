"""Lightweight food-db search for photo RAG (training + Python infer).

Prefer the same whole-food USDA row the TypeScript host would map to.
A 6 g garnish slice or an apple-pie filling must not become the visual ruler.
"""

from __future__ import annotations

import re
from typing import Any

STOP = {
    "a",
    "an",
    "the",
    "of",
    "and",
    "with",
    "raw",
    "cooked",
    "fresh",
    "frozen",
    "or",
    "in",
}

NOISE = {
    "pie",
    "filling",
    "sandwich",
    "juice",
    "salad",
    "soup",
    "cake",
    "cupcake",
    "bread",
    "butter",
    "canned",
    "platter",
    "tenders",
    "nugget",
    "chips",
    "chip",
    "candy",
    "dessert",
    "breakfast",
    "mayonnaise",
    "dressing",
}

_TOKEN = re.compile(r"[a-z0-9]+")


def tokens(s: str) -> list[str]:
    return [t for t in _TOKEN.findall(s.lower()) if t and t not in STOP]


def _stem(t: str) -> str:
    if t.endswith("ies") and len(t) > 4:
        return t[:-3] + "y"
    if t.endswith("s") and len(t) > 3 and not t.endswith("ss"):
        return t[:-1]
    return t


def _stems(s: str) -> list[str]:
    return [_stem(t) for t in tokens(s)]


def search_foods(foods: list[dict[str, Any]], query: str, k: int = 3) -> list[dict[str, Any]]:
    q = (query or "").strip().lower()
    qtoks = _stems(q)
    if not qtoks:
        return []
    oil = "oil" in qtoks
    scored: list[tuple[float, dict[str, Any]]] = []
    for food in foods:
        name = food.get("name") or ""
        aliases = food.get("aliases") or []
        blob = name + " " + " ".join(aliases)
        ntoks = set(_stems(blob))
        hit = sum(1 for t in qtoks if t in ntoks)
        if not hit:
            continue
        head = name.split(",")[0].strip().lower()
        htoks = _stems(head)
        extra = [t for t in htoks if t not in qtoks]
        score = hit * 10.0
        if hit == len(qtoks):
            score += 18
        if htoks == qtoks:
            score += 55
        elif head == q or head.rstrip("s") == q.rstrip("s"):
            score += 48
        elif htoks and qtoks and htoks[-1] == qtoks[-1] and len(htoks) <= len(qtoks) + 1:
            score += 22
        score -= 12 * len(extra)
        if any(t in NOISE for t in extra):
            score -= 28
        if food.get("visibility") == "search":
            score += 4
        serve = float(food.get("serveG") or 0)
        if serve >= 40:
            score += 6
        elif serve and serve < 12:
            score -= 18
        if float(food.get("kcal") or 0) < 5:
            score -= 12
        if oil:
            if 8 <= serve <= 20:
                score += 32
            elif serve >= 80:
                score -= 18
        scored.append((score, food))
    scored.sort(key=lambda x: -x[0])
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for _, food in scored:
        fid = str(food.get("id") or "")
        if fid in seen:
            continue
        seen.add(fid)
        out.append(food)
        if len(out) >= k:
            break
    return out


def catalog_lines(foods: list[dict[str, Any]], names: list[str], k: int = 3) -> list[str]:
    lines: list[str] = []
    for name in names:
        name = (name or "").strip()
        if not name:
            continue
        hits = search_foods(foods, name, k)
        if not hits:
            lines.append(f"- {name}: (no USDA row)")
            continue
        bits = []
        for i, food in enumerate(hits):
            letter = chr(65 + i)
            label = food.get("serveLabel") or "serving"
            grams = int(round(float(food.get("serveG") or 0)))
            bits.append(f"{letter}. {food.get('name')} · USDA {label} ({grams} g)")
        lines.append(f"- {name}: " + " | ".join(bits))
    return lines
