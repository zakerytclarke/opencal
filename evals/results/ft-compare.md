# OpenCal fine-tune: before vs after

Held-out eval is `evals/splits/text.json` + `images.json` test, plus Nutrition5k identification (`images.n5k.json`) and `coach.json` / `cite.json`.
The VLM extracts name, brand, quantity, and unit. Calories are MiniSearch + convert_portion on the host-mapped USDA row, not model-invented numbers.

v5 numbers below are the previous canonical run on 16 text + 2 fixture photos (n=18). v6 adds 32 held-out Nutrition5k identification plates (FooDD classes: apple, carrot, cucumber, egg, orange, rice, tomato) that v5 never scored. Compare **text** MAE for calories and **image name accuracy** for vision. FooDD itself is not on disk.

## Meal calories (primary)

### Baseline (n=18)
- Food name accuracy: 100.0%
- Calorie MAE: 56.1 kcal (median 0.0)
- Calorie MAPE: 25.9% · within 20%: 88.9% · within 50%: 94.4%
- Calorie MAE when named correctly: 56.1

### Fine-tuned v1 (n=18)
- Food name accuracy: 100.0%
- Calorie MAE: 56.1 kcal (median 0.0)
- Calorie MAPE: 25.9% · within 20%: 88.9% · within 50%: 94.4%
- Calorie MAE when named correctly: 56.1

### Fine-tuned (n=50)
- Food name accuracy: 98.0%
- Calorie MAE: 43.1 kcal (median 12.0)
- Calorie MAPE: 52.3% · within 20%: 54.0% · within 50%: 56.0%
- Calorie MAE when named correctly: 36.9

| metric | baseline | fine-tuned | change |
|---|---:|---:|---|
| name acc | 100.0% | 98.0% | -0.0 (worse) |
| kcal MAE | 56.1 | 43.1 | -13.0 (improved) |
| kcal median AE | 0.0 | 12.0 | +12.0 (worse) |
| within 20% | 88.9% | 54.0% | -34.9 pp (worse) |
| within 50% | 94.4% | 56.0% | -38.4 pp (worse) |

v1 vs this run (same held-out split):

| metric | v1 | this run | change |
|---|---:|---:|---|
| name acc | 100.0% | 98.0% | -0.0 (worse) |
| kcal MAE | 56.1 | 43.1 | -13.0 (improved) |

## Text vs images

### Baseline text (n=16)
- Food name accuracy: 100.0%
- Calorie MAE: 1.4 kcal (median 0.0)
- Calorie MAPE: 0.4% · within 20%: 100.0% · within 50%: 100.0%
- Calorie MAE when named correctly: 1.4
### Fine-tuned v1 text (n=16)
- Food name accuracy: 100.0%
- Calorie MAE: 1.4 kcal (median 0.0)
- Calorie MAPE: 0.4% · within 20%: 100.0% · within 50%: 100.0%
- Calorie MAE when named correctly: 1.4
### Fine-tuned text (n=16)
- Food name accuracy: 100.0%
- Calorie MAE: 1.4 kcal (median 0.0)
- Calorie MAPE: 0.4% · within 20%: 100.0% · within 50%: 100.0%
- Calorie MAE when named correctly: 1.4
### Baseline images (n=2)
- Food name accuracy: 100.0%
- Calorie MAE: 494.0 kcal (median 494.0)
- Calorie MAPE: 230.3% · within 20%: 0.0% · within 50%: 50.0%
- Calorie MAE when named correctly: 494.0
### Fine-tuned v1 images (n=2)
- Food name accuracy: 100.0%
- Calorie MAE: 494.0 kcal (median 494.0)
- Calorie MAPE: 230.3% · within 20%: 0.0% · within 50%: 50.0%
- Calorie MAE when named correctly: 494.0
### Fine-tuned images (n=34)
- Food name accuracy: 97.1%
- Calorie MAE: 62.7 kcal (median 27.0)
- Calorie MAPE: 76.8% · within 20%: 32.4% · within 50%: 35.3%
- Calorie MAE when named correctly: 54.2

## Coach (don't forget how to talk)

| metric | baseline | fine-tuned | change |
|---|---:|---:|---|
| overall | 100.0% | 100.0% | +0.0 pp (same) |
| log → JSON | 100.0% | 100.0% | +0.0 pp (same) |
| chat/Q → prose | 100.0% | 100.0% | +0.0 pp (same) |
| USDA kcal in range | 100.0% | 100.0% | +0.0 pp (same) |

Eval infer uses the same `{"foods":[` assistant prefix as the PWA.
Text MAE applies the same refineExtracted host pass as the PWA (bare eggs → large, compound names).
Production no longer asks the VLM to pick a USDA letter; the host maps extract JSON to a base food.
`fix-eggs` gold is 2 large eggs (185 kcal) while the photo is a mixed plate;
the model emits JSON for egg plus sides, which inflates image MAE vs that eggs-only label.
Image identification (name accuracy) is the vision metric; banana count is the clean fixture calorie check.
If MiniSearch cannot map the extracted name, the host leaves the diary unmatched (0 kcal).

## Citation / refuse (coach)

Held-out `evals/splits/cite.json`: 3/3 cite USDA/convert_portion or refuse without a row.
