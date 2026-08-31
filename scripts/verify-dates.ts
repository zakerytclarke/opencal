import { addDays, addMonths, monthGrid, sameMonth, startOfMonth, todayKey } from '../src/lib/dates.ts'
import { filterRecents, recentLoggedFoods } from '../src/lib/diary.ts'
import { repeatEntry } from '../src/lib/foods.ts'
import type { Diary, LogEntry } from '../src/types.ts'

function entry(partial: Partial<LogEntry> & Pick<LogEntry, 'id' | 'name' | 'foodId' | 'loggedAt'>): LogEntry {
  return {
    date: '2026-08-30',
    emoji: '🍳',
    grams: 50,
    servings: 1,
    serveLabel: '1 × serving',
    kcal: 80,
    protein: 6,
    carbs: 1,
    fat: 5,
    source: 'search',
    ...partial,
  }
}

const cases: { name: string; pass: boolean; got: string }[] = []

function check(name: string, pass: boolean, got: string) {
  cases.push({ name, pass, got })
}

check('startOfMonth', startOfMonth('2026-08-30') === '2026-08-01', startOfMonth('2026-08-30'))
check('addDays across month', addDays('2026-08-31', 1) === '2026-09-01', addDays('2026-08-31', 1))
check('addMonths clamps day', addMonths('2026-01-31', 1) === '2026-02-28', addMonths('2026-01-31', 1))
check('monthGrid is 6 weeks', monthGrid('2026-08-30').length === 42, String(monthGrid('2026-08-30').length))
check(
  'monthGrid includes first and last of August',
  monthGrid('2026-08-15').includes('2026-08-01') && monthGrid('2026-08-15').includes('2026-08-31'),
  monthGrid('2026-08-15').slice(0, 1).concat(monthGrid('2026-08-15').slice(-1)).join(','),
)
check('sameMonth', sameMonth('2026-08-01', '2026-08-31') && !sameMonth('2026-08-31', '2026-09-01'), 'aug/sep')
check('todayKey format', /^\d{4}-\d{2}-\d{2}$/.test(todayKey()), todayKey())

const diary: Diary = {
  '2026-08-29': [
    entry({ id: 'a', name: 'Turkey Bacon', foodId: 'tb', loggedAt: '2026-08-29T08:00:00.000Z', kcal: 40 }),
    entry({ id: 'q', name: 'Quick add', foodId: 'quick', loggedAt: '2026-08-29T09:00:00.000Z', kcal: 500 }),
  ],
  '2026-08-30': [
    entry({ id: 'b', name: 'Turkey Bacon', foodId: 'tb', loggedAt: '2026-08-30T08:00:00.000Z', kcal: 80 }),
    entry({ id: 'c', name: 'Eggs', foodId: 'egg', brand: null, loggedAt: '2026-08-30T09:00:00.000Z', kcal: 140 }),
  ],
}

const recents = recentLoggedFoods(diary, 8)
check(
  'recents skip quick add and dedupe newest first',
  recents.length === 2 && recents[0].name === 'Eggs' && recents[1].kcal === 80,
  recents.map((e) => `${e.name}:${e.kcal}`).join(' · '),
)
check(
  'filter recents by query',
  filterRecents(recents, 'bacon').length === 1 && filterRecents(recents, 'bacon')[0].name === 'Turkey Bacon',
  filterRecents(recents, 'bacon')
    .map((e) => e.name)
    .join(','),
)

const copy = repeatEntry(recents[1], '2026-08-31')
check(
  'repeat keeps nutrition and user name',
  copy.name === 'Turkey Bacon' && copy.kcal === 80 && copy.date === '2026-08-31' && copy.id !== recents[1].id,
  `${copy.name} ${copy.kcal} ${copy.date}`,
)

const failed = cases.filter((c) => !c.pass)
console.log('| # | Test | Got | Result |')
console.log('|---|------|-----|--------|')
cases.forEach((c, i) => {
  console.log(`| ${i + 1} | ${c.name} | ${c.got} | ${c.pass ? 'PASS' : 'FAIL'} |`)
})
console.log('')
console.log(`${cases.length - failed.length}/${cases.length} passed`)
if (failed.length) process.exit(1)
