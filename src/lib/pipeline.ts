import { extractFoods, isQuickCalorie } from './extract'
import { quickAddEntry, resolveExtracted } from './foods'
import { uid } from './storage'
import { analyzeMealPhoto, analyzeMealText } from './vlm'
import type { DebugPath, LogEntry } from '../types'

type ProgressFn = (message: string, pct?: number) => void

function stamp(
  entries: LogEntry[],
  meta: {
    input: string
    raw: string
    path: DebugPath
    error?: string
    ms: number
    source: LogEntry['source']
  },
): LogEntry[] {
  const batchId = uid()
  return entries.map((entry) => ({
    ...entry,
    source: meta.source,
    batchId,
    debugInput: meta.input,
    debugRaw: meta.raw || (meta.error ? `[error] ${meta.error}` : '(empty model output)'),
    debugPath: meta.path,
    debugError: meta.error,
    debugMs: meta.ms,
  }))
}

export async function logFromText(
  text: string,
  date: string,
  source: 'search' | 'voice' | 'sentence',
  onProgress?: ProgressFn,
): Promise<LogEntry[]> {
  const started = performance.now()
  const quick = isQuickCalorie(text)
  if (quick != null) {
    onProgress?.('Logging calories…', 100)
    return stamp([quickAddEntry(quick, date)], {
      input: text,
      raw: '(quick add — model skipped)',
      path: 'quick',
      ms: Math.round(performance.now() - started),
      source: 'quick',
    })
  }
  const result = await analyzeMealText(text, onProgress)
  const items = result.items.length ? result.items : extractFoods(text)
  const entries = resolveExtracted(items, date, source).map((r) => r.entry)
  return stamp(entries, {
    input: text,
    raw: result.raw,
    path: result.path,
    error: result.error,
    ms: result.ms,
    source,
  })
}

export async function logFromPhoto(image: Blob, date: string, onProgress?: ProgressFn): Promise<LogEntry[]> {
  const result = await analyzeMealPhoto(image, onProgress)
  const items = result.items.length ? result.items : extractFoods(result.raw)
  const entries = resolveExtracted(items, date, 'photo').map((r) => r.entry)
  return stamp(entries, {
    input: '(photo)',
    raw: result.raw,
    path: result.path,
    error: result.error,
    ms: result.ms,
    source: 'photo',
  })
}
