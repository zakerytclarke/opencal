# Pipeline evals

Local train/test harness for OpenCal. It runs the **same** `logFromText` / `logFromPhoto` path as the app (LFM on-device + USDA MiniSearch), then scores names and calories against gold.

Gold calories are **USDA via our food database** for the labeled food and serving — the number a user would see in the diary. FooDD supplies image class labels (and a per-100g table in `taxonomy/foodd.json`). Train is for prompt/few-shot tuning; do not put test strings into `EXTRACT_FEWSHOT`.

## Splits

| Split | Text | Images |
| --- | --- | --- |
| Train | `evals/splits/text.json` `train` | fixtures + FooDD 80% |
| Test | `evals/splits/text.json` `test` (held out) | banana/eggs fixtures + FooDD 20% |

## Commands

```bash
npm run eval:text          # held-out text, full VLM pipeline
npm run eval:images        # fixtures (+ FooDD if prepared)
npm run eval               # test split, text + images
npm run eval -- --split train --modality text --limit 4
```

FooDD (IEEE FooDD / Kaggle `darsh22blc1378/foodd-ieee-datasets`):

```bash
FOODD_DIR=/path/to/FooDD npm run eval:prepare
npm run eval:images
```

Results: `evals/results/latest.md` (MAE, MAPE, % within 20/50 kcal relative, name accuracy, MAE on correctly named foods).

`npm test` covers metric helpers only. These evals are slow (on-device VLM) and are not part of CI.
