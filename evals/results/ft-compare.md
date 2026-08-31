# Original vs fine-tuned: meal nutrition on photos

Same 20% Nutrition5k test (409 plates, seed `opencal-n5k-eval-v2`).
The VLM only names foods and household portions. Calories and macros come from the host USDA map + `convert_portion`.
Gold is Nutrition5k **dish totals** (weighed ingredients: kcal, protein, carbs, fat) — not a household USDA guess and not name accuracy.

## Why these metrics

- **MAE** is mean |pred − gold| in kcal or grams. This is the number that matters for a diary.
- **WAPE** is total absolute error / total gold across the set. Unlike mean % error, a 5 kcal snack does not explode the score.
- **Median relative error** is the typical plate’s |pred − gold| / gold.
- **Within 20% / 50%** is how often the logged meal is close enough to be useful.

## Nutrition5k 20% (primary)

| metric | original | fine-tuned | change |
|---|---:|---:|---|
| kcal MAE | 729.9 | 55.9 | -674.0 (improved) |
| kcal median AE | 244.6 | 18.9 | -225.7 (improved) |
| kcal WAPE | 734.6% | 56.3% | -678.3 pp (improved) |
| kcal median relative error | 750.1% | 43.7% | -706.4 pp (improved) |
| meal MAPE (≥50 kcal) | — | 51.1% | target <30% |
| within 20% of gold kcal | 3.4% | 23.2% | +19.8 pp (improved) |
| within 50% of gold kcal | 11.7% | 54.3% | +42.6 pp (improved) |
| meals ≥50 kcal within 20% | 6.2% | 20.8% | +14.6 pp (improved) |
| protein MAE (g) | 21.0 | 4.0 | -17.0 (improved) |
| carbs MAE (g) | 91.6 | 6.5 | -85.1 (improved) |
| fat MAE (g) | 35.8 | 2.9 | -32.9 (improved) |
| name accuracy (secondary) | 67.7% | 80.9% | +13.2 pp (improved) |

## kcal by slice

| slice | n | kcal MAE | median AE | WAPE | median rel. | within 20% | within 50% | ≥50 kcal within 20% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| N5k 20% | 409 | 729.9 → **55.9** | 244.6 → 18.9 | 734.6% → **56.3%** | 750.1% → 43.7% | 3.4% → 23.2% | 11.7% → 54.3% | 6.2% → 20.8% |
| N5k singles | 305 | 611.1 → **28.0** | 224.9 → 13.5 | 1210.6% → **55.5%** | 913.4% → 41.6% | 3.6% → 24.6% | 12.5% → 58.0% | 8.3% → 22.0% |
| N5k mixed | 104 | 1078.2 → **137.8** | 465.1 → 76.3 | 444.2% → **56.8%** | 367.6% → 56.7% | 2.9% → 19.2% | 9.6% → 43.3% | 3.6% → 19.3% |
| Fixtures | 2 | 389.5 → **353.5** | 389.5 → 353.5 | 109.7% → **99.6%** | 210.5% → 108.3% | 50.0% → 0.0% | 50.0% → 0.0% | 50.0% → 0.0% |
| Text | 16 | 16.8 → **1.4** | 0.0 → 0.0 | 5.2% → **0.4%** | 0.0% → 0.0% | 93.8% → 100.0% | 93.8% → 100.0% | 93.3% → 100.0% |

## Macros on the 20% image test

| nutrient | MAE before | MAE after | WAPE before | WAPE after | median rel. before | median rel. after |
|---|---:|---:|---:|---:|---:|---:|
| kcal | 729.9 kcal | **55.9 kcal** | 734.6% | **56.3%** | 750.1% | 43.7% |
| protein | 21.0 g | **4.0 g** | 368.9% | **70.0%** | 497.8% | 33.9% |
| carbs | 91.6 g | **6.5 g** | 814.9% | **58.2%** | 817.0% | 46.6% |
| fat | 35.8 g | **2.9 g** | 842.7% | **69.1%** | 168.0% | 14.3% |

## What this means

The original model is not a calorie estimator. It counts pieces and the host maps those to full USDA servings, so a handful of almonds becomes thousands of kcal. Fine-tuning is the difference between unusable and in-the-ballpark.

Two-stage identify → USDA RAG → portion (v8) plus host ranking and photo clamps is **55.9 kcal MAE / 56% WAPE / 51% meal MAPE** on the 20% Nutrition5k test. Ranking maps eggs to 1 large (not 1 cup), prints oil as a tablespoon ruler, and snaps a 7 g apple to 1 medium / 4 tbsp oil to 1 tbsp. Calories still come from USDA `convert_portion`.

That is still above the 30% meal-MAPE target. A 450M VLM cannot visually weigh mixed plates (pork logged as 11 g, rice as 36 g). Perfect names + scale grams through USDA only reach ~23% (dataset vs USDA density), so 30% is the model+portion gap, not the food DB. A further epoch that taught `1 medium` / `3 oz` for everything overshot to 95% MAPE and was not promoted. Nutrition5k train-gram priors reach ~45% on this test but would log 14 g of rice in a real diary, so they stay out of the app.

Name accuracy is not the product metric. A correctly named food with the wrong portion is still a wrong diary entry. Calories always come from USDA `convert_portion`, never from the VLM.
