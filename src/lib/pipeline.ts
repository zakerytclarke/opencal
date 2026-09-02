import { extractFoods, isQuickCalorie, refineExtracted } from './extract'
import {
  catalogHitsFor,
  entryFromFood,
  mapToBaseFood,
  photoCatalog,
  quickAddEntry,
  sanitizePhotoItem,
  unmatchedEntry,
  type PhotoCatalog,
} from './foods'
import { uid } from './storage'
import { estimatePhotoPortions, estimateTextPortions, extractMealPhoto, extractMealText } from './vlm'
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
  mealName?: string
}): LogEntry {
  return {
    ...entry,
    source: meta.source,
    batchId: meta.batchId,
    mealName: meta.mealName,
    debugInput: meta.input,
    debugRaw: meta.raw || (meta.error ? `[error] ${meta.error}` : '(empty model output)'),
    debugPath: meta.path,
    debugError: meta.error,
    debugMs: meta.ms,
  }
}

function matchOne(
  meal: string,
  item: ExtractedItem,
  date: string,
  source: LogEntry['source'],
  photoSiblings = 1,
  catalogFoods?: Food[] | null,
): { entry: LogEntry; raw: string; path: DebugPath; error?: string; ms: number } {
  const started = performance.now()
  if (item.caloriesHint && !item.query) {
    return {
      entry: quickAddEntry(item.caloriesHint, date, item.raw || 'Quick add'),
      raw: '(quick add)',
      path: 'quick',
      ms: Math.round(performance.now() - started),
    }
  }

  const resolved: ExtractedItem = {
    ...item,
    quantity: item.quantity,
    unit: item.unit,
    brand: item.brand ?? null,
    query: item.query,
  }
  const mapped = mapToBaseFood(resolved, meal, catalogFoods)
  if (!mapped) {
    return {
      entry: unmatchedEntry(resolved, source, date),
      raw: '(no USDA match)',
      path: 'vlm',
      ms: Math.round(performance.now() - started),
    }
  }

  const portioned = source === 'photo' ? sanitizePhotoItem(resolved, mapped.food, photoSiblings) : resolved
  return {
    entry: entryFromFood(mapped.food, portioned, source, date),
    raw: mapped.citation,
    path: 'vlm',
    ms: Math.round(performance.now() - started),
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
  catalog: PhotoCatalog | null = null,
  mealName?: string,
): Promise<LogEntry[]> {
  const entries: LogEntry[] = []
  const n = Math.max(1, items.length)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const pct = 28 + Math.round(((i + 0.2) / n) * 68)
    handlers.onProgress?.({ message: `Looking up USDA for ${item.query}…`, pct })
    const catalogFoods = catalogHitsFor(item, catalog)
    const result = matchOne(meal, item, date, source, source === 'photo' ? items.length : 1, catalogFoods)

    const entry = stamp(result.entry, {
      batchId,
      input: meal,
      raw: [extractRaw, result.raw].filter(Boolean).join('\n---\n'),
      path: result.path === 'error-fallback' ? result.path : extractPath,
      error: result.error ?? extractError,
      ms: result.ms,
      source,
      mealName,
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
    handlers.onProgress?.({ message, pct: pct != null ? Math.min(22, pct * 0.22) : 12 })
  })
  const named = extracted.items.length ? extracted.items : extractFoods(text)
  handlers.onProgress?.({
    message: named.length ? `Found ${named.length} food${named.length === 1 ? '' : 's'}` : 'No foods found',
    pct: 24,
  })
  if (!named.length) {
    handlers.onExtracted?.([])
    return []
  }

  const catalog = photoCatalog(named)
  handlers.onProgress?.({ message: 'Looking up USDA servings…', pct: 32 })
  const portioned = await estimateTextPortions(text, catalog.names, catalog.lines, (message, pct) => {
    handlers.onProgress?.({ message, pct: pct != null ? 32 + Math.min(20, pct * 0.2) : 40 })
  })
  const items = portioned.items.length ? portioned.items : refineExtracted(named, text)
  handlers.onExtracted?.(items)
  const extractRaw = [extracted.raw, portioned.raw].filter(Boolean).join('\n---\n')
  const extractError = extracted.error || portioned.error
  const extractPath = portioned.items.length ? portioned.path : extracted.path
  return resolveItems(text, items, date, source, batchId, extractRaw, extractPath, extractError, handlers, catalog, extracted.mealName)
}

export async function logFromPhoto(image: Blob, date: string, handlers: JobHandlers = {}): Promise<LogEntry[]> {
  const batchId = uid()
  handlers.onProgress?.({ message: 'Reading the photo…', pct: 6 })
  const identified = await extractMealPhoto(image, (message, pct) => {
    handlers.onProgress?.({ message, pct: pct != null ? Math.min(22, pct * 0.22) : 10 })
  })
  const named = identified.items.length ? identified.items : extractFoods(identified.raw)
  handlers.onProgress?.({
    message: named.length ? `Found ${named.length} food${named.length === 1 ? '' : 's'}` : 'No foods found',
    pct: 24,
  })
  if (!named.length) {
    handlers.onExtracted?.([])
    return []
  }

  const catalog = photoCatalog(named)
  handlers.onProgress?.({ message: 'Looking up USDA servings…', pct: 32 })
  const portioned = await estimatePhotoPortions(image, catalog.names, catalog.lines, (message, pct) => {
    handlers.onProgress?.({ message, pct: pct != null ? 32 + Math.min(20, pct * 0.2) : 40 })
  })
  const items = portioned.items.length ? portioned.items : named
  handlers.onExtracted?.(items)
  const extractRaw = [identified.raw, portioned.raw].filter(Boolean).join('\n---\n')
  const extractError = identified.error || portioned.error
  const extractPath = portioned.items.length ? portioned.path : identified.path
  return resolveItems('(photo)', items, date, 'photo', batchId, extractRaw, extractPath, extractError, handlers, catalog, identified.mealName)
}
