# OpenCal extract→USDA eval · v6 · 2026-08-31T14:22:20.671Z

Extracts from the VLM, calories from MiniSearch + convert_portion (host maps name/brand/qty/unit to a USDA row; no pick VLM). Text scoring applies the same refineExtracted host pass as the PWA.

### Text (n=16)
- Food name accuracy: 100.0%
- Calorie MAE: 1.4 kcal (median 0.0)
- Calorie MAPE: 0.4% · within 20%: 100.0% · within 50%: 100.0%
- Calorie MAE when named correctly: 1.4 kcal
- Empty/unmatched: 0.0% · mean latency 11 ms
### Images (n=34)
- Food name accuracy: 97.1%
- Calorie MAE: 62.7 kcal (median 27.0)
- Calorie MAPE: 76.8% · within 20%: 32.4% · within 50%: 35.3%
- Calorie MAE when named correctly: 54.2 kcal
- Empty/unmatched: 0.0% · mean latency 3 ms
### All (n=50)
- Food name accuracy: 98.0%
- Calorie MAE: 43.1 kcal (median 12.0)
- Calorie MAPE: 52.3% · within 20%: 54.0% · within 50%: 56.0%
- Calorie MAE when named correctly: 36.9 kcal
- Empty/unmatched: 0.0% · mean latency 6 ms

| id | hit | pred kcal | gold kcal | abs err | ape | items |
|---|---|---:|---:|---:|---:|---|
| test-eggs-banana | yes | 284 | 290 | 6 | 2% | Eggs, Banana |
| test-turkey-bacon-eggs | yes | 260 | 266 | 6 | 2% | Turkey Bacon, Eggs |
| test-almond-milk | yes | 73 | 73 | 0 | 0% | Almond Milk |
| test-big-mac | yes | 563 | 553 | 10 | 2% | Mcdonald's Big Mac |
| test-starbucks-latte | yes | 255 | 255 | 0 | 0% | Starbucks Grande Latte |
| test-kind-bar | yes | 194 | 194 | 0 | 0% | KIND Kind Bar |
| test-chipotle-bowl | yes | 837 | 837 | 0 | 0% | Chipotle Chicken Bowl |
| test-greek-yogurt | yes | 80 | 80 | 0 | 0% | Greek Yogurt |
| test-banana | yes | 105 | 105 | 0 | 0% | Banana |
| test-egg-whites | yes | 255 | 255 | 0 | 0% | Egg Whites |
| test-pizza-slices | yes | 569 | 569 | 0 | 0% | Cheese Pizza |
| test-chipotle-bowl-sides | yes | 1195 | 1195 | 0 | 0% | Chipotle Chicken Bowl, Guacamole, Black Beans |
| test-blueberry-muffin | yes | 181 | 181 | 0 | 0% | Blueberry Muffin |
| test-turkey-bacon | yes | 121 | 121 | 0 | 0% | Turkey Bacon |
| test-milk-not-almond | yes | 127 | 127 | 0 | 0% | Milk |
| test-banana-pepper | yes | 41 | 41 | 0 | 0% | Banana Pepper |
| fix-banana | yes | 505 | 525 | 20 | 4% | Bananas |
| fix-eggs | yes | 963 | 185 | 778 | 421% | Egg, Avocado, Spinach, Bacon, Milk |
| n5k-dish_1558722398 | yes | 101 | 101 | 0 | 0% | Apple |
| n5k-dish_1558640593 | yes | 101 | 101 | 0 | 0% | Apple |
| n5k-dish_1558545738 | yes | 101 | 101 | 0 | 0% | Apple |
| n5k-dish_1558721726 | yes | 17 | 101 | 84 | 83% | Apple |
| n5k-dish_1558458847 | yes | 101 | 101 | 0 | 0% | Apple |
| n5k-dish_1558635546 | yes | 101 | 101 | 0 | 0% | Apple |
| n5k-dish_1558640039 | yes | 52 | 25 | 27 | 108% | Carrot |
| n5k-dish_1558633158 | yes | 59 | 25 | 34 | 136% | Carrot, Butter |
| n5k-dish_1558639526 | yes | 58 | 25 | 33 | 132% | Carrot |
| n5k-dish_1558642089 | yes | 58 | 25 | 33 | 132% | Carrot |
| n5k-dish_1558722636 | yes | 58 | 25 | 33 | 132% | Carrot |
| n5k-dish_1558641007 | yes | 52 | 25 | 27 | 108% | Carrot |
| n5k-dish_1562096343 | yes | 1 | 16 | 15 | 94% | Cucumber |
| n5k-dish_1560961179 | yes | 222 | 185 | 37 | 20% | Scrambled Eggs, Mixed Vegetables |
| n5k-dish_1562605315 | yes | 191 | 185 | 6 | 3% | Scrambled Eggs |
| n5k-dish_1559149688 | yes | 280 | 185 | 95 | 51% | Scrambled Eggs, Bacon |
| n5k-dish_1559239256 | yes | 13 | 62 | 49 | 79% | Orange |
| n5k-dish_1559239912 | yes | 62 | 62 | 0 | 0% | Orange |
| n5k-dish_1559240908 | yes | 13 | 62 | 49 | 79% | Orange |
| n5k-dish_1559245848 | yes | 62 | 62 | 0 | 0% | Orange |
| n5k-dish_1559238481 | yes | 13 | 62 | 49 | 79% | Orange |
| n5k-dish_1559932674 | yes | 13 | 62 | 49 | 79% | Orange |
| n5k-dish_1562009810 | yes | 23 | 205 | 182 | 89% | Rice, Carrots |
| n5k-dish_1558629398 | yes | 39 | 22 | 17 | 77% | Tomatoes, Carrot |
| n5k-dish_1558636514 | yes | 65 | 22 | 43 | 195% | Tomatoes |
| n5k-dish_1558721484 | yes | 26 | 22 | 4 | 18% | Cherry Tomatoes |
| n5k-dish_1558639907 | yes | 36 | 22 | 14 | 64% | Cherry Tomatoes |
| n5k-dish_1558722842 | yes | 1 | 22 | 21 | 95% | Cherry Tomatoes |
| n5k-dish_1558631872 | yes | 46 | 22 | 24 | 109% | Tomatoes |
| n5k-dish_1561575688 | no | 580 | 234 | 346 | 148% | Palm, Quinoa, Salad, Brown Rice |
| n5k-dish_1559846073 | yes | 67 | 89 | 22 | 25% | Broccoli, Orange |
| n5k-dish_1560799407 | yes | 41 | 83 | 42 | 51% | Beef, Carrots, Spinach |
