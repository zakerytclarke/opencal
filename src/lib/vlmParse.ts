import { extractFoods } from './extract'
import type { ExtractedItem } from '../types'

export type ChatPart = { type?: string; text?: string }
export type ChatMessage = { role: string; content: string | ChatPart[] }

export type PickDecision = {
  index: number | null
  name: string | null
  brand: string | null
  unit: string | null
  quantity: number
}

export const EXTRACT_SYSTEM = `You extract every food and drink from a meal.
Reply with JSON only. No markdown, no prose.
Format:
{"foods":[{"name":"eggs","brand":null,"quantity":2,"unit":"large"},{"name":"banana","brand":null,"quantity":1,"unit":"medium"}]}
Rules:
- One object per distinct edible item. Split combos (chicken bowl with rice → chicken, rice). Named sides stay separate (bowl with guacamole and beans → bowl, guacamole, beans).
- If the user did not say small/medium/large, do not invent a size. A muffin/cookie/bagel with no size word uses unit muffin/cookie/bagel or null, not small.
- name is a short grocery name.
- brand is only set if the user or package named one, else null.
- quantity is a number. unit is the household word the user said: large, medium, small, slice, cup, tbsp, tsp, oz, g, fl oz, bowl, handful, can, bottle, grande, tall, bar.
- Fruit, drinks, snacks, and cooked dishes all count. Skip plates and utensils.
- Only foods the user named. Never copy foods from examples.
- Do not convert units, estimate grams, or invent calories. convert_portion and scale_nutrition run after a USDA row is picked.`

export const EXTRACT_PREFIX = '{"foods":['

export const EXTRACT_FEWSHOT: ChatMessage[] = [
  { role: 'user', content: 'I ate a slice of pepperoni pizza and a coke' },
  {
    role: 'assistant',
    content:
      '{"foods":[{"name":"pepperoni pizza","brand":null,"quantity":1,"unit":"slice"},{"name":"coke","brand":null,"quantity":1,"unit":"can"}]}',
  },
]

export const PHOTO_EXTRACT_SYSTEM = `You extract every edible item clearly visible in the photo.
Reply with JSON only, never a caption:
{"foods":[{"name":"apple","brand":null,"quantity":1,"unit":"medium"}]}
Count every distinct piece. Three apples is quantity 3, not 1. Six pizza slices is quantity 6 unit slice. Two eggs is quantity 2 unit large. A bunch still attached is that many items, not one bunch.
Split a mixed bowl into the foods you can see (tofu, eggs, corn, …), not one generic "bowl".
Use household units (medium, slice, cup, tbsp, oz, piece). Do not estimate grams or calories.
Skip plates, utensils, flowers, lanterns, salt blocks, and backgrounds. Do not invent sides that are not in the photo.`

export const PHOTO_EXTRACT_USER = 'What foods are in this photo? Count items and name household units. Do not estimate grams or calories.'

export const PICK_SYSTEM = `You pick a local USDA nutrition reference row.
Calories and grams are already computed by convert_portion from USDA per-100 g values and household weights. Do not invent numbers or change the portion.
You are given the user's meal, this item, and lettered hits. Each hit includes convert_portion for this item's quantity and unit.
Reply with JSON only:
{"pick":"A","name":"Oatmeal, cooked"}
Rules:
- pick is the letter of the closest nutrition reference, or null if none match.
- name is the chosen row's name. Do not output quantity, unit, grams, or calories.
- Prefer everyday cooked/raw foods over baby food, ingredients, or odd variants.
- Prefer a typical whole-food serving (medium fruit, large egg, slice of pizza) over a 2–20 g garnish slice, juice fl oz, or "topping from" row unless the user said slice/oz of that item.`

export const PICK_PREFIX = '{"pick":'

export function extractUserPrompt(meal: string): string {
  return `Extract foods and household units from this meal. Do not convert units or invent calories.\n${meal}`
}

export function pickUserPrompt(opts: {
  meal: string
  item: ExtractedItem
  lines: string[]
}): string {
  const brand = opts.item.brand ? ` brand ${opts.item.brand}` : ''
  const portion = [opts.item.quantity, opts.item.unit].filter(Boolean).join(' ')
  return [
    `Meal: ${opts.meal}`,
    `Item: ${opts.item.query}${brand}${portion ? `, about ${portion}` : ''}`,
    'Database hits (USDA reference + convert_portion for this item):',
    ...opts.lines,
    'None. no match',
    'Pick the closest nutrition reference letter. Keep the user name, brand, and portion. Do not output grams or calories.',
  ].join('\n')
}

/** LFM ChatML without Jinja — transformers.js cannot parse `{% generation %}`. */
export function formatChatPrompt(
  messages: ChatMessage[],
  addGenerationPrompt = true,
  assistantPrefix = '',
): string {
  const parts = ['<|startoftext|>']
  for (const message of messages) {
    const body = Array.isArray(message.content)
      ? message.content.map((p) => (p.type === 'image' ? '<image>' : (p.text ?? ''))).join('')
      : message.content
    parts.push(`<|im_start|>${message.role}\n${body}<|im_end|>\n`)
  }
  if (addGenerationPrompt) parts.push(`<|im_start|>assistant\n${assistantPrefix}`)
  return parts.join('')
}

export function stripSpecialTokens(text: string): string {
  return text.replace(/<\|[^>]+?\|>/g, '').trim()
}

function jsonBlobs(text: string): string[] {
  const trimmed = stripSpecialTokens(text)
  const blobs: string[] = []
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) blobs.push(fenced[1])
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) blobs.push(trimmed.slice(firstBrace, lastBrace + 1))
  const firstArr = trimmed.indexOf('[')
  const lastArr = trimmed.lastIndexOf(']')
  if (firstArr >= 0 && lastArr > firstArr) blobs.push(trimmed.slice(firstArr, lastArr + 1))
  blobs.push(trimmed)
  return blobs
}

function parseJsonLoose(text: string): unknown | null {
  for (const blob of jsonBlobs(text)) {
    try {
      return JSON.parse(blob)
    } catch {
      const closed = blob.replace(/,(\s*[}\]])/g, '$1')
      try {
        return JSON.parse(closed)
      } catch {
        // try next
      }
    }
  }
  return null
}

function num(value: unknown, fallback = 1): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function str(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'none') return null
  return s
}

export function parseExtractedFoods(text: string, fallbackText?: string): ExtractedItem[] {
  const attempts = [text, `${EXTRACT_PREFIX}${text}`]
  for (const attempt of attempts) {
    const parsed = parseJsonLoose(attempt)
    const rows: ExtractedItem[] = []
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? ((parsed as { foods?: unknown[]; items?: unknown[] }).foods ??
          (parsed as { items?: unknown[] }).items ??
          [])
        : []
    for (const row of list) {
      if (typeof row === 'string') {
        if (row.trim()) rows.push({ raw: text, query: row.trim(), quantity: 1, unit: null })
        continue
      }
      if (!row || typeof row !== 'object') continue
      const r = row as { name?: string; query?: string; food?: string; brand?: string; quantity?: number; unit?: string }
      const query = str(r.query ?? r.name ?? r.food)
      if (!query) continue
      rows.push({
        raw: text,
        query,
        brand: str(r.brand),
        quantity: num(r.quantity),
        unit: str(r.unit),
      })
    }
    if (rows.length) return expandCombined(rows)
  }

  const listed = parseNumberedFoods(text)
  if (listed.length) return listed
  if (fallbackText) return extractFoods(fallbackText)
  return extractFoods(stripSpecialTokens(text))
}

function expandCombined(items: ExtractedItem[]): ExtractedItem[] {
  if (items.length !== 1) return items
  const only = items[0]
  if (!/\b(?:and|with|,)\b/i.test(only.query)) return items
  const split = extractFoods(only.query)
  if (split.length < 2) return items
  return split.map((item) => ({
    ...item,
    brand: only.brand,
    quantity: item.quantity * only.quantity,
    unit: item.unit ?? only.unit,
    raw: only.raw,
  }))
}

const NON_FOOD =
  /\b(background|plate|platter|cutting board|table|tableware|utensil|fork|knife|spoon|napkin|flower|camera|hand|person|surface|wooden|maker|appliance|board)\b/i

function parseNumberedFoods(text: string): ExtractedItem[] {
  const items: ExtractedItem[] = []
  const re = /(?:^|\n)\s*(?:\d+[.)]\s+|[-*•]\s+)([^\n]+)/g
  let m: RegExpExecArray | null
  const cleaned = stripSpecialTokens(text)
  while ((m = re.exec(cleaned))) {
    const name = m[1]
      .replace(/[*_]/g, '')
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .trim()
    if (!name || name.length > 48 || name.split(/\s+/).length > 8 || NON_FOOD.test(name)) continue
    const extracted = extractFoods(name)[0]
    items.push({
      raw: text,
      query: extracted?.query || name,
      quantity: extracted?.quantity ?? 1,
      unit: extracted?.unit ?? null,
    })
  }
  return items
}

export function parsePick(text: string, hitCount: number): PickDecision {
  const labeled = text.trim().startsWith('{') ? text : `${PICK_PREFIX}${text}`
  const parsed = parseJsonLoose(labeled)
  const fallback: PickDecision = { index: null, name: null, brand: null, unit: null, quantity: 1 }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const letter = stripSpecialTokens(text).trim().match(/^([A-Ha-h]|none|null)$/i)
    if (letter) return { ...fallback, index: letterIndex(letter[1], hitCount) }
    return fallback
  }
  const obj = parsed as {
    pick?: unknown
    id?: unknown
    name?: unknown
    brand?: unknown
    unit?: unknown
    quantity?: unknown
  }
  return {
    index: letterIndex(obj.pick ?? obj.id, hitCount),
    name: str(obj.name),
    brand: str(obj.brand),
    unit: str(obj.unit),
    quantity: num(obj.quantity),
  }
}

function letterIndex(value: unknown, hitCount: number): number | null {
  if (value == null) return null
  if (typeof value === 'number' && value >= 0 && value < hitCount) return value
  const s = String(value).trim()
  if (!s || /^(none|null|no)$/i.test(s)) return null
  if (/^\d+$/.test(s)) {
    const n = Number(s)
    if (n >= 0 && n < hitCount) return n
    if (n >= 1 && n <= hitCount) return n - 1
    return null
  }
  const ch = s.toUpperCase()
  if (ch.length === 1 && ch >= 'A' && ch <= 'Z') {
    const i = ch.charCodeAt(0) - 65
    return i >= 0 && i < hitCount ? i : null
  }
  return null
}
