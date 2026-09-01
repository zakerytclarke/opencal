#!/usr/bin/env python3
"""Label Food-101 dish photos with GPT-5.5 (name/brand/grams) and emit the
OpenCal gram fine-tune format.

Two tasks are produced:
  * gram_image  : photo -> {"foods":[{name,brand,grams}]}   (primary; closes the real-photo gap)
  * gram_text   : "I had {dish}" meal sentence -> same grams (secondary teacher distill)

Row schema mirrors evals/data/finetune/gram-v4/train.jsonl 1:1:
  {"task": "gram_image", "image": "/abs/path.jpg",
   "messages": [system, user(GRAM_IMAGE_USER), assistant(JSON)], "meta": {...}}

Resumable: labels are appended to labels.jsonl keyed by f101-s{si}-r{ri};
already-labeled rows are skipped on rerun.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import random
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pyarrow.parquet as pq
from PIL import Image

sys.path.insert(0, "scripts/finetune")
from prompts import GRAM_SYSTEM, GRAM_IMAGE_USER, GRAM_TEXT_USER  # type: ignore
from openai import OpenAI  # type: ignore

os.environ["OPENAI_API_KEY"] = open("/tmp/opencode/.openai_key").read().strip()

ROOT = Path("evals/data/food101").resolve()
DATA = ROOT / "data"
IMGS = ROOT / "images"


def shards() -> list[Path]:
    return sorted(DATA.glob("train-*.parquet"))


def classes() -> dict[int, str]:
    m = json.loads((ROOT / "classes.json").read_text())
    return {int(k): v for k, v in m.items()}


def sample(per_class: int, seed: int = 42) -> list[tuple[int, int, int]]:
    """Pick ~per_class rows for every class, spread evenly across that class's
    occurrences (which span shards). Returns (shard_idx, row_index, class)."""
    by_class: dict[int, list[tuple[int, int]]] = defaultdict(list)
    n_shards = len(shards())
    for si in range(n_shards):
        t = pq.read_table(str(shards()[si]), columns=["label"])
        labels = t["label"].to_pylist()
        for ri, l in enumerate(labels):
            by_class[int(l)].append((si, ri))

    picked: list[tuple[int, int, int]] = []
    rng = random.Random(seed)
    for c, lst in by_class.items():
        k = min(per_class, len(lst))
        step = len(lst) / k
        for i in range(k):
            si, ri = lst[int(i * step)]
            picked.append((si, ri, c))
    rng.shuffle(picked)
    return picked


def parse_foods(txt: str) -> list[dict]:
    txt = (txt or "").strip()
    if txt.startswith("```"):
        txt = txt.split("\n", 1)[1].rsplit("```", 1)[0]
    d = json.loads(txt)
    items = d.get("foods") if isinstance(d, dict) else d
    out = []
    for f in items or []:
        name = (f.get("name") or "").strip()
        try:
            g = int(round(float(f.get("grams") or 0)))
        except Exception:
            g = 0
        if not name or g <= 0:
            continue
        out.append({"name": name, "brand": f.get("brand"), "grams": max(5, min(1000, g))})
    return out


def label_images(picked, workers, model, limit=0) -> None:
    cls = classes()
    IMGS.mkdir(parents=True, exist_ok=True)
    client = OpenAI(max_retries=3)

    done = set()
    lp = ROOT / "labels.jsonl"
    if lp.exists():
        for line in lp.read_text().splitlines():
            if line.strip():
                try:
                    done.add(json.loads(line)["id"])
                except Exception:
                    pass

    todo = [p for p in picked if f"f101-s{p[0]}-r{p[1]}" not in done]
    if limit:
        todo = todo[:limit]
    print(f"total picked {len(picked)} | already done {len(done)} | to label {len(todo)}", flush=True)
    if not todo:
        return

    # group by shard so each shard's image column is read once
    by_shard: dict[int, list[tuple[int, int, int]]] = defaultdict(list)
    for si, ri, cl in todo:
        by_shard[si].append((si, ri, cl))

    tok_in = tok_out = 0
    n = 0
    t0 = time.time()
    class_lookup = {(si, ri): cl for si, ri, cl in todo}

    def work(si: int, ri: int, imgbytes: bytes) -> dict | None:
        p = IMGS / f"f101-s{si}-r{ri}.jpg"
        if not p.exists():
            im = Image.open(io.BytesIO(imgbytes)).convert("RGB")
            im.thumbnail((640, 640))
            im.save(p, quality=85)
        b64 = base64.b64encode(p.read_bytes()).decode()
        last = None
        for a in range(4):
            try:
                r = client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": [
                        {"type": "text", "text": GRAM_SYSTEM + "\n\n" + GRAM_IMAGE_USER},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    ]}],
                )
                items = parse_foods(r.choices[0].message.content)
                if not items:
                    last = RuntimeError("empty foods")
                    continue
                tin = r.usage.prompt_tokens if r.usage else 0
                tout = r.usage.completion_tokens if r.usage else 0
                return {"si": si, "ri": ri, "in": tin, "out": tout}, items
            except Exception as e:  # noqa: BLE001
                last = e
                time.sleep(2 * (a + 1))
        return {"si": si, "ri": ri, "err": str(last)}, None

    with open(lp, "a", buffering=1) as lf:
        for si in sorted(by_shard):
            rows = by_shard[si]
            print(f"[shard {si}] loading {len(rows)} selected images", flush=True)
            col = pq.read_table(str(shards()[si]), columns=["image"]).column(0)
            with ThreadPoolExecutor(max_workers=workers) as ex:
                futs = {ex.submit(work, si, ri, col[ri].as_py()["bytes"]): (si, ri)
                        for si, ri, cl in rows}
                for fu in as_completed(futs):
                    si, ri = futs[fu]
                    try:
                        hdr, items = fu.result()
                    except Exception as e:  # noqa: BLE001
                        print(f"  skip s{si}-r{ri}: {e}", file=sys.stderr, flush=True)
                        continue
                    if items is None:
                        print(f"  skip s{si}-r{ri}: {hdr.get('err', 'empty')}", file=sys.stderr, flush=True)
                        continue
                    tok_in += hdr["in"]; tok_out += hdr["out"]; n += 1
                    row = {
                        "id": f"f101-s{si}-r{ri}",
                        "class": class_lookup.get((si, ri)),
                        "img": str(IMGS / f"f101-s{si}-r{ri}.jpg"),
                        "foods": items,
                    }
                    lf.write(json.dumps(row) + "\n")
                    if n % 50 == 0:
                        dt = (time.time() - t0) / n
                        print(f"  {n} labeled | {dt:.2f}s/img | tok in={tok_in:,} out={tok_out:,}", flush=True)
        print(f"DONE {n} labeled | {len(done) + n} total | tok in={tok_in:,} out={tok_out:,} | {time.time()-t0:.0f}s", flush=True)


def build_dataset(train_path, val_path, with_text: bool, per_val: int = 0) -> None:
    labels = [json.loads(l) for l in (ROOT / "labels.jsonl").read_text().splitlines() if l.strip()]
    # deterministic split: ~per_val per class held out for val, rest train
    from collections import defaultdict as dd
    byc = dd(list)
    for r in labels:
        byc[r.get("class")].append(r)
    rng = random.Random(42)
    val, train = [], []
    for cl, rows in byc.items():
        rng.shuffle(rows)
        k = min(per_val, len(rows)) if per_val else 0
        val.extend(rows[:k]); train.extend(rows[k:])
    rng.shuffle(train); rng.shuffle(val)

    def gram_image_row(r: dict) -> dict:
        img = Path(r["img"])
        if not img.is_absolute():
            img = img.resolve()
        return {
            "task": "gram_image", "image": str(img),
            "messages": [
                {"role": "system", "content": GRAM_SYSTEM},
                {"role": "user", "content": GRAM_IMAGE_USER},
                {"role": "assistant", "content": json.dumps({"foods": r["foods"]})},
            ],
            "meta": {"id": r["id"], "class": r.get("class"), "source": "food101-gpt55"},
        }

    def gram_text_row(r: dict) -> dict:
        meal = f"I had {r.get('class') or 'a meal'} for a meal"
        return {
            "task": "gram_text", "image": None,
            "messages": [
                {"role": "system", "content": GRAM_SYSTEM},
                {"role": "user", "content": GRAM_TEXT_USER.format(meal=meal)},
                {"role": "assistant", "content": json.dumps({"foods": r["foods"]})},
            ],
            "meta": {"id": r["id"] + "-t", "class": r.get("class"), "source": "food101-gpt55-text"},
        }

    def write(path: Path, rows: list) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            for r in rows:
                f.write(json.dumps(gram_image_row(r)) + "\n")
                if with_text:
                    f.write(json.dumps(gram_text_row(r)) + "\n")

    write(train_path, train)
    write(val_path, val)
    print(f"dataset: train={len(train)} images ({len(train) * (2 if with_text else 1)} rows) val={len(val)} images", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-class", type=int, default=50)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--model", default="gpt-5.5")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--text", action="store_true", help="also emit weak gram_text rows (dish name only)")
    ap.add_argument("--val-per-class", type=int, default=10)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-label", action="store_true")
    ap.add_argument("--no-build", action="store_true")
    args = ap.parse_args()

    picked = sample(args.per_class, args.seed)
    if not args.no_label:
        label_images(picked, args.workers, args.model, limit=args.limit)
    if not args.no_build:
        build_dataset(ROOT / "train.jsonl", ROOT / "val.jsonl", args.text, args.val_per_class)


if __name__ == "__main__":
    main()
