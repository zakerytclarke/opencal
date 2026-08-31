import { readFileSync } from 'node:fs'
import { extractFoods } from '../src/lib/extract.ts'
import {
  candidateLines,
  entryFromFood,
  fdcIdFromFoodId,
  foodSourceLabel,
  foodSourceUrl,
  getFood,
  loadFoods,
  searchForItem,
  searchFoods,
  unmatchedEntry,
} from '../src/lib/foods.ts'
import { parseExtractedFoods, parsePick } from '../src/lib/vlmParse.ts'
import type { ExtractedItem } from '../src/types.ts'

const foodsJson = readFileSync(new URL('../public/foods.json', import.meta.url))
globalThis.fetch = (async (input: RequestInfo | URL) => {
  if (String(input).includes('foods.json')) {
    return new Response(foodsJson, { headers: { 'content-type': 'application/json' } })
  }
  throw new Error(`unexpected fetch ${String(input)}`)
}) as typeof fetch

await loadFoods()

type Case = {
  name: string
  run: () => { pass: boolean; got: string }
}

function item(query: string, extras: Partial<ExtractedItem> = {}): ExtractedItem {
  return { raw: query, query, quantity: 1, unit: null, ...extras }
}

function topNames(hits: { name: string }[], n = 3): string {
  return hits.slice(0, n).map((h) => h.name).join(' · ') || '(none)'
}

const cases: Case[] = [
  {
    name: 'Joint: 2 slices turkey bacon extract stays one food',
    run() {
      const items = parseExtractedFoods(
        '{"foods":[{"name":"turkey bacon","quantity":2,"unit":"slice"}]}',
      )
      const hits = searchForItem(items[0], 8)
      const top = hits[0]?.name ?? ''
      const pass =
        items.length === 1 &&
        items[0].quantity === 2 &&
        items[0].unit === 'slice' &&
        /turkey bacon/i.test(top) &&
        !/grease|canadian|pork/i.test(top)
      return { pass, got: `${items.length} item(s) · ${items[0].quantity} ${items[0].unit} · ${top}` }
    },
  },
  {
    name: 'Joint: spoken turkey bacon + eggs splits then ranks each',
    run() {
      const items = extractFoods('2 slices turkey bacon and 2 eggs')
      const bacon = items.find((i) => /turkey bacon/i.test(i.query))
      const eggs = items.find((i) => /^eggs?$/i.test(i.query))
      const baconHit = bacon ? searchForItem(bacon, 6)[0] : undefined
      const eggHit = eggs ? searchForItem(eggs, 6)[0] : undefined
      const pass = Boolean(
        items.length >= 2 &&
          bacon &&
          eggs &&
          bacon.quantity === 2 &&
          /turkey bacon/i.test(baconHit?.name ?? '') &&
          /egg/i.test(eggHit?.name ?? '') &&
          !/white|yolk|pepper/i.test(eggHit?.name ?? ''),
      )
      return {
        pass,
        got: `${items.map((i) => `${i.quantity} ${i.unit ?? ''} ${i.query}`.trim()).join(' · ')} → ${baconHit?.name} / ${eggHit?.name}`,
      }
    },
  },
  {
    name: 'Turkey bacon beats pork bacon and grease',
    run() {
      const hits = searchFoods('turkey bacon', 8)
      const top = hits[0]?.name ?? ''
      return {
        pass: /turkey bacon/i.test(top) && hits.every((h, i) => i > 2 || /turkey/i.test(h.name)),
        got: topNames(hits),
      }
    },
  },
  {
    name: 'Plain bacon is not turkey bacon',
    run() {
      const hits = searchFoods('bacon', 6)
      const top = hits[0]?.name ?? ''
      return {
        pass: /\bbacon\b/i.test(top) && !/turkey/i.test(top),
        got: topNames(hits),
      }
    },
  },
  {
    name: 'Canadian bacon is not turkey bacon',
    run() {
      const hits = searchFoods('canadian bacon', 6)
      const top = hits[0]?.name ?? ''
      return {
        pass: /canadian bacon/i.test(top) && !/turkey/i.test(top),
        got: topNames(hits),
      }
    },
  },
  {
    name: 'Joint branded: McDonald’s Big Mac',
    run() {
      const items = parseExtractedFoods(
        '{"foods":[{"name":"Big Mac","brand":"McDonald\'s","quantity":1,"unit":"sandwich"}]}',
      )
      const hits = searchForItem(items[0], 6)
      const top = hits[0]?.name ?? ''
      return {
        pass: items[0]?.brand === "McDonald's" && /big mac/i.test(top) && /mcdonald/i.test(top),
        got: `${items[0]?.brand} · ${topNames(hits)}`,
      }
    },
  },
  {
    name: 'Big Mac without brand still ranks a Big Mac',
    run() {
      const hits = searchFoods('big mac', 5)
      return { pass: /big mac/i.test(hits[0]?.name ?? ''), got: topNames(hits) }
    },
  },
  {
    name: 'Joint branded: Starbucks grande latte',
    run() {
      const items = parseExtractedFoods(
        '{"foods":[{"name":"latte","brand":"Starbucks","quantity":1,"unit":"grande"}]}',
      )
      const hits = searchForItem(items[0], 6)
      const top = hits[0]?.name ?? ''
      return {
        pass: /starbucks/i.test(top) && /latte/i.test(top) && !/pumpkin/i.test(top),
        got: topNames(hits),
      }
    },
  },
  {
    name: 'Joint branded: KIND bar',
    run() {
      const items = parseExtractedFoods(
        '{"foods":[{"name":"protein bar","brand":"KIND","quantity":1,"unit":"bar"}]}',
      )
      const hits = searchForItem(items[0], 6)
      const top = hits[0]?.name ?? ''
      return {
        pass: /kind/i.test(top) && /bar/i.test(top) && !/south beach|snickers|cracker barrel/i.test(top),
        got: topNames(hits),
      }
    },
  },
  {
    name: 'Joint branded: Chobani Greek yogurt prefers plain',
    run() {
      const items = parseExtractedFoods(
        '{"foods":[{"name":"greek yogurt","brand":"Chobani","quantity":1,"unit":"cup"}]}',
      )
      const hits = searchForItem(items[0], 8)
      const top = hits[0]?.name ?? ''
      return {
        pass: /chobani/i.test(top) && /greek/i.test(top) && /yogurt/i.test(top) && /plain/i.test(top),
        got: topNames(hits),
      }
    },
  },
  {
    name: 'Joint branded: Chipotle chicken bowl is not chipotle dip',
    run() {
      const items = parseExtractedFoods(
        '{"foods":[{"name":"chicken burrito bowl","brand":"Chipotle","quantity":1,"unit":"bowl"}]}',
      )
      const hits = searchForItem(items[0], 6)
      const top = hits[0]?.name ?? ''
      return {
        pass: /chipotle/i.test(top) && /bowl|burrito/i.test(top) && !/\bdip\b/i.test(top),
        got: topNames(hits),
      }
    },
  },
  {
    name: 'Joint branded: Applebee’s chicken tenders',
    run() {
      const items = parseExtractedFoods(
        '{"foods":[{"name":"chicken tenders","brand":"Applebee\'s","quantity":1,"unit":"platter"}]}',
      )
      const hits = searchForItem(items[0], 6)
      const top = hits[0]?.name ?? ''
      return {
        pass: /applebee/i.test(top) && /tender/i.test(top),
        got: topNames(hits),
      }
    },
  },
  {
    name: 'Almond milk is not dairy milk',
    run() {
      const hits = searchFoods('almond milk', 6)
      const top = hits[0]?.name ?? ''
      return {
        pass:
          /almond milk/i.test(top) &&
          !/\bchocolate\b/i.test(top) &&
          hits.slice(0, 4).every((h) => /almond/i.test(h.name)) &&
          !hits.slice(0, 4).some((h) => /milk, whole|2% milkfat/i.test(h.name)),
        got: topNames(hits),
      }
    },
  },
  {
    name: 'Milk is dairy, not almond or oat',
    run() {
      const hits = searchFoods('milk', 6)
      const top = hits[0]?.name ?? ''
      return {
        pass: /\bmilk\b/i.test(top) && !/almond|oat|soy|coconut|rice/i.test(top),
        got: topNames(hits),
      }
    },
  },
  {
    name: 'Egg whites are not whole eggs',
    run() {
      const hits = searchFoods('egg whites', 6)
      const top = hits[0]?.name ?? ''
      return {
        pass: /white/i.test(top) && !/yolk|whole|grade a, large, egg whole/i.test(top),
        got: topNames(hits),
      }
    },
  },
  {
    name: 'Eggs are whole, not whites or banana',
    run() {
      const hits = searchFoods('eggs', 6)
      const top = hits[0]?.name ?? ''
      return {
        pass: /egg/i.test(top) && /whole|scrambled|^egg$/i.test(top) && !/white|yolk|pepper/i.test(top),
        got: topNames(hits),
      }
    },
  },
  {
    name: 'Banana is fruit, not banana pepper',
    run() {
      const hits = searchFoods('banana', 6)
      const top = hits[0]?.name ?? ''
      const kcal = hits[0] ? Math.round(hits[0].kcal * (hits[0].serveG / 100)) : 0
      return {
        pass:
          /banana/i.test(top) &&
          !/pepper/i.test(top) &&
          hits.slice(0, 3).every((h) => !/pepper/i.test(h.name)) &&
          (hits[0]?.serveG ?? 0) >= 80 &&
          kcal >= 70 &&
          kcal <= 140,
        got: `${topNames(hits)} · ${hits[0]?.serveG}g · ${kcal} kcal`,
      }
    },
  },
  {
    name: 'Carrot is a vegetable, not a 5 g garnish slice',
    run() {
      const hits = searchFoods('carrot', 6)
      const top = hits[0]
      const kcal = top ? Math.round(top.kcal * (top.serveG / 100)) : 0
      return {
        pass: Boolean(
          top &&
            /carrot/i.test(top.name) &&
            top.serveG >= 40 &&
            kcal >= 15 &&
            kcal <= 80 &&
            !/juice|dehydrated|salad|peas/i.test(top.name),
        ),
        got: `${top?.name} · ${top?.serveG}g · ${kcal} kcal`,
      }
    },
  },
  {
    name: '1 medium banana stays ~100 kcal even if USDA row is a 6 g slice',
    run() {
      const food = searchFoods('banana', 12).find((f) => /banana, raw/i.test(f.name) && f.serveG < 20)
      if (!food) return { pass: false, got: 'no garnish banana row' }
      const medium = entryFromFood(food, item('banana', { quantity: 1, unit: 'medium' }), 'photo', '2026-08-30')
      const pickedSlice = entryFromFood(food, item('banana', { quantity: 1, unit: 'slice' }), 'photo', '2026-08-30')
      const pass =
        medium.kcal >= 90 &&
        medium.kcal <= 130 &&
        medium.grams >= 80 &&
        pickedSlice.kcal >= 90 &&
        pickedSlice.kcal <= 130
      return {
        pass,
        got: `row ${food.serveG}g · medium ${medium.grams}g ${medium.kcal} kcal · picked-slice ${pickedSlice.grams}g ${pickedSlice.kcal} kcal`,
      }
    },
  },
  {
    name: '1 medium carrot is a vegetable, not dehydrated chips',
    run() {
      const food = searchFoods('carrot', 6)[0]
      if (!food) return { pass: false, got: 'no carrot' }
      const entry = entryFromFood(food, item('carrot', { quantity: 1, unit: 'medium' }), 'search', '2026-08-30')
      return {
        pass:
          /carrot/i.test(food.name) &&
          !/dehydrated|juice|salad/i.test(food.name) &&
          entry.kcal >= 15 &&
          entry.kcal <= 80 &&
          entry.grams >= 40,
        got: `${food.name} → ${entry.grams}g ${entry.kcal} kcal`,
      }
    },
  },
  {
    name: 'Tomato has real calories, not a 0 kcal foundation stub',
    run() {
      const hits = searchFoods('tomato', 6)
      const top = hits[0]
      return {
        pass: Boolean(top && /tomato/i.test(top.name) && top.kcal >= 10 && (top.serveG >= 80 || /medium|small|large/i.test(top.serveLabel))),
        got: `${top?.name} · ${top?.kcal} kcal/100g · ${top?.serveG}g`,
      }
    },
  },
  {
    name: 'Banana pepper stays a pepper',
    run() {
      const hits = searchFoods('banana pepper', 6)
      const top = hits[0]?.name ?? ''
      return {
        pass: /pepper/i.test(top) && /banana/i.test(top) && !/^banana(?!,?\s*pepper)/i.test(top),
        got: topNames(hits),
      }
    },
  },
  {
    name: 'Joint meal: Chipotle bowl + guac + beans each match',
    run() {
      const items = parseExtractedFoods(
        '{"foods":[{"name":"chicken burrito bowl","brand":"Chipotle","quantity":1,"unit":"bowl"},{"name":"guacamole","quantity":1,"unit":"serving"},{"name":"black beans","quantity":1,"unit":"cup"}]}',
      )
      const tops = items.map((i) => searchForItem(i, 5)[0]?.name ?? '')
      const pass =
        items.length === 3 &&
        /chipotle/i.test(tops[0]) &&
        /guac/i.test(tops[1]) &&
        /black bean/i.test(tops[2])
      return { pass, got: tops.join(' · ') }
    },
  },
  {
    name: 'Joint meal: Starbucks latte + blueberry muffin',
    run() {
      const items = parseExtractedFoods(
        '{"name":"latte","brand":"Starbucks","quantity":1,"unit":"grande"},{"name":"blueberry muffin","quantity":1}]}',
      )
      const tops = items.map((i) => searchForItem(i, 5)[0]?.name ?? '')
      return {
        pass:
          items.length === 2 &&
          /starbucks/i.test(tops[0]) &&
          /muffin/i.test(tops[1]) &&
          /blueberr/i.test(tops[1]) &&
          !/cereal|dry mix|, dry$|english muffin/i.test(tops[1]),
        got: tops.join(' · '),
      }
    },
  },
  {
    name: 'Pick JSON selects turkey bacon row B',
    run() {
      const hits = searchForItem(item('turkey bacon'), 6)
      const rows = candidateLines(hits, item('turkey bacon', { quantity: 2, unit: 'slice' }))
      const turkeyIdx = rows.findIndex((r) => /turkey bacon, cooked$/i.test(r.food.name))
      const letter = String.fromCharCode(65 + Math.max(0, turkeyIdx))
      const pick = parsePick(
        `{"pick":"${letter}","name":"Turkey bacon, cooked","brand":null,"unit":"slice","quantity":2}`,
        rows.length,
      )
      const food = pick.index != null ? rows[pick.index].food : null
      return {
        pass: food != null && /turkey bacon, cooked/i.test(food.name) && pick.quantity === 2 && pick.unit === 'slice' && /convert_portion/.test(rows[0]?.line ?? ''),
        got: `pick ${letter} → ${food?.name ?? 'none'} · ${pick.quantity} ${pick.unit}`,
      }
    },
  },
  {
    name: 'Pick none still keeps unmatched branded name',
    run() {
      const pick = parsePick(
        '{"pick":null,"name":"Secret Menu Dragon Drink","brand":"Starbucks","unit":"grande","quantity":1}',
        6,
      )
      return {
        pass: pick.index === null && pick.name === 'Secret Menu Dragon Drink' && pick.brand === 'Starbucks',
        got: `${pick.index} · ${pick.brand} ${pick.name}`,
      }
    },
  },
  {
    name: 'Nutrition scales 2 slices of turkey bacon off the serving',
    run() {
      const food = searchForItem(item('turkey bacon'), 4)[0]
      if (!food) return { pass: false, got: 'no turkey bacon' }
      const one = entryFromFood(food, item('turkey bacon', { quantity: 1, unit: 'slice' }), 'search', '2026-08-30')
      const two = entryFromFood(food, item('turkey bacon', { quantity: 2, unit: 'slice' }), 'search', '2026-08-30')
      return {
        pass:
          two.grams === one.grams * 2 &&
          two.kcal > 0 &&
          Math.abs(two.kcal - one.kcal * 2) <= 2,
        got: `1 slice ${one.kcal} kcal / ${one.grams}g · 2 slices ${two.kcal} kcal / ${two.grams}g`,
      }
    },
  },
  {
    name: 'KIND bar serving is one bar, not a crumb',
    run() {
      const food = searchForItem(item('kind bar', { brand: 'KIND' }), 4)[0]
      if (!food) return { pass: false, got: 'no kind bar' }
      const entry = entryFromFood(food, item('kind bar', { brand: 'KIND', quantity: 1, unit: 'bar' }), 'search', '2026-08-30')
      return {
        pass:
          /kind/i.test(food.name) &&
          entry.name === 'Kind Bar' &&
          entry.brand === 'KIND' &&
          entry.foodId === food.id &&
          entry.kcal >= 150 &&
          entry.grams >= 30,
        got: `${entry.name} (${entry.brand}) → ${food.name} · ${entry.serveLabel} · ${entry.grams}g · ${entry.kcal} kcal`,
      }
    },
  },
  {
    name: 'Diary keeps spoken name, links USDA turkey bacon',
    run() {
      const items = parseExtractedFoods(
        '{"foods":[{"name":"turkey bacon","quantity":2,"unit":"slice"}]}',
      )
      const food = searchForItem(items[0], 6)[0]
      if (!food) return { pass: false, got: 'no reference' }
      const entry = entryFromFood(food, items[0], 'voice', '2026-08-30')
      return {
        pass:
          entry.name === 'Turkey Bacon' &&
          entry.brand == null &&
          entry.foodId === food.id &&
          /turkey bacon/i.test(food.name) &&
          food.name !== entry.name,
        got: `${entry.name} brand=${entry.brand ?? 'none'} → ${food.id} ${food.name}`,
      }
    },
  },
  {
    name: 'Diary keeps Starbucks + latte, not USDA row title',
    run() {
      const items = parseExtractedFoods(
        '{"foods":[{"name":"grande latte","brand":"Starbucks","quantity":1,"unit":"grande"}]}',
      )
      const food = searchForItem(items[0], 6)[0]
      if (!food) return { pass: false, got: 'no reference' }
      const entry = entryFromFood(food, items[0], 'voice', '2026-08-30')
      return {
        pass:
          entry.name === 'Grande Latte' &&
          entry.brand === 'Starbucks' &&
          entry.foodId === food.id &&
          /starbucks/i.test(food.name) &&
          food.name !== entry.name,
        got: `${entry.brand} ${entry.name} → ${food.name}`,
      }
    },
  },
  {
    name: 'Photo KIND protein bar keeps package name',
    run() {
      const items = parseExtractedFoods(
        '{"foods":[{"name":"protein bar","brand":"KIND","quantity":1,"unit":"bar"}]}',
      )
      const food = searchForItem(items[0], 6)[0]
      if (!food) return { pass: false, got: 'no reference' }
      const entry = entryFromFood(food, items[0], 'photo', '2026-08-30')
      return {
        pass:
          entry.name === 'Protein Bar' &&
          entry.brand === 'KIND' &&
          entry.foodId === food.id &&
          /kind/i.test(food.name),
        got: `${entry.brand} ${entry.name} → ${food.name}`,
      }
    },
  },
  {
    name: 'USDA brand is not copied onto an unbranded spoken food',
    run() {
      const items = parseExtractedFoods('{"foods":[{"name":"greek yogurt","quantity":1,"unit":"cup"}]}')
      const food = searchForItem(items[0], 6)[0]
      if (!food) return { pass: false, got: 'no reference' }
      const entry = entryFromFood(food, items[0], 'voice', '2026-08-30')
      return {
        pass: entry.name === 'Greek Yogurt' && entry.brand == null && entry.foodId === food.id,
        got: `${entry.name} brand=${entry.brand ?? 'none'} · ref ${food.name}`,
      }
    },
  },
  {
    name: 'USDA foods link to FoodData Central by FDC ID',
    run() {
      const food = searchFoods('turkey bacon', 8).find((f) => /turkey bacon/i.test(f.name) && !/grease/i.test(f.name))
      if (!food) return { pass: false, got: 'no turkey bacon' }
      const fdc = fdcIdFromFoodId(food.id)
      const url = foodSourceUrl(food.id, food.name)
      return {
        pass: fdc === '2706135' && url === 'https://fdc.nal.usda.gov/food-details/2706135/nutrients',
        got: `${food.id} · ${foodSourceLabel(food.id)} · ${url}`,
      }
    },
  },
  {
    name: 'Foundation and SR foods keep their FDC IDs',
    run() {
      const foundation = foodSourceUrl('foundation-331897', 'Milk, whole')
      const sr = foodSourceUrl('sr-171287', 'Bananas, raw')
      return {
        pass:
          foundation === 'https://fdc.nal.usda.gov/food-details/331897/nutrients' &&
          sr === 'https://fdc.nal.usda.gov/food-details/171287/nutrients',
        got: `${foundation} · ${sr}`,
      }
    },
  },
  {
    name: 'Compiled extras search USDA by name, not a fake FDC ID',
    run() {
      const url = foodSourceUrl('extra-5137788', 'Avocado Toast')
      return {
        pass:
          foodSourceLabel('extra-5137788') === 'Compiled' &&
          fdcIdFromFoodId('extra-5137788') == null &&
          url.includes('food-search') &&
          decodeURIComponent(url).includes('Avocado Toast'),
        got: url,
      }
    },
  },
  {
    name: 'Public search hides garnish slices and dehydrated chips',
    run() {
      const publicHits = searchFoods('carrot', 12, 'search')
      const pub = publicHits[0]
      const garnish = getFood('fndds-2709660')
      const dehyd = getFood('sr-170500')
      const leaked = publicHits.find((f) => /dehydrated/i.test(f.name) || (f.serveG ?? 0) < 20)
      return {
        pass: Boolean(
          pub &&
            pub.visibility === 'search' &&
            pub.name === 'Carrot' &&
            pub.serveG >= 40 &&
            !leaked &&
            garnish &&
            garnish.visibility === 'ref' &&
            garnish.serveG < 20 &&
            dehyd &&
            dehyd.visibility === 'ref' &&
            /dehydrated/i.test(dehyd.name),
        ),
        got: `search ${pub?.name} ${pub?.serveG}g vis=${pub?.visibility} · garnish ${garnish?.serveG}g ${garnish?.visibility} · dehyd ${dehyd?.name} ${dehyd?.visibility}`,
      }
    },
  },
  {
    name: 'Public banana search is a medium fruit, refs still include the 6 g slice',
    run() {
      const pub = searchFoods('banana', 6, 'search')[0]
      const garnish = searchFoods('banana', 12, 'all').find((f) => /banana, raw/i.test(f.name) && f.serveG < 20)
      const kcal = pub ? Math.round(pub.kcal * (pub.serveG / 100)) : 0
      return {
        pass: Boolean(pub && pub.visibility === 'search' && (pub.serveG ?? 0) >= 80 && kcal >= 70 && garnish && garnish.visibility === 'ref'),
        got: `search ${pub?.name} ${pub?.serveG}g ${kcal}kcal vis=${pub?.visibility} · ref slice ${garnish?.serveG}g ${garnish?.visibility}`,
      }
    },
  },
  {
    name: 'USDA branded foods keep their FDC IDs',
    run() {
      const url = foodSourceUrl('branded-534358', 'KIND bar')
      return {
        pass: foodSourceLabel('branded-534358') === 'USDA Branded' && url === 'https://fdc.nal.usda.gov/food-details/534358/nutrients',
        got: `${foodSourceLabel('branded-534358')} · ${url}`,
      }
    },
  },
  {
    name: 'Pick-null unmatched entry has zero calories',
    run() {
      const entry = unmatchedEntry(
        { raw: 'a medium banana', query: 'banana', quantity: 1, unit: 'medium' },
        'sentence',
        '2026-08-31',
      )
      return {
        pass: entry.foodId === 'unmatched' && entry.kcal === 0 && /banana/i.test(entry.name),
        got: `${entry.foodId} ${entry.kcal}kcal ${entry.name}`,
      }
    },
  },
  {
    name: 'Quick add and unmatched have no FDC id',
    run() {
      const pass = fdcIdFromFoodId('quick') == null && fdcIdFromFoodId('unmatched') == null
      return { pass, got: pass ? 'none' : 'unexpected id' }
    },
  },
]

const results = cases.map((c) => {
  const { pass, got } = c.run()
  return { name: c.name, pass, got }
})

const failed = results.filter((r) => !r.pass)
console.log('| # | Test | Got | Result |')
console.log('|---|------|-----|--------|')
results.forEach((r, i) => {
  console.log(`| ${i + 1} | ${r.name} | ${r.got.replace(/\|/g, '/')} | ${r.pass ? 'PASS' : 'FAIL'} |`)
})
console.log('')
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
