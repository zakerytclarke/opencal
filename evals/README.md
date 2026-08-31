# Pipeline evals

Local train/test harness for OpenCal. It runs the **same** `logFromText` / `logFromPhoto` path as the app (LFM on-device + USDA MiniSearch), then scores names and calories against gold.

Gold calories are **USDA via our food database** for the labeled food and serving — the number a user would see in the diary. The VLM extracts **name, brand, quantity, and unit**; the host maps that to a USDA row and runs `convert_portion`. FooDD supplies image class labels (and a per-100g table in `taxonomy/foodd.json`). Nutrition5k identification plates (`images.n5k.json`) cover the same classes when FooDD is not on disk. Train is for prompt/few-shot tuning; do not put test strings into `EXTRACT_FEWSHOT`.

## Splits

| Split | Text | Images |
| --- | --- | --- |
| Train | `evals/splits/text.json` `train` | fixtures + FooDD 80% |
| Test | `evals/splits/text.json` `test` (held out) | banana/eggs fixtures + FooDD 20% + Nutrition5k ID plates |

## Commands

```bash
npm run eval:text          # held-out text, full VLM pipeline
npm run eval:images        # fixtures (+ FooDD / Nutrition5k if prepared)
npm run eval               # test split, text + images
npm run eval -- --split train --modality text --limit 4
npm run eval:prepare-n5k   # copy held-out Nutrition5k ID plates (excludes prior train thumbs)
```

FooDD (IEEE FooDD / Kaggle `darsh22blc1378/foodd-ieee-datasets`):

```bash
FOODD_DIR=/path/to/FooDD npm run eval:prepare
npm run eval:images
```

Results: `evals/results/latest.md` (MAE, MAPE, % within 20/50 kcal relative, name accuracy, MAE on correctly named foods).

`npm test` covers metric helpers only. These evals are slow (on-device VLM) and are not part of CI.

## Fine-tune (LFM2.5-VL-450M)

See `scripts/finetune/README.md`. Mix USDA synth + Nutrition5k plates + coach dialogue, full-FT on a local GPU, then compare **meal calorie MAE** on the frozen test split (`evals/results/ft-compare.md`). The test strings in `evals/splits/*.json` never go into training.

