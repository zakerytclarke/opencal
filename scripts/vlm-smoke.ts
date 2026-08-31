import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { analyzeMealPhoto, analyzeMealText, getVlmStatus } from '../src/lib/vlm.ts'

type Expectation = {
  name: string
  want: string[]
  minItems?: number
}

function blobFrom(path: string): Blob {
  const buf = readFileSync(path)
  return new Blob([buf], { type: 'image/jpeg' })
}

function includesAny(hay: string, needles: string[]): boolean {
  const h = hay.toLowerCase()
  return needles.some((n) => h.includes(n.toLowerCase()))
}

function check(label: string, raw: string, queries: string[], path: string, spec: Expectation): boolean {
  const joined = queries.join(' | ')
  const hits = spec.want.filter((w) => includesAny(joined || raw, [w]))
  const itemsOk = queries.length >= (spec.minItems ?? Math.min(spec.want.length, 1))
  const modelOk = path === 'vlm' || queries.length > 0
  const ok = itemsOk && hits.length >= Math.min(1, spec.want.length) && modelOk
  console.log(
    `${ok ? 'OK' : 'FAIL'} ${label} path=${path} items=${queries.length} hits=${hits.join(',') || '-'} raw=${raw.slice(0, 220).replace(/\s+/g, ' ')}`,
  )
  if (!ok) {
    console.log('  queries:', queries)
    console.log('  wanted:', spec.want)
  }
  return ok
}

const textCases: { input: string; spec: Expectation }[] = [
  {
    input: '2 eggs and a banana',
    spec: { name: 'simple breakfast', want: ['egg', 'banana'], minItems: 2 },
  },
  {
    input: 'chicken bowl with rice and guacamole',
    spec: { name: 'bowl combo', want: ['chicken', 'rice', 'guac'], minItems: 2 },
  },
  {
    input: 'I had a grande latte and a blueberry muffin at the coffee shop',
    spec: { name: 'coffee shop', want: ['latte', 'muffin'], minItems: 2 },
  },
  {
    input: 'half a cup of oatmeal with a tablespoon of peanut butter and a handful of blueberries',
    spec: { name: 'oatmeal bowl', want: ['oatmeal', 'peanut', 'blueberr'], minItems: 2 },
  },
  {
    input: 'Chipotle chicken burrito bowl, no rice, extra guacamole, black beans',
    spec: { name: 'restaurant bowl', want: ['chicken', 'guac', 'bean'], minItems: 2 },
  },
]

const imageCases: { file: string; spec: Expectation }[] = [
  { file: 'banana.jpg', spec: { name: 'banana photo', want: ['banana'], minItems: 1 } },
  { file: 'eggs.jpg', spec: { name: 'eggs photo', want: ['egg'], minItems: 1 } },
  { file: 'pizza.jpg', spec: { name: 'pizza photo', want: ['pizza'], minItems: 1 } },
  { file: 'bowl.jpg', spec: { name: 'salad bowl photo', want: ['salad', 'chicken', 'avocado', 'tomato', 'vegetable', 'bowl'], minItems: 1 } },
]

console.log('loading LFM2.5-VL…')
const t0 = Date.now()
const warmup = await analyzeMealText('one banana')
console.log(`model ready in ${Date.now() - t0}ms status=${JSON.stringify(getVlmStatus())}`)
console.log('warmup', warmup.path, warmup.ms, warmup.error ?? warmup.raw.slice(0, 180), warmup.items)

let failed = 0

for (const c of textCases) {
  const result = await analyzeMealText(c.input)
  const queries = result.items.map((i) => i.query)
  if (!check(`text:${c.spec.name}`, result.raw, queries, result.path, c.spec)) failed++
}

const fixtures = resolve(import.meta.dirname, 'fixtures')
for (const c of imageCases) {
  const result = await analyzeMealPhoto(blobFrom(resolve(fixtures, c.file)))
  const queries = result.items.map((i) => i.query)
  if (!check(`photo:${c.spec.name}`, result.raw, queries, result.path, c.spec)) failed++
}

if (failed) {
  console.error(`${failed} smoke cases failed`)
  process.exit(1)
}
console.log('vlm smoke ok')
