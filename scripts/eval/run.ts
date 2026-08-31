import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logFromPhoto, logFromText } from '../../src/lib/pipeline.ts'
import { caseNutrition, goldMealNutrition, imageExpect } from './gold.ts'
import { formatSummary, goldFields, nutritionFromEntries, predFields, scoreCase, summarize } from './metrics.ts'
import { setupLocalFoods } from './setup.ts'
import { imageCasesFor, loadAllImageSplits } from './image-splits.ts'
import type { CaseScore, EvalSplit, TextCase, TextSplitFile } from './types.ts'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function mimeFor(path: string): string {
  const ext = extname(path).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

function take<T>(rows: T[], limit: number): T[] {
  return limit > 0 ? rows.slice(0, limit) : rows
}

const split = (arg('split', 'test') as EvalSplit) || 'test'
const modality = arg('modality', 'both')
const limit = Number(arg('limit', '0')) || 0

await setupLocalFoods()

const textFile = loadJson<TextSplitFile>(join(root, 'evals/splits/text.json'))

const textCases: TextCase[] =
  split === 'train' ? textFile.train : split === 'test' ? textFile.test : [...textFile.train, ...textFile.test]
const imageCases = imageCasesFor(split, loadAllImageSplits(root))

const scores: CaseScore[] = []
const runText = modality === 'text' || modality === 'both'
const runImages = modality === 'images' || modality === 'both'

if (runText) {
  for (const row of take(textCases, limit)) {
    const goldN = goldMealNutrition(row.expect)
    const started = Date.now()
    try {
      const entries = await logFromText(row.text, '1970-01-01', 'search')
      const pred = nutritionFromEntries(entries)
      const names = entries.map((e) => `${e.brand ?? ''} ${e.name}`.trim())
      const score = scoreCase({
        id: row.id,
        split,
        modality: 'text',
        predictedNames: names,
        goldAliases: row.expect.map((e) => e.aliases),
        ...predFields(pred),
        ...goldFields(goldN),
        unmatched: entries.filter((e) => e.foodId === 'unmatched' || e.foodId === 'quick').length,
        ms: Date.now() - started,
      })
      scores.push(score)
      console.log(
        `${score.named ? 'HIT' : 'MISS'} ${row.id}  pred ${Math.round(pred.kcal)} vs gold ${Math.round(goldN.kcal)}  ${names.join(' · ') || '(none)'}`,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      scores.push(
        scoreCase({
          id: row.id,
          split,
          modality: 'text',
          predictedNames: [],
          goldAliases: row.expect.map((e) => e.aliases),
          kcalPred: 0,
          ...goldFields(goldN),
          unmatched: 1,
          ms: Date.now() - started,
          error: message,
        }),
      )
      console.error('ERR', row.id, message)
    }
  }
}

if (runImages) {
  for (const row of take(imageCases, limit)) {
    const goldItems = imageExpect(row)
    const goldN = caseNutrition(row, goldItems)
    const abs = resolve(root, row.path)
    const started = Date.now()
    if (!existsSync(abs)) {
      console.error('MISSING', row.id, abs)
      scores.push(
        scoreCase({
          id: row.id,
          split,
          modality: 'image',
          source: row.source,
          predictedNames: [],
          goldAliases: goldItems.map((e) => e.aliases),
          loose: row.loose,
          kcalPred: 0,
          ...goldFields(goldN),
          unmatched: 1,
          ms: 0,
          error: `missing file ${row.path}`,
        }),
      )
      continue
    }
    try {
      const blob = new Blob([readFileSync(abs)], { type: mimeFor(abs) })
      const entries = await logFromPhoto(blob, '1970-01-01')
      const pred = nutritionFromEntries(entries)
      const names = entries.map((e) => `${e.brand ?? ''} ${e.name}`.trim())
      const score = scoreCase({
        id: row.id,
        split,
        modality: 'image',
        source: row.source,
        predictedNames: names,
        goldAliases: goldItems.map((e) => e.aliases),
        loose: row.loose,
        ...predFields(pred),
        ...goldFields(goldN),
        unmatched: entries.filter((e) => e.foodId === 'unmatched' || e.foodId === 'quick').length,
        ms: Date.now() - started,
      })
      scores.push(score)
      console.log(
        `${score.named ? 'HIT' : 'MISS'} ${row.id}  pred ${Math.round(pred.kcal)} vs gold ${Math.round(goldN.kcal)}  ${names.join(' · ') || '(none)'}`,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      scores.push(
        scoreCase({
          id: row.id,
          split,
          modality: 'image',
          source: row.source,
          predictedNames: [],
          goldAliases: goldItems.map((e) => e.aliases),
          loose: row.loose,
          kcalPred: 0,
          ...goldFields(goldN),
          unmatched: 1,
          ms: Date.now() - started,
          error: message,
        }),
      )
      console.error('ERR', row.id, message)
    }
  }
}

const byModality = {
  text: scores.filter((s) => s.modality === 'text'),
  image: scores.filter((s) => s.modality === 'image'),
  all: scores,
}

const report = [
  `# OpenCal pipeline eval · ${split} · ${new Date().toISOString()}`,
  '',
  'Calories are production pipeline output vs gold. Nutrition5k uses dataset dish totals (kcal + macros). Text and fixtures use USDA-mapped expect items. The VLM extracts name/brand/qty/unit; the host maps to a USDA row.',
  '',
  runText ? formatSummary('Text', summarize(byModality.text)) : '',
  runImages ? formatSummary('Images', summarize(byModality.image)) : '',
  formatSummary('All', summarize(byModality.all)),
  '',
  '| id | hit | pred kcal | gold kcal | abs err | ape | items |',
  '|---|---|---:|---:|---:|---:|---|',
  ...scores.map(
    (s) =>
      `| ${s.id} | ${s.named ? 'yes' : 'no'} | ${Math.round(s.kcalPred)} | ${Math.round(s.kcalGold)} | ${s.kcalAbsErr.toFixed(0)} | ${(s.kcalApe * 100).toFixed(0)}% | ${s.itemsPred.join(', ') || '—'} |`,
  ),
]
  .filter((line) => line !== '')
  .join('\n')

const outDir = join(root, 'evals/results')
mkdirSync(outDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
writeFileSync(join(outDir, `${stamp}.json`), `${JSON.stringify({ split, modality, scores, summary: { text: summarize(byModality.text), image: summarize(byModality.image), all: summarize(byModality.all) } }, null, 2)}\n`)
writeFileSync(join(outDir, `${stamp}.md`), `${report}\n`)
writeFileSync(join(outDir, 'latest.json'), `${JSON.stringify({ split, modality, scores, summary: { text: summarize(byModality.text), image: summarize(byModality.image), all: summarize(byModality.all) } }, null, 2)}\n`)
writeFileSync(join(outDir, 'latest.md'), `${report}\n`)
console.log('')
console.log(report)
console.log(`\nWrote evals/results/latest.md`)
