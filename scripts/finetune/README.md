# Fine-tune OpenCal's on-device VLM

Target: `LiquidAI/LFM2.5-VL-450M` (same family as the in-app ONNX build).
Primary metric: **full-meal calorie MAE** after extract → MiniSearch → `convert_portion` (USDA per 100 g).
The model still must not invent calories; it names foods and household units. Coach mix keeps chat/Q&A.

## Datasets

| Mix | What | Gold |
| --- | --- | --- |
| USDA synth | Spoken meals from `public/foods.json`, forced unit mix (slice, oz, cup, tbsp, …) | Extract JSON |
| Combos | "X with Y and Z" stays three foods | Extract JSON |
| Curriculum | Hand-written units + restaurant bowls + sides | Extract JSON |
| OpenCal train split | `evals/splits/text.json` train only | Extract JSON |
| Pick letters | Gold USDA row; `convert_portion` is computed **per candidate** | `{"pick":"A",...}` |
| Nutrition5k | Local HF cache plates + `metadata.jsonl` (no 181 GB dump) | Ingredient list |
| Fixture photos | `pizza.jpg` / `bowl.jpg` only — never `banana.jpg` / `eggs.jpg` | Multi-item JSON |
| Coach | USDA Q&A, refuse-to-guess, small talk, log-routing | Prose or JSON |

Held out forever: `evals/splits/text.json` test, `images.json` test, `coach.json` test.

## Commands

Use the machine's ML env (CUDA torch):

```bash
/home/zclarke/ml_env/bin/python -m pip install -r scripts/finetune/requirements.txt

# 1. Mix JSONL (Nutrition5k uses the local HuggingFace cache)
/home/zclarke/ml_env/bin/python scripts/finetune/prepare.py

# 2. Baseline on frozen eval (skip if evals/results/ft-baseline.json already exists)
/home/zclarke/ml_env/bin/python scripts/finetune/infer.py \
  --model LiquidAI/LFM2.5-VL-450M --tag baseline
npx tsx scripts/eval/score-extracts.ts \
  --extracts evals/data/finetune/preds/baseline/extracts.json --tag baseline

# 3. Full fine-tune. Continue from the last checkpoint with --resume.
/home/zclarke/ml_env/bin/python scripts/finetune/train.py --epochs 2 --batch 4 --lr 8e-6 \
  --resume evals/data/finetune/ckpts/lfm25vl-opencal

# 4. After
/home/zclarke/ml_env/bin/python scripts/finetune/infer.py \
  --model evals/data/finetune/ckpts/lfm25vl-opencal --tag finetuned
npx tsx scripts/eval/score-extracts.ts \
  --extracts evals/data/finetune/preds/finetuned/extracts.json --tag finetuned

# 5. Before/after (and v1 vs this run if evals/results/ft-v1.json exists)
/home/zclarke/ml_env/bin/python scripts/finetune/compare.py
```

Or: `bash scripts/finetune/run.sh`

Results: `evals/results/ft-baseline.md`, `ft-finetuned.md`, `ft-compare.md`.

ONNX export for the PWA is a separate step after a checkpoint beats baseline on kcal MAE and coach prose accuracy.
