# OpenCal extract→USDA eval · finetuned · 2026-08-31T09:37:04.529Z

Extracts from the VLM, calories from MiniSearch + convert_portion (no pick VLM).

### Text (n=16)
- Food name accuracy: 100.0%
- Calorie MAE: 5.6 kcal (median 0.0)
- Calorie MAPE: 6.1% · within 20%: 93.8% · within 50%: 93.8%
- Calorie MAE when named correctly: 5.6 kcal
- Empty/unmatched: 0.0% · mean latency 12 ms
### Images (n=2)
- Food name accuracy: 100.0%
- Calorie MAE: 437.5 kcal (median 437.5)
- Calorie MAPE: 236.5% · within 20%: 50.0% · within 50%: 50.0%
- Calorie MAE when named correctly: 437.5 kcal
- Empty/unmatched: 0.0% · mean latency 3 ms
### All (n=18)
- Food name accuracy: 100.0%
- Calorie MAE: 53.6 kcal (median 0.0)
- Calorie MAPE: 31.7% · within 20%: 88.9% · within 50%: 88.9%
- Calorie MAE when named correctly: 53.6 kcal
- Empty/unmatched: 0.0% · mean latency 11 ms

| id | hit | pred kcal | gold kcal | abs err | ape | items |
|---|---|---:|---:|---:|---:|---|
| test-eggs-banana | yes | 284 | 290 | 6 | 2% | Eggs, Banana |
| test-turkey-bacon-eggs | yes | 224 | 266 | 42 | 16% | Turkey Bacon, Eggs |
| test-almond-milk | yes | 73 | 73 | 0 | 0% | Almond Milk |
| test-big-mac | yes | 563 | 553 | 10 | 2% | Mcdonald's Big Mac |
| test-starbucks-latte | yes | 255 | 255 | 0 | 0% | Starbucks Grande Latte |
| test-kind-bar | yes | 194 | 194 | 0 | 0% | kIND protein bar |
| test-chipotle-bowl | yes | 837 | 837 | 0 | 0% | Chipotle Chicken Bowl |
| test-greek-yogurt | yes | 80 | 80 | 0 | 0% | Greek Yogurt |
| test-banana | yes | 105 | 105 | 0 | 0% | Banana |
| test-egg-whites | yes | 255 | 255 | 0 | 0% | Egg Whites |
| test-pizza-slices | yes | 569 | 569 | 0 | 0% | Cheese Pizza |
| test-chipotle-bowl-sides | yes | 1195 | 1195 | 0 | 0% | Chipotle Chicken Bowl, Guacamole, Black Beans |
| test-blueberry-muffin | yes | 181 | 181 | 0 | 0% | Blueberry Muffin |
| test-turkey-bacon | yes | 121 | 121 | 0 | 0% | Turkey Bacon |
| test-milk-not-almond | yes | 127 | 127 | 0 | 0% | Milk |
| test-banana-pepper | yes | 9 | 41 | 32 | 78% | Pepper |
| fix-banana | yes | 525 | 525 | 0 | 0% | Banana |
| fix-eggs | yes | 1060 | 185 | 875 | 473% | Egg, Avocado, Spinach, Bread |
