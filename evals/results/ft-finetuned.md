# OpenCal extract→USDA eval · finetuned · 2026-08-31T03:57:26.205Z

Extracts from the VLM, calories from MiniSearch + convert_portion (no pick VLM).

### Text (n=16)
- Food name accuracy: 93.8%
- Calorie MAE: 36.2 kcal (median 0.0)
- Calorie MAPE: 7.5% · within 20%: 75.0% · within 50%: 100.0%
- Calorie MAE when named correctly: 14.7 kcal
- Empty/unmatched: 0.0% · mean latency 14 ms
### Images (n=2)
- Food name accuracy: 50.0%
- Calorie MAE: 302.5 kcal (median 302.5)
- Calorie MAPE: 90.0% · within 20%: 0.0% · within 50%: 0.0%
- Calorie MAE when named correctly: 420.0 kcal
- Empty/unmatched: 0.0% · mean latency 0 ms
### All (n=18)
- Food name accuracy: 88.9%
- Calorie MAE: 65.8 kcal (median 0.0)
- Calorie MAPE: 16.7% · within 20%: 66.7% · within 50%: 88.9%
- Calorie MAE when named correctly: 40.1 kcal
- Empty/unmatched: 0.0% · mean latency 12 ms

| id | hit | pred kcal | gold kcal | abs err | ape | items |
|---|---|---:|---:|---:|---:|---|
| test-eggs-banana | yes | 284 | 290 | 6 | 2% | Eggs, Banana |
| test-turkey-bacon-eggs | yes | 171 | 266 | 95 | 36% | Turkey Bacon, Eggs |
| test-almond-milk | yes | 73 | 73 | 0 | 0% | Almond Milk |
| test-big-mac | yes | 563 | 553 | 10 | 2% | Mcdonald's Big Mac |
| test-starbucks-latte | yes | 255 | 255 | 0 | 0% | Starbucks Grande Latte |
| test-kind-bar | yes | 194 | 194 | 0 | 0% | Kind Protein Bar |
| test-chipotle-bowl | yes | 837 | 837 | 0 | 0% | Chipotle Chicken Bowl |
| test-greek-yogurt | yes | 80 | 80 | 0 | 0% | Greek Yogurt |
| test-banana | yes | 105 | 105 | 0 | 0% | Banana |
| test-egg-whites | yes | 319 | 255 | 64 | 25% | Egg Whites |
| test-pizza-slices | yes | 569 | 569 | 0 | 0% | Cheese Pizza |
| test-chipotle-bowl-sides | no | 837 | 1195 | 358 | 30% | Chipotle Chicken Bowl With Guacamole And Black Beans |
| test-blueberry-muffin | yes | 135 | 181 | 46 | 25% | Blueberry Muffin |
| test-turkey-bacon | yes | 121 | 121 | 0 | 0% | Turkey Bacon |
| test-milk-not-almond | yes | 127 | 127 | 0 | 0% | Milk |
| test-banana-pepper | yes | 41 | 41 | 0 | 0% | Banana Pepper |
| fix-banana | yes | 105 | 525 | 420 | 80% | Banana |
| fix-eggs | no | 0 | 185 | 185 | 100% | — |
