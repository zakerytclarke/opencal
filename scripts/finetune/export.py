#!/usr/bin/env python3
"""Export the fine-tuned checkpoint for local serving.

Writes:
  evals/data/finetune/export/hf/     HuggingFace snapshot (tokenizer + weights)
  public/models/lfm25vl-opencal/    transformers.js files when ONNX export succeeds

ONNX uses Liquid4All/onnx-export when available. The PWA also talks to
scripts/finetune/serve.py over /vlm without ONNX.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CKPT = ROOT / "evals" / "data" / "finetune" / "ckpts" / "lfm25vl-opencal"
HF_OUT = ROOT / "evals" / "data" / "finetune" / "export" / "hf"
PUBLIC = ROOT / "public" / "models" / "lfm25vl-opencal"


def copy_hf(src: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for name in (
        "config.json",
        "generation_config.json",
        "processor_config.json",
        "preprocessor_config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "chat_template.jinja",
        "model.safetensors",
        "model.safetensors.index.json",
    ):
        p = src / name
        if p.exists():
            shutil.copy2(p, dest / name)
    meta = {
        "source": str(src),
        "note": "OpenCal fine-tune. Calories still come from USDA convert_portion, not the model.",
    }
    (dest / "opencal.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"wrote HF snapshot {dest}")


def try_onnx(src: Path, dest: Path) -> bool:
    """Best-effort LiquidONNX export into a transformers.js-shaped folder."""
    exporter = shutil.which("lfm2-vl-export")
    onnx_export = Path.home() / "onnx-export"
    cmd = None
    if exporter:
        cmd = [exporter, str(src), "--precision", "fp16", "q4"]
    elif shutil.which("uv") and (onnx_export / "pyproject.toml").exists():
        cmd = ["uv", "run", "lfm2-vl-export", str(src), "--precision", "fp16", "q4"]
    if not cmd:
        print("LiquidONNX exporter not found — skip ONNX (local serve.py still works)")
        print("  git clone https://github.com/Liquid4All/onnx-export.git && cd onnx-export && uv sync")
        return False
    out_root = ROOT / "evals" / "data" / "finetune" / "export" / "onnx"
    out_root.mkdir(parents=True, exist_ok=True)
    print("running", " ".join(cmd), flush=True)
    try:
        subprocess.run(cmd + ["--output", str(out_root)], check=True)
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        print(f"ONNX export failed ({exc}) — HF snapshot is still at {src}")
        return False
    # Copy whatever layout we got into public/models for local Vite.
    dest.mkdir(parents=True, exist_ok=True)
    for p in out_root.rglob("*"):
        if p.is_file() and p.stat().st_size < 2_000_000_000:
            rel = p.relative_to(out_root)
            target = dest / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                shutil.copy2(p, target)
    print(f"copied ONNX tree toward {dest}")
    return True


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--ckpt", default=str(CKPT))
    p.add_argument("--skip-onnx", action="store_true")
    args = p.parse_args()
    src = Path(args.ckpt)
    if not (src / "config.json").exists():
        sys.exit(f"missing checkpoint {src}")
    copy_hf(src, HF_OUT)
    if not args.skip_onnx:
        try_onnx(src, PUBLIC)
    print("export done")
    print(f"  HF:    {HF_OUT}")
    print(f"  local: python scripts/finetune/serve.py")
    print(f"  app:   npm run dev  (proxies /vlm to the local server)")


if __name__ == "__main__":
    main()
