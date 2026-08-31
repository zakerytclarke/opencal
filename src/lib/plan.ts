import type { Activity, Profile, Sex } from '../types'

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
