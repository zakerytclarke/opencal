/**
 * Held-out Nutrition5k identification eval (FooDD-class singles + a few mixed plates).
 * Never uses banana.jpg / eggs.jpg. Skips dishes already copied into the v5 train thumb dir.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import type { ExpectItem, ImageCase, ImageSplitFile } from './types.ts'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const taxonomyPath = join(root, 'evals/taxonomy/foodd.json')
const outSplit = join(root, 'evals/splits/images.n5k.json')
const outImgDir = join(root, 'evals/data/n5k-eval')
const trainThumbDir = join(root, 'evals/data/finetune/images')

type TaxonomyClass = {
  aliases: string[]
  query: string
  quantity: number
  unit: string | null
  foodId?: string
  kcalPer100g?: number
}

type Taxonomy = { classes: Record<string, TaxonomyClass> }

type N5kIng = { name?: string; grams?: number }
type N5kRow = {
  id?: string
  file_name?: string
  ingredients?: N5kIng[]
}

const NAME_TO_CLASS: Record<string, string> = {
  apple: 'apple',
  banana: 'banana',
  bread: 'bread',
  toast: 'bread',
  'white bread': 'bread',
  'wheat bread': 'bread',
  carrot: 'carrot',
  carrots: 'carrot',
  cucumber: 'cucumber',
  cucumbers: 'cucumber',
  egg: 'egg',
  eggs: 'egg',
  'scrambled eggs': 'egg',
  onion: 'onion',
  onions: 'onion',
  orange: 'orange',
  oranges: 'orange',
  pasta: 'pasta',
  spaghetti: 'pasta',
  noodles: 'pasta',
  pizza: 'pizza',
  'cheese pizza': 'pizza',
  'pepperoni pizza': 'pizza',
  rice: 'rice',
  'white rice': 'rice',
  'brown rice': 'rice',
  tomato: 'tomato',
  tomatoes: 'tomato',
  'cherry tomatoes': 'tomato',
}

const MASS_WINDOW: Record<string, [number, number]> = {
  apple: [80, 220],
  banana: [80, 160],
  bread: [20, 80],
  carrot: [30, 120],
  cucumber: [50, 250],
  egg: [40, 200],
  onion: [40, 180],
  orange: [80, 220],
  pasta: [80, 280],
  pizza: [60, 250],
  rice: [80, 250],
  tomato: [40, 200],
}

const SKIP_ING = new Set([
  'olive oil',
  'salt',
  'garlic',
  'pepper',
  'vinegar',
  'lemon juice',
  'mustard',
  'thyme',
  'parsley',
  'lime',
  'shallots',
])

const MAX_PER_CLASS = 6
const MIXED_N = 12
const SEED = 'opencal-n5k-eval-v1'

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback
}

function stableInt(s: string): number {
  const buf = createHash('sha1').update(s).digest()
  return buf.readUInt32BE(0)
}

function cleanName(name: string): string {
  return name.toLowerCase().replace(/\(raw\)|\(cooked\)/g, '').replace(/\s+/g, ' ').trim()
}

function classOf(name: string): string | null {
  return NAME_TO_CLASS[cleanName(name)] ?? null
}

function findN5k(): { meta: string; snap: string } | null {
  const fromArg = arg('dir') || process.env.N5K_DIR || ''
  const candidates = [
    fromArg,
    join(homedir(), '.cache/huggingface/hub/datasets--mmathys--food-nutrients/snapshots'),
  ].filter(Boolean)
  for (const dir of candidates) {
    const abs = resolve(dir)
    if (!existsSync(abs)) continue
    const snaps = readdirSync(abs).map((n) => join(abs, n))
    const roots = snaps.length && !existsSync(join(abs, 'metadata.jsonl')) ? snaps : [abs]
    for (const snap of roots) {
      const meta = join(snap, 'metadata.jsonl')
      if (existsSync(meta)) return { meta, snap }
    }
  }
  return null
}

function trainedIds(): Set<string> {
  const ids = new Set<string>()
  if (!existsSync(trainThumbDir)) return ids
  for (const name of readdirSync(trainThumbDir)) {
    const m = /^n5k-(dish_\d+)\.jpg$/.exec(name)
    if (m) ids.add(m[1])
  }
  return ids
}

function visibleIngs(row: N5kRow): N5kIng[] {
  return (row.ingredients ?? []).filter((ing) => {
    const name = cleanName(ing.name ?? '')
    const grams = Number(ing.grams) || 0
    return name && !SKIP_ING.has(name) && grams >= 20
  })
}

const found = findN5k()
if (!found) {
  console.error(`Nutrition5k cache not found.

Expected HuggingFace dataset mmathys/food-nutrients (metadata.jsonl + test/ images).
Set N5K_DIR or pass --dir pointing at the snapshot.
`)
  process.exit(1)
}

const taxonomy = JSON.parse(readFileSync(taxonomyPath, 'utf8')) as Taxonomy
const skipTrain = trainedIds()
const samples: N5kRow[] = []
for (const line of readFileSync(found.meta, 'utf8').split('\n')) {
  if (!line.trim()) continue
  samples.push(JSON.parse(line) as N5kRow)
}

const byClass = new Map<string, N5kRow[]>()
const mixed: N5kRow[] = []
for (const row of samples) {
  const sid = String(row.id || '')
  if (!sid || skipTrain.has(sid)) continue
  const ings = row.ingredients ?? []
  if (ings.length === 1) {
    const name = ings[0]?.name ?? ''
    const grams = Number(ings[0]?.grams) || 0
    const cls = classOf(name)
    if (!cls) continue
    const win = MASS_WINDOW[cls]
    if (!win || grams < win[0] || grams > win[1]) continue
    const list = byClass.get(cls) ?? []
    list.push(row)
    byClass.set(cls, list)
  }
  const vis = visibleIngs(row)
  if (vis.length >= 2 && vis.length <= 3) mixed.push(row)
}

mkdirSync(outImgDir, { recursive: true })

function copyDish(row: N5kRow): string | null {
  const rel = (row.file_name || '').replace(/\\/g, '/')
  const src = join(found!.snap, rel)
  const fallback = join(found!.snap, 'test', `${row.id}.png`)
  const from = existsSync(src) ? src : existsSync(fallback) ? fallback : null
  if (!from) return null
  const dest = join(outImgDir, `${row.id}.png`)
  if (!existsSync(dest)) copyFileSync(from, dest)
  return `evals/data/n5k-eval/${row.id}.png`
}

const test: ImageCase[] = []

for (const [cls, list] of [...byClass.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const spec = taxonomy.classes[cls]
  if (!spec) continue
  const ranked = [...list].sort((a, b) => stableInt(`${SEED}:${a.id}`) - stableInt(`${SEED}:${b.id}`)).slice(0, MAX_PER_CLASS)
  for (const row of ranked) {
    const path = copyDish(row)
    if (!path) continue
    test.push({
      id: `n5k-${row.id}`,
      path,
      label: cls,
      source: 'nutrition5k',
      aliases: spec.aliases,
      query: spec.query,
      foodId: spec.foodId,
      quantity: spec.quantity,
      unit: spec.unit,
      kcalPer100g: spec.kcalPer100g,
    })
  }
}

const mixedRanked = [...mixed]
  .sort((a, b) => stableInt(`${SEED}:mix:${a.id}`) - stableInt(`${SEED}:mix:${b.id}`))
  .filter((row) => !test.some((t) => t.id === `n5k-${row.id}`))
  .slice(0, MIXED_N)

for (const row of mixedRanked) {
  const path = copyDish(row)
  if (!path) continue
  const vis = visibleIngs(row)
  const expect: ExpectItem[] = vis.map((ing) => {
    const name = cleanName(ing.name ?? 'food')
    const cls = classOf(name)
    const spec = cls ? taxonomy.classes[cls] : null
    return {
      aliases: spec?.aliases ?? [name.replace(/s$/, ''), name],
      query: spec?.query ?? name,
      quantity: spec?.quantity ?? 1,
      unit: spec?.unit ?? 'serving',
      foodId: spec?.foodId,
    }
  })
  test.push({
    id: `n5k-${row.id}`,
    path,
    label: vis.map((i) => cleanName(i.name ?? '')).join('+'),
    source: 'nutrition5k',
    aliases: expect.flatMap((e) => e.aliases),
    query: expect[0]?.query ?? 'meal',
    quantity: 1,
    unit: 'bowl',
    loose: true,
    expect,
  })
}

if (!test.length) {
  console.error('No Nutrition5k identification plates matched (after excluding prior train thumbs).')
  process.exit(1)
}

const out: ImageSplitFile = {
  seed: SEED,
  note: `Nutrition5k identification eval. FooDD-class singles (max ${MAX_PER_CLASS}/class, mass window) plus ${MIXED_N} mixed plates. Excludes v5 train thumbs. Never banana.jpg/eggs.jpg.`,
  train: [],
  test,
}
mkdirSync(dirname(outSplit), { recursive: true })
writeFileSync(outSplit, `${JSON.stringify(out, null, 2)}\n`)

const singles = test.filter((t) => !t.loose)
const by = new Map<string, number>()
for (const t of singles) by.set(t.label, (by.get(t.label) ?? 0) + 1)
console.log(`Wrote ${outSplit}`)
console.log(`test ${test.length} · singles ${singles.length} · mixed ${test.length - singles.length}`)
console.log(`classes ${[...by.entries()].map(([k, n]) => `${k}:${n}`).join(', ')}`)
console.log(`skipped ${skipTrain.size} previously trained n5k thumbs`)
