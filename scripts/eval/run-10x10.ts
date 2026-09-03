import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logFromPhoto } from '../../src/lib/pipeline.ts'
import { caseNutrition, imageExpect } from './gold.ts'
import { formatSummary, goldFields, nutritionFromEntries, predFields, scoreCase, summarize } from './metrics.ts'
import { setupLocalFoods } from './setup.ts'
import type { CaseScore, ImageCase, MealNutrition } from './types.ts'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  return ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
}

function take<T>(rows: T[], limit: number): T[] {
  return limit > 0 ? rows.slice(0, limit) : rows
}

// --- 10 GPT-annotated user photos (gold kcal = sum of labeled foods) ---------
type LabelRow = {
  file: string
  foods: Array<{ name: string; grams?: number; kcal?: number }>
}

function userPhotoCases(each: number): ImageCase[] {
  const labelsPath = join(root, 'evals/results/user-photos-openai-labels.jsonl')
  const imgDir = join(root, 'evals/data/user-photos')
  const lines = readFileSync(labelsPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  const out: ImageCase[] = []
  for (const line of lines) {
    const row = JSON.parse(line) as LabelRow
    const abs = resolve(root, imgDir, row.file)
    if (!existsSync(abs)) continue
    const gold: MealNutrition = {
      kcal: row.foods.reduce((a, f) => a + (f.kcal ?? 0), 0),
      protein: 0,
      carbs: 0,
      fat: 0,
    }
    out.push({
      id: `uph-${row.file.replace(/\.\w+$/, '')}`,
      path: `evals/data/user-photos/${row.file}`,
      label: row.foods.map((f) => f.name).join(', '),
      source: 'user-photos',
      aliases: row.foods.map((f) => f.name),
      query: row.foods.map((f) => f.name).join(', '),
      quantity: 1,
      unit: null,
      loose: true,
      nutrition: gold,
    })
    if (each > 0 && out.length >= each) break
  }
  return out
}

// --- 10 Nutrition5k test plates (gold kcal = dataset dish total) -------------
function n5kCases(each: number): ImageCase[] {
  const file = loadJson<{ seed: string; test: ImageCase[] }>(join(root, 'evals/splits/images.n5k.json'))
  const rows = take(file.test, each)
  return rows.filter((r) => existsSync(isAbsolute(r.path) ? r.path : resolve(root, r.path)))
}

const each = Number(arg('each', '10')) || 10

await setupLocalFoods()

const userCases = userPhotoCases(each)
const n5kRows = n5kCases(each)
console.log(`eval: 10x10 target — user-photos ${userCases.length}, n5k ${n5kRows.length}`)

const scores: CaseScore[] = []

async function runImage(row: ImageCase): Promise<CaseScore> {
  const goldItems = imageExpect(row)
  const goldN = caseNutrition(row, goldItems)
  const abs = isAbsolute(row.path) ? row.path : resolve(root, row.path)
  const started = Date.now()
  if (!existsSync(abs)) {
    return scoreCase({
      id: row.id, split: 'test', modality: 'image', source: row.source,
      predictedNames: [], goldAliases: goldItems.map((e) => e.aliases), loose: row.loose,
      kcalPred: 0, ...goldFields(goldN), unmatched: 1, ms: 0, error: `missing file ${row.path}`,
    })
  }
  try {
    const blob = new Blob([readFileSync(abs)], { type: mimeFor(abs) })
    const entries = await logFromPhoto(blob, '1970-01-01')
    const pred = nutritionFromEntries(entries)
    const names = entries.map((e) => `${e.brand ?? ''} ${e.name}`.trim())
    const score = scoreCase({
      id: row.id, split: 'test', modality: 'image', source: row.source,
      predictedNames: names, goldAliases: goldItems.map((e) => e.aliases), loose: row.loose,
      ...predFields(pred), ...goldFields(goldN),
      unmatched: entries.filter((e) => e.foodId === 'unmatched' || e.foodId === 'quick').length,
      ms: Date.now() - started,
    })
    console.log(`${score.named ? 'HIT' : 'MISS'} ${row.id}  pred ${Math.round(pred.kcal)} vs gold ${Math.round(goldN.kcal)}  ${names.join(' · ') || '(none)'}`)
    return score
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('ERR', row.id, message)
    return scoreCase({
      id: row.id, split: 'test', modality: 'image', source: row.source,
      predictedNames: [], goldAliases: goldItems.map((e) => e.aliases), loose: row.loose,
      kcalPred: 0, ...goldFields(goldN), unmatched: 1, ms: Date.now() - started, error: message,
    })
  }
}

for (const row of userCases) scores.push(await runImage(row))
for (const row of n5kRows) scores.push(await runImage(row))

const bySet = {
  user: scores.filter((s) => s.source === 'user-photos'),
  n5k: scores.filter((s) => s.source !== 'user-photos'),
  all: scores,
}

const report = [
  `# OpenCal e2e 10×10 · ${new Date().toISOString()}`,
  '',
  'Full production path (`logFromPhoto`: LFM VLM extract → host ingredient-first USDA lookup → entry). Gold kcal: GPT-annotated user photos (sum of labeled foods) + Nutrition5k dataset dish totals.',
  '',
  formatSummary('User photos (GPT gold)', summarize(bySet.user)),
  '',
  formatSummary('Nutrition5k', summarize(bySet.n5k)),
  '',
  formatSummary('All', summarize(bySet.all)),
  '',
  '| id | set | hit | pred kcal | gold kcal | abs err | items |',
  '|---|---|---|---:|---:|---:|---|',
  ...scores.map(
    (s) =>
      `| ${s.id} | ${s.source ?? '—'} | ${s.named ? 'yes' : 'no'} | ${Math.round(s.kcalPred)} | ${Math.round(s.kcalGold)} | ${s.kcalAbsErr.toFixed(0)} | ${s.itemsPred.join(', ') || '—'} |`,
  ),
].join('\n')

const outDir = join(root, 'evals/results')
mkdirSync(outDir, { recursive: true })
const payload = {
  split: 'test',
  target: '10x10',
  each,
  scores,
  summary: {
    user: summarize(bySet.user),
    n5k: summarize(bySet.n5k),
    all: summarize(bySet.all),
  },
}
writeFileSync(join(outDir, 'e2e-10x10.json'), `${JSON.stringify(payload, null, 2)}\n`)
writeFileSync(join(outDir, 'e2e-10x10.md'), `${report}\n`)
console.log('')
console.log(report)
console.log(`\nWrote evals/results/e2e-10x10.md`)
