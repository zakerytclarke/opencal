import { convertPortion, parseHousehold, scaleNutrition } from '../src/lib/portions.ts'
import type { Food } from '../src/types.ts'
import { readFileSync } from 'node:fs'
import { entryFromFood, getFood, loadFoods, searchFoods } from '../src/lib/foods.ts'
import type { ExtractedItem } from '../src/types.ts'

const foodsJson = readFileSync(new URL('../public/foods.json', import.meta.url))
globalThis.fetch = (async (input: RequestInfo | URL) => {
  if (String(input).includes('foods.json')) {
    return new Response(foodsJson, { headers: { 'content-type': 'application/json' } })
  }
  throw new Error(`unexpected fetch ${String(input)}`)
}) as typeof fetch

await loadFoods()

function food(partial: Partial<Food> & Pick<Food, 'name' | 'kcal' | 'serveG' | 'serveLabel'>): Food {
  return {
    id: 'test',
    emoji: '🍽️',
    category: 'other',
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0,
    sugar: 0,
    source: 'compiled',
    aliases: [],
    visibility: 'search',
    ...partial,
  }
}

function item(quantity: number, unit: string | null): Pick<ExtractedItem, 'quantity' | 'unit'> {
  return { quantity, unit }
}

type Case = { name: string; run: () => { pass: boolean; got: string } }

const cases: Case[] = [
  {
    name: 'NIST ounce is 28.349523125 g',
    run() {
      const row = food({ name: 'Test', kcal: 100, serveG: 100, serveLabel: '100 g' })
      const p = convertPortion(row, item(1, 'oz'))
      const pass = p.method === 'nist-mass' && Math.abs(p.grams - 28.349523125) < 1e-6 && p.kcal === 28
      return { pass, got: `${p.grams} g ${p.kcal} kcal ${p.method}` }
    },
  },
  {
    name: 'FDA cup uses USDA household when the row is 1 cup',
    run() {
      const oats = food({ name: 'Oatmeal', kcal: 68, serveG: 234, serveLabel: '1 cup cooked' })
      const half = convertPortion(oats, item(0.5, 'cup'))
      const pass = half.method === 'usda-household' && Math.abs(half.grams - 117) < 0.01
      return { pass, got: `${half.grams} g ${half.kcal} kcal ${half.method}` }
    },
  },
  {
    name: 'USDA tablespoon scales off the household tbsp, not 15 g of water',
    run() {
      const pb = food({ name: 'Peanut butter', kcal: 588, serveG: 32, serveLabel: '2 tbsp' })
      const p = convertPortion(pb, item(1, 'tbsp'))
      const pass = Math.abs(p.grams - 16) < 0.01 && p.method === 'usda-household'
      return { pass, got: `${p.grams} g ${p.method}` }
    },
  },
  {
    name: 'Grande latte uses 16 fl oz density from the USDA/compiled row',
    run() {
      const latte = getFood('extra-9469757')
      if (!latte) return { pass: false, got: 'missing grande latte extra' }
      const grande = convertPortion(latte, item(1, 'grande'))
      const cup = convertPortion(latte, item(1, 'cup'))
      const pass =
        Math.abs(grande.grams - latte.serveG) < 2 &&
        cup.grams >= 230 &&
        cup.grams <= 250 &&
        grande.kcal === scaleNutrition(latte, grande.grams).kcal
      return { pass, got: `grande ${grande.grams.toFixed(1)}g ${grande.kcal}kcal · cup ${cup.grams.toFixed(1)}g ${cup.method}` }
    },
  },
  {
    name: 'Calories are always USDA per-100 g times converted grams',
    run() {
      const row = food({ name: 'Test', kcal: 200, protein: 10, carbs: 20, fat: 8, serveG: 100, serveLabel: '100 g' })
      const p = convertPortion(row, item(50, 'g'))
      const pass = p.kcal === 100 && p.protein === 5 && p.carbs === 10 && p.fat === 4 && p.method === 'nist-mass'
      return { pass, got: `${p.kcal} kcal / ${p.protein}p ${p.carbs}c ${p.fat}f` }
    },
  },
  {
    name: 'parseHousehold reads FDA cup and NIST fl oz labels',
    run() {
      const cup = parseHousehold('1 cup cooked')
      const floz = parseHousehold('16 fl oz')
      const pass = cup?.unit === 'cup' && cup.ml === 240 && floz?.unit === 'fl oz' && floz.ml != null && Math.abs(floz.ml - 473.176) < 0.01
      return { pass, got: `cup ${cup?.unit} ${cup?.ml} · fl oz ${floz?.unit} ${floz?.ml}` }
    },
  },
  {
    name: 'Garnish banana medium still uses USDA 118 g whole-item weight',
    run() {
      const slice = searchFoods('banana', 12).find((f) => /banana, raw/i.test(f.name) && f.serveG < 20)
      if (!slice) return { pass: false, got: 'no garnish banana' }
      const entry = entryFromFood(
        slice,
        { raw: 'banana', query: 'banana', quantity: 1, unit: 'medium' },
        'voice',
        '2026-08-30',
      )
      const pass = entry.grams >= 80 && entry.kcal >= 90 && entry.kcal <= 130
      return { pass, got: `${slice.serveG}g row → ${entry.grams}g ${entry.kcal} kcal` }
    },
  },
  {
    name: '2 slices turkey bacon doubles USDA slice grams',
    run() {
      const bacon = searchFoods('turkey bacon', 8).find((f) => /turkey bacon/i.test(f.name) && !/grease/i.test(f.name))
      if (!bacon) return { pass: false, got: 'no turkey bacon' }
      const one = convertPortion(bacon, item(1, 'slice'))
      const two = convertPortion(bacon, item(2, 'slices'))
      const pass = Math.abs(two.grams - one.grams * 2) < 0.01 && two.kcal > 0
      return { pass, got: `1 slice ${one.grams}g · 2 slices ${two.grams}g` }
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
