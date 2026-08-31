import type { ExtractedItem, Food, LogEntry } from '../types'

/**
 * Host-side portion tools. The VLM names foods and household units;
 * these functions turn units into grams and USDA calories.
 *
 * Sources:
 * - Mass: NIST avoirdupois (1 oz = 28.349523125 g, 1 lb = 453.59237 g)
 * - Volume: FDA 21 CFR 101.9 nutrition labeling (1 cup = 240 mL, 1 tbsp = 15 mL, 1 tsp = 5 mL)
 * - US fluid ounce: NIST (29.5735295625 mL)
 * - Household grams: the USDA row's serveG / serveLabel (FNDDS, SR, Foundation, Branded)
 * - Named drink sizes: published cup volumes (grande = 16 fl oz), then USDA density
 * - Calories: always food.kcal * grams / 100 from that USDA row
 */

export type PortionMethod =
  | 'nist-mass'
  | 'usda-household'
  | 'fda-volume+usda-density'
  | 'fda-volume+water'
  | 'named-size+usda-density'
  | 'usda-whole-item'
  | 'usda-serving'

export type PortionResult = {
  grams: number
  kcal: number
  protein: number
  carbs: number
  fat: number
  method: PortionMethod
  detail: string
}

const UNIT_ALIAS: Record<string, string> = {
  gram: 'g',
  grams: 'g',
  kilogram: 'kg',
  kilograms: 'kg',
  ounce: 'oz',
  ounces: 'oz',
  pound: 'lb',
  pounds: 'lb',
  lbs: 'lb',
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
  cups: 'cup',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  slices: 'slice',
  pieces: 'piece',
  items: 'item',
  servings: 'serving',
  bars: 'bar',
  cans: 'can',
  bottles: 'bottle',
  bowls: 'bowl',
  handfuls: 'handful',
  scoops: 'scoop',
  glasses: 'glass',
  plates: 'plate',
  sandwiches: 'sandwich',
  tacos: 'taco',
  burritos: 'burrito',
  wraps: 'wrap',
  eggs: 'egg',
  muffins: 'muffin',
  cookies: 'cookie',
  bagels: 'bagel',
  nuggets: 'nugget',
  patties: 'patty',
  containers: 'container',
  pouches: 'pouch',
}

/** NIST Handbook 44 avoirdupois / SI. */
const MASS_G: Record<string, number> = {
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
}

/** FDA 21 CFR 101.9(b) labeling volumes, plus NIST fluid ounce. */
const VOLUME_ML: Record<string, number> = {
  ml: 1,
  l: 1000,
  cup: 240,
  tbsp: 15,
  tsp: 5,
  'fl oz': 29.5735295625,
}

/** Published beverage cups, expressed as FDA/NIST milliliters. */
const NAMED_ML: Record<string, { ml: number; detail: string }> = {
  short: { ml: 8 * 29.5735295625, detail: 'short 8 fl oz' },
  tall: { ml: 12 * 29.5735295625, detail: 'tall 12 fl oz' },
  grande: { ml: 16 * 29.5735295625, detail: 'grande 16 fl oz' },
  venti: { ml: 20 * 29.5735295625, detail: 'hot venti 20 fl oz' },
}

const COUNT_UNITS = new Set([
  'slice',
  'piece',
  'item',
  'each',
  'serving',
  'bar',
  'can',
  'bottle',
  'bowl',
  'handful',
  'scoop',
  'glass',
  'plate',
  'sandwich',
  'taco',
  'burrito',
  'wrap',
  'egg',
  'muffin',
  'cookie',
  'bagel',
  'nugget',
  'patty',
  'container',
  'pouch',
])

const SIZE_FACTOR: Record<string, number> = {
  'extra small': 0.75,
  small: 0.75,
  medium: 1,
  large: 1.25,
  'extra large': 1.25,
}

export function canonUnit(unit: string | null | undefined): string {
  if (!unit) return ''
  const s = unit.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()
  if (s === 'fl oz' || s === 'floz' || s === 'fluid ounce' || s === 'fluid ounces') return 'fl oz'
  return UNIT_ALIAS[s] ?? s
}

function parseQty(raw: string): number | null {
  const t = raw.trim()
  if (/^\d+\/\d+$/.test(t)) {
    const [a, b] = t.split('/').map(Number)
    return b ? a / b : null
  }
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

export type Household = {
  qty: number
  unit: string
  ml: number | null
  massG: number | null
}

/** Read the USDA household serving printed on the row. */
export function parseHousehold(label: string): Household | null {
  const text = label.replace(/\s+/g, ' ').trim()
  const m = text.match(/^([\d.]+|\d+\/\d+)\s+(.+)$/i)
  if (!m) return null
  const qty = parseQty(m[1])
  if (qty == null) return null
  let rest = m[2].toLowerCase()
  if (rest.startsWith('fl oz') || rest.startsWith('fluid oz')) {
    return { qty, unit: 'fl oz', ml: qty * VOLUME_ML['fl oz'], massG: null }
  }
  const first = rest.split(/[,/]/)[0]?.trim() ?? rest
  const unit = canonUnit(first.split(/\s+/)[0] ?? first)
  if (!unit) return null
  if (unit in MASS_G) return { qty, unit, ml: null, massG: qty * MASS_G[unit] }
  if (unit in VOLUME_ML) return { qty, unit, ml: qty * VOLUME_ML[unit], massG: null }
  return { qty, unit, ml: null, massG: null }
}

export function scaleNutrition(
  food: Pick<Food, 'kcal' | 'protein' | 'carbs' | 'fat'>,
  grams: number,
): Pick<LogEntry, 'kcal' | 'protein' | 'carbs' | 'fat'> {
  const f = grams / 100
  return {
    kcal: Math.round(food.kcal * f),
    protein: Math.round(food.protein * f * 10) / 10,
    carbs: Math.round(food.carbs * f * 10) / 10,
    fat: Math.round(food.fat * f * 10) / 10,
  }
}

function pack(food: Food, grams: number, method: PortionMethod, detail: string): PortionResult {
  const g = Math.max(0.1, grams)
  return { grams: g, method, detail, ...scaleNutrition(food, g) }
}

function densityGPerMl(food: Food): number | null {
  const house = parseHousehold(food.serveLabel)
  if (house?.ml && house.ml > 0 && food.serveG > 0) return food.serveG / house.ml
  return null
}

function volumeGrams(food: Food, userMl: number, named: boolean): PortionResult {
  const density = densityGPerMl(food)
  const house = parseHousehold(food.serveLabel)
  if (density != null && house?.ml) {
    const grams = food.serveG * (userMl / house.ml)
    return pack(
      food,
      grams,
      named ? 'named-size+usda-density' : 'fda-volume+usda-density',
      `${userMl.toFixed(0)} mL × USDA ${food.serveLabel} (${food.serveG} g / ${house.ml.toFixed(0)} mL)`,
    )
  }
  return pack(
    food,
    userMl,
    'fda-volume+water',
    `${userMl.toFixed(0)} mL at 1 g/mL (no USDA volume serving on this row)`,
  )
}

function householdCount(food: Food, userQty: number, unit: string): number {
  const house = parseHousehold(food.serveLabel)
  if (house && (house.unit === unit || food.serveLabel.toLowerCase().includes(unit))) {
    return food.serveG * (userQty / house.qty)
  }
  return food.serveG * userQty
}

/**
 * convert_portion(food, quantity, unit)
 * Grams from NIST/FDA/USDA. Calories from USDA per 100 g only.
 */
export function convertPortion(
  food: Food,
  item: Pick<ExtractedItem, 'quantity' | 'unit'>,
  opts?: { wholeProduceGrams?: number },
): PortionResult {
  const qty = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1
  const unit = canonUnit(item.unit)
  const whole = opts?.wholeProduceGrams

  if (unit in MASS_G) {
    const grams = MASS_G[unit] * qty
    return pack(food, grams, 'nist-mass', `${qty} ${unit} × NIST ${MASS_G[unit]} g`)
  }

  if (unit in NAMED_ML) {
    return volumeGrams(food, NAMED_ML[unit].ml * qty, true)
  }

  if (unit in VOLUME_ML) {
    const house = parseHousehold(food.serveLabel)
    if (house?.unit === unit || (house?.ml && canonUnit(house.unit) === unit)) {
      return pack(
        food,
        food.serveG * (qty / house.qty),
        'usda-household',
        `${qty} ${unit} from USDA ${food.serveLabel} = ${food.serveG} g`,
      )
    }
    if (house?.ml) {
      return volumeGrams(food, VOLUME_ML[unit] * qty, false)
    }
    const label = food.serveLabel.toLowerCase()
    if (label.includes(unit) || (unit === 'cup' && /\bcups?\b/.test(label))) {
      return pack(food, food.serveG * qty, 'usda-household', `${qty} × USDA ${food.serveLabel}`)
    }
    return volumeGrams(food, VOLUME_ML[unit] * qty, false)
  }

  if (whole != null && (!unit || unit in SIZE_FACTOR || COUNT_UNITS.has(unit) || unit === 'whole')) {
    const factor = SIZE_FACTOR[unit] ?? 1
    return pack(
      food,
      whole * qty * factor,
      'usda-whole-item',
      `USDA medium-item weight ${whole} g (row is a ${food.serveG} g garnish slice)`,
    )
  }

  if (!unit) {
    return pack(food, food.serveG * qty, 'usda-serving', `${qty} × USDA ${food.serveLabel} (${food.serveG} g)`)
  }

  if (unit in SIZE_FACTOR) {
    const house = parseHousehold(food.serveLabel)
    const base =
      house && (house.unit === unit || /medium|small|large/.test(food.serveLabel.toLowerCase()))
        ? food.serveG * (qty / house.qty)
        : food.serveG * qty
    return pack(food, base * (SIZE_FACTOR[unit] ?? 1), 'usda-household', `${qty} ${unit} × USDA ${food.serveLabel}`)
  }

  if (COUNT_UNITS.has(unit)) {
    return pack(
      food,
      householdCount(food, qty, unit),
      'usda-household',
      `${qty} ${unit} × USDA ${food.serveLabel} (${food.serveG} g)`,
    )
  }

  const label = `${food.serveLabel} ${food.name}`.toLowerCase()
  if (label.includes(unit)) {
    return pack(food, food.serveG * qty, 'usda-household', `${qty} × USDA ${food.serveLabel}`)
  }

  return pack(food, food.serveG * qty, 'usda-serving', `${qty} ${unit} → USDA serving ${food.serveG} g`)
}

/** One line for the VLM: USDA reference plus convert_portion for this item. */
export function portionToolLine(food: Food, item: Pick<ExtractedItem, 'quantity' | 'unit'>, result: PortionResult): string {
  const qty = item.quantity
  const unit = item.unit ?? 'serving'
  const grams = Math.round(result.grams)
  return `USDA ${food.serveLabel} (${Math.round(food.serveG)} g) · convert_portion ${qty} ${unit} → ${grams} g, ${result.kcal} kcal`
}
