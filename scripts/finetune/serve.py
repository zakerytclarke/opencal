#!/usr/bin/env python3
"""Local inference server for the fine-tuned OpenCal VLM.

The Vite dev server proxies /vlm → this process so the PWA can use the
PyTorch checkpoint without Hugging Face or ONNX. Not for production Pages.

  /home/zclarke/ml_env/bin/python scripts/finetune/serve.py
  npm run dev
"""

from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import torch
from PIL import Image
from transformers import AutoModelForImageTextToText, AutoProcessor

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from infer import EXTRACT_PREFIX, generate, parse_foods  # noqa: E402
from prompts import (  # noqa: E402
    EXTRACT_SYSTEM,
    EXTRACT_USER,
    PHOTO_EXTRACT_SYSTEM,
    PHOTO_EXTRACT_USER,
    PHOTO_PORTION_SYSTEM,
    PICK_NONE_LINE,
    PICK_SYSTEM,
    PICK_USER_TAIL,
    TEXT_PORTION_SYSTEM,
)

DEFAULT_CKPT = ROOT / "evals" / "data" / "finetune" / "ckpts" / "lfm25vl-opencal"
PICK_PREFIX = '{"pick":'

MODEL = None
PROCESSOR = None
DEVICE = None
CKPT = DEFAULT_CKPT


def load(ckpt: Path):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"loading {ckpt} on {device}", flush=True)
    processor = AutoProcessor.from_pretrained(str(ckpt), trust_remote_code=True, max_image_tokens=256)
    model = AutoModelForImageTextToText.from_pretrained(
        str(ckpt),
        dtype=torch.bfloat16 if device.type == "cuda" else torch.float32,
        device_map="auto" if device.type == "cuda" else None,
        trust_remote_code=True,
    )
    model.eval()
    return model, processor, device


def extract_text(meal: str) -> dict:
    messages = [
        {"role": "system", "content": [{"type": "text", "text": EXTRACT_SYSTEM}]},
        {"role": "user", "content": [{"type": "text", "text": EXTRACT_USER.format(meal=meal)}]},
    ]
    raw = generate(MODEL, PROCESSOR, messages, 220, DEVICE, EXTRACT_PREFIX)
    return {"raw": raw, "items": parse_foods(raw)}


def extract_photo(image: Image.Image) -> dict:
    messages = [
        {"role": "system", "content": [{"type": "text", "text": PHOTO_EXTRACT_SYSTEM}]},
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image.convert("RGB")},
                {"type": "text", "text": PHOTO_EXTRACT_USER},
            ],
        },
    ]
    raw = generate(MODEL, PROCESSOR, messages, 220, DEVICE, EXTRACT_PREFIX)
    return {"raw": raw, "items": parse_foods(raw)}


def portion_photo(image: Image.Image, catalog: str) -> dict:
    messages = [
        {"role": "system", "content": [{"type": "text", "text": PHOTO_PORTION_SYSTEM}]},
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image.convert("RGB")},
                {"type": "text", "text": catalog},
            ],
        },
    ]
    raw = generate(MODEL, PROCESSOR, messages, 280, DEVICE, EXTRACT_PREFIX)
    return {"raw": raw, "items": parse_foods(raw)}


def portion_text(catalog: str) -> dict:
    messages = [
        {"role": "system", "content": [{"type": "text", "text": TEXT_PORTION_SYSTEM}]},
        {"role": "user", "content": [{"type": "text", "text": catalog}]},
    ]
    raw = generate(MODEL, PROCESSOR, messages, 280, DEVICE, EXTRACT_PREFIX)
    return {"raw": raw, "items": parse_foods(raw)}


def pick(meal: str, item: dict, lines: list[str]) -> dict:
    brand = item.get("brand")
    brand_s = f" brand {brand}" if brand else ""
    portion = " ".join(str(x) for x in [item.get("quantity"), item.get("unit")] if x not in (None, ""))
    query = item.get("query") or item.get("name") or ""
    user = "\n".join(
        [
            f"Meal: {meal}",
            f"Item: {query}{brand_s}{', about ' + portion if portion else ''}",
            "Database hits (USDA reference + convert_portion for this item):",
            *lines,
            PICK_NONE_LINE,
            PICK_USER_TAIL,
        ]
    )
    messages = [
        {"role": "system", "content": [{"type": "text", "text": PICK_SYSTEM}]},
        {"role": "user", "content": [{"type": "text", "text": user}]},
    ]
    raw = generate(MODEL, PROCESSOR, messages, 80, DEVICE, PICK_PREFIX)
    if not raw.strip().startswith("{"):
        raw = PICK_PREFIX + raw
    return {"raw": raw}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path in {"/health", "/vlm/health"}:
            self._json(200, {"ok": True, "model": str(CKPT)})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            if path in {"/extract-text", "/vlm/extract-text"}:
                payload = json.loads(raw.decode() or "{}")
                self._json(200, extract_text(str(payload.get("text") or payload.get("meal") or "")))
                return
            if path in {"/portion-text", "/vlm/portion-text"}:
                payload = json.loads(raw.decode() or "{}")
                catalog = str(payload.get("catalog") or payload.get("text") or payload.get("meal") or "")
                self._json(200, portion_text(catalog))
                return
            if path in {"/pick", "/vlm/pick"}:
                payload = json.loads(raw.decode() or "{}")
                self._json(
                    200,
                    pick(
                        str(payload.get("meal") or ""),
                        payload.get("item") or {},
                        list(payload.get("lines") or []),
                    ),
                )
                return
            if path in {"/extract-photo", "/vlm/extract-photo"}:
                parsed = _parse_multipart(self.headers.get("Content-Type") or "", raw)
                image = parsed.get("image")
                if image is None:
                    image = _image_from_bytes(raw)
                if image is None:
                    self._json(400, {"error": "expected an image file"})
                    return
                self._json(200, extract_photo(image))
                return
            if path in {"/portion-photo", "/vlm/portion-photo"}:
                parsed = _parse_multipart(self.headers.get("Content-Type") or "", raw)
                image = parsed.get("image")
                catalog = str(parsed.get("catalog") or "")
                if image is None:
                    self._json(400, {"error": "expected an image file"})
                    return
                self._json(200, portion_photo(image, catalog))
                return
        except Exception as exc:
            self._json(500, {"error": str(exc)})
            return
        self._json(404, {"error": "not found"})


def _image_from_bytes(body: bytes) -> Image.Image | None:
    import io

    for magic in (b"\xff\xd8\xff", b"\x89PNG"):
        i = body.find(magic)
        if i >= 0:
            try:
                return Image.open(io.BytesIO(body[i:])).convert("RGB")
            except Exception:
                continue
    try:
        return Image.open(io.BytesIO(body)).convert("RGB")
    except Exception:
        return None


def _parse_multipart(content_type: str, body: bytes) -> dict:
    out: dict = {}
    if "multipart/form-data" not in content_type:
        image = _image_from_bytes(body)
        if image is not None:
            out["image"] = image
        return out
    import email
    import io

    header = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n"
    msg = email.message_from_bytes(header.encode() + body)
    for part in msg.walk():
        name = part.get_param("name", header="content-disposition")
        data = part.get_payload(decode=True)
        if not name or data is None:
            continue
        if name == "catalog":
            out["catalog"] = data.decode("utf-8", errors="replace")
        elif name == "image" or part.get_content_maintype() == "image" or part.get_filename():
            try:
                out["image"] = Image.open(io.BytesIO(data)).convert("RGB")
            except Exception:
                pass
    if "image" not in out:
        image = _image_from_bytes(body)
        if image is not None:
            out["image"] = image
    return out


def main() -> None:
    global MODEL, PROCESSOR, DEVICE, CKPT
    p = argparse.ArgumentParser()
    p.add_argument("--ckpt", default=str(DEFAULT_CKPT))
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8765)
    args = p.parse_args()
    CKPT = Path(args.ckpt)
    if not (CKPT / "config.json").exists():
        sys.exit(f"missing checkpoint {CKPT}")
    MODEL, PROCESSOR, DEVICE = load(CKPT)
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"OpenCal VLM local server http://{args.host}:{args.port}/health", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
