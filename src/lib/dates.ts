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

export function longDate(key: string): string {
  return parseKey(key).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

export function startOfMonth(key: string): string {
  const d = parseKey(key)
  d.setDate(1)
  return todayKey(d)
}

export function addMonths(key: string, n: number): string {
  const d = parseKey(key)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return todayKey(d)
}

export function monthLabel(key: string): string {
  return parseKey(key).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7)
}

/** 6×7 grid starting Sunday, including spillover days from adjacent months. */
export function monthGrid(anchor: string, weekStartsOn = 0): string[] {
  const start = startOfMonth(anchor)
  const lead = (parseKey(start).getDay() - weekStartsOn + 7) % 7
  const gridStart = addDays(start, -lead)
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
}
