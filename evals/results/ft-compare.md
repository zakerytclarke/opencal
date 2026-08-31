# OpenCal fine-tune: before vs after

Held-out eval is `evals/splits/text.json` + `images.json` test, plus `coach.json`.
Calories are MiniSearch + convert_portion on the model's extract (USDA per-100 g), not model-invented numbers.

## Meal calories (primary)

### Baseline (n=18)
- Food name accuracy: 77.8%
- Calorie MAE: 102.2 kcal (median 47.5)
- Calorie MAPE: 65.7% · within 20%: 50.0% · within 50%: 72.2%
- Calorie MAE when named correctly: 57.9

### Fine-tuned v1 (n=18)
- Food name accuracy: 88.9%
- Calorie MAE: 65.8 kcal (median 0.0)
- Calorie MAPE: 16.7% · within 20%: 66.7% · within 50%: 88.9%
- Calorie MAE when named correctly: 40.1

### Fine-tuned (n=18)
- Food name accuracy: 100.0%
- Calorie MAE: 56.1 kcal (median 0.0)
- Calorie MAPE: 25.9% · within 20%: 88.9% · within 50%: 94.4%
- Calorie MAE when named correctly: 56.1

| metric | baseline | fine-tuned | change |
|---|---:|---:|---|
| name acc | 77.8% | 100.0% | +22.2 pp (improved) |
| kcal MAE | 102.2 | 56.1 | -46.1 (improved) |
| kcal median AE | 47.5 | 0.0 | -47.5 (improved) |
| within 20% | 50.0% | 88.9% | +38.9 pp (improved) |
| within 50% | 72.2% | 94.4% | +22.2 pp (improved) |

v1 vs this run (same held-out split):

| metric | v1 | this run | change |
|---|---:|---:|---|
| name acc | 88.9% | 100.0% | +11.1 pp (improved) |
| kcal MAE | 65.8 | 56.1 | -9.7 (improved) |

## Text vs images

### Baseline text (n=16)
- Food name accuracy: 87.5%
- Calorie MAE: 70.6 kcal (median 26.0)
- Calorie MAPE: 61.4% · within 20%: 56.2% · within 50%: 81.2%
- Calorie MAE when named correctly: 57.9
### Fine-tuned v1 text (n=16)
- Food name accuracy: 93.8%
- Calorie MAE: 36.2 kcal (median 0.0)
- Calorie MAPE: 7.5% · within 20%: 75.0% · within 50%: 100.0%
- Calorie MAE when named correctly: 14.7
### Fine-tuned text (n=16)
- Food name accuracy: 100.0%
- Calorie MAE: 1.4 kcal (median 0.0)
- Calorie MAPE: 0.4% · within 20%: 100.0% · within 50%: 100.0%
- Calorie MAE when named correctly: 1.4
### Baseline images (n=2)
- Food name accuracy: 0.0%
- Calorie MAE: 355.0 kcal (median 355.0)
- Calorie MAPE: 100.0% · within 20%: 0.0% · within 50%: 0.0%
- Calorie MAE when named correctly: n/a
### Fine-tuned v1 images (n=2)
- Food name accuracy: 50.0%
- Calorie MAE: 302.5 kcal (median 302.5)
- Calorie MAPE: 90.0% · within 20%: 0.0% · within 50%: 0.0%
- Calorie MAE when named correctly: 420.0
### Fine-tuned images (n=2)
- Food name accuracy: 100.0%
- Calorie MAE: 494.0 kcal (median 494.0)
- Calorie MAPE: 230.3% · within 20%: 0.0% · within 50%: 50.0%
- Calorie MAE when named correctly: 494.0

## Coach (don't forget how to talk)

| metric | baseline | fine-tuned | change |
|---|---:|---:|---|
| overall | 50.0% | 100.0% | +50.0 pp (improved) |
| log → JSON | 66.7% | 100.0% | +33.3 pp (improved) |
| chat/Q → prose | 42.9% | 100.0% | +57.1 pp (improved) |
| USDA kcal in range | 0.0% | 100.0% | +100.0 pp (improved) |

Eval infer uses the same `{"foods":[` assistant prefix as the PWA.
Text MAE applies the same refineExtracted host pass as the PWA (bare eggs → large, compound names).
`fix-eggs` gold is 2 large eggs (185 kcal) while the photo is a mixed plate;
the model emits JSON for egg plus sides, which inflates image MAE vs that eggs-only label.
Banana photo currently counts 7 (was 5 / 525 kcal). Text MAE is the cleaner calorie signal.
If the USDA fruit banana row is missing from hits, pick-null (and the host) refuse chips/pepper near-misses (0 kcal unmatched).

## Pick / refuse (RAG)

Held-out `evals/splits/pick.json`: 6/7 correct.
Refuse when the true USDA row is missing: 5/5.
Calories are never taken from the model; pick-null leaves the diary unmatched (0 kcal).

## Citation / refuse (coach)

Held-out `evals/splits/cite.json`: 2/3 cite USDA/convert_portion or refuse without a row.
