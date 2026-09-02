import type { LogEntry } from '../types'

export type FoodBatch = {
  id: string
  entries: LogEntry[]
  source: LogEntry['source']
  path: LogEntry['debugPath']
  input: string
  raw: string
  error?: string
  ms?: number
  mealName?: string
  at: string
}

export function groupBatches(entries: LogEntry[]): FoodBatch[] {
  const map = new Map<string, LogEntry[]>()
  const order: string[] = []
  for (const entry of entries) {
    const key = entry.batchId ?? `solo-${entry.id}`
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(entry)
  }
  return order.map((id) => {
    const group = map.get(id) ?? []
    const head = group[0]
    return {
      id,
      entries: group,
      source: head?.source ?? 'search',
      path: head?.debugPath,
      input: head?.debugInput ?? '',
      raw: head?.debugRaw ?? '',
      error: head?.debugError,
      ms: head?.debugMs,
      mealName: head?.mealName,
      at: head?.loggedAt ?? '',
    }
  })
}

export function pathLabel(path: LogEntry['debugPath']): string {
  switch (path) {
    case 'vlm':
      return 'VLM match'
    case 'vlm-empty':
      return 'VLM ran, no tools'
    case 'error-fallback':
      return 'VLM failed → extractor'
    case 'quick':
      return 'quick add'
    case 'extractor':
      return 'extractor'
    default:
      return 'unknown path'
  }
}
