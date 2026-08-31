import MiniSearch from 'minisearch'
import type { ExtractedItem, Food, FoodFile, LogEntry } from '../types'
import { convertPortion, portionToolLine, scaleNutrition } from './portions'
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
    const base = import.meta.env?.BASE_URL ?? '/'
    const res = await fetch(`${base}foods.json`)
    if (!res.ok) throw new Error('Could not load the food database')
    const data = (await res.json()) as FoodFile
    foods = data.foods.map((f) => ({
      ...f,
      visibility: f.visibility === 'search' || f.visibility === 'ref' ? f.visibility : classifyVisibility(f),
    }))
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

export function catalogCount(): number {
  return foods.filter((f) => f.visibility === 'search').length
}

export const USDA_FDC = 'https://fdc.nal.usda.gov/'
export const USDA_DATASETS = 'https://fdc.nal.usda.gov/download-datasets'
export const USDA_DOCS = 'https://fdc.nal.usda.gov/data-documentation'

export function fdcIdFromFoodId(id: string): string | null {
  const m = /^(?:fndds|foundation|sr|branded)-(\d+)$/.exec(id)
  return m?.[1] ?? null
}

export function foodSourceLabel(id: string): string {
  if (id.startsWith('fndds-')) return 'USDA FNDDS'
  if (id.startsWith('foundation-')) return 'USDA Foundation'
  if (id.startsWith('sr-')) return 'USDA SR Legacy'
  if (id.startsWith('branded-')) return 'USDA Branded'
  if (id.startsWith('extra-')) return 'Compiled'
  return 'USDA'
}

/** Public USDA page for this food, or a FoodData Central search if it is a compiled extra. */
export function foodSourceUrl(id: string, name?: string): string {
  const fdc = fdcIdFromFoodId(id)
  if (fdc) return `https://fdc.nal.usda.gov/food-details/${fdc}/nutrients`
  if (name) return `https://fdc.nal.usda.gov/food-search?query=${encodeURIComponent(name)}`
  return USDA_FDC
}

function wordBoundaryHas(hay: string, needle: string): boolean {
  if (!needle) return false
  const re = new RegExp(`(?:^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?(?:\\s|$)`)
  return re.test(hay)
}

/** Foods that people actually eat as a labeled slice/piece. */
const SLICE_IS_A_SERVING =
  /pizza|bread|toast|bagel|muffin|cake|pie|taco|sandwich|bacon|ham|sausage|cheese|steak|loaf|waffle|pancake/

function askedSmallUnit(q: string): boolean {
  return /\b(slice|slices|piece|pieces|fl oz|tbsp|tsp|oz|g|gram|ml)\b/.test(q)
}

function garnishSlice(food: Food, q: string): boolean {
  if (askedSmallUnit(q) || food.serveG >= 30) return false
  if (!/slice|piece|chunk/.test(normalize(food.serveLabel))) return false
  return !SLICE_IS_A_SERVING.test(`${normalize(food.name)} ${q}`)
}

const BARE_PRODUCE =
  /^(banana|bananas|apple|apples|carrot|carrots|tomato|tomatoes|orange|oranges|onion|onions|cucumber|cucumbers)$/

function isBareProduceName(name: string): boolean {
  const first = normalize(name.split(',')[0] ?? '')
  return BARE_PRODUCE.test(first)
}

/** FNDDS often stores produce as a 2–20 g garnish slice. */
function isProduceGarnishRow(food: Food): boolean {
  if (food.serveG >= 30) return false
  if (!/slice|piece|chunk/.test(normalize(food.serveLabel))) return false
  if (SLICE_IS_A_SERVING.test(normalize(food.name))) return false
  return isBareProduceName(food.name)
}

function userAskedSmallBit(item: ExtractedItem): boolean {
  return askedSmallUnit([item.raw, item.query].filter(Boolean).join(' '))
}

const REF_NAME =
  /baby ?food|baby toddler|\binfant\b|as ingredient|for use (on|with)|topping from|dehydrated|usda commodity|imitation|not specified|as to form|as to fat|with added vegetables|ns as to|from other sources|for use as/
const NICE_LABEL =
  /\b(medium|small|large|extra large|extra small|slice|sandwich|bar|can|bottle|bowl|burrito|taco|cup|tbsp|tablespoon|tsp|egg|bagel|muffin|cookie|patty|fillet|container|pouch|grande|wrap|platter|nugget|pizza|piece|item|each|serving|scoops?)\b/
const UGLY_LABEL = /refuse|yield from|quantity not|^1 fl oz$|^100 g$|fl oz \(with ice\)/
const KEEP_SLICE = /pizza|bread|toast|bagel|muffin|bacon|nugget|pancake|waffle/
const BRAND_HINT =
  /\b(chobani|starbucks|mcdonald|kind |chipotle|applebee|burger king|trader joe|kellogg|general mills|pepsi|coca-cola|coke|quest |clif |fairlife|oatly|silk |fage|dannon|danone|hormel|tyson|barilla|chick-fil-a|taco bell|dunkin|subway|in-n-out)\b/

/** Catalog foods people pick in search. Everything else is matcher-only. */
export function classifyVisibility(food: Pick<Food, 'name' | 'serveLabel' | 'serveG' | 'kcal' | 'source'>): Food['visibility'] {
  if (food.source === 'compiled' || food.source === 'branded') return 'search'
  const name = food.name
  const label = food.serveLabel
  const grams = food.serveG
  if (food.kcal < 5) return 'ref'
  if (REF_NAME.test(name.toLowerCase())) return 'ref'
  if (name.length > 64) return 'ref'
  const raccOk = /racc/i.test(label) && grams >= 40 && grams <= 220
  if (UGLY_LABEL.test(label.toLowerCase()) && !raccOk) return 'ref'
  if ((name.match(/,/g) ?? []).length >= 3 && !BRAND_HINT.test(name.toLowerCase()) && !NICE_LABEL.test(label.toLowerCase())) return 'ref'
  const first = name.split(',')[0]?.trim() ?? ''
  const branded = first === first.toUpperCase() && first.length > 3
  if (branded && grams >= 30 && grams <= 650) return 'search'
  if (BRAND_HINT.test(name.toLowerCase()) && grams >= 30 && grams <= 650) return 'search'
  if (grams < 28) {
    if (KEEP_SLICE.test(name.toLowerCase()) && /slice|piece/i.test(label) && grams >= 8) return 'search'
    return 'ref'
  }
  if (grams > 650) return 'ref'
  if (NICE_LABEL.test(label.toLowerCase()) || raccOk) return 'search'
  return 'ref'
}

export function isCatalogFood(food: Food): boolean {
  return food.visibility === 'search'
}

function rank(query: string, food: Food, miniScore: number): number {
  const q = normalize(query)
  const name = normalize(food.name)
  const first = name.split(',')[0]?.trim() ?? name
  const aliases = food.aliases.map(normalize)
  const label = normalize(food.serveLabel)
  let score = Math.min(40, miniScore * 0.2)
  if (name === q) score += 168
  else if (aliases.includes(q) && name === first && !garnishSlice(food, q)) score += 160
  else if (aliases.includes(q) && /dehydrated|juice|chips|powder|nectar/.test(name)) score += 12
  else if (aliases.includes(q)) score += 110
  else if (first === q) score += 120
  else if (name.startsWith(`${q} `) || name.startsWith(`${q},`) || aliases.some((a) => a.startsWith(q))) score += 55
  else if (wordBoundaryHas(name, q) || aliases.some((a) => wordBoundaryHas(a, q))) score += 20
  score -= Math.min(36, Math.max(0, name.length - q.length) * 0.28)
  if (/baby ?food|baby toddler|\binfant\b/.test(name)) score -= 90
  if (/as ingredient|for use (on|with)|topping from/.test(name)) score -= 40
  if (/,?\s*dry\b|dry mix|artificially flavored/.test(name) && !/\bmix\b/.test(q)) score -= 40
  if (food.kcal < 1) score -= 80
  if (garnishSlice(food, q) || isProduceGarnishRow(food)) score -= 80
  if (!askedSmallUnit(q) && food.serveG < 20 && !SLICE_IS_A_SERVING.test(name)) score -= 45
  if (!askedSmallUnit(q) && food.serveG >= 70 && food.serveG <= 220 && /medium|small|large|peeled|extra small/.test(label)) {
    score += 32
  }
  if ((q === 'egg' || q === 'eggs') && /white|yolk|noodle|bread|bagel|foo yung|roll/.test(name)) score -= 50
  if ((q === 'egg' || q === 'eggs') && /whole|scrambled/.test(name)) score += 22
  if (/egg white/.test(q) && /sandwich/.test(name)) score -= 60
  if ((q === 'banana' || q === 'bananas') && /pepper/.test(name)) score -= 60
  if ((q === 'banana' || q === 'bananas') && /\braw\b/.test(name) && food.serveG >= 70) score += 18
  if (BARE_PRODUCE.test(q)) {
    if (
      /juice|nectar|chips|split|pudding|dehydrated|powder|candied|dried|pie|cider|glazed|pickled|puree|paste|sauce|filling/.test(
        name,
      )
    ) {
      score -= 280
    }
    if (/muffin|cake|cupcake|bread/.test(name)) score -= 80
    if (/salad/.test(name) && !/salad/.test(q)) score -= 110
    if (/peas and carrots|beef|soup|stew|mixed/.test(name) && !/peas|soup|stew|mixed/.test(q)) score -= 90
    if (isBareProduceName(food.name) && food.kcal >= 10 && food.serveG >= 40) score += 70
    if (/\braw\b/.test(name) && food.serveG >= 40 && food.kcal >= 10) score += 48
    if (/frozen, unprepared/.test(name) && food.serveG >= 40 && food.kcal >= 10) score += 55
    else if (/\bcanned\b/.test(name) && food.serveG >= 40 && food.kcal >= 10) score += 30
  }
  const qStem = q.endsWith('s') && q.length > 4 ? q.slice(0, -1) : q
  const firstStem = first.endsWith('s') && first.length > 4 ? first.slice(0, -1) : first
  if (qStem.length >= 4 && firstStem === qStem && first !== q && name !== q) score += 36
  const flavorAsked =
    /\b(chocolate|vanilla|strawberry|blueberry|mango|peach|pumpkin|coconut|apricot|pineapple)\b/.test(q)
  if (!flavorAsked) {
    if (
      /\b(chocolate|vanilla|strawberry|blueberry|mango|peach|pumpkin spice|coconut)\b/.test(name) &&
      /\b(milk|yogurt|latte|bar)\b/.test(name)
    ) {
      score -= 22
    }
    if (/\bplain\b/.test(name) && /\b(yogurt|milk)\b/.test(name)) score += 16
  }
  const words = q.split(/\s+/).filter((w) => w.length > 1)
  if (words.length >= 2) {
    const covered = words.filter((w) => name.includes(w) || aliases.some((a) => a.includes(w))).length
    if (covered === words.length) score += 52
    else if (covered === words.length - 1) score += 16
    else score -= 48
  }
  if (/\bturkey\b/.test(q) && !/\bturkey\b/.test(name) && !aliases.some((a) => /\bturkey\b/.test(a))) score -= 70
  if (/\bbacon\b/.test(q) && !/\bturkey\b/.test(q) && /\bturkey\b/.test(name)) score -= 28
  if (/almond milk/.test(q) && /almond milk/.test(name)) score += 40
  if (/egg white/.test(q) && /egg white/.test(name)) score += 40
  if (/greek yogurt|yogurt, greek/.test(q) && /greek/.test(name) && /yogurt/.test(name)) score += 36
  if (/starbucks|grande/.test(q) && /starbucks/.test(name)) score += 44
  if (/big mac/.test(q) && /big mac/.test(name)) score += 55
  if (/\bkind\b/.test(q) && /kind bar/.test(name)) score += 48
  if (/chobani/.test(q) && /chobani/.test(name)) score += 48
  if (/chipotle/.test(q) && /chipotle/.test(name) && !/dip/.test(name)) score += 36
  if (/\bmuffin/.test(q) && /cereal/.test(name)) score -= 50
  if (/\bmuffin/.test(q) && /^(muffin|muffins),/.test(name)) score += 28
  if (/commercially prepared/.test(name) && words.some((w) => name.includes(w))) score += 12
  if (food.source === 'fndds') score += 10
  if (food.source === 'compiled' || food.source === 'branded') score += 16
  if (food.visibility === 'search') score += 12
  return score
}

export type FoodScope = 'search' | 'all'

export function searchFoods(query: string, limit = 20, scope: FoodScope = 'all'): Food[] {
  if (!search || !query.trim()) return []
  const q = query.trim()
  const n = normalize(q)
  const variants = new Set([q, n])
  if (n.endsWith('s') && n.length > 4) variants.add(n.slice(0, -1))
  else if (n.length > 3) variants.add(`${n}s`)
  const merged: { id: unknown; score: number }[] = []
  for (const v of variants) {
    if (!v) continue
    merged.push(...search.search(v, { combineWith: 'AND' }))
    merged.push(...search.search(v, { combineWith: 'OR', fuzzy: 0.15, prefix: true }))
  }
  const bestMini = new Map<string, number>()
  for (const h of merged) {
    const id = String(h.id)
    bestMini.set(id, Math.max(bestMini.get(id) ?? 0, h.score))
  }
  const ranked = [...bestMini.entries()]
    .map(([id, mini]) => {
      const food = byId.get(id)
      if (!food) return null
      return { food, score: rank(query, food, mini) }
    })
    .filter((x): x is { food: Food; score: number } => !!x)
    .sort((a, b) => b.score - a.score)
  const out: Food[] = []
  const seen = new Set<string>()
  for (const row of ranked) {
    if (seen.has(row.food.id)) continue
    if (scope === 'search' && row.food.visibility === 'ref') continue
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

/** USDA / FNDDS medium-item weights when the row is a 2–20 g garnish slice. */
function wholeItemGrams(food: Food): number {
  const name = normalize(food.name)
  if (/banana/.test(name) && !/chip|split|nectar|pudding|pepper/.test(name)) return 118
  if (/^apples?\b/.test(name) && !/juice|sauce|dried|pie|candied/.test(name)) return 165
  if (/^oranges?\b/.test(name) && !/juice|peel/.test(name)) return 130
  if (/^tomatoes?\b/.test(name) && !/juice|sauce|paste|puree|soup/.test(name)) return 120
  if (/^carrots?\b/.test(name) && !/juice|dehydrated/.test(name)) return 61
  if (/^onions?\b/.test(name)) return 110
  if (/^cucumbers?\b/.test(name)) return 150
  return Math.max(80, food.serveG * 12)
}

function wholeProduceGrams(food: Food, item: ExtractedItem): number | undefined {
  const garnish =
    isProduceGarnishRow(food) && !userAskedSmallBit(item)
      ? true
      : garnishSlice(food, [item.query, item.unit, item.raw].filter(Boolean).join(' '))
  if (!garnish) return undefined
  const unit = (item.unit ?? '').toLowerCase()
  if (
    unit &&
    !['small', 'medium', 'large', 'extra large', 'each', 'item', 'items', 'slice', 'slices', 'piece', 'pieces', 'whole'].includes(
      unit,
    )
  ) {
    return undefined
  }
  return wholeItemGrams(food)
}

function portionFor(food: Food, item: ExtractedItem) {
  return convertPortion(food, item, { wholeProduceGrams: wholeProduceGrams(food, item) })
}

export function scaleFood(food: Food, grams: number): Pick<LogEntry, 'kcal' | 'protein' | 'carbs' | 'fat'> {
  return scaleNutrition(food, grams)
}

/** Diary label from what the user typed, spoke, or the photo named. */
export function prettyFoodName(name: string): string {
  const t = name.replace(/\s+/g, ' ').trim()
  if (!t) return 'Food'
  if (/[A-Z]/.test(t) && t !== t.toUpperCase()) return t
  if (t === t.toUpperCase() && t.length <= 8) return t
  return t.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_, p, c) => `${p}${c.toUpperCase()}`)
}

export function foodBrand(name: string): string | null {
  const lead = name.match(/^([A-Z][A-Z0-9'&. ]{1,40}?)(?:'S|'s)?, /)
  if (lead) return lead[1].replace(/'S$/, "'s").trim()
  const paren = name.match(/\(([^)]+)\)$/)
  if (paren && /[A-Za-z]/.test(paren[1]) && paren[1].length < 36) return paren[1].trim()
  return null
}

export function candidateLines(
  hits: Food[],
  item?: ExtractedItem,
): { key: string; food: Food; line: string }[] {
  return hits.slice(0, 8).map((food, i) => {
    const key = String.fromCharCode(65 + i)
    const brand = foodBrand(food.name)
    const converted = item
      ? portionToolLine(food, item, portionFor(food, item))
      : `USDA ${food.serveLabel} (${Math.round(food.serveG)} g)`
    const line = `${key}. ${food.name}${brand ? ` · brand ${brand}` : ''} · ${converted}`
    return { key, food, line }
  })
}

export function searchForItem(item: ExtractedItem, limit = 8): Food[] {
  const q = [item.brand, item.query].filter(Boolean).join(' ')
  const all = searchFoods(q, Math.max(limit * 4, 24), 'all')
  const catalog = all.filter((f) => f.visibility === 'search')
  const refs = all.filter((f) => f.visibility === 'ref')
  const hits = [...catalog, ...refs].slice(0, limit)
  if (hits.length || !item.brand) return hits
  return searchForItem({ ...item, brand: null }, limit)
}

export function entryFromFood(
  food: Food,
  item: ExtractedItem,
  source: LogEntry['source'],
  date: string,
): LogEntry {
  const grams = Math.max(1, Math.round(portionFor(food, item).grams))
  const macros = scaleFood(food, grams)
  const servings = Math.round((grams / food.serveG) * 100) / 100
  return {
    id: uid(),
    date,
    foodId: food.id,
    name: prettyFoodName(item.query || item.raw || food.name),
    brand: item.brand?.trim() || null,
    emoji: food.emoji,
    grams,
    servings,
    serveLabel: item.unit
      ? `${trimQty(item.quantity)} × ${item.unit}`
      : `${trimQty(servings)} × ${food.serveLabel}`,
    ...macros,
    source,
    loggedAt: new Date().toISOString(),
  }
}

export function unmatchedEntry(item: ExtractedItem, source: LogEntry['source'], date: string): LogEntry {
  const label = [item.quantity, item.unit].filter(Boolean).join(' ') || 'unmatched'
  return {
    id: uid(),
    date,
    foodId: 'unmatched',
    name: prettyFoodName(item.query || item.raw),
    brand: item.brand ?? null,
    emoji: '🍽️',
    grams: 0,
    servings: item.quantity,
    serveLabel: label,
    kcal: item.caloriesHint ?? 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    source,
    loggedAt: new Date().toISOString(),
  }
}

export function repeatEntry(entry: LogEntry, date: string): LogEntry {
  return {
    id: uid(),
    date,
    foodId: entry.foodId,
    name: entry.name,
    brand: entry.brand,
    emoji: entry.emoji,
    grams: entry.grams,
    servings: entry.servings,
    serveLabel: entry.serveLabel,
    kcal: entry.kcal,
    protein: entry.protein,
    carbs: entry.carbs,
    fat: entry.fat,
    source: 'search',
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
      return { entry: unmatchedEntry(item, source, date), food: null, item }
    }
    return { entry: entryFromFood(food, item, source, date), food, item }
  })
}
