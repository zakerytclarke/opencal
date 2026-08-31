import type { ExtractedItem } from '../types'

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  half: 0.5,
  quarter: 0.25,
  couple: 2,
  few: 3,
  several: 4,
}

const UNITS = [
  'extra large',
  'tablespoons',
  'tablespoon',
  'teaspoons',
  'teaspoon',
  'servings',
  'serving',
  'handfuls',
  'handful',
  'bottles',
  'bottle',
  'glasses',
  'glass',
  'ounces',
  'ounce',
  'pounds',
  'pound',
  'slices',
  'slice',
  'pieces',
  'piece',
  'scoops',
  'scoop',
  'plates',
  'plate',
  'bowls',
  'bowl',
  'items',
  'item',
  'grams',
  'gram',
  'cups',
  'cup',
  'cans',
  'can',
  'bars',
  'bar',
  'tbsp',
  'tsp',
  'lbs',
  'lb',
  'kg',
  'oz',
  'ml',
  'medium',
  'large',
  'small',
  'each',
  'g',
  'l',
]

const LEADING = /^(i\s+)?(just\s+)?(had|ate|eaten|logged|log|drank|drink|have|having|got|grabbed|ordered|want to (?:log|add)|please (?:log|add)|add|log)\s+/i
const TRAILING = /\s+(for\s+)?(breakfast|lunch|dinner|brunch|snack|tonight|today|this morning|this afternoon|yesterday)\s*$/i
const FILLER = /\b(like|about|around|maybe|approximately|some|of|the|my|a lot of)\b/gi

function parseNumber(token: string): number | null {
  const t = token.toLowerCase()
  if (t in NUMBER_WORDS) return NUMBER_WORDS[t]
  if (/^\d+\/\d+$/.test(t)) {
    const [a, b] = t.split('/').map(Number)
    return b ? a / b : null
  }
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t)
  return null
}

function stripChat(text: string): string {
  return text
    .replace(LEADING, '')
    .replace(TRAILING, '')
    .replace(/\b(and then|plus also)\b/gi, ' and ')
    .trim()
}

export function isQuickCalorie(text: string): number | null {
  const m = text.trim().match(/^(\d{2,5})\s*(k?cal(?:ories)?)?$/i)
  if (!m) return null
  if (!m[2] && Number(m[1]) < 50) return null
  return Number(m[1])
}

function splitItems(text: string): string[] {
  return text
    .split(/\s*(?:,|;|&|\+|\/|\band\b|\bthen\b|\bplus\b|\bwith\b)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

function parseSegment(raw: string): ExtractedItem {
  let s = raw.replace(FILLER, ' ').replace(/\s+/g, ' ').trim()
  const cal = s.match(/(\d{2,5})\s*(k?cal(?:ories)?)/i)
  let caloriesHint: number | undefined
  if (cal) {
    caloriesHint = Number(cal[1])
    s = s.replace(cal[0], ' ').trim()
  }

  let quantity = 1
  let unit: string | null = null

  const tokens = s.split(' ')
  if (tokens.length) {
    const n = parseNumber(tokens[0])
    if (n != null) {
      quantity = n
      tokens.shift()
      const maybeUnit = tokens.slice(0, 2).join(' ').toLowerCase()
      const hit = UNITS.find((u) => maybeUnit === u || maybeUnit.startsWith(`${u} `) || tokens[0]?.toLowerCase() === u)
      if (hit) {
        unit = hit
        const consume = hit.includes(' ') ? 2 : 1
        tokens.splice(0, consume)
      }
    } else {
      const two = tokens.slice(0, 2).join(' ').toLowerCase()
      const hit = UNITS.find((u) => two === u || tokens[0]?.toLowerCase() === u)
      if (hit && ['small', 'medium', 'large', 'extra large'].includes(hit)) {
        unit = hit
        tokens.splice(0, hit.includes(' ') ? 2 : 1)
      }
    }
  }

  let query = tokens.join(' ').replace(/\bwith\b/g, ' ').replace(/\s+/g, ' ').trim()
  // "bowl of oatmeal" after unit already consumed; leftover "of oatmeal"
  query = query.replace(/^of\s+/i, '').replace(/\s+of$/i, '')
  if (!query) query = raw

  return { raw, query, quantity, unit, caloriesHint }
}

export function extractFoods(text: string): ExtractedItem[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const quick = isQuickCalorie(trimmed)
  if (quick != null) {
    return [{ raw: trimmed, query: '', quantity: 1, unit: null, caloriesHint: quick }]
  }
  const cleaned = stripChat(trimmed)
  const parts = splitItems(cleaned)
  const items = parts.map(parseSegment).filter((i) => i.query.length >= 2 || i.caloriesHint)
  return items.length ? items : [{ raw: trimmed, query: cleaned || trimmed, quantity: 1, unit: null }]
}

const GROUND_STOP = new Set([
  'a', 'an', 'and', 'or', 'with', 'the', 'of', 'in', 'on', 'for', 'from', 'to', 'my', 'some',
])

function stemTok(t: string): string {
  if (t.endsWith('ies') && t.length > 4) return `${t.slice(0, -3)}y`
  if (t.endsWith('s') && t.length > 3 && !t.endsWith('ss')) return t.slice(0, -1)
  return t
}

function normTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t && !GROUND_STOP.has(t))
    .map(stemTok)
}

function mentionedInMeal(item: ExtractedItem, meal: string): boolean {
  const mealToks = new Set(normTokens(meal))
  const nameToks = normTokens(item.query)
  if (!nameToks.length) return false
  const hits = nameToks.filter((t) => mealToks.has(t))
  if (nameToks.length === 1) return hits.length === 1
  return hits.length >= Math.ceil(nameToks.length / 2)
}

function specifyFromMeal(item: ExtractedItem, meal: string): ExtractedItem {
  const q = item.query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const n = meal.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  if (/^eggs?$/.test(q) && /\begg whites?\b/.test(n)) {
    return { ...item, query: /\bwhites\b/.test(n) ? 'egg whites' : 'egg white' }
  }
  if (!q || q.length < 3) return item
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = n.match(new RegExp(`\\b${escaped}s?\\s+([a-z]+)\\b`))
  const extra = m?.[1]
  if (
    extra &&
    !GROUND_STOP.has(extra) &&
    !UNITS.includes(extra) &&
    /^(pepper|peppers|bacon|white|whites|juice|milk|butter|bread|bowl|bar|yogurt)$/.test(extra)
  ) {
    return { ...item, query: `${q} ${extra}` }
  }
  return item
}

function brandFromMeal(meal: string, item: ExtractedItem): string | null {
  const brands = "KIND|Starbucks|Chipotle|McDonald'?s|Chobani|Applebee'?s"
  const q = item.query.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  const near = meal.match(new RegExp(`\\b(${brands})\\b(.{0,40}?)\\b${q}\\b`, 'i'))
  if (near && !/\b(with|and|,)\b/i.test(near[2])) {
    return near[1].replace(/mcdonalds/i, "McDonald's")
  }
  if (item.brand?.trim()) {
    const b = item.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const vlmNear = meal.match(new RegExp(`\\b${b}\\b(.{0,40}?)\\b${q}\\b`, 'i'))
    if (vlmNear && !/\b(with|and|,)\b/i.test(vlmNear[1])) return item.brand.trim()
  }
  return null
}

function sameFood(a: string, b: string): boolean {
  const at = normTokens(a)
  const bt = normTokens(b)
  if (!at.length || !bt.length) return false
  if (at.join(' ') === bt.join(' ')) return true
  const [shorter, longer] = at.length <= bt.length ? [at, bt] : [bt, at]
  return shorter.every((t) => longer.includes(t))
}

function stripGuessedSize(item: ExtractedItem, meal: string): ExtractedItem {
  if (!item.unit || !/^(small|medium|large|extra large)$/i.test(item.unit)) return item
  if (new RegExp(`\\b${item.unit.replace(/\s+/g, '\\s+')}s?\\b`, 'i').test(meal)) return item
  return { ...item, unit: null }
}

/** Drop example-food leaks and recover quantity/brand from the user's words. */
export function refineExtracted(items: ExtractedItem[], meal: string): ExtractedItem[] {
  if (!meal.trim() || meal.trim() === '(photo)') return items
  const regex = extractFoods(meal).filter((i) => i.query && !i.caloriesHint)
  const grounded = items
    .filter((item) => mentionedInMeal(item, meal))
    .map((item) => {
      let next = specifyFromMeal(item, meal)
      const q = next.query.toLowerCase()
      const hit = regex.find((r) => {
        const rq = r.query.toLowerCase()
        return rq === q || rq.includes(q) || q.includes(rq)
      })
      if (hit && hit.quantity !== next.quantity) {
        next = { ...next, quantity: hit.quantity, unit: hit.unit ?? next.unit }
      } else if (hit && !next.unit && hit.unit) {
        next = { ...next, unit: hit.unit }
      }
      if (/\bgrande\b/i.test(meal) && !next.unit) {
        next = { ...next, unit: 'grande' }
      }
      next = stripGuessedSize({ ...next, brand: brandFromMeal(meal, next) }, meal)
      return next
    })
  for (const r of regex) {
    if (grounded.some((g) => sameFood(g.query, r.query))) continue
    grounded.push(stripGuessedSize({ ...r, brand: brandFromMeal(meal, r) }, meal))
  }
  return grounded
}

export function looksLikeSentence(text: string): boolean {
  const t = text.trim()
  if (t.length > 40) return true
  if (LEADING.test(t)) return true
  return /\b(and|then|plus|,|;)\b/i.test(t) && t.split(/\s+/).length >= 4
}
