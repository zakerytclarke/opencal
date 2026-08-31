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
  return crypto.randomUUID()
}
