# Fine-tune OpenCal's on-device VLM

Target: `LiquidAI/LFM2.5-VL-450M` (same family as the in-app ONNX build).
Primary metric: **full-meal calorie MAE** after extract → MiniSearch → `convert_portion` (USDA per 100 g).
The model still must not invent calories; it names foods and household units. Coach mix keeps chat/Q&A.

## Datasets

| Mix | What | Gold |
| --- | --- | --- |
| USDA synth | Spoken meals from `public/foods.json` search catalog | Extract JSON |
| OpenCal train split | `evals/splits/text.json` train only | Extract JSON |
| Pick letters | Gold USDA row among distractors | `{"pick":"A",...}` |
| Nutrition5k | `mmathys/food-nutrients` overhead plates | Ingredient grams (USDA-linked) |
| Fixture photos | pizza/bowl train images | Extract JSON |
| Coach | USDA Q&A + small talk + "log X" routing | Prose or JSON |

Held out forever: `evals/splits/text.json` test, `images.json` test, `coach.json` test.

## Commands

Use the machine's ML env (CUDA torch):

```bash
/home/zclarke/ml_env/bin/python -m pip install -r scripts/finetune/requirements.txt

# 1. Mix JSONL (~minutes; Nutrition5k ~1.3 GB)
/home/zclarke/ml_env/bin/python scripts/finetune/prepare.py

# 2. Baseline on frozen eval
/home/zclarke/ml_env/bin/python scripts/finetune/infer.py \
  --model LiquidAI/LFM2.5-VL-450M --tag baseline
npx tsx scripts/eval/score-extracts.ts \
  --extracts evals/data/finetune/preds/baseline/extracts.json --tag baseline

# 3. Full fine-tune on the 5090 (default). Pass --lora 16 for adapters.
/home/zclarke/ml_env/bin/python scripts/finetune/train.py --epochs 1 --batch 4 --lr 2e-5

# 4. After
/home/zclarke/ml_env/bin/python scripts/finetune/infer.py \
  --model evals/data/finetune/ckpts/lfm25vl-opencal --tag finetuned
npx tsx scripts/eval/score-extracts.ts \
  --extracts evals/data/finetune/preds/finetuned/extracts.json --tag finetuned

# 5. Before/after
/home/zclarke/ml_env/bin/python scripts/finetune/compare.py
```

Or: `bash scripts/finetune/run.sh`

Results: `evals/results/ft-baseline.md`, `ft-finetuned.md`, `ft-compare.md`.

ONNX export for the PWA is a separate step after a checkpoint beats baseline on kcal MAE and coach prose accuracy.
