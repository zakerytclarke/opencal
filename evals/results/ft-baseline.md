# OpenCal extract→USDA eval · baseline · 2026-08-31T03:54:35.573Z

Extracts from the VLM, calories from MiniSearch + convert_portion (no pick VLM).

### Text (n=16)
- Food name accuracy: 87.5%
- Calorie MAE: 70.6 kcal (median 26.0)
- Calorie MAPE: 61.4% · within 20%: 56.3% · within 50%: 81.3%
- Calorie MAE when named correctly: 57.9 kcal
- Empty/unmatched: 0.0% · mean latency 12 ms
### Images (n=2)
- Food name accuracy: 0.0%
- Calorie MAE: 355.0 kcal (median 355.0)
- Calorie MAPE: 100.0% · within 20%: 0.0% · within 50%: 0.0%
- Calorie MAE when named correctly: n/a kcal
- Empty/unmatched: 0.0% · mean latency 0 ms
### All (n=18)
- Food name accuracy: 77.8%
- Calorie MAE: 102.2 kcal (median 47.5)
- Calorie MAPE: 65.7% · within 20%: 50.0% · within 50%: 72.2%
- Calorie MAE when named correctly: 57.9 kcal
- Empty/unmatched: 0.0% · mean latency 10 ms

| id | hit | pred kcal | gold kcal | abs err | ape | items |
|---|---|---:|---:|---:|---:|---|
| test-eggs-banana | yes | 284 | 290 | 6 | 2% | Eggs, Banana |
| test-turkey-bacon-eggs | yes | 260 | 266 | 6 | 2% | Turkey Bacon, Eggs |
| test-almond-milk | yes | 73 | 73 | 0 | 0% | Almond Milk |
| test-big-mac | yes | 704 | 553 | 151 | 27% | McDonald's Big Mac |
| test-starbucks-latte | yes | 8 | 255 | 247 | 97% | Starbucks Grande Latte |
| test-kind-bar | yes | 243 | 194 | 49 | 25% | KIND protein bar |
| test-chipotle-bowl | yes | 837 | 837 | 0 | 0% | Chipotle Chicken Bowl |
| test-greek-yogurt | yes | 80 | 80 | 0 | 0% | Greek Yogurt |
| test-banana | yes | 284 | 105 | 179 | 170% | Banana, Eggs |
| test-egg-whites | no | 179 | 255 | 76 | 30% | Eggs |
| test-pizza-slices | yes | 569 | 569 | 0 | 0% | Cheese Pizza |
| test-chipotle-bowl-sides | yes | 1321 | 1195 | 126 | 11% | Chipotle Chicken Bowl, Guacamole, Black Beans |
| test-blueberry-muffin | yes | 227 | 181 | 46 | 25% | Blueberry Muffin |
| test-turkey-bacon | yes | 121 | 121 | 0 | 0% | Turkey Bacon |
| test-milk-not-almond | yes | 127 | 127 | 0 | 0% | Milk |
| test-banana-pepper | no | 284 | 41 | 243 | 593% | Banana, Eggs |
| fix-banana | no | 0 | 525 | 525 | 100% | — |
| fix-eggs | no | 0 | 185 | 185 | 100% | — |
