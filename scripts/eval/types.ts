export type EvalSplit = 'train' | 'test'

export type ExpectItem = {
  aliases: string[]
  query: string
  quantity: number
  unit: string | null
  foodId?: string
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
  named: boolean
  namedCount: number
  namedNeed: number
  kcalPred: number
  kcalGold: number
  kcalAbsErr: number
  kcalApe: number
  unmatched: number
  itemsPred: string[]
  itemsGold: string[]
  ms: number
  error?: string
}

export type MetricSummary = {
  n: number
  namedAcc: number
  unmatchedRate: number
  kcalMae: number
  kcalMdae: number
  kcalMape: number
  within20: number
  within50: number
  kcalMaeNamed: number | null
  meanMs: number
}
