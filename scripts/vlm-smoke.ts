import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadFoods, searchForItem } from '../src/lib/foods.ts'

const foodsJson = readFileSync(new URL('../public/foods.json', import.meta.url))
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).includes('foods.json')) {
    return new Response(foodsJson, { headers: { 'content-type': 'application/json' } })
  }
  return realFetch(input, init)
}) as typeof fetch
import { logFromPhoto, logFromText } from '../src/lib/pipeline.ts'
import { extractMealPhoto, extractMealText, getVlmStatus } from '../src/lib/vlm.ts'

await loadFoods()

function blobFrom(path: string): Blob {
  return new Blob([readFileSync(path)], { type: 'image/jpeg' })
}

let failed = 0

function ok(label: string, pass: boolean, extra?: unknown) {
  if (pass) console.log('OK', label)
  else {
    failed++
    console.error('FAIL', label, extra)
  }
}

console.log('extract + match smoke…', JSON.stringify(getVlmStatus()))

const extracted = await extractMealText('2 eggs and a banana')
console.log('extract', extracted.path, extracted.items, extracted.raw.slice(0, 180), extracted.error ?? '')
ok(
  'extract eggs+banana',
  extracted.path === 'vlm' &&
    extracted.items.some((i) => /egg/i.test(i.query)) &&
    extracted.items.some((i) => /banana/i.test(i.query)),
  extracted.items,
)

const logged: string[] = []
const entries = await logFromText('2 eggs and a banana', '2026-08-30', 'search', {
  onExtracted: (items) => console.log('split', items.map((i) => `${i.quantity} ${i.unit ?? ''} ${i.query}`)),
  onEntry: (entry) => {
    logged.push(entry.name)
    console.log('in', entry.name, entry.serveLabel, entry.kcal, entry.brand ?? '')
  },
})
ok(
  'match eggs+banana into diary foods',
  entries.length >= 2 &&
    entries.some((e) => /egg/i.test(e.name)) &&
    entries.some((e) => /banana/i.test(e.name)) &&
    entries.every((e) => e.foodId !== 'unmatched' || e.name.length > 0),
  entries.map((e) => ({ name: e.name, kcal: e.kcal, serve: e.serveLabel })),
)

const hits = searchForItem({ raw: 'eggs', query: 'eggs', quantity: 2, unit: 'large' }, 6)
ok('search eggs has USDA rows', hits.length > 0 && hits.some((h) => /egg/i.test(h.name)), hits.map((h) => h.name).slice(0, 4))

const oatmeal = await extractMealText('half a cup of oatmeal with a tablespoon of peanut butter')
ok(
  'extract oatmeal+pb',
  oatmeal.items.some((i) => /oat/i.test(i.query)) && oatmeal.items.some((i) => /peanut/i.test(i.query)),
  oatmeal.items,
)

const photo = await extractMealPhoto(blobFrom(resolve(import.meta.dirname, 'fixtures/banana.jpg')))
console.log('photo extract', photo.path, photo.items, photo.raw.slice(0, 180), photo.error ?? '')
ok('photo extract banana', photo.items.some((i) => /banana/i.test(`${i.query} ${photo.raw}`)), photo.items)

const photoEntries = await logFromPhoto(blobFrom(resolve(import.meta.dirname, 'fixtures/pizza.jpg')), '2026-08-30', {
  onEntry: (entry) => console.log('photo in', entry.name, entry.kcal),
})
ok(
  'photo pizza matched or listed',
  photoEntries.some((e) => /pizza/i.test(`${e.name} ${e.debugRaw ?? ''}`)),
  photoEntries.map((e) => e.name),
)

console.log('status', getVlmStatus())
if (failed) {
  console.error(`${failed} smoke cases failed`)
  process.exit(1)
}
console.log('vlm smoke ok', logged)
