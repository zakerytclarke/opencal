import type { LogEntry } from '../types'

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

export function loggedDays(diary: Record<string, LogEntry[]>, keys: string[]): Set<string> {
  return new Set(keys.filter((k) => (diary[k] ?? []).length > 0))
}
