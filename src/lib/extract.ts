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

export function looksLikeSentence(text: string): boolean {
  const t = text.trim()
  if (t.length > 40) return true
  if (LEADING.test(t)) return true
  return /\b(and|then|plus|,|;)\b/i.test(t) && t.split(/\s+/).length >= 4
}
