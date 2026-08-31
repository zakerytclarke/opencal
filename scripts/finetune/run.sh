#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PY="${OPENCAL_PY:-/home/zclarke/ml_env/bin/python}"
if [[ ! -x "$PY" ]]; then PY="${PYTHON:-python3}"; fi

"$PY" -m pip install -q -r scripts/finetune/requirements.txt
"$PY" scripts/finetune/prepare.py "$@"
"$PY" scripts/finetune/infer.py --model LiquidAI/LFM2.5-VL-450M --tag baseline
npx tsx scripts/eval/score-extracts.ts --extracts evals/data/finetune/preds/baseline/extracts.json --tag baseline
"$PY" scripts/finetune/train.py --epochs 1 --batch 4 --lr 2e-5
"$PY" scripts/finetune/infer.py --model evals/data/finetune/ckpts/lfm25vl-opencal --tag finetuned
npx tsx scripts/eval/score-extracts.ts --extracts evals/data/finetune/preds/finetuned/extracts.json --tag finetuned
"$PY" scripts/finetune/compare.py
