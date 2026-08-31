import type { CaseScore, MealNutrition, MetricSummary, NutrientSummary } from './types.ts'

const STOP = new Set([
  'a', 'an', 'and', 'or', 'with', 'the', 'of', 'in', 'on', 'for', 'from',
  'raw', 'cooked', 'large', 'medium', 'small', 'whole', 'plain', 'grade', 'extra', 'only',
])

/** Meals this small make % error explode; still included in MAE / WAPE. */
export const MEAL_KCAL = 50

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function stem(token: string): string {
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`
  if (token.endsWith('s') && token.length > 3 && !token.endsWith('ss')) return `${token.slice(0, -1)}`
  return token
}

function tokensOf(s: string): string[] {
  return normalizeName(s)
    .split(' ')
    .map(stem)
    .filter((t) => t && !STOP.has(t))
}

export function aliasHit(predicted: string[], aliases: string[]): boolean {
  if (!predicted.length || !aliases.length) return false
  return aliases.some((alias) => {
    const aToks = tokensOf(alias)
    if (!aToks.length) return false
    return predicted.some((pred) => {
      if (aToks.length === 1) {
        const first = tokensOf(pred.split(',')[0] ?? pred)
        const last = first[first.length - 1]
        return last === aToks[0] || first.join(' ') === aToks[0] || first.join(' ').endsWith(` ${aToks[0]}`)
      }
      const all = tokensOf(pred)
      return aToks.every((t) => all.includes(t))
    })
  })
}

export function ape(pred: number, gold: number): number {
  const denom = Math.max(Math.abs(gold), 1)
  return Math.abs(pred - gold) / denom
}

export function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function wape(absErrs: number[], golds: number[]): number {
  const num = absErrs.reduce((a, x) => a + x, 0)
  const den = golds.reduce((a, x) => a + Math.abs(x), 0)
  return num / Math.max(den, 1)
}

function emptyNutrient(): NutrientSummary {
  return { mae: 0, mdae: 0, mape: 0, wape: 0, mdape: 0, within20: 0, within50: 0 }
}

function summarizeNutrient(absErrs: number[], apes: number[], golds: number[]): NutrientSummary {
  const n = absErrs.length
  if (!n) return emptyNutrient()
  return {
    mae: absErrs.reduce((a, x) => a + x, 0) / n,
    mdae: median(absErrs),
    mape: apes.reduce((a, x) => a + x, 0) / n,
    wape: wape(absErrs, golds),
    mdape: median(apes),
    within20: apes.filter((x) => x <= 0.2).length / n,
    within50: apes.filter((x) => x <= 0.5).length / n,
  }
}

export function scoreCase(input: {
  id: string
  split: CaseScore['split']
  modality: CaseScore['modality']
  source?: string
  predictedNames: string[]
  goldAliases: string[][]
  loose?: boolean
  kcalPred: number
  kcalGold: number
  proteinPred?: number
  proteinGold?: number
  carbsPred?: number
  carbsGold?: number
  fatPred?: number
  fatGold?: number
  unmatched: number
  ms: number
  error?: string
}): CaseScore {
  const hits = input.goldAliases.filter((aliases) => aliasHit(input.predictedNames, aliases))
  const named =
    input.loose && input.goldAliases.length
      ? hits.length > 0
      : hits.length === input.goldAliases.length && input.goldAliases.length > 0
  const proteinPred = input.proteinPred ?? 0
  const proteinGold = input.proteinGold ?? 0
  const carbsPred = input.carbsPred ?? 0
  const carbsGold = input.carbsGold ?? 0
  const fatPred = input.fatPred ?? 0
  const fatGold = input.fatGold ?? 0
  return {
    id: input.id,
    split: input.split,
    modality: input.modality,
    source: input.source,
    loose: input.loose,
    named,
    namedCount: hits.length,
    namedNeed: input.goldAliases.length,
    kcalPred: input.kcalPred,
    kcalGold: input.kcalGold,
    kcalAbsErr: Math.abs(input.kcalPred - input.kcalGold),
    kcalApe: ape(input.kcalPred, input.kcalGold),
    proteinPred,
    proteinGold,
    proteinAbsErr: Math.abs(proteinPred - proteinGold),
    proteinApe: ape(proteinPred, proteinGold),
    carbsPred,
    carbsGold,
    carbsAbsErr: Math.abs(carbsPred - carbsGold),
    carbsApe: ape(carbsPred, carbsGold),
    fatPred,
    fatGold,
    fatAbsErr: Math.abs(fatPred - fatGold),
    fatApe: ape(fatPred, fatGold),
    unmatched: input.unmatched,
    itemsPred: input.predictedNames,
    itemsGold: input.goldAliases.map((a) => a[0] ?? ''),
    ms: input.ms,
    error: input.error,
  }
}

export function summarize(scores: CaseScore[]): MetricSummary {
  const n = scores.length
  const empty: MetricSummary = {
    n: 0,
    namedAcc: 0,
    unmatchedRate: 0,
    kcalMae: 0,
    kcalMdae: 0,
    kcalMape: 0,
    kcalWape: 0,
    kcalMdape: 0,
    within20: 0,
    within50: 0,
    within20Meal: 0,
    within50Meal: 0,
    mealN: 0,
    kcalMaeNamed: null,
    protein: emptyNutrient(),
    carbs: emptyNutrient(),
    fat: emptyNutrient(),
    meanMs: 0,
  }
  if (!n) return empty
  const named = scores.filter((s) => s.named)
  const kcalMaeNamed = named.length ? named.reduce((a, s) => a + s.kcalAbsErr, 0) / named.length : null
  const meals = scores.filter((s) => s.kcalGold >= MEAL_KCAL)
  const kcal = summarizeNutrient(
    scores.map((s) => s.kcalAbsErr),
    scores.map((s) => s.kcalApe),
    scores.map((s) => s.kcalGold),
  )
  const mealRel = meals.length
    ? summarizeNutrient(
        meals.map((s) => s.kcalAbsErr),
        meals.map((s) => s.kcalApe),
        meals.map((s) => s.kcalGold),
      )
    : emptyNutrient()
  return {
    n,
    namedAcc: scores.filter((s) => s.named).length / n,
    unmatchedRate: scores.filter((s) => s.unmatched > 0 && s.kcalPred === 0).length / n,
    kcalMae: kcal.mae,
    kcalMdae: kcal.mdae,
    kcalMape: kcal.mape,
    kcalWape: kcal.wape,
    kcalMdape: kcal.mdape,
    within20: kcal.within20,
    within50: kcal.within50,
    within20Meal: mealRel.within20,
    within50Meal: mealRel.within50,
    mealN: meals.length,
    kcalMaeNamed,
    protein: summarizeNutrient(
      scores.map((s) => s.proteinAbsErr),
      scores.map((s) => s.proteinApe),
      scores.map((s) => s.proteinGold),
    ),
    carbs: summarizeNutrient(
      scores.map((s) => s.carbsAbsErr),
      scores.map((s) => s.carbsApe),
      scores.map((s) => s.carbsGold),
    ),
    fat: summarizeNutrient(
      scores.map((s) => s.fatAbsErr),
      scores.map((s) => s.fatApe),
      scores.map((s) => s.fatGold),
    ),
    meanMs: scores.reduce((a, s) => a + s.ms, 0) / n,
  }
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`
}

function nutrientLine(label: string, s: NutrientSummary, unit: string): string {
  return `- ${label} MAE: ${s.mae.toFixed(1)} ${unit} (median ${s.mdae.toFixed(1)}) · WAPE ${pct(s.wape)} · median rel. ${pct(s.mdape)}`
}

export function formatSummary(title: string, s: MetricSummary): string {
  const maeNamed = s.kcalMaeNamed == null ? 'n/a' : `${s.kcalMaeNamed.toFixed(1)} kcal`
  return [
    `### ${title} (n=${s.n})`,
    `- Calorie MAE: ${s.kcalMae.toFixed(1)} kcal (median ${s.kcalMdae.toFixed(1)})`,
    `- Calorie WAPE: ${pct(s.kcalWape)} of total gold kcal · median relative error ${pct(s.kcalMdape)}`,
    `- Within 20% / 50% of gold kcal: ${pct(s.within20)} / ${pct(s.within50)}`,
    `- Same, meals ≥${MEAL_KCAL} kcal (n=${s.mealN}): ${pct(s.within20Meal)} / ${pct(s.within50Meal)}`,
    nutrientLine('Protein', s.protein, 'g'),
    nutrientLine('Carbs', s.carbs, 'g'),
    nutrientLine('Fat', s.fat, 'g'),
    `- Food name accuracy: ${pct(s.namedAcc)} (secondary) · MAE when named: ${maeNamed}`,
    `- Empty/unmatched: ${pct(s.unmatchedRate)} · mean latency ${Math.round(s.meanMs)} ms`,
  ].join('\n')
}

export function nutritionFromEntries(
  entries: Array<{ kcal?: number; protein?: number; carbs?: number; fat?: number } | null>,
): MealNutrition {
  return entries.reduce(
    (sum, e) => ({
      kcal: sum.kcal + (e?.kcal ?? 0),
      protein: sum.protein + (e?.protein ?? 0),
      carbs: sum.carbs + (e?.carbs ?? 0),
      fat: sum.fat + (e?.fat ?? 0),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  )
}

export function predFields(n: MealNutrition) {
  return {
    kcalPred: n.kcal,
    proteinPred: n.protein,
    carbsPred: n.carbs,
    fatPred: n.fat,
  }
}

export function goldFields(n: MealNutrition) {
  return {
    kcalGold: n.kcal,
    proteinGold: n.protein,
    carbsGold: n.carbs,
    fatGold: n.fat,
  }
}
