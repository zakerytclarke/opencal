import MiniSearch from 'minisearch'
import type { ExtractedItem, Food, FoodFile, LogEntry } from '../types'
import { uid } from './storage'

let foods: Food[] = []
let byId = new Map<string, Food>()
let search: MiniSearch<Food> | null = null
let loadPromise: Promise<Food[]> | null = null

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function loadFoods(): Promise<Food[]> {
  if (foods.length) return foods
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const res = await fetch('/foods.json')
    if (!res.ok) throw new Error('Could not load the food database')
    const data = (await res.json()) as FoodFile
    foods = data.foods
    byId = new Map(foods.map((f) => [f.id, f]))
    search = new MiniSearch<Food>({
      fields: ['name', 'aliasesText', 'category'],
      storeFields: ['id'],
      searchOptions: { boost: { name: 3, aliasesText: 2 }, fuzzy: 0.15, prefix: true },
      extractField: (doc, field) => {
        if (field === 'aliasesText') return (doc.aliases ?? []).join(' ')
        const value = doc[field as keyof Food]
        return typeof value === 'string' ? value : ''
      },
    })
    search.addAll(foods)
    return foods
  })()
  return loadPromise
}

export function getFood(id: string): Food | undefined {
  return byId.get(id)
}

export function foodCount(): number {
  return foods.length
}

function wordBoundaryHas(hay: string, needle: string): boolean {
  if (!needle) return false
  const re = new RegExp(`(?:^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?(?:\\s|$)`)
  return re.test(hay)
}

function rank(query: string, food: Food, miniScore: number): number {
  const q = normalize(query)
  const name = normalize(food.name)
  const first = name.split(',')[0]?.trim() ?? name
  const aliases = food.aliases.map(normalize)
  let score = miniScore * 0.2
  if (name === q || aliases.includes(q)) score += 160
  else if (first === q) score += 120
  else if (name.startsWith(`${q} `) || name.startsWith(`${q},`) || aliases.some((a) => a.startsWith(q))) score += 55
  else if (wordBoundaryHas(name, q) || aliases.some((a) => wordBoundaryHas(a, q))) score += 20
  score -= Math.min(36, Math.max(0, name.length - q.length) * 0.28)
  if (/baby ?food|baby toddler|\binfant\b/.test(name)) score -= 90
  if (/as ingredient/.test(name)) score -= 22
  if ((q === 'egg' || q === 'eggs') && /white|yolk|noodle|bread|bagel|foo yung|roll/.test(name)) score -= 50
  if ((q === 'egg' || q === 'eggs') && /whole|scrambled/.test(name)) score += 22
  if ((q === 'banana' || q === 'bananas') && /pepper/.test(name)) score -= 60
  if ((q === 'banana' || q === 'bananas') && /\braw\b/.test(name)) score += 18
  if (food.source === 'fndds') score += 10
  if (food.source === 'compiled') score += 16
  return score
}

export function searchFoods(query: string, limit = 20): Food[] {
  if (!search || !query.trim()) return []
  const hits = search.search(query.trim(), { combineWith: 'AND' })
  const fallback = hits.length ? hits : search.search(query.trim(), { combineWith: 'OR', fuzzy: 0.2 })
  const seen = new Set<string>()
  const ranked = fallback
    .map((h) => {
      const food = byId.get(String(h.id))
      if (!food) return null
      return { food, score: rank(query, food, h.score) }
    })
    .filter((x): x is { food: Food; score: number } => !!x)
    .sort((a, b) => b.score - a.score)
  const out: Food[] = []
  for (const row of ranked) {
    if (seen.has(row.food.id)) continue
    seen.add(row.food.id)
    out.push(row.food)
    if (out.length >= limit) break
  }
  return out
}

export function bestMatch(query: string): Food | null {
  const words = query.trim().split(/\s+/).filter(Boolean)
  const attempts = [query.trim()]
  if (words.length > 2) attempts.push(words.slice(0, 2).join(' '))
  if (words.length > 1) attempts.push(words[0])
  for (const attempt of attempts) {
    const hit = searchFoods(attempt, 8)[0]
    if (hit) return hit
  }
  return null
}

const UNIT_GRAMS: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  oz: 28.3495,
  ounce: 28.3495,
  ounces: 28.3495,
  lb: 453.592,
  lbs: 453.592,
  pound: 453.592,
  pounds: 453.592,
  tbsp: 15,
  tablespoon: 15,
  tablespoons: 15,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  l: 1000,
  liter: 1000,
}

function gramsFor(food: Food, item: ExtractedItem): number {
  const unit = item.unit
  if (!unit) {
    return food.serveG * item.quantity
  }
  if (unit in UNIT_GRAMS) {
    return UNIT_GRAMS[unit] * item.quantity
  }
  const label = `${food.serveLabel} ${food.name}`.toLowerCase()
  if (label.includes(unit) || unit === 'serving' || unit === 'servings') {
    return food.serveG * item.quantity
  }
  if (unit === 'cup' || unit === 'cups') {
    if (label.includes('cup')) return food.serveG * item.quantity
    return 240 * item.quantity
  }
  if (['slice', 'slices', 'piece', 'pieces', 'item', 'items', 'each'].includes(unit)) {
    return food.serveG * item.quantity
  }
  if (['bowl', 'bowls', 'plate', 'plates', 'glass', 'glasses', 'can', 'cans', 'bottle', 'bottles', 'handful', 'scoop', 'scoops', 'bar', 'bars'].includes(unit)) {
    return food.serveG * item.quantity
  }
  if (['small', 'medium', 'large', 'extra large'].includes(unit)) {
    const factor = unit === 'small' ? 0.75 : unit === 'large' || unit === 'extra large' ? 1.25 : 1
    return food.serveG * item.quantity * factor
  }
  return food.serveG * item.quantity
}

export function scaleFood(food: Food, grams: number): Pick<LogEntry, 'kcal' | 'protein' | 'carbs' | 'fat'> {
  const f = grams / 100
  return {
    kcal: Math.round(food.kcal * f),
    protein: Math.round(food.protein * f * 10) / 10,
    carbs: Math.round(food.carbs * f * 10) / 10,
    fat: Math.round(food.fat * f * 10) / 10,
  }
}

export function entryFromFood(
  food: Food,
  item: ExtractedItem,
  source: LogEntry['source'],
  date: string,
): LogEntry {
  const grams = Math.max(1, Math.round(gramsFor(food, item)))
  const macros = scaleFood(food, grams)
  const servings = Math.round((grams / food.serveG) * 100) / 100
  return {
    id: uid(),
    date,
    foodId: food.id,
    name: food.name,
    emoji: food.emoji,
    grams,
    servings,
    serveLabel: item.unit
      ? `${trimQty(item.quantity)} ${item.unit}`
      : `${trimQty(servings)} × ${food.serveLabel}`,
    ...macros,
    source,
    loggedAt: new Date().toISOString(),
  }
}

export function quickAddEntry(kcal: number, date: string, name = 'Quick add'): LogEntry {
  return {
    id: uid(),
    date,
    foodId: 'quick',
    name,
    emoji: '⚡',
    grams: 0,
    servings: 1,
    serveLabel: `${kcal} cal`,
    kcal,
    protein: 0,
    carbs: 0,
    fat: 0,
    source: 'quick',
    loggedAt: new Date().toISOString(),
  }
}

function trimQty(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return (Math.round(n * 100) / 100).toString()
}

export function resolveExtracted(
  items: ExtractedItem[],
  date: string,
  source: LogEntry['source'],
): { entry: LogEntry; food: Food | null; item: ExtractedItem }[] {
  return items.map((item) => {
    if (item.caloriesHint && !item.query) {
      return { entry: quickAddEntry(item.caloriesHint, date, item.raw || 'Quick add'), food: null, item }
    }
    const food = item.query ? bestMatch(item.query) : null
    if (!food) {
      if (item.caloriesHint) {
        return { entry: quickAddEntry(item.caloriesHint, date, item.query || item.raw), food: null, item }
      }
      return {
        entry: {
          id: uid(),
          date,
          foodId: 'unmatched',
          name: item.query || item.raw,
          emoji: '🍽️',
          grams: 0,
          servings: item.quantity,
          serveLabel: item.unit ? `${item.quantity} ${item.unit}` : 'unmatched',
          kcal: item.caloriesHint ?? 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          source,
          loggedAt: new Date().toISOString(),
        },
        food: null,
        item,
      }
    }
    return { entry: entryFromFood(food, item, source, date), food, item }
  })
}
