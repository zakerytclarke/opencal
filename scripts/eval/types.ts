export type EvalSplit = 'train' | 'test'

export type ExpectItem = {
  aliases: string[]
  query: string
  quantity: number
  unit: string | null
  foodId?: string
}

export type MealNutrition = {
  kcal: number
  protein: number
  carbs: number
  fat: number
}

export type TextCase = {
  id: string
  text: string
  expect: ExpectItem[]
}

export type ImageCase = {
  id: string
  path: string
  label: string
  source: string
  aliases: string[]
  query: string
  quantity: number
  unit: string | null
  foodId?: string
  kcalPer100g?: number
  loose?: boolean
  /** Multi-ingredient gold. When set, scoring uses these instead of the single query/aliases fields. */
  expect?: ExpectItem[]
  /** Lab / dataset dish totals. When set, calorie and macro gold uses these instead of USDA-mapped expect items. */
  nutrition?: MealNutrition
}

export type TextSplitFile = {
  seed: string
  note?: string
  train: TextCase[]
  test: TextCase[]
}

export type ImageSplitFile = {
  seed: string
  note?: string
  train: ImageCase[]
  test: ImageCase[]
}

export type CaseScore = {
  id: string
  split: EvalSplit
  modality: 'text' | 'image'
  source?: string
  loose?: boolean
  named: boolean
  namedCount: number
  namedNeed: number
  kcalPred: number
  kcalGold: number
  kcalAbsErr: number
  kcalApe: number
  proteinPred: number
  proteinGold: number
  proteinAbsErr: number
  proteinApe: number
  carbsPred: number
  carbsGold: number
  carbsAbsErr: number
  carbsApe: number
  fatPred: number
  fatGold: number
  fatAbsErr: number
  fatApe: number
  unmatched: number
  itemsPred: string[]
  itemsGold: string[]
  ms: number
  error?: string
}

export type NutrientSummary = {
  mae: number
  mdae: number
  mape: number
  wape: number
  mdape: number
  within20: number
  within50: number
}

export type MetricSummary = {
  n: number
  namedAcc: number
  unmatchedRate: number
  kcalMae: number
  kcalMdae: number
  kcalMape: number
  kcalWape: number
  kcalMdape: number
  within20: number
  within50: number
  within20Meal: number
  within50Meal: number
  mealN: number
  kcalMaeNamed: number | null
  protein: NutrientSummary
  carbs: NutrientSummary
  fat: NutrientSummary
  meanMs: number
}
