import type { Diary, LogEntry, Profile } from '../types'

const PROFILE_KEY = 'opencal.profile'
const DIARY_KEY = 'opencal.diary'

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    return raw ? (JSON.parse(raw) as Profile) : null
  } catch {
    return null
  }
}

export function saveProfile(profile: Profile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
}

export function clearProfile(): void {
  localStorage.removeItem(PROFILE_KEY)
}

export function clearDiary(): void {
  localStorage.removeItem(DIARY_KEY)
}

export function clearAllData(): void {
  clearProfile()
  clearDiary()
}

export function loadDiary(): Diary {
  try {
    const raw = localStorage.getItem(DIARY_KEY)
    return raw ? (JSON.parse(raw) as Diary) : {}
  } catch {
    return {}
  }
}

export function saveDiary(diary: Diary): void {
  localStorage.setItem(DIARY_KEY, JSON.stringify(diary))
}

export function addEntries(diary: Diary, date: string, entries: LogEntry[]): Diary {
  const next = { ...diary, [date]: [...(diary[date] ?? []), ...entries] }
  saveDiary(next)
  return next
}

export function removeEntry(diary: Diary, date: string, id: string): Diary {
  const next = { ...diary, [date]: (diary[date] ?? []).filter((e) => e.id !== id) }
  saveDiary(next)
  return next
}

export function uid(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // randomUUID is only available in secure contexts (https / localhost).
  // Build a v4-shaped id manually so non-secure LAN/dev URLs (http://<ip>:5173)
  // don't crash the app.
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) | 0
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
