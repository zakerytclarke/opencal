/**
 * Nutrition5k 80/20 image split.
 * Test is at least 20% of usable plates (image + a visible ingredient).
 * Prefers dishes that are not already in the fine-tune thumb dir so current
 * weights are not scored on photos they trained on. Never banana.jpg / eggs.jpg.
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
  total_calories?: number
  total_protein?: number
  total_carb?: number
  total_fat?: number
  total_mass?: number
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

const SEED = 'opencal-n5k-eval-v2'
const TEST_FRAC = 0.2

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

function imagePath(found: { snap: string }, row: N5kRow): string | null {
  const rel = (row.file_name || '').replace(/\\/g, '/')
  const src = join(found.snap, rel)
  if (existsSync(src)) return src
  const fallback = join(found.snap, 'test', `${row.id}.png`)
  return existsSync(fallback) ? fallback : null
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
const priorTrain = trainedIds()
const samples: N5kRow[] = []
for (const line of readFileSync(found.meta, 'utf8').split('\n')) {
  if (!line.trim()) continue
  samples.push(JSON.parse(line) as N5kRow)
}

const pool: N5kRow[] = []
for (const row of samples) {
  const sid = String(row.id || '')
  if (!sid) continue
  if (!imagePath(found, row)) continue
  if (!visibleIngs(row).length) continue
  pool.push(row)
}

const testFrac = Math.min(0.5, Math.max(0.2, Number(arg('frac', String(TEST_FRAC))) || TEST_FRAC))
const need = Math.max(1, Math.ceil(pool.length * testFrac))
const unused = pool.filter((r) => !priorTrain.has(String(r.id)))
const used = pool.filter((r) => priorTrain.has(String(r.id)))
const rank = (rows: N5kRow[]) =>
  [...rows].sort((a, b) => stableInt(`${SEED}:${a.id}`) - stableInt(`${SEED}:${b.id}`))

const testRows: N5kRow[] = rank(unused).slice(0, need)
if (testRows.length < need) {
  testRows.push(...rank(used).slice(0, need - testRows.length))
}
const testIds = new Set(testRows.map((r) => String(r.id)))
const leaked = testRows.filter((r) => priorTrain.has(String(r.id))).length

function expectFromIng(ing: N5kIng, singleWhole: boolean): ExpectItem {
  const name = cleanName(ing.name ?? 'food')
  const cls = classOf(name)
  const spec = cls ? taxonomy.classes[cls] : null
  const grams = Number(ing.grams) || 0
  const win = cls ? MASS_WINDOW[cls] : undefined
  if (singleWhole && spec && win && grams >= win[0] && grams <= win[1]) {
    return {
      aliases: spec.aliases,
      query: spec.query,
      quantity: spec.quantity,
      unit: spec.unit,
      foodId: spec.foodId,
    }
  }
  return {
    aliases: spec?.aliases ?? [name.replace(/s$/, ''), name],
    query: spec?.query ?? name,
    quantity: Math.max(1, Math.round(grams)),
    unit: 'g',
    foodId: spec?.foodId,
  }
}

function toCase(row: N5kRow, dest: string): ImageCase {
  const vis = visibleIngs(row)
  const singleWhole = vis.length === 1
  const expect = vis.map((ing) => expectFromIng(ing, singleWhole))
  const cls = vis.length === 1 ? classOf(vis[0]?.name ?? '') : null
  const spec = cls ? taxonomy.classes[cls] : null
  const primary = expect[0]
  return {
    id: `n5k-${row.id}`,
    path: dest,
    label: vis.map((i) => cleanName(i.name ?? '')).join('+') || 'meal',
    source: 'nutrition5k',
    aliases: spec?.aliases ?? primary?.aliases ?? [primary?.query ?? 'food'],
    query: spec?.query ?? primary?.query ?? 'meal',
    foodId: spec?.foodId ?? primary?.foodId,
    quantity: spec && singleWhole ? spec.quantity : (primary?.quantity ?? 1),
    unit: spec && singleWhole ? spec.unit : (primary?.unit ?? 'serving'),
    kcalPer100g: spec?.kcalPer100g,
    loose: vis.length > 1,
    expect,
    nutrition: {
      kcal: Number(row.total_calories) || 0,
      protein: Number(row.total_protein) || 0,
      carbs: Number(row.total_carb) || 0,
      fat: Number(row.total_fat) || 0,
    },
  }
}

mkdirSync(outImgDir, { recursive: true })
const test: ImageCase[] = []
for (const row of testRows) {
  const src = imagePath(found, row)
  if (!src) continue
  const destAbs = join(outImgDir, `${row.id}.png`)
  if (!existsSync(destAbs)) copyFileSync(src, destAbs)
  test.push(toCase(row, `evals/data/n5k-eval/${row.id}.png`))
}

if (!test.length) {
  console.error('No Nutrition5k plates with images and visible ingredients.')
  process.exit(1)
}

const out: ImageSplitFile = {
  seed: SEED,
  note: `Nutrition5k 80/20. Pool ${pool.length} usable plates · test ${test.length} (${(100 * test.length / pool.length).toFixed(1)}%) · ${leaked} overlap prior train thumbs · gold is dish total_calories/protein/carb/fat · never banana.jpg/eggs.jpg.`,
  train: [],
  test,
}
mkdirSync(dirname(outSplit), { recursive: true })
writeFileSync(outSplit, `${JSON.stringify(out, null, 2)}\n`)

const singles = test.filter((t) => !t.loose)
console.log(`Wrote ${outSplit}`)
console.log(`pool ${pool.length} · test ${test.length} (${((100 * test.length) / pool.length).toFixed(1)}% of pool) · singles ${singles.length} · mixed ${test.length - singles.length}`)
console.log(`unused available ${unused.length} · prior train thumbs ${priorTrain.size} · leaked into test ${leaked}`)
console.log(`train-eligible (not in test) ${pool.length - testIds.size}`)
