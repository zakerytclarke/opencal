"""Lightweight food-db search for photo RAG (training + Python infer).

Production mapping still uses MiniSearch in the TypeScript host.
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


def search_foods(foods: list[dict[str, Any]], query: str, k: int = 3) -> list[dict[str, Any]]:
    qtoks = [_stem(t) for t in tokens(query)]
    if not qtoks:
        return []
    scored: list[tuple[float, dict[str, Any]]] = []
    for food in foods:
        blob = (food.get("name") or "") + " " + " ".join(food.get("aliases") or [])
        ntoks = {_stem(t) for t in tokens(blob)}
        hit = sum(1 for t in qtoks if t in ntoks)
        if not hit:
            continue
        score = hit * 12.0
        if hit == len(qtoks):
            score += 20
        if food.get("visibility") == "search":
            score += 4
        serve = float(food.get("serveG") or 0)
        if serve >= 40:
            score += 6
        elif serve and serve < 15:
            score -= 8
        if float(food.get("kcal") or 0) < 5:
            score -= 10
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
