"""Try the gram model on your own photos.
Usage: tryphoto.py photo1.jpg photo2.png ...
"""
import sys, torch
from PIL import Image
from transformers import AutoModelForImageTextToText, AutoProcessor
from prompts import GRAM_SYSTEM, GRAM_IMAGE_USER
from infer import generate, parse_foods, EXTRACT_PREFIX

import pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
MODEL = str(ROOT / "evals/data/finetune/ckpts/lfm25vl-gram-v4-merged")
photos = [a for a in sys.argv[1:] if a.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".heic"))]
if not photos:
    raise SystemExit("usage: tryphoto.py photo1.jpg photo2.png ...")
device = torch.device("cuda")
proc = AutoProcessor.from_pretrained(MODEL, trust_remote_code=True, max_image_tokens=256)
model = AutoModelForImageTextToText.from_pretrained(
    MODEL, dtype=torch.bfloat16, device_map="auto", trust_remote_code=True).eval()
for p in photos:
    img = Image.open(p).convert("RGB")
    msgs = [
        {"role": "system", "content": [{"type": "text", "text": GRAM_SYSTEM}]},
        {"role": "user", "content": [{"type": "image", "image": img}, {"type": "text", "text": GRAM_IMAGE_USER}]},
    ]
    raw = generate(model, proc, msgs, 220, device, EXTRACT_PREFIX)
    print(f"\n== {p}")
    for f in parse_foods(raw):
        print(f"   {f['name']:30} {f.get('grams'):>6} g")
    print(f"   raw: {raw.strip()}")
