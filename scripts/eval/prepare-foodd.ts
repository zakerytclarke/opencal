import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ImageCase, ImageSplitFile } from './types.ts'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const taxonomyPath = join(root, 'evals/taxonomy/foodd.json')

type Taxonomy = {
  classes: Record<
    string,
    { aliases: string[]; query: string; quantity: number; unit: string | null; kcalPer100g: number; foodId?: string }
  >
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp'])

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function loadTaxonomy(): Taxonomy {
  return JSON.parse(readFileSync(taxonomyPath, 'utf8')) as Taxonomy
}

function classFromPath(rel: string, classes: string[]): string | null {
  const parts = rel.split(/[/\\]/).map((p) => p.toLowerCase().replace(/[^a-z]/g, ''))
  for (const key of classes) {
    const needle = key.toLowerCase().replace(/[^a-z]/g, '')
    if (parts.some((p) => p === needle || p.includes(needle))) return key
  }
  return null
}

function walkImages(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walkImages(full))
    else if (IMAGE_EXT.has(name.slice(name.lastIndexOf('.')).toLowerCase()) && st.size > 8_000) {
      out.push(full)
    }
  }
  return out
}

function stableInt(s: string): number {
  const buf = createHash('sha1').update(s).digest()
  return buf.readUInt32BE(0)
}

function splitFor(id: string, seed: string): 'train' | 'test' {
  return stableInt(`${seed}:${id}`) % 100 < 80 ? 'train' : 'test'
}

function findFooddDir(): string | null {
  const fromArg = arg('dir') || process.env.FOODD_DIR || ''
  const candidates = [
    fromArg,
    join(root, 'evals/data/foodd'),
    join(root, 'evals/data/FooDD'),
    '/tmp/opencal-foodd',
    '/tmp/FooDD',
  ].filter(Boolean)
  for (const dir of candidates) {
    const abs = resolve(dir)
    if (existsSync(abs) && statSync(abs).isDirectory()) return abs
  }
  return null
}

const foodd = findFooddDir()
if (!foodd) {
  console.error(`FooDD tree not found.

Download the IEEE FooDD set (or the 7-class Kaggle mirror) and point at it:

  FOODD_DIR=/path/to/FooDD npm run eval:prepare

Expected layout: class folders (Apple, Banana, …) of jpg/png photos.
Kaggle mirror: darsh22blc1378/foodd-ieee-datasets
IEEE: https://ieee-dataport.org/open-access/foodd-food-detection-dataset-calorie-measurement-using-food-images
`)
  process.exit(1)
}

const taxonomy = loadTaxonomy()
const classKeys = Object.keys(taxonomy.classes)
const maxPerClass = Number(arg('max-per-class', '16')) || 16
const seed = 'opencal-foodd-v1'

const files = walkImages(foodd)
const byClass = new Map<string, string[]>()
for (const file of files) {
  const rel = relative(foodd, file)
  const cls = classFromPath(rel, classKeys)
  if (!cls) continue
  const list = byClass.get(cls) ?? []
  list.push(file)
  byClass.set(cls, list)
}

const train: ImageCase[] = []
const test: ImageCase[] = []
for (const [cls, list] of [...byClass.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const spec = taxonomy.classes[cls]
  const ranked = [...list].sort((a, b) => stableInt(`${seed}:${a}`) - stableInt(`${seed}:${b}`)).slice(0, maxPerClass)
  for (const file of ranked) {
    const rel = relative(root, file)
    const id = `foodd-${cls}-${createHash('sha1').update(rel).digest('hex').slice(0, 10)}`
    const row: ImageCase = {
      id,
      path: rel.startsWith('..') ? file : rel,
      label: cls,
      source: 'foodd',
      aliases: spec.aliases,
      query: spec.query,
      foodId: spec.foodId,
      quantity: spec.quantity,
      unit: spec.unit,
      kcalPer100g: spec.kcalPer100g,
    }
    if (splitFor(id, seed) === 'train') train.push(row)
    else test.push(row)
  }
}

if (!train.length && !test.length) {
  console.error(`No FooDD class folders matched. Looked under ${foodd} for: ${classKeys.join(', ')}`)
  process.exit(1)
}

const out: ImageSplitFile = {
  seed,
  note: `Generated from ${foodd} · max ${maxPerClass}/class · 80/20 hash split`,
  train,
  test,
}
const outPath = join(root, 'evals/splits/images.foodd.json')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`)
console.log(`Wrote ${outPath}`)
console.log(`train ${train.length} · test ${test.length} · classes ${[...byClass.keys()].sort().join(', ')}`)
if (flag('print')) console.log(JSON.stringify({ train: train.length, test: test.length, byClass: Object.fromEntries([...byClass].map(([k, v]) => [k, v.length])) }, null, 2))
