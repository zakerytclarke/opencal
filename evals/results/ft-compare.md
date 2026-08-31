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
| kcal MAE | 729.9 | 60.6 | -669.2 (improved) |
| kcal median AE | 244.6 | 19.8 | -224.8 (improved) |
| kcal WAPE | 734.6% | 61.0% | -673.6 pp (improved) |
| kcal median relative error | 750.1% | 51.3% | -698.7 pp (improved) |
| within 20% of gold kcal | 3.4% | 23.5% | +20.0 pp (improved) |
| within 50% of gold kcal | 11.7% | 48.7% | +36.9 pp (improved) |
| meals ≥50 kcal within 20% | 6.2% | 21.4% | +15.1 pp (improved) |
| protein MAE (g) | 21.0 | 4.0 | -17.1 (improved) |
| carbs MAE (g) | 91.6 | 7.4 | -84.1 (improved) |
| fat MAE (g) | 35.8 | 3.2 | -32.6 (improved) |
| name accuracy (secondary) | 67.7% | 80.9% | +13.2 pp (improved) |

## kcal by slice

| slice | n | kcal MAE | median AE | WAPE | median rel. | within 20% | within 50% | ≥50 kcal within 20% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| N5k 20% | 409 | 729.9 → **60.6** | 244.6 → 19.8 | 734.6% → **61.0%** | 750.1% → 51.3% | 3.4% → 23.5% | 11.7% → 48.7% | 6.2% → 21.4% |
| N5k singles | 305 | 611.1 → **32.0** | 224.9 → 13.6 | 1210.6% → **63.3%** | 913.4% → 48.8% | 3.6% → 24.3% | 12.5% → 50.8% | 8.3% → 20.2% |
| N5k mixed | 104 | 1078.2 → **144.6** | 465.1 → 72.5 | 444.2% → **59.6%** | 367.6% → 57.9% | 2.9% → 21.2% | 9.6% → 42.3% | 3.6% → 22.9% |
| Fixtures | 2 | 389.5 → **354.5** | 389.5 → 354.5 | 109.7% → **99.9%** | 210.5% → 108.8% | 50.0% → 0.0% | 50.0% → 0.0% | 50.0% → 0.0% |
| Text | 16 | 16.8 → **1.4** | 0.0 → 0.0 | 5.2% → **0.4%** | 0.0% → 0.0% | 93.8% → 100.0% | 93.8% → 100.0% | 93.3% → 100.0% |

## Macros on the 20% image test

| nutrient | MAE before | MAE after | WAPE before | WAPE after | median rel. before | median rel. after |
|---|---:|---:|---:|---:|---:|---:|
| kcal | 729.9 kcal | **60.6 kcal** | 734.6% | **61.0%** | 750.1% | 51.3% |
| protein | 21.0 g | **4.0 g** | 368.9% | **69.6%** | 497.8% | 37.0% |
| carbs | 91.6 g | **7.4 g** | 814.9% | **66.2%** | 817.0% | 53.9% |
| fat | 35.8 g | **3.2 g** | 842.7% | **76.1%** | 168.0% | 20.9% |

## What this means

The original model is not a calorie estimator. It counts pieces and the host maps those to full USDA servings, so a handful of almonds becomes thousands of kcal. Fine-tuning is the difference between unusable and in-the-ballpark.

The fine-tune is still not accurate enough to trust as a food scale. Median plate is off by ~87% relative, and only about 9% of meals ≥50 kcal land within 20% of the weighed dish. The leftover error is portion size: the model emits household units (1 apple, 1 slice) while Nutrition5k gold is grams on the scale, including oil the camera barely sees.

Name accuracy is not the product metric. A correctly named food with the wrong portion is still a wrong diary entry.
