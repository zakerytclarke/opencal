export type Sex = 'female' | 'male'
export type Units = 'imperial' | 'metric'
export type Activity =
  | 'sedentary'
  | 'light'
  | 'moderate'
  | 'active'
  | 'very'

export type Profile = {
  sex: Sex
  age: number
  heightCm: number
  weightKg: number
  goalWeightKg: number
  weeklyKg: number
  activity: Activity
  units: Units
  calorieGoal: number
  proteinGoal: number
  carbsGoal: number
  fatGoal: number
  createdAt: string
}

export type Food = {
  id: string
  name: string
  emoji: string
  category: string
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  sugar: number
  serveG: number
  serveLabel: string
  source: string
  aliases: string[]
}

export type FoodFile = {
  version: number
  sources: string[]
  count: number
  foods: Food[]
}

export type DebugPath = 'vlm' | 'vlm-empty' | 'extractor' | 'quick' | 'error-fallback'

export type LogEntry = {
  id: string
  date: string
  foodId: string
  name: string
  brand?: string | null
  emoji: string
  grams: number
  servings: number
  serveLabel: string
  kcal: number
  protein: number
  carbs: number
  fat: number
  source: 'search' | 'voice' | 'photo' | 'quick' | 'sentence'
  loggedAt: string
  batchId?: string
  debugInput?: string
  debugRaw?: string
  debugPath?: DebugPath
  debugError?: string
  debugMs?: number
}

export type Diary = Record<string, LogEntry[]>

export type ExtractedItem = {
  raw: string
  query: string
  brand?: string | null
  quantity: number
  unit: string | null
  caloriesHint?: number
}

export type LogJobStatus = 'queued' | 'extracting' | 'matching' | 'done' | 'error'

export type PendingFood = {
  id: string
  query: string
  brand?: string | null
  quantity: number
  unit: string | null
  status: 'waiting' | 'matching' | 'done'
}

export type LogJob = {
  id: string
  date: string
  source: LogEntry['source']
  input: string
  previewUrl?: string
  status: LogJobStatus
  step: string
  pct: number
  pending: PendingFood[]
  error?: string
}
