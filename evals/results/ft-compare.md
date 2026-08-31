# Two-stage logging (v11) vs previous production (v8 + host clamps)

Same 20% Nutrition5k test (409 plates, seed `opencal-n5k-eval-v2`).
Text and photo both run **identify keywords → USDA RAG catalog → portion JSON** (name, brand, quantity, unit). Calories and macros come from the host USDA map + `convert_portion`.
Gold is Nutrition5k **dish totals** for photos; text gold is USDA-mapped expect items.

v11 is the production checkpoint (`lfm25vl-opencal`). v8 remains on disk as `lfm25vl-opencal-v8`. v8 cannot run two-stage text: it copies catalog row titles into the diary.

## Why these metrics

- **MAE** is mean |pred − gold| in kcal or grams. This is the number that matters for a diary.
- **WAPE** is total absolute error / total gold across the set. Unlike mean % error, a 5 kcal snack does not explode the score.
- **Median relative error** is the typical plate’s |pred − gold| / gold.
- **Within 20% / 50%** is how often the logged meal is close enough to be useful.

## Nutrition5k 20% (primary)

| metric | v8 + host | two-stage v11 | change |
|---|---:|---:|---|
| kcal MAE | 55.9 | 81.1 | +25.2 (worse) |
| kcal median AE | 18.9 | 28.5 | +9.6 (worse) |
| kcal WAPE | 56.3% | 81.7% | +25.4 pp (worse) |
| meal MAPE (≥50 kcal) | 51.1% | 80.4% | +29.3 pp (worse) |
| kcal median relative error | 43.7% | 61.8% | +18.0 pp (worse) |
| within 20% of gold kcal | 23.2% | 17.4% | -5.9 pp (worse) |
| within 50% of gold kcal | 54.3% | 42.3% | -12.0 pp (worse) |
| meals ≥50 kcal within 20% | 20.8% | 18.2% | -2.6 pp (worse) |
| protein MAE (g) | 4.0 | 4.6 | +0.6 (worse) |
| carbs MAE (g) | 6.5 | 9.3 | +2.8 (worse) |
| fat MAE (g) | 2.9 | 4.4 | +1.4 (worse) |
| name accuracy (secondary) | 80.9% | 80.9% | +0.0 pp (same) |

## kcal by slice

| slice | n | kcal MAE | median AE | WAPE | median rel. | within 20% | within 50% | ≥50 kcal within 20% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| N5k 20% | 409 | 55.9 → **81.1** | 18.9 → 28.5 | 56.3% → **81.7%** | 43.7% → 61.8% | 23.2% → 17.4% | 54.3% → 42.3% | 20.8% → 18.2% |
| N5k singles | 305 | 28.0 → **50.8** | 13.5 → 26.0 | 55.5% → **100.7%** | 41.6% → 66.0% | 24.6% → 16.7% | 58.0% → 39.7% | 22.0% → 16.5% |
| N5k mixed | 104 | 137.8 → **170.0** | 76.3 → 91.9 | 56.8% → **70.1%** | 56.7% → 50.3% | 19.2% → 19.2% | 43.3% → 50.0% | 19.3% → 20.5% |
| Fixtures | 2 | 353.5 → **148.5** | 353.5 → 148.5 | 99.6% → **41.8%** | 108.3% → 71.2% | 0.0% → 50.0% | 0.0% → 50.0% | 0.0% → 50.0% |
| Text | 16 | 1.4 → **1.4** | 0.0 → 0.0 | 0.4% → **0.4%** | 0.0% → 0.0% | 100.0% → 100.0% | 100.0% → 100.0% | 100.0% → 100.0% |

## Macros on the 20% image test

| nutrient | MAE before | MAE after | WAPE before | WAPE after | median rel. before | median rel. after |
|---|---:|---:|---:|---:|---:|---:|
| kcal | 55.9 kcal | **81.1 kcal** | 56.3% | **81.7%** | 43.7% | 61.8% |
| protein | 4.0 g | **4.6 g** | 70.0% | **81.1%** | 33.9% | 46.3% |
| carbs | 6.5 g | **9.3 g** | 58.2% | **83.0%** | 46.6% | 58.0% |
| fat | 2.9 g | **4.4 g** | 69.1% | **102.5%** | 14.3% | 18.2% |

## What this means

Two-stage logging works. Stage 1 emits search keywords only. Stage 2 sees the original meal or photo plus the RAG catalog and emits `{name, brand, quantity, unit}`. The host still runs `convert_portion`. v8 without this train copies USDA catalog lines into text logs (duplicate Big Macs, `bar (40 g)` units). After v11, held-out text is **1.4 kcal MAE / 0.4% MAPE / 100% names**, same as before.

Photo names are unchanged (80.9%). Portion estimates moved: meal MAPE 51% → 80% on Nutrition5k ≥50 kcal. Mixed plates still under-weigh meat/starch; some singles overshoot (1 cup almonds). A 450M VLM still cannot visually weigh. Target remains <30% meal MAPE.

Tried and not promoted: mixed-train v12 (MAPE 72%, worse MAE), text-only v13 (MAPE 100% — shared LM drifts photo portions). Production is v11; v8 is the previous photo-best checkpoint.

Name accuracy is not the product metric. A correctly named food with the wrong portion is still a wrong diary entry. Calories always come from USDA `convert_portion`, never from the VLM.
