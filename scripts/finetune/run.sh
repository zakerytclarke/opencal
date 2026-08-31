#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PY="${OPENCAL_PY:-/home/zclarke/ml_env/bin/python}"
if [[ ! -x "$PY" ]]; then PY="${PYTHON:-python3}"; fi

"$PY" -m pip install -q -r scripts/finetune/requirements.txt
"$PY" scripts/finetune/prepare.py "$@"

if [[ ! -f evals/results/ft-baseline.json ]]; then
  "$PY" scripts/finetune/infer.py --model LiquidAI/LFM2.5-VL-450M --tag baseline
  npx tsx scripts/eval/score-extracts.ts --extracts evals/data/finetune/preds/baseline/extracts.json --tag baseline
fi

CKPT="evals/data/finetune/ckpts/lfm25vl-opencal"
RESUME=()
if [[ -f "$CKPT/model.safetensors" ]]; then
  RESUME=(--resume "$CKPT")
fi
# Keep v1 metrics for compare.py
if [[ -f evals/results/ft-finetuned.json && ! -f evals/results/ft-v1.json ]]; then
  cp evals/results/ft-finetuned.json evals/results/ft-v1.json
fi

"$PY" scripts/finetune/train.py --epochs 2 --batch 4 --lr 8e-6 "${RESUME[@]}"
"$PY" scripts/finetune/infer.py --model "$CKPT" --tag finetuned
npx tsx scripts/eval/score-extracts.ts --extracts evals/data/finetune/preds/finetuned/extracts.json --tag finetuned
"$PY" scripts/finetune/compare.py
