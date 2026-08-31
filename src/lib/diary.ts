import type { Diary, LogEntry } from '../types'

export function totals(entries: LogEntry[]) {
  return entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      protein: acc.protein + e.protein,
      carbs: acc.carbs + e.carbs,
      fat: acc.fat + e.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  )
}

export function loggedDays(diary: Record<string, LogEntry[]>, keys?: string[]): Set<string> {
  const list = keys ?? Object.keys(diary)
  return new Set(list.filter((k) => (diary[k] ?? []).length > 0))
}

export function recentLoggedFoods(diary: Diary, limit = 12): LogEntry[] {
  const all = Object.values(diary)
    .flat()
    .filter((e) => e.foodId !== 'quick')
    .sort((a, b) => (a.loggedAt < b.loggedAt ? 1 : -1))
  const seen = new Set<string>()
  const out: LogEntry[] = []
  for (const entry of all) {
    const key = `${entry.foodId}|${entry.name.toLowerCase()}|${(entry.brand ?? '').toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
    if (out.length >= limit) break
  }
  return out
}

export function filterRecents(recents: LogEntry[], query: string): LogEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return recents
  return recents.filter(
    (e) => e.name.toLowerCase().includes(q) || (e.brand ?? '').toLowerCase().includes(q),
  )
}
