import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Force the base LFM (not the opencal fine-tune) so this validates the new
// flat-array photo prompt against the general model before shipping.
const BASE_MODEL = process.env.VLM_BASE_ID ?? 'onnx-community/LFM2.5-VL-450M-ONNX'
;(globalThis as { OPENCAL_VLM_ID?: string }).OPENCAL_VLM_ID = BASE_MODEL

const foodsJson = readFileSync(new URL('../public/foods.json', import.meta.url))
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).includes('foods.json')) {
    return new Response(foodsJson, { headers: { 'content-type': 'application/json' } })
  }
  return realFetch(input, init)
}) as typeof fetch

import { loadFoods } from '../src/lib/foods.ts'
import { logFromPhoto } from '../src/lib/pipeline.ts'
import { getVlmStatus } from '../src/lib/vlm.ts'

function blobFrom(path: string): Blob {
  return new Blob([readFileSync(path)], { type: 'image/jpeg' })
}

const FIXTURES = ['banana.jpg', 'pizza.jpg', 'eggs.jpg', 'bowl.jpg']
let failed = 0

console.log('[vlm-photo] base model:', BASE_MODEL)
await loadFoods()

for (const file of FIXTURES) {
  const path = resolve(import.meta.dirname, 'fixtures', file)
  const started = Date.now()
  console.log(`\n=== ${file} ===`)
  let entries
  try {
    entries = await logFromPhoto(blobFrom(path), '2026-09-01', {
      onExtracted: (items) =>
        console.log(
          'extracted:',
          items.map((i) => `${i.quantity ?? ''} ${i.query} (usda:${i.usdaName ?? ''} g:${i.grams ?? ''} ${i.emoji ?? ''})`).join(' · '),
        ),
    })
  } catch (err) {
    failed++
    console.error('FAIL', file, 'pipeline threw:', err instanceof Error ? err.message : String(err))
    continue
  }
  const listed = entries.filter((e) => e.foodId !== 'unmatched')
  const totalKcal = listed.reduce((sum, e) => sum + e.kcal, 0)
  console.log(
    'kcal:',
    listed.map((e) => `${e.name} ${e.serveLabel} ${e.kcal}`).join(' · ') || '(none matched)',
    `→ TOTAL ${totalKcal}`,
  )
  console.log('unmatched:', entries.filter((e) => e.foodId === 'unmatched').map((e) => e.name).join(', ') || '(none)')
  if (!entries.length) failed++
  console.log('took:', Math.round((Date.now() - started) / 1000), 's')
}

console.log('\n[vlm-photo] status:', JSON.stringify(getVlmStatus()))
if (failed) {
  console.error(`${failed} fixture(s) returned no foods`)
  process.exit(1)
}
console.log(`[vlm-photo] all ${FIXTURES.length} fixtures produced foods on ${BASE_MODEL}`)
