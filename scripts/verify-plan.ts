import {
  HEALTHY_BMI,
  UNTOUCHED,
  applyOnboardingSuggestions,
  bmiOf,
  convertOnboardingUnits,
  initialOnboardingDraft,
  kgToLb,
  lbToKg,
  predictedGoalKg,
  predictedWeightKg,
  typicalHeightCm,
  type OnboardingDraft,
  type OnboardingTouched,
} from '../src/lib/plan.ts'

const cases: { name: string; pass: boolean; got: string }[] = []

function check(name: string, pass: boolean, got: string) {
  cases.push({ name, pass, got })
}

function suggest(draft: OnboardingDraft, touched: OnboardingTouched = UNTOUCHED): OnboardingDraft {
  return applyOnboardingSuggestions(draft, touched)
}

const base = initialOnboardingDraft()
const male = suggest({ ...base, sex: 'male' }, UNTOUCHED)

check(
  'Female default height is 5 ft 4 in',
  base.ft === '5' && base.inch === '4',
  `${base.ft}'${base.inch}"`,
)
check(
  'Male default height is 5 ft 9 in',
  male.ft === '5' && male.inch === '9',
  `${male.ft}'${male.inch}"`,
)

const femaleLb = Number(base.weight)
const maleLb = Number(male.weight)
check(
  'Men start heavier than women',
  maleLb > femaleLb + 20,
  `female ${femaleLb} lb · male ${maleLb} lb`,
)

const femaleGoal = Number(base.goal)
const maleGoal = Number(male.goal)
check('Default plan is a cut toward healthy BMI', femaleGoal < femaleLb && maleGoal < maleLb, `f ${femaleLb}→${femaleGoal} · m ${maleLb}→${maleGoal}`)

const femaleGoalKg = lbToKg(femaleGoal)
const femaleHeight = typicalHeightCm('female')
const femaleGoalBmi = bmiOf(femaleGoalKg, femaleHeight)
check(
  'Female goal BMI is about 22',
  Math.abs(femaleGoalBmi - HEALTHY_BMI) < 0.35,
  femaleGoalBmi.toFixed(2),
)

const maleGoalKg = lbToKg(maleGoal)
const maleGoalBmi = bmiOf(maleGoalKg, typicalHeightCm('male'))
check(
  'Male goal BMI is about 22',
  Math.abs(maleGoalBmi - HEALTHY_BMI) < 0.35,
  maleGoalBmi.toFixed(2),
)

const sameHeightF = predictedWeightKg('female', 170, 30)
const sameHeightM = predictedWeightKg('male', 170, 30)
check(
  'At the same height, men are still heavier',
  sameHeightM > sameHeightF + 3,
  `F ${sameHeightF.toFixed(1)} kg · M ${sameHeightM.toFixed(1)} kg`,
)

const older = predictedWeightKg('female', 163, 50)
const younger = predictedWeightKg('female', 163, 22)
check('Older adults are predicted a bit heavier', older > younger, `${younger.toFixed(1)} → ${older.toFixed(1)} kg`)

const healthyKg = predictedGoalKg(lbToKg(130), 163)
check(
  'Already-healthy weight keeps the same goal',
  Math.abs(healthyKg - lbToKg(130)) < 0.01,
  `${healthyKg.toFixed(2)} kg`,
)

const underKg = predictedGoalKg(lbToKg(100), 163)
check('Underweight goal is a healthy gain', underKg > lbToKg(100) && bmiOf(underKg, 163) >= 19.5, `${kgToLb(underKg).toFixed(0)} lb`)

const tall = suggest({ ...base, ft: '5', inch: '10' }, { ...UNTOUCHED, height: true })
const short = suggest({ ...base, ft: '5', inch: '1' }, { ...UNTOUCHED, height: true })
check(
  'Taller people get a higher predicted weight and goal',
  Number(tall.weight) > Number(short.weight) && Number(tall.goal) > Number(short.goal),
  `5'1 ${short.weight}/${short.goal} · 5'10 ${tall.weight}/${tall.goal}`,
)

const typedWeight = suggest({ ...base, sex: 'male', weight: '200' }, { ...UNTOUCHED, weight: true })
check(
  'Typed weight is not overwritten when sex changes',
  typedWeight.weight === '200' && typedWeight.ft === '5' && typedWeight.inch === '9',
  `${typedWeight.weight} lb at ${typedWeight.ft}'${typedWeight.inch}"`,
)
check(
  'Untouched goal still tracks healthy BMI after a typed weight',
  Number(typedWeight.goal) < 200 && Math.abs(bmiOf(lbToKg(Number(typedWeight.goal)), typicalHeightCm('male')) - 22) < 0.35,
  `${typedWeight.goal} lb`,
)

const typedBoth = suggest(
  { ...typedWeight, goal: '175' },
  { height: false, weight: true, goal: true, pace: false },
)
const afterSex = suggest({ ...typedBoth, sex: 'female' }, { height: false, weight: true, goal: true, pace: false })
check(
  'Typed weight and goal survive a later sex change',
  afterSex.weight === '200' && afterSex.goal === '175',
  `${afterSex.weight} → ${afterSex.goal}`,
)
check(
  'Untouched height still follows sex after typed weights',
  afterSex.ft === '5' && afterSex.inch === '4',
  `${afterSex.ft}'${afterSex.inch}"`,
)

const customHeight = suggest(
  { ...base, sex: 'male', ft: '6', inch: '2' },
  { height: true, weight: false, goal: false, pace: false },
)
check(
  'Typed height is not overwritten when sex changes',
  customHeight.ft === '6' && customHeight.inch === '2',
  `${customHeight.ft}'${customHeight.inch}"`,
)

const metric = convertOnboardingUnits(base, 'metric')
const back = convertOnboardingUnits(metric, 'imperial')
check(
  'Unit switch converts instead of re-predicting',
  metric.units === 'metric' && Number(metric.weight) > 40 && Number(metric.weight) < 100 && back.weight === base.weight && back.goal === base.goal,
  `${base.weight} lb → ${metric.weight} kg → ${back.weight} lb`,
)

const failed = cases.filter((c) => !c.pass)
console.log('| # | Test | Got | Result |')
console.log('|---|------|-----|--------|')
cases.forEach((c, i) => {
  console.log(`| ${i + 1} | ${c.name} | ${c.got.replace(/\|/g, '/')} | ${c.pass ? 'PASS' : 'FAIL'} |`)
})
console.log('')
console.log(`${cases.length - failed.length}/${cases.length} passed`)
if (failed.length) process.exit(1)
