#!/usr/bin/env tsx
/**
 * Score model extracts through the production USDA matcher + convert_portion.
 * Isolates extract quality: MiniSearch top hit, no second VLM pick call.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setupLocalFoods } from './setup.ts'
import { refineExtracted } from '../../src/lib/extract.ts'
import { goldMealKcal, imageExpect } from './gold.ts'
import { formatSummary, scoreCase, summarize } from './metrics.ts'
import { entryFromFood, mapToBaseFood } from '../../src/lib/foods.ts'
import type { ExtractedItem } from '../../src/types.ts'
import type { CaseScore, TextSplitFile } from './types.ts'
import { imageCaseIndex, loadAllImageSplits } from './image-splits.ts'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback
}

type ExtractRow = {
  id: string
  modality: 'text' | 'image'
  items: { name?: string; query?: string; brand?: string | null; quantity?: number; unit?: string | null }[]
  raw?: string
  error?: string
}

await setupLocalFoods()

const extractsPath = resolve(arg('extracts'))
const tag = arg('tag', 'run')
if (!existsSync(extractsPath)) {
  console.error(`missing extracts ${extractsPath}`)
  process.exit(1)
}

const extracts = JSON.parse(readFileSync(extractsPath, 'utf8')) as ExtractRow[]
const textFile = JSON.parse(readFileSync(join(root, 'evals/splits/text.json'), 'utf8')) as TextSplitFile
const textById = new Map([...textFile.train, ...textFile.test].map((r) => [r.id, r]))
const imageById = imageCaseIndex(loadAllImageSplits(root))

const scores: CaseScore[] = []
for (const row of extracts) {
  const started = Date.now()
  if (row.modality === 'text') {
    const gold = textById.get(row.id)
    if (!gold) continue
    const items: ExtractedItem[] = refineExtracted(
      (row.items ?? []).map((it) => ({
        raw: row.raw ?? '',
        query: (it.query || it.name || '').trim(),
        brand: it.brand ?? null,
        quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
        unit: it.unit ?? null,
      })),
      gold.text,
    )
    const entries = items
      .filter((i) => i.query)
      .map((item) => {
        const mapped = mapToBaseFood(item, gold.text)
        return mapped ? entryFromFood(mapped.food, item, 'search', '1970-01-01') : null
      })
    const named = entries.map((e) => (e ? `${e.brand ?? ''} ${e.name}`.trim() : ''))
    const kcalPred = entries.reduce((s, e) => s + (e?.kcal ?? 0), 0)
    scores.push(
      scoreCase({
        id: row.id,
        split: 'test',
        modality: 'text',
        predictedNames: named.filter(Boolean),
        goldAliases: gold.expect.map((e) => e.aliases),
        kcalPred,
        kcalGold: goldMealKcal(gold.expect),
        unmatched: entries.filter((e) => e == null).length,
        ms: Date.now() - started,
        error: row.error,
      }),
    )
  } else {
    const gold = imageById.get(row.id)
    if (!gold) continue
    const items: ExtractedItem[] = (row.items ?? []).map((it) => ({
      raw: row.raw ?? '',
      query: (it.query || it.name || '').trim(),
      brand: it.brand ?? null,
      quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
      unit: it.unit ?? null,
    }))
    const goldItems = imageExpect(gold)
    const entries = items
      .filter((i) => i.query)
      .map((item) => {
        const mapped = mapToBaseFood(item, '(photo)')
        return mapped ? entryFromFood(mapped.food, item, 'photo', '1970-01-01') : null
      })
    const named = entries.map((e) => (e ? `${e.brand ?? ''} ${e.name}`.trim() : ''))
    const kcalPred = entries.reduce((s, e) => s + (e?.kcal ?? 0), 0)
    scores.push(
      scoreCase({
        id: row.id,
        split: 'test',
        modality: 'image',
        source: gold.source,
        predictedNames: named.filter(Boolean),
        goldAliases: goldItems.map((e) => e.aliases),
        loose: gold.loose,
        kcalPred,
        kcalGold: goldMealKcal(goldItems),
        unmatched: entries.filter((e) => e == null).length,
        ms: Date.now() - started,
        error: row.error,
      }),
    )
  }
}

const by = {
  text: scores.filter((s) => s.modality === 'text'),
  image: scores.filter((s) => s.modality === 'image'),
  all: scores,
}
const summary = { text: summarize(by.text), image: summarize(by.image), all: summarize(by.all) }
const report = [
  `# OpenCal extract→USDA eval · ${tag} · ${new Date().toISOString()}`,
  '',
  'Extracts from the VLM, calories from MiniSearch + convert_portion (host maps name/brand/qty/unit to a USDA row; no pick VLM). Text scoring applies the same refineExtracted host pass as the PWA.',
  '',
  formatSummary('Text', summary.text),
  formatSummary('Images', summary.image),
  formatSummary('All', summary.all),
  '',
  '| id | hit | pred kcal | gold kcal | abs err | ape | items |',
  '|---|---|---:|---:|---:|---:|---|',
  ...scores.map(
    (s) =>
      `| ${s.id} | ${s.named ? 'yes' : 'no'} | ${Math.round(s.kcalPred)} | ${Math.round(s.kcalGold)} | ${s.kcalAbsErr.toFixed(0)} | ${(s.kcalApe * 100).toFixed(0)}% | ${s.itemsPred.join(', ') || '—'} |`,
  ),
].join('\n')

const outDir = join(root, 'evals/results')
mkdirSync(outDir, { recursive: true })
const outJson = join(outDir, `ft-${tag}.json`)
const outMd = join(outDir, `ft-${tag}.md`)
writeFileSync(outJson, `${JSON.stringify({ tag, scores, summary }, null, 2)}\n`)
writeFileSync(outMd, `${report}\n`)
console.log(report)
console.log(`\nWrote ${outMd}`)
