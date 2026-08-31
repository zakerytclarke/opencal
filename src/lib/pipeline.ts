import { extractFoods, isQuickCalorie } from './extract'
import { quickAddEntry, resolveExtracted } from './foods'
import { analyzeMealPhoto, analyzeMealText } from './vlm'
import type { LogEntry } from '../types'

type ProgressFn = (message: string, pct?: number) => void

export async function logFromText(
  text: string,
  date: string,
  source: 'search' | 'voice' | 'sentence',
  onProgress?: ProgressFn,
): Promise<LogEntry[]> {
  const quick = isQuickCalorie(text)
  if (quick != null) {
    onProgress?.('Logging calories…', 100)
    return [quickAddEntry(quick, date)]
  }
  try {
    const { items } = await analyzeMealText(text, onProgress)
    const resolved = resolveExtracted(items.length ? items : extractFoods(text), date, source)
    return resolved.map((r) => r.entry)
  } catch {
    onProgress?.('Matching the local database…', 94)
    return resolveExtracted(extractFoods(text), date, source).map((r) => r.entry)
  }
}

export async function logFromPhoto(image: Blob, date: string, onProgress?: ProgressFn): Promise<LogEntry[]> {
  const { items, raw } = await analyzeMealPhoto(image, onProgress)
  const fallback = items.length ? items : extractFoods(raw)
  return resolveExtracted(fallback, date, 'photo').map((r) => r.entry)
}
