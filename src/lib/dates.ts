export function todayKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(key: string, n: number): string {
  const d = parseKey(key)
  d.setDate(d.getDate() + n)
  return todayKey(d)
}

export function startOfWeek(key: string, weekStartsOn = 0): string {
  const d = parseKey(key)
  const day = d.getDay()
  const diff = (day - weekStartsOn + 7) % 7
  d.setDate(d.getDate() - diff)
  return todayKey(d)
}

export function weekKeys(anchor: string, weekStartsOn = 0): string[] {
  const start = startOfWeek(anchor, weekStartsOn)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

export function weekdayLabel(key: string): string {
  return parseKey(key).toLocaleDateString(undefined, { weekday: 'narrow' })
}

export function prettyDate(key: string): string {
  const d = parseKey(key)
  const now = todayKey()
  if (key === now) return 'Today'
  if (key === addDays(now, -1)) return 'Yesterday'
  if (key === addDays(now, 1)) return 'Tomorrow'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
