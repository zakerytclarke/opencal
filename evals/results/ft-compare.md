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
| kcal MAE | 729.9 | 114.0 | -615.9 (improved) |
| kcal median AE | 244.6 | 41.0 | -203.5 (improved) |
| kcal WAPE | 734.6% | 114.7% | -619.9 pp (improved) |
| kcal median relative error | 750.1% | 86.6% | -663.4 pp (improved) |
| within 20% of gold kcal | 3.4% | 5.9% | +2.4 pp (improved) |
| within 50% of gold kcal | 11.7% | 21.5% | +9.8 pp (improved) |
| meals ≥50 kcal within 20% | 6.2% | 8.9% | +2.6 pp (improved) |
| protein MAE (g) | 21.0 | 6.0 | -15.0 (improved) |
| carbs MAE (g) | 91.6 | 12.7 | -78.8 (improved) |
| fat MAE (g) | 35.8 | 5.9 | -29.9 (improved) |
| name accuracy (secondary) | 67.7% | 73.8% | +6.1 pp (improved) |

## kcal by slice

| slice | n | kcal MAE | median AE | WAPE | median rel. | within 20% | within 50% | ≥50 kcal within 20% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| N5k 20% | 409 | 729.9 → **114.0** | 244.6 → 41.0 | 734.6% → **114.7%** | 750.1% → 86.6% | 3.4% → 5.9% | 11.7% → 21.5% | 6.2% → 8.9% |
| N5k singles | 305 | 611.1 → **78.2** | 224.9 → 37.0 | 1210.6% → **155.0%** | 913.4% → 89.1% | 3.6% → 4.3% | 12.5% → 19.3% | 8.3% → 5.5% |
| N5k mixed | 104 | 1078.2 → **218.8** | 465.1 → 147.0 | 444.2% → **90.2%** | 367.6% → 79.8% | 2.9% → 10.6% | 9.6% → 27.9% | 3.6% → 13.3% |
| Fixtures | 2 | 389.5 → **399.0** | 389.5 → 399.0 | 109.7% → **112.4%** | 210.5% → 212.2% | 50.0% → 50.0% | 50.0% → 50.0% | 50.0% → 50.0% |
| Text | 16 | 16.8 → **1.4** | 0.0 → 0.0 | 5.2% → **0.4%** | 0.0% → 0.0% | 93.8% → 100.0% | 93.8% → 100.0% | 93.3% → 100.0% |

## Macros on the 20% image test

| nutrient | MAE before | MAE after | WAPE before | WAPE after | median rel. before | median rel. after |
|---|---:|---:|---:|---:|---:|---:|
| kcal | 729.9 kcal | **114.0 kcal** | 734.6% | **114.7%** | 750.1% | 86.6% |
| protein | 21.0 g | **6.0 g** | 368.9% | **105.3%** | 497.8% | 75.4% |
| carbs | 91.6 g | **12.7 g** | 814.9% | **113.3%** | 817.0% | 84.5% |
| fat | 35.8 g | **5.9 g** | 842.7% | **138.5%** | 168.0% | 31.4% |

## What this means

The original model is not a calorie estimator. It counts pieces and the host maps those to full USDA servings, so a handful of almonds becomes thousands of kcal. Fine-tuning is the difference between unusable and in-the-ballpark.

The fine-tune is still not accurate enough to trust as a food scale. Median plate is off by ~87% relative, and only about 9% of meals ≥50 kcal land within 20% of the weighed dish. The leftover error is portion size: the model emits household units (1 apple, 1 slice) while Nutrition5k gold is grams on the scale, including oil the camera barely sees.

Name accuracy is not the product metric. A correctly named food with the wrong portion is still a wrong diary entry.
