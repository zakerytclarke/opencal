import { extractFoods, isQuickCalorie, refineExtracted } from './extract'
import { bestMatch, candidateLines, entryFromFood, quickAddEntry, searchForItem, unmatchedEntry } from './foods'
import { uid } from './storage'
import { extractMealPhoto, extractMealText, pickFoodMatch } from './vlm'
import type { DebugPath, ExtractedItem, Food, LogEntry } from '../types'

export type JobProgress = {
  message: string
  pct: number
}

export type JobHandlers = {
  onProgress?: (p: JobProgress) => void
  onExtracted?: (items: ExtractedItem[]) => void
  onEntry?: (entry: LogEntry, item: ExtractedItem, index: number) => void
}

function stamp(entry: LogEntry, meta: {
  batchId: string
  input: string
  raw: string
  path: DebugPath
  error?: string
  ms: number
  source: LogEntry['source']
}): LogEntry {
  return {
    ...entry,
    source: meta.source,
    batchId: meta.batchId,
    debugInput: meta.input,
    debugRaw: meta.raw || (meta.error ? `[error] ${meta.error}` : '(empty model output)'),
    debugPath: meta.path,
    debugError: meta.error,
    debugMs: meta.ms,
  }
}

function preferReference(item: ExtractedItem, picked: Food | null, hits: Food[]): Food | null {
  const brand = item.brand?.trim().toLowerCase()
  const hay = `${item.query} ${item.unit ?? ''}`.toLowerCase()
  let food = picked ?? hits[0] ?? null
  if (brand && food && !food.name.toLowerCase().includes(brand)) {
    food = hits.find((h) => h.name.toLowerCase().includes(brand)) ?? food
  }
  if (/\bgrande\b/.test(hay)) {
    const grande = hits.find(
      (h) => /grande/i.test(h.name) && (!brand || h.name.toLowerCase().includes(brand)),
    )
    if (grande) food = grande
  }
  return food
}

async function matchOne(
  meal: string,
  item: ExtractedItem,
  date: string,
  source: LogEntry['source'],
  onProgress?: JobHandlers['onProgress'],
): Promise<{ entry: LogEntry; raw: string; path: DebugPath; error?: string; ms: number }> {
  const started = performance.now()
  if (item.caloriesHint && !item.query) {
    return {
      entry: quickAddEntry(item.caloriesHint, date, item.raw || 'Quick add'),
      raw: '(quick add)',
      path: 'quick',
      ms: Math.round(performance.now() - started),
    }
  }

  const hits = searchForItem(item, 8)
  if (!hits.length) {
    return {
      entry: unmatchedEntry(item, source, date),
      raw: '(no search hits)',
      path: 'vlm',
      ms: Math.round(performance.now() - started),
    }
  }

  const rows = candidateLines(hits)
  onProgress?.({ message: `Matching ${item.query}…`, pct: 0 })
  const picked = await pickFoodMatch(
    meal,
    item,
    rows.map((r) => r.line),
  )
  const pickedFood =
    picked.decision.index != null ? rows[picked.decision.index]?.food ?? null : null
  const food = preferReference(item, pickedFood, hits)
  const resolved: ExtractedItem = {
    ...item,
    quantity: item.quantity,
    unit: item.unit,
    brand: item.brand ?? null,
    query: item.query,
  }

  if (!food) {
    const fallback = bestMatch(item.query)
    return {
      entry: fallback
        ? entryFromFood(fallback, resolved, source, date)
        : unmatchedEntry(resolved, source, date),
      raw: picked.raw,
      path: picked.error ? 'error-fallback' : 'vlm',
      error: picked.error,
      ms: picked.ms,
    }
  }

  return {
    entry: entryFromFood(food, resolved, source, date),
    raw: picked.raw,
    path: picked.error ? 'error-fallback' : 'vlm',
    error: picked.error,
    ms: picked.ms,
  }
}

async function resolveItems(
  meal: string,
  items: ExtractedItem[],
  date: string,
  source: LogEntry['source'],
  batchId: string,
  extractRaw: string,
  extractPath: DebugPath,
  extractError: string | undefined,
  handlers: JobHandlers,
): Promise<LogEntry[]> {
  const entries: LogEntry[] = []
  const n = Math.max(1, items.length)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const pct = 28 + Math.round(((i + 0.2) / n) * 68)
    handlers.onProgress?.({ message: `Matching ${item.query}…`, pct })
    const result = await matchOne(meal, item, date, source, handlers.onProgress)
    const entry = stamp(result.entry, {
      batchId,
      input: meal,
      raw: [extractRaw, result.raw].filter(Boolean).join('\n---\n'),
      path: result.path === 'error-fallback' ? result.path : extractPath,
      error: result.error ?? extractError,
      ms: result.ms,
      source,
    })
    entries.push(entry)
    handlers.onEntry?.(entry, item, i)
    handlers.onProgress?.({
      message: `Logged ${item.query}`,
      pct: 28 + Math.round(((i + 1) / n) * 70),
    })
  }
  handlers.onProgress?.({ message: 'Done', pct: 100 })
  return entries
}

export async function logFromText(
  text: string,
  date: string,
  source: 'search' | 'voice' | 'sentence',
  handlers: JobHandlers = {},
): Promise<LogEntry[]> {
  const started = performance.now()
  const batchId = uid()
  const quick = isQuickCalorie(text)
  if (quick != null) {
    handlers.onProgress?.({ message: 'Logging calories…', pct: 100 })
    const entry = stamp(quickAddEntry(quick, date), {
      batchId,
      input: text,
      raw: '(quick add — model skipped)',
      path: 'quick',
      ms: Math.round(performance.now() - started),
      source: 'quick',
    })
    handlers.onEntry?.(entry, { raw: text, query: '', quantity: 1, unit: null, caloriesHint: quick }, 0)
    return [entry]
  }

  handlers.onProgress?.({ message: 'Finding foods…', pct: 8 })
  const extracted = await extractMealText(text, (message, pct) => {
    handlers.onProgress?.({ message, pct: pct != null ? Math.min(26, pct * 0.26) : 12 })
  })
  const rawItems = extracted.items.length ? extracted.items : extractFoods(text)
  const items = refineExtracted(rawItems, text)
  handlers.onExtracted?.(items)
  handlers.onProgress?.({
    message: items.length ? `Found ${items.length} food${items.length === 1 ? '' : 's'}` : 'No foods found',
    pct: 28,
  })
  if (!items.length) return []
  return resolveItems(text, items, date, source, batchId, extracted.raw, extracted.path, extracted.error, handlers)
}

export async function logFromPhoto(image: Blob, date: string, handlers: JobHandlers = {}): Promise<LogEntry[]> {
  const batchId = uid()
  handlers.onProgress?.({ message: 'Reading the photo…', pct: 6 })
  const extracted = await extractMealPhoto(image, (message, pct) => {
    handlers.onProgress?.({ message, pct: pct != null ? Math.min(26, pct * 0.26) : 10 })
  })
  const items = extracted.items.length ? extracted.items : extractFoods(extracted.raw)
  handlers.onExtracted?.(items)
  handlers.onProgress?.({
    message: items.length ? `Found ${items.length} food${items.length === 1 ? '' : 's'}` : 'No foods found',
    pct: 28,
  })
  if (!items.length) return []
  return resolveItems('(photo)', items, date, 'photo', batchId, extracted.raw, extracted.path, extracted.error, handlers)
}
