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

export const EXTRACT_SYSTEM = `Role & Task
You are a precise nutrition analysis assistant. Analyze the provided image or text description of food and extract an itemized list of ingredients mapped to USDA FoodData Central standards.

Output Format
Return only a valid JSON array of objects without markdown headers or conversational text. Use the following schema for each ingredient:
[
{
"grouped_food_name": "String (the dish, e.g., Hot Dog, Breakfast Burrito)",
"ingredient_name": "String (USDA reference name, e.g., Egg, whole, cooked, scrambled)",
"estimated_gram_weight": "Number (integer, grams of edible food — a real adult serving, not a speck)",
"emoji": "String (one emoji — the same one for every row of the dish)"
}
]

Instructions & Constraints

Input Handling: Process input provided as an image, a text description (e.g., "I ate avocado toast with an apple", "I ate a hot dog with mustard and a bun", "I ate a breakfast burrito with eggs, hashbrowns, and bacon"), or both.

One shared group name per dish: Every row that is a component of the same meal or dish MUST reuse the exact same grouped_food_name string (same casing, same words). A bun + frank + mustard = one "Hot Dog". An egg + cheese + bacon inside a burrito = one "Breakfast Burrito". A slice of bread topped with mashed avocado = one "Avocado Toast" (rows for bread and avocado, both labelled "Avocado Toast"). Bread with turkey + cheese = one "Turkey Sandwich". Bread with peanut butter (+ jelly) = one "Peanut Butter Jelly Sandwich". Only use a different grouped_food_name for a genuinely separate item on the plate (a side salad next to the sandwich, a beverage, a dessert).

Composition rule (base + topping = one dish): when a slice of bread, wrap, pita, or bun carries or is filled with a topping, the combination is ONE dish named after the topping — the base is a row inside that dish, NOT its own item. Never emit "Bread" and "Avocado" (or "Bread" and "Peanut Butter", "Bread" and "Hummus", etc.) as separate grouped_food_names when they are being eaten together; emit both as rows under "Avocado Toast" / "Peanut Butter Sandwich" / "Hummus Wrap". A standalone fruit or drink on the plate that is not part of the dish gets its own grouped_food_name (the fruit itself — "Apple", "Orange").

USDA Standard Mapping: Set ingredient_name to the closest standard entry in the USDA FoodData Central database for that specific component, not for the dish.

Weight Estimation (grams of edible food, realistic adult serving): A main or topping ingredient on a dish must be at least 20 g — a whole avocado half mashed onto toast is 30–60 g, never 5–15 g. Only true table condiments (a swipe of ketchup/mustard/mayo/butter) drop to 5–15 g. Use these anchors unless visual cues clearly say otherwise:
- whole medium fruit 100–120 g; small fruit 50–80 g
- one egg 45–55 g; scrambled/boiled egg 50–70 g
- one slice of bread 25–35 g; a hot-dog bun 45–65 g
- one frankfurter or hot dog 50–70 g
- a table scoop of condiment (mustard, ketchup, mayo, butter) 5–15 g
- mashed or sliced avocado on a single toast serving 30–60 g; one whole avocado 150–200 g
- a table serving of rice or pasta 150–250 g; one slice of pizza 110–160 g
- one scoop of ice cream 70–90 g; one scoop of peanut or almond butter 14–20 g
- one typical protein portion (chicken fillet, steak, fish fillet) 120–200 g`

export const EXTRACT_PREFIX = '['

export const EXTRACT_USER_TAIL =
  'Return the JSON array only. Each item has grouped_food_name, ingredient_name, estimated_gram_weight, and emoji.'

export const PHOTO_EXTRACT_SYSTEM = EXTRACT_SYSTEM
export const PHOTO_EXTRACT_PREFIX = EXTRACT_PREFIX
export const PHOTO_EXTRACT_USER = EXTRACT_USER_TAIL

export const PHOTO_PORTION_SYSTEM = `You match each visible food to a USDA catalog record, then say how many of that record's household serving are on the plate.
The host already named the foods and looked up food-database rows. Each line is one record: food name, household serving, grams.
Reply with JSON only:
{"foods":[{"name":"apple","brand":null,"quantity":1,"unit":"medium"},{"name":"olive oil","brand":null,"quantity":1,"unit":"tbsp"},{"name":"rice","brand":null,"quantity":0.5,"unit":"cup"}]}
Rules:
- One object per visible food. name identifies the same food as a catalog record. brand is a package or logo, else null.
- Copy the household unit from the catalog record you matched (medium, large, tbsp, cup, slice). quantity is how many of that serving you see (1, 0.5, 2).
- A whole fruit or egg uses that record's medium/large serving, never 7 g. Oil uses 1 tsp or 1 tbsp from the oil record.
- Only use grams if nothing on the list is a household serving for that pile.
- Do not pick a letter. Do not invent calories. The host finds the same catalog record from your name, quantity, and unit, then convert_portion computes grams and macros.
- Skip plates and utensils.`

export const PHOTO_PORTION_USER_TAIL =
  'Look at the photo. For every visible food match a catalog record and emit name, brand, quantity, and that record\'s household unit. Do not pick a letter or invent calories. JSON only.'

export const TEXT_PORTION_SYSTEM = `You match each food in the meal to a USDA catalog record, then say how many of that record's household serving the user ate.
The host already named the foods and looked up food-database rows. Each line is one record: food name, household serving, grams.
You also have the original meal — use it for quantity and unit (2 eggs, half a cup, a tablespoon).
Reply with JSON only:
{"foods":[{"name":"eggs","brand":null,"quantity":2,"unit":"large"},{"name":"banana","brand":null,"quantity":1,"unit":"medium"},{"name":"peanut butter","brand":null,"quantity":1,"unit":"tbsp"}]}
Rules:
- One object per food the user named. name identifies the same food as a catalog record. brand is only if they named one, else null.
- Copy the household unit from the catalog record you matched (medium, large, tbsp, cup, slice) unless the user said a different unit (oz, g, fl oz, cup). quantity is how many they ate (2, 0.5, 1).
- If they did not say small/medium/large, do not invent a size. Bare eggs use the catalog's large serving. A muffin/cookie/bagel with no size word uses that record's muffin/cookie/bagel unit.
- Do not pick a letter. Do not invent calories. The host finds the same catalog record from your name, quantity, and unit, then convert_portion computes grams and macros.
- Only foods the user named. Never copy foods from examples.`

export const TEXT_PORTION_USER_TAIL =
  'Read the meal. For every food match a catalog record and emit name, brand, quantity, and unit. Do not pick a letter or invent calories. JSON only.'

export const CATALOG_USER_HEADER =
  'Food database records (match one per food; copy its household unit; host will convert_portion):'

export const PICK_SYSTEM = `You pick a local USDA nutrition reference row.
Calories and grams are already computed by convert_portion from USDA per-100 g values and household weights. Do not invent numbers or change the portion.
You are given the user's meal, this item, and lettered hits. Each hit includes convert_portion for this item's quantity and unit.
Reply with JSON only. Same food:
{"pick":"A","name":"Oatmeal, cooked"}
No matching row:
{"pick":null,"name":null}
Rules:
- pick is the letter of the same food, or null if none of the hits is that food.
- name is the chosen row's name, or null when pick is null. Do not output quantity, unit, grams, or calories.
- Prefer everyday cooked/raw foods over baby food, ingredients, or odd variants.
- Prefer a typical whole-food serving (medium fruit, large egg, slice of pizza) over a 2–20 g garnish slice, juice fl oz, or "topping from" row unless the user said slice/oz of that item.
- Near-misses are not a match: banana chips are not a banana; a pepper is not a banana pepper; almond milk is not dairy milk. Pick null rather than the wrong row.
- Do not invent a USDA row.`

export const PICK_PREFIX = '{"pick":'
export const PICK_NONE_LINE = 'N. None. no matching USDA row'
export const PICK_USER_TAIL =
  'Pick the letter of the same food. If none of the hits is that food, pick null. Do not invent a USDA row. Do not output grams or calories.'

export function photoPortionUser(names: string[], lines: string[]): string {
  const visible = names.filter(Boolean).join(', ') || 'see photo'
  return [
    `Visible foods: ${visible}`,
    CATALOG_USER_HEADER,
    ...(lines.length ? lines : ['(no USDA rows)']),
    PHOTO_PORTION_USER_TAIL,
  ].join('\n')
}

export function textPortionUser(meal: string, names: string[], lines: string[]): string {
  const named = names.filter(Boolean).join(', ') || 'see meal'
  return [
    `Meal:\n${meal}`,
    `Named foods: ${named}`,
    CATALOG_USER_HEADER,
    ...(lines.length ? lines : ['(no USDA rows)']),
    TEXT_PORTION_USER_TAIL,
  ].join('\n')
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
    PICK_NONE_LINE,
    PICK_USER_TAIL,
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
  const firstArr = trimmed.indexOf('[')
  const lastArr = trimmed.lastIndexOf(']')
  const isTopArray = trimmed.trimStart().startsWith('[') && firstArr >= 0 && lastArr > firstArr
  if (isTopArray) blobs.push(trimmed.slice(firstArr, lastArr + 1))
  if (firstBrace >= 0 && lastBrace > firstBrace) blobs.push(trimmed.slice(firstBrace, lastBrace + 1))
  if (!isTopArray && firstArr >= 0 && lastArr > firstArr) blobs.push(trimmed.slice(firstArr, lastArr + 1))
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

function positiveNum(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
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
      const r = row as {
        name?: string
        query?: string
        food?: string
        groupedFoodName?: string
        grouped_food_name?: string
        usdaName?: string
        ingredient_name?: string
        grams?: number
        estimated_gram_weight?: number
        servingCount?: number
        quantity?: number
        serving_quantity?: number
        unit?: string
        brand?: string
        emoji?: string
      }
      const query = str(r.query ?? r.grouped_food_name ?? r.groupedFoodName ?? r.name ?? r.food)
      if (!query) continue
      const usda = str(r.ingredient_name ?? r.usdaName) ?? undefined
      const grams = positiveNum(r.estimated_gram_weight ?? r.grams)
      const quantity = positiveNum(r.quantity ?? r.serving_quantity)
      const serving = positiveNum(r.servingCount ?? r.serving_quantity ?? r.quantity)
      rows.push({
        raw: text,
        query,
        brand: str(r.brand),
        quantity: quantity ?? 1,
        unit: str(r.unit),
        usdaName: usda,
        grams: grams ?? undefined,
        servingCount: serving ?? undefined,
        emoji: str(r.emoji) ?? undefined,
      })
    }
    if (rows.length) return expandCombined(rows)
  }

  const listed = parseNumberedFoods(text)
  if (listed.length) return listed
  if (fallbackText) return extractFoods(fallbackText)
  return extractFoods(stripSpecialTokens(text))
}

export function parsePhotoExtraction(text: string): { mealName: string | null; items: ExtractedItem[] } {
  const parsed = parseJsonLoose(text)
  const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  const list = obj ? (Array.isArray(obj.foods) ? obj.foods : Array.isArray(obj.items) ? obj.items : null) : null
  const rawName = obj ? obj.name ?? obj.meal ?? obj.title : null
  const mealName = typeof rawName === 'string' ? (str(rawName) ?? null) : null
  // Trust an explicit foods/items list on a JSON object — including an empty
  // one — so a bare `{"name":"…","foods":[]}` never falls back to the regex
  // extractor and picks up the meal-name string as a food.
  const items = list != null ? (list.length ? parseExtractedFoods(text) : []) : parseExtractedFoods(text)
  return { mealName, items }
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
  if (!s || /^(none|null|no|n)$/i.test(s)) return null
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
