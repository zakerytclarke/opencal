import type { Activity, Profile, Sex, Units } from '../types'

const ACTIVITY_FACTOR: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very: 1.9,
}

/** Mifflin-St Jeor BMR. */
export function bmrKcal(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  return sex === 'male' ? base + 5 : base - 161
}

export function tdeeKcal(profile: Pick<Profile, 'sex' | 'weightKg' | 'heightCm' | 'age' | 'activity'>): number {
  return bmrKcal(profile.sex, profile.weightKg, profile.heightCm, profile.age) * ACTIVITY_FACTOR[profile.activity]
}

export function buildGoals(
  input: Omit<Profile, 'calorieGoal' | 'proteinGoal' | 'carbsGoal' | 'fatGoal' | 'createdAt'> & {
    createdAt?: string
  },
): Profile {
  const tdee = tdeeKcal(input)
  const dailyDelta = (input.weeklyKg * 7700) / 7
  const floor = input.sex === 'female' ? 1200 : 1500
  const calorieGoal = Math.max(floor, Math.round(tdee - dailyDelta))
  const proteinGoal = Math.round(Math.max(1.6 * input.weightKg, calorieGoal * 0.25 / 4))
  const fatGoal = Math.round((calorieGoal * 0.3) / 9)
  const carbsGoal = Math.max(0, Math.round((calorieGoal - proteinGoal * 4 - fatGoal * 9) / 4))
  return {
    ...input,
    calorieGoal,
    proteinGoal,
    carbsGoal,
    fatGoal,
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
}

export function kgToLb(kg: number): number {
  return kg / 0.45359237
}

export function lbToKg(lb: number): number {
  return lb * 0.45359237
}

export function cmToFtIn(cm: number): { ft: number; inch: number } {
  const total = cm / 2.54
  const ft = Math.floor(total / 12)
  const inch = Math.round(total - ft * 12)
  if (inch === 12) return { ft: ft + 1, inch: 0 }
  return { ft, inch }
}

export function ftInToCm(ft: number, inch: number): number {
  return (ft * 12 + inch) * 2.54
}

export function weeksToGoal(currentKg: number, goalKg: number, weeklyKg: number): number | null {
  if (weeklyKg === 0) return null
  const delta = currentKg - goalKg
  if (Math.abs(delta) < 0.05) return 0
  if (Math.sign(delta) !== Math.sign(weeklyKg) && weeklyKg !== 0) {
    // weeklyKg is signed: positive means lose
  }
  const pace = Math.abs(weeklyKg)
  if (pace === 0) return null
  return Math.max(1, Math.round(Math.abs(delta) / pace))
}

export function goalDate(weeks: number | null): string | null {
  if (weeks == null) return null
  const d = new Date()
  d.setDate(d.getDate() + weeks * 7)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Mid-healthy BMI (WHO healthy range is 18.5–24.9). */
export const HEALTHY_BMI = 22
export const HEALTHY_BMI_MIN = 18.5
export const HEALTHY_BMI_MAX = 24.9
export const UNDERWEIGHT_TARGET_BMI = 20

/** CDC adult averages, rounded: women 5′4″, men 5′9″. */
export const TYPICAL_HEIGHT_CM: Record<Sex, number> = { female: 163, male: 175 }

/**
 * Typical current BMI. Men sit a bit higher, and both start just into
 * overweight so the healthy-BMI goal is a modest cut rather than a guess.
 */
export const TYPICAL_BMI: Record<Sex, number> = { female: 25.5, male: 27 }

export type OnboardingDraft = {
  units: Units
  sex: Sex
  age: string
  ft: string
  inch: string
  heightCm: string
  weight: string
  goal: string
  paceLb: number
  activity: Activity
}

export type OnboardingTouched = {
  height: boolean
  weight: boolean
  goal: boolean
  pace: boolean
}

export const UNTOUCHED: OnboardingTouched = {
  height: false,
  weight: false,
  goal: false,
  pace: false,
}

export function parseDraftNumber(s: string): number {
  return Number(String(s).replace(/[^\d.]/g, '')) || 0
}

export function bmiOf(weightKg: number, heightCm: number): number {
  const m = heightCm / 100
  if (m <= 0 || weightKg <= 0) return 0
  return weightKg / (m * m)
}

export function weightKgForBmi(bmi: number, heightCm: number): number {
  const m = Math.max(heightCm, 1) / 100
  return bmi * m * m
}

export function typicalHeightCm(sex: Sex): number {
  return TYPICAL_HEIGHT_CM[sex]
}

/** Typical starting weight: taller and male → heavier; age nudges BMI after 30. */
export function predictedWeightKg(sex: Sex, heightCm: number, age: number): number {
  const years = Number.isFinite(age) && age > 0 ? age : 28
  const ageAdj = Math.max(-1.2, Math.min(2.2, (years - 30) * 0.07))
  return weightKgForBmi(TYPICAL_BMI[sex] + ageAdj, Math.max(heightCm, 1))
}

/**
 * Goal weight at a healthy BMI for this height.
 * Already-healthy bodies keep their current weight; underweight aims at BMI 20.
 */
export function predictedGoalKg(currentKg: number, heightCm: number): number {
  const h = Math.max(heightCm, 1)
  if (currentKg <= 0) return weightKgForBmi(HEALTHY_BMI, h)
  const bmi = bmiOf(currentKg, h)
  if (bmi < HEALTHY_BMI_MIN) return weightKgForBmi(UNDERWEIGHT_TARGET_BMI, h)
  if (bmi <= HEALTHY_BMI_MAX) return currentKg
  return weightKgForBmi(HEALTHY_BMI, h)
}

export function predictedPaceLb(currentKg: number, goalKg: number): number {
  const deltaLb = Math.abs(kgToLb(currentKg - goalKg))
  if (deltaLb < 10) return 0.5
  return 1
}

export function formatWeightInput(kg: number, units: Units): string {
  if (units === 'imperial') return String(Math.round(kgToLb(kg)))
  const n = Math.round(kg * 10) / 10
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export function draftHeightCm(draft: OnboardingDraft): number {
  const cm =
    draft.units === 'imperial'
      ? ftInToCm(parseDraftNumber(draft.ft), parseDraftNumber(draft.inch))
      : parseDraftNumber(draft.heightCm)
  return cm >= 90 ? cm : typicalHeightCm(draft.sex)
}

export function draftWeightKg(draft: OnboardingDraft): number {
  const n = parseDraftNumber(draft.weight)
  return draft.units === 'imperial' ? lbToKg(n) : n
}

export function draftGoalKg(draft: OnboardingDraft): number {
  const n = parseDraftNumber(draft.goal)
  return draft.units === 'imperial' ? lbToKg(n) : n
}

function applyTypicalHeight(draft: OnboardingDraft): OnboardingDraft {
  const cm = typicalHeightCm(draft.sex)
  const { ft, inch } = cmToFtIn(cm)
  return {
    ...draft,
    ft: String(ft),
    inch: String(inch),
    heightCm: String(Math.round(cm)),
  }
}

/** Fill predicted height/weight/goal/pace unless the user already edited them. */
export function applyOnboardingSuggestions(draft: OnboardingDraft, touched: OnboardingTouched): OnboardingDraft {
  let next = draft
  if (!touched.height) next = applyTypicalHeight(next)
  const heightCm = draftHeightCm(next)
  const age = parseDraftNumber(next.age) || 28
  if (!touched.weight) {
    next = { ...next, weight: formatWeightInput(predictedWeightKg(next.sex, heightCm, age), next.units) }
  }
  const weightKg = draftWeightKg(next) || predictedWeightKg(next.sex, heightCm, age)
  if (!touched.goal) {
    next = { ...next, goal: formatWeightInput(predictedGoalKg(weightKg, heightCm), next.units) }
  }
  if (!touched.pace) {
    next = { ...next, paceLb: predictedPaceLb(weightKg, draftGoalKg(next) || predictedGoalKg(weightKg, heightCm)) }
  }
  return next
}

export function convertOnboardingUnits(draft: OnboardingDraft, units: Units): OnboardingDraft {
  if (draft.units === units) return draft
  const heightCm = draftHeightCm(draft)
  const { ft, inch } = cmToFtIn(heightCm)
  return {
    ...draft,
    units,
    ft: String(ft),
    inch: String(inch),
    heightCm: String(Math.round(heightCm)),
    weight: formatWeightInput(draftWeightKg(draft), units),
    goal: formatWeightInput(draftGoalKg(draft), units),
  }
}

export const initialOnboardingDraft = (): OnboardingDraft =>
  applyOnboardingSuggestions(
    {
      units: 'imperial',
      sex: 'female',
      age: '28',
      ft: '5',
      inch: '4',
      heightCm: '163',
      weight: '',
      goal: '',
      paceLb: 1,
      activity: 'light',
    },
    UNTOUCHED,
  )
